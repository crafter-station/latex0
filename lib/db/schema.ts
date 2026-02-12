import { pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core"
import { nanoid } from "nanoid"

export const documents = pgTable("documents", {
  id: varchar("id", { length: 21 })
    .primaryKey()
    .$defaultFn(() => nanoid()),
  title: varchar("title", { length: 255 }).notNull().default("Untitled Document"),
  content: text("content").notNull().default(""),
  folder: varchar("folder", { length: 255 }).notNull().default("root"),
  userId: text("user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export type Document = typeof documents.$inferSelect
export type NewDocument = typeof documents.$inferInsert
