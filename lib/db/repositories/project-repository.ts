import { eq, and, desc, isNull } from "drizzle-orm"
import { db } from "@/lib/db"
import {
  projects,
  folders,
  documents,
  type Project,
  type Folder,
  type Document,
} from "@/lib/db/schema"

const MAX_DEPTH = 3

export const projectRepository = {
  async create(params: {
    name: string
    parentId?: string | null
    userId: string
    description?: string
    color?: string
  }): Promise<Project> {
    let path = `/${params.name}`
    let depth = 0

    if (params.parentId) {
      const parent = await db
        .select()
        .from(projects)
        .where(
          and(
            eq(projects.id, params.parentId),
            eq(projects.userId, params.userId)
          )
        )
        .limit(1)

      if (!parent[0]) throw new Error("Parent project not found")
      if (parent[0].depth >= MAX_DEPTH)
        throw new Error("Maximum project depth exceeded")

      path = `${parent[0].path}/${params.name}`
      depth = parent[0].depth + 1
    }

    const result = await db
      .insert(projects)
      .values({
        name: params.name,
        description: params.description || null,
        parentId: params.parentId || null,
        userId: params.userId,
        path,
        depth,
        color: params.color || null,
      })
      .returning()
    return result[0]
  },

  async findAllByUser(userId: string): Promise<Project[]> {
    return db
      .select()
      .from(projects)
      .where(eq(projects.userId, userId))
      .orderBy(projects.path)
  },

  async findById(id: string, userId: string): Promise<Project | undefined> {
    const result = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, id), eq(projects.userId, userId)))
      .limit(1)
    return result[0]
  },

  async getContents(
    projectId: string,
    userId: string
  ): Promise<{ subProjects: Project[]; folders: Folder[]; documents: Document[] }> {
    const [subProjects, rootFolders, rootDocs] = await Promise.all([
      db
        .select()
        .from(projects)
        .where(
          and(eq(projects.parentId, projectId), eq(projects.userId, userId))
        )
        .orderBy(projects.name),
      db
        .select()
        .from(folders)
        .where(
          and(
            eq(folders.projectId, projectId),
            isNull(folders.parentId),
            eq(folders.userId, userId)
          )
        )
        .orderBy(folders.name),
      db
        .select()
        .from(documents)
        .where(
          and(
            eq(documents.projectId, projectId),
            isNull(documents.folderId),
            eq(documents.userId, userId)
          )
        )
        .orderBy(desc(documents.updatedAt)),
    ])

    return { subProjects, folders: rootFolders, documents: rootDocs }
  },

  async rename(
    id: string,
    userId: string,
    name: string
  ): Promise<Project | undefined> {
    const project = await this.findById(id, userId)
    if (!project) return undefined

    const parentPath = project.path.substring(
      0,
      project.path.lastIndexOf("/")
    )
    const newPath = parentPath ? `${parentPath}/${name}` : `/${name}`

    const result = await db
      .update(projects)
      .set({ name, path: newPath, updatedAt: new Date() })
      .where(and(eq(projects.id, id), eq(projects.userId, userId)))
      .returning()

    if (result[0]) {
      await this.updateDescendantPaths(id, project.path, newPath, userId)
    }

    return result[0]
  },

  async move(
    id: string,
    userId: string,
    newParentId: string | null
  ): Promise<Project | undefined> {
    const project = await this.findById(id, userId)
    if (!project) return undefined

    if (newParentId === id) throw new Error("Cannot move project into itself")

    let newPath: string
    let newDepth: number

    if (newParentId) {
      const newParent = await this.findById(newParentId, userId)
      if (!newParent) throw new Error("Target project not found")
      if (newParent.depth >= MAX_DEPTH)
        throw new Error("Maximum project depth exceeded")

      if (newParent.path.startsWith(project.path + "/"))
        throw new Error("Cannot move project into its descendant")

      newPath = `${newParent.path}/${project.name}`
      newDepth = newParent.depth + 1
    } else {
      newPath = `/${project.name}`
      newDepth = 0
    }

    const oldPath = project.path

    const result = await db
      .update(projects)
      .set({
        parentId: newParentId,
        path: newPath,
        depth: newDepth,
        updatedAt: new Date(),
      })
      .where(and(eq(projects.id, id), eq(projects.userId, userId)))
      .returning()

    if (result[0]) {
      await this.updateDescendantPaths(id, oldPath, newPath, userId)
    }

    return result[0]
  },

  async updateDetails(
    id: string,
    userId: string,
    data: { description?: string; color?: string }
  ): Promise<Project | undefined> {
    const updates: Record<string, unknown> = { updatedAt: new Date() }
    if (data.description !== undefined) updates.description = data.description
    if (data.color !== undefined) updates.color = data.color

    const result = await db
      .update(projects)
      .set(updates)
      .where(and(eq(projects.id, id), eq(projects.userId, userId)))
      .returning()

    return result[0]
  },

  async delete(id: string, userId: string): Promise<boolean> {
    const project = await this.findById(id, userId)
    if (!project) return false

    const allProjects = await db
      .select()
      .from(projects)
      .where(eq(projects.userId, userId))

    const descendantIds = this.getDescendantIds(id, allProjects)
    const allIds = [id, ...descendantIds]

    // Nullify projectId for documents and folders in this project and descendants
    for (const pid of allIds) {
      await db
        .update(documents)
        .set({ projectId: null, updatedAt: new Date() })
        .where(
          and(eq(documents.projectId, pid), eq(documents.userId, userId))
        )
      await db
        .update(folders)
        .set({ projectId: null, updatedAt: new Date() })
        .where(
          and(eq(folders.projectId, pid), eq(folders.userId, userId))
        )
    }

    // Delete the project
    const result = await db
      .delete(projects)
      .where(and(eq(projects.id, id), eq(projects.userId, userId)))
      .returning()

    // Delete descendant projects
    for (const did of descendantIds) {
      await db
        .delete(projects)
        .where(and(eq(projects.id, did), eq(projects.userId, userId)))
    }

    return result.length > 0
  },

  // Helpers

  getDescendantIds(parentId: string, allProjects: Project[]): string[] {
    const children = allProjects.filter((p) => p.parentId === parentId)
    const ids: string[] = []
    for (const child of children) {
      ids.push(child.id)
      ids.push(...this.getDescendantIds(child.id, allProjects))
    }
    return ids
  },

  async updateDescendantPaths(
    parentId: string,
    oldPath: string,
    newPath: string,
    userId: string
  ) {
    const allProjects = await db
      .select()
      .from(projects)
      .where(eq(projects.userId, userId))

    const descendants = allProjects.filter(
      (p) => p.path.startsWith(oldPath + "/") && p.id !== parentId
    )

    for (const d of descendants) {
      const updatedPath = newPath + d.path.substring(oldPath.length)
      await db
        .update(projects)
        .set({ path: updatedPath, updatedAt: new Date() })
        .where(eq(projects.id, d.id))
    }
  },
}
