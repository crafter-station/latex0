import { eq, and, desc, isNull } from "drizzle-orm"
import { db } from "@/lib/db"
import { folders, documents, type Folder, type Document } from "@/lib/db/schema"

const MAX_DEPTH = 10

export const folderRepository = {
  async create(params: {
    name: string
    parentId?: string | null
    userId: string
  }): Promise<Folder> {
    let path = `/${params.name}`
    let depth = 0

    if (params.parentId) {
      const parent = await db
        .select()
        .from(folders)
        .where(
          and(
            eq(folders.id, params.parentId),
            eq(folders.userId, params.userId)
          )
        )
        .limit(1)

      if (!parent[0]) throw new Error("Parent folder not found")
      if (parent[0].depth >= MAX_DEPTH)
        throw new Error("Maximum folder depth exceeded")

      path = `${parent[0].path}/${params.name}`
      depth = parent[0].depth + 1
    }

    const result = await db
      .insert(folders)
      .values({
        name: params.name,
        parentId: params.parentId || null,
        userId: params.userId,
        path,
        depth,
      })
      .returning()
    return result[0]
  },

  async findAllByUser(userId: string): Promise<Folder[]> {
    return db
      .select()
      .from(folders)
      .where(eq(folders.userId, userId))
      .orderBy(folders.path)
  },

  async findById(id: string, userId: string): Promise<Folder | undefined> {
    const result = await db
      .select()
      .from(folders)
      .where(and(eq(folders.id, id), eq(folders.userId, userId)))
      .limit(1)
    return result[0]
  },

  async getContents(
    folderId: string | null,
    userId: string
  ): Promise<{ folders: Folder[]; documents: Document[] }> {
    const folderCondition = folderId
      ? and(eq(folders.parentId, folderId), eq(folders.userId, userId))
      : and(isNull(folders.parentId), eq(folders.userId, userId))

    const docCondition = folderId
      ? and(eq(documents.folderId, folderId), eq(documents.userId, userId))
      : and(isNull(documents.folderId), eq(documents.userId, userId))

    const [childFolders, childDocs] = await Promise.all([
      db.select().from(folders).where(folderCondition).orderBy(folders.name),
      db
        .select()
        .from(documents)
        .where(docCondition)
        .orderBy(desc(documents.updatedAt)),
    ])

    return { folders: childFolders, documents: childDocs }
  },

  async rename(
    id: string,
    userId: string,
    name: string
  ): Promise<Folder | undefined> {
    const folder = await this.findById(id, userId)
    if (!folder) return undefined

    // Calculate new path
    const parentPath = folder.path.substring(
      0,
      folder.path.lastIndexOf("/")
    )
    const newPath = parentPath ? `${parentPath}/${name}` : `/${name}`

    // Update this folder
    const result = await db
      .update(folders)
      .set({ name, path: newPath, updatedAt: new Date() })
      .where(and(eq(folders.id, id), eq(folders.userId, userId)))
      .returning()

    if (result[0]) {
      // Update all descendant paths
      await this.updateDescendantPaths(id, folder.path, newPath, userId)
    }

    return result[0]
  },

  async move(
    id: string,
    userId: string,
    newParentId: string | null
  ): Promise<Folder | undefined> {
    const folder = await this.findById(id, userId)
    if (!folder) return undefined

    // Prevent moving a folder into itself
    if (newParentId === id) throw new Error("Cannot move folder into itself")

    let newPath: string
    let newDepth: number

    if (newParentId) {
      const newParent = await this.findById(newParentId, userId)
      if (!newParent) throw new Error("Target folder not found")
      if (newParent.depth >= MAX_DEPTH)
        throw new Error("Maximum folder depth exceeded")

      // Prevent moving into a descendant
      if (newParent.path.startsWith(folder.path + "/"))
        throw new Error("Cannot move folder into its descendant")

      newPath = `${newParent.path}/${folder.name}`
      newDepth = newParent.depth + 1
    } else {
      newPath = `/${folder.name}`
      newDepth = 0
    }

    const oldPath = folder.path

    const result = await db
      .update(folders)
      .set({
        parentId: newParentId,
        path: newPath,
        depth: newDepth,
        updatedAt: new Date(),
      })
      .where(and(eq(folders.id, id), eq(folders.userId, userId)))
      .returning()

    if (result[0]) {
      await this.updateDescendantPaths(id, oldPath, newPath, userId)
    }

    return result[0]
  },

  async delete(id: string, userId: string): Promise<boolean> {
    // Set documents in this folder and subfolders to null folderId
    const folder = await this.findById(id, userId)
    if (!folder) return false

    // Get all descendant folder IDs
    const allFolders = await db
      .select()
      .from(folders)
      .where(eq(folders.userId, userId))

    const descendantIds = this.getDescendantIds(id, allFolders)
    const allIds = [id, ...descendantIds]

    // Nullify folderId for documents in these folders
    for (const fid of allIds) {
      await db
        .update(documents)
        .set({ folderId: null, updatedAt: new Date() })
        .where(
          and(eq(documents.folderId, fid), eq(documents.userId, userId))
        )
    }

    // Delete the folder (cascades to children via parentId)
    const result = await db
      .delete(folders)
      .where(and(eq(folders.id, id), eq(folders.userId, userId)))
      .returning()

    // Also delete descendant folders explicitly (no FK cascade in drizzle)
    for (const did of descendantIds) {
      await db
        .delete(folders)
        .where(and(eq(folders.id, did), eq(folders.userId, userId)))
    }

    return result.length > 0
  },

  async moveDocument(
    documentId: string,
    userId: string,
    folderId: string | null
  ): Promise<Document | undefined> {
    if (folderId) {
      const folder = await this.findById(folderId, userId)
      if (!folder) throw new Error("Target folder not found")
    }

    const result = await db
      .update(documents)
      .set({ folderId, updatedAt: new Date() })
      .where(and(eq(documents.id, documentId), eq(documents.userId, userId)))
      .returning()

    return result[0]
  },

  // Private helpers

  getDescendantIds(parentId: string, allFolders: Folder[]): string[] {
    const children = allFolders.filter((f) => f.parentId === parentId)
    const ids: string[] = []
    for (const child of children) {
      ids.push(child.id)
      ids.push(...this.getDescendantIds(child.id, allFolders))
    }
    return ids
  },

  async updateDescendantPaths(
    parentId: string,
    oldPath: string,
    newPath: string,
    userId: string
  ) {
    // Get all folders for this user and update paths of descendants
    const allFolders = await db
      .select()
      .from(folders)
      .where(eq(folders.userId, userId))

    const descendants = allFolders.filter(
      (f) => f.path.startsWith(oldPath + "/") && f.id !== parentId
    )

    for (const desc of descendants) {
      const updatedPath = newPath + desc.path.substring(oldPath.length)
      await db
        .update(folders)
        .set({ path: updatedPath, updatedAt: new Date() })
        .where(eq(folders.id, desc.id))
    }
  },
}
