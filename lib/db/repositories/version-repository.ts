import { eq, and, desc, max } from "drizzle-orm"
import { db } from "@/lib/db"
import {
  documentVersions,
  documents,
  type DocumentVersion,
  type Document,
  type VersionTrigger,
} from "@/lib/db/schema"

export const versionRepository = {
  async createVersion(params: {
    documentId: string
    content: string
    title: string
    triggerType: VersionTrigger
    userId: string
    restoredFrom?: number
  }): Promise<DocumentVersion> {
    const latest = await db
      .select({ maxVersion: max(documentVersions.versionNumber) })
      .from(documentVersions)
      .where(eq(documentVersions.documentId, params.documentId))

    const nextVersion = (latest[0]?.maxVersion ?? 0) + 1

    const result = await db
      .insert(documentVersions)
      .values({
        documentId: params.documentId,
        versionNumber: nextVersion,
        content: params.content,
        contentType: "full",
        title: params.title,
        triggerType: params.triggerType,
        createdBy: params.userId,
        restoredFrom: params.restoredFrom ?? null,
      })
      .returning()

    return result[0]
  },

  async getVersions(
    documentId: string,
    limit = 20,
    offset = 0
  ): Promise<DocumentVersion[]> {
    return db
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.documentId, documentId))
      .orderBy(desc(documentVersions.versionNumber))
      .limit(limit)
      .offset(offset)
  },

  async getVersionById(
    versionId: string
  ): Promise<DocumentVersion | undefined> {
    const result = await db
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.id, versionId))
      .limit(1)
    return result[0]
  },

  async getLatestVersion(
    documentId: string
  ): Promise<DocumentVersion | undefined> {
    const result = await db
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.documentId, documentId))
      .orderBy(desc(documentVersions.versionNumber))
      .limit(1)
    return result[0]
  },

  async getVersionCount(documentId: string): Promise<number> {
    const result = await db
      .select({ maxVersion: max(documentVersions.versionNumber) })
      .from(documentVersions)
      .where(eq(documentVersions.documentId, documentId))
    return result[0]?.maxVersion ?? 0
  },

  async restoreVersion(
    versionId: string,
    userId: string
  ): Promise<{ document: Document; version: DocumentVersion } | null> {
    const version = await this.getVersionById(versionId)
    if (!version) return null

    const doc = await db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.id, version.documentId),
          eq(documents.userId, userId)
        )
      )
      .limit(1)
    if (!doc[0]) return null

    const updatedDoc = await db
      .update(documents)
      .set({
        content: version.content,
        title: version.title,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, version.documentId))
      .returning()

    const newVersion = await this.createVersion({
      documentId: version.documentId,
      content: version.content,
      title: version.title,
      triggerType: "manual",
      userId,
      restoredFrom: version.versionNumber,
    })

    return { document: updatedDoc[0], version: newVersion }
  },

  async shouldCreateSnapshot(
    documentId: string,
    newContent: string
  ): Promise<{ should: boolean; reason?: string }> {
    const latest = await this.getLatestVersion(documentId)

    if (!latest) return { should: true, reason: "first_version" }

    const fifteenMinutes = 15 * 60 * 1000
    if (Date.now() - latest.createdAt.getTime() > fifteenMinutes) {
      return { should: true, reason: "time_based" }
    }

    const lenDiff = Math.abs(newContent.length - latest.content.length)
    if (lenDiff > 100) {
      return { should: true, reason: "significant_size" }
    }

    const oldSections = (latest.content.match(/\\(section|chapter|subsection|usepackage)\b/g) || []).length
    const newSections = (newContent.match(/\\(section|chapter|subsection|usepackage)\b/g) || []).length
    if (oldSections !== newSections) {
      return { should: true, reason: "structural_change" }
    }

    return { should: false }
  },
} as const
