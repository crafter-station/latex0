import { eq, and, desc } from "drizzle-orm"
import { db } from "@/lib/db"
import { documents, type Document, type NewDocument } from "@/lib/db/schema"

export const documentRepository = {
  async findAllByUser(userId: string): Promise<Document[]> {
    return db
      .select()
      .from(documents)
      .where(eq(documents.userId, userId))
      .orderBy(desc(documents.updatedAt))
  },

  async findById(id: string, userId: string): Promise<Document | undefined> {
    const result = await db
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), eq(documents.userId, userId)))
      .limit(1)
    return result[0]
  },

  async findByIdUnsafe(id: string): Promise<Document | undefined> {
    const result = await db
      .select()
      .from(documents)
      .where(eq(documents.id, id))
      .limit(1)
    return result[0]
  },

  async create(data: NewDocument): Promise<Document> {
    const result = await db.insert(documents).values(data).returning()
    return result[0]
  },

  async update(
    id: string,
    userId: string,
    data: Partial<Pick<Document, "title" | "content" | "folder" | "folderId">>
  ): Promise<Document | undefined> {
    const result = await db
      .update(documents)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(documents.id, id), eq(documents.userId, userId)))
      .returning()
    return result[0]
  },

  async updateUnsafe(
    id: string,
    data: Partial<Pick<Document, "title" | "content">>
  ): Promise<Document | undefined> {
    const result = await db
      .update(documents)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(documents.id, id))
      .returning()
    return result[0]
  },

  async delete(id: string, userId: string): Promise<boolean> {
    const result = await db
      .delete(documents)
      .where(and(eq(documents.id, id), eq(documents.userId, userId)))
      .returning()
    return result.length > 0
  },
} as const
