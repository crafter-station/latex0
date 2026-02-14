import { eq, and, or, isNull, gt } from "drizzle-orm"
import { db } from "@/lib/db"
import {
  documentShares,
  documents,
  type DocumentShare,
  type Document,
  type SharePermission,
  type UserPermission,
  type DocumentVisibility,
} from "@/lib/db/schema"

export const shareRepository = {
  async createShare(params: {
    documentId: string
    sharedBy: string
    sharedWith?: string
    permission: SharePermission
    expiresAt?: Date
  }): Promise<DocumentShare> {
    const result = await db
      .insert(documentShares)
      .values({
        documentId: params.documentId,
        sharedBy: params.sharedBy,
        sharedWith: params.sharedWith || null,
        permission: params.permission,
        expiresAt: params.expiresAt || null,
      })
      .returning()
    return result[0]
  },

  async getSharesByDocument(documentId: string): Promise<DocumentShare[]> {
    return db
      .select()
      .from(documentShares)
      .where(eq(documentShares.documentId, documentId))
  },

  async getShareByToken(
    token: string
  ): Promise<(DocumentShare & { document: Document }) | null> {
    const result = await db
      .select({
        share: documentShares,
        document: documents,
      })
      .from(documentShares)
      .innerJoin(documents, eq(documentShares.documentId, documents.id))
      .where(
        and(
          eq(documentShares.shareToken, token),
          or(
            isNull(documentShares.expiresAt),
            gt(documentShares.expiresAt, new Date())
          )
        )
      )
      .limit(1)

    if (!result[0]) return null
    return { ...result[0].share, document: result[0].document }
  },

  async revokeShare(shareId: string, userId: string): Promise<boolean> {
    const result = await db
      .delete(documentShares)
      .where(
        and(
          eq(documentShares.id, shareId),
          eq(documentShares.sharedBy, userId)
        )
      )
      .returning()
    return result.length > 0
  },

  async getSharedWithUser(userId: string): Promise<Document[]> {
    const result = await db
      .select({ document: documents })
      .from(documentShares)
      .innerJoin(documents, eq(documentShares.documentId, documents.id))
      .where(
        and(
          eq(documentShares.sharedWith, userId),
          or(
            isNull(documentShares.expiresAt),
            gt(documentShares.expiresAt, new Date())
          )
        )
      )
    return result.map((r) => r.document)
  },

  async getUserPermission(
    documentId: string,
    userId: string
  ): Promise<UserPermission | null> {
    const doc = await db
      .select()
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.userId, userId)))
      .limit(1)
    if (doc[0]) return "owner"

    const share = await db
      .select()
      .from(documentShares)
      .where(
        and(
          eq(documentShares.documentId, documentId),
          eq(documentShares.sharedWith, userId),
          or(
            isNull(documentShares.expiresAt),
            gt(documentShares.expiresAt, new Date())
          )
        )
      )
      .limit(1)

    if (!share[0]) return null
    return share[0].permission as UserPermission
  },

  async updateDocumentVisibility(
    documentId: string,
    visibility: DocumentVisibility
  ) {
    await db
      .update(documents)
      .set({ visibility, updatedAt: new Date() })
      .where(eq(documents.id, documentId))
  },
} as const
