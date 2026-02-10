import { eq, and, desc } from "drizzle-orm"
import { db } from "@/lib/db"
import { documents, type Document, type NewDocument } from "@/lib/db/schema"

export interface IDocumentRepository {
  findAllByUser(userId: string): Promise<Document[]>
  findById(id: string, userId: string): Promise<Document | undefined>
  create(data: NewDocument): Promise<Document>
  update(
    id: string,
    userId: string,
    data: Partial<Pick<Document, "title" | "content" | "folder">>
  ): Promise<Document | undefined>
  delete(id: string, userId: string): Promise<boolean>
}

export const documentRepository: IDocumentRepository = {
  async findAllByUser(userId: string) {
    return db
      .select()
      .from(documents)
      .where(eq(documents.userId, userId))
      .orderBy(desc(documents.updatedAt))
  },

  async findById(id: string, userId: string) {
    const result = await db
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), eq(documents.userId, userId)))
      .limit(1)
    return result[0]
  },

  async create(data: NewDocument) {
    const result = await db.insert(documents).values(data).returning()
    return result[0]
  },

  async update(id, userId, data) {
    const result = await db
      .update(documents)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(documents.id, id), eq(documents.userId, userId)))
      .returning()
    return result[0]
  },

  async delete(id: string, userId: string) {
    const result = await db
      .delete(documents)
      .where(and(eq(documents.id, id), eq(documents.userId, userId)))
      .returning()
    return result.length > 0
  },
}
