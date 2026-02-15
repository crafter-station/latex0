import { eq, and, or, isNull, gt } from "drizzle-orm"
import { db } from "@/lib/db"
import {
  projectShares,
  projects,
  type ProjectShare,
  type Project,
  type SharePermission,
  type UserPermission,
} from "@/lib/db/schema"

export const projectShareRepository = {
  async createShare(params: {
    projectId: string
    sharedBy: string
    sharedWith?: string
    permission: SharePermission
    expiresAt?: Date
  }): Promise<ProjectShare> {
    const result = await db
      .insert(projectShares)
      .values({
        projectId: params.projectId,
        sharedBy: params.sharedBy,
        sharedWith: params.sharedWith || null,
        permission: params.permission,
        expiresAt: params.expiresAt || null,
      })
      .returning()
    return result[0]
  },

  async getSharesByProject(projectId: string): Promise<ProjectShare[]> {
    return db
      .select()
      .from(projectShares)
      .where(eq(projectShares.projectId, projectId))
  },

  async getShareByToken(
    token: string
  ): Promise<(ProjectShare & { project: Project }) | null> {
    const result = await db
      .select({
        share: projectShares,
        project: projects,
      })
      .from(projectShares)
      .innerJoin(projects, eq(projectShares.projectId, projects.id))
      .where(
        and(
          eq(projectShares.shareToken, token),
          or(
            isNull(projectShares.expiresAt),
            gt(projectShares.expiresAt, new Date())
          )
        )
      )
      .limit(1)

    if (!result[0]) return null
    return { ...result[0].share, project: result[0].project }
  },

  async revokeShare(shareId: string, userId: string): Promise<boolean> {
    const result = await db
      .delete(projectShares)
      .where(
        and(
          eq(projectShares.id, shareId),
          eq(projectShares.sharedBy, userId)
        )
      )
      .returning()
    return result.length > 0
  },

  async getSharedWithUser(userId: string): Promise<Project[]> {
    const result = await db
      .select({ project: projects })
      .from(projectShares)
      .innerJoin(projects, eq(projectShares.projectId, projects.id))
      .where(
        and(
          eq(projectShares.sharedWith, userId),
          or(
            isNull(projectShares.expiresAt),
            gt(projectShares.expiresAt, new Date())
          )
        )
      )
    return result.map((r) => r.project)
  },

  async getUserPermission(
    projectId: string,
    userId: string
  ): Promise<UserPermission | null> {
    const project = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
      .limit(1)
    if (project[0]) return "owner"

    const share = await db
      .select()
      .from(projectShares)
      .where(
        and(
          eq(projectShares.projectId, projectId),
          eq(projectShares.sharedWith, userId),
          or(
            isNull(projectShares.expiresAt),
            gt(projectShares.expiresAt, new Date())
          )
        )
      )
      .limit(1)

    if (!share[0]) return null
    return share[0].permission as UserPermission
  },
} as const
