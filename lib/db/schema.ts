import { pgTable, text, timestamp, varchar, integer, unique } from "drizzle-orm/pg-core"
import { createInsertSchema, createSelectSchema } from "drizzle-zod"
import { nanoid } from "nanoid"

// ─── Enum Types ─────────────────────────────────────────────────────────────

export const documentVisibility = ["private", "shared", "public"] as const
export type DocumentVisibility = (typeof documentVisibility)[number]

export const sharePermission = ["view", "edit"] as const
export type SharePermission = (typeof sharePermission)[number]

export const userPermission = ["owner", "view", "edit"] as const
export type UserPermission = (typeof userPermission)[number]

export const versionTrigger = ["auto", "manual", "compile", "significant"] as const
export type VersionTrigger = (typeof versionTrigger)[number]

export const versionContentType = ["full", "delta"] as const
export type VersionContentType = (typeof versionContentType)[number]

export const folderVisibility = ["private", "shared"] as const
export type FolderVisibility = (typeof folderVisibility)[number]

// ─── Documents ──────────────────────────────────────────────────────────────

export const documents = pgTable("documents", {
  id: varchar("id", { length: 21 })
    .primaryKey()
    .$defaultFn(() => nanoid()),
  title: varchar("title", { length: 255 }).notNull().default("Untitled Document"),
  content: text("content").notNull().default(""),
  folder: varchar("folder", { length: 255 }).notNull().default("root"),
  folderId: varchar("folder_id", { length: 21 }),
  userId: text("user_id").notNull(),
  visibility: text("visibility", { enum: documentVisibility }).notNull().default("private"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export type Document = typeof documents.$inferSelect
export type NewDocument = typeof documents.$inferInsert

// ─── Document Shares ────────────────────────────────────────────────────────

export const documentShares = pgTable("document_shares", {
  id: varchar("id", { length: 21 })
    .primaryKey()
    .$defaultFn(() => nanoid()),
  documentId: varchar("document_id", { length: 21 }).notNull(),
  sharedBy: text("shared_by").notNull(),
  sharedWith: text("shared_with"),
  permission: text("permission", { enum: sharePermission }).notNull(),
  shareToken: text("share_token")
    .unique()
    .$defaultFn(() => nanoid(32)),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export type DocumentShare = typeof documentShares.$inferSelect
export type NewDocumentShare = typeof documentShares.$inferInsert

// ─── Folders ────────────────────────────────────────────────────────────────

export const folders = pgTable("folders", {
  id: varchar("id", { length: 21 })
    .primaryKey()
    .$defaultFn(() => nanoid()),
  name: varchar("name", { length: 255 }).notNull(),
  parentId: varchar("parent_id", { length: 21 }),
  userId: text("user_id").notNull(),
  path: text("path").notNull(),
  depth: integer("depth").notNull().default(0),
  visibility: text("visibility", { enum: folderVisibility }).notNull().default("private"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export type Folder = typeof folders.$inferSelect
export type NewFolder = typeof folders.$inferInsert

// ─── Document Versions ──────────────────────────────────────────────────────

export const documentVersions = pgTable("document_versions", {
  id: varchar("id", { length: 21 })
    .primaryKey()
    .$defaultFn(() => nanoid()),
  documentId: varchar("document_id", { length: 21 }).notNull(),
  versionNumber: integer("version_number").notNull(),
  content: text("content").notNull(),
  contentType: text("content_type", { enum: versionContentType }).notNull(),
  title: text("title").notNull(),
  triggerType: text("trigger_type", { enum: versionTrigger }).notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  restoredFrom: integer("restored_from"),
}, (table) => [
  unique("unique_doc_version").on(table.documentId, table.versionNumber),
])

export type DocumentVersion = typeof documentVersions.$inferSelect
export type NewDocumentVersion = typeof documentVersions.$inferInsert

// ─── Zod Schemas ────────────────────────────────────────────────────────────

export const insertDocumentSchema = createInsertSchema(documents)
export const selectDocumentSchema = createSelectSchema(documents)

export const insertDocumentShareSchema = createInsertSchema(documentShares)
export const selectDocumentShareSchema = createSelectSchema(documentShares)

export const insertFolderSchema = createInsertSchema(folders)
export const selectFolderSchema = createSelectSchema(folders)

export const insertDocumentVersionSchema = createInsertSchema(documentVersions)
export const selectDocumentVersionSchema = createSelectSchema(documentVersions)

export const updateDocumentSchema = insertDocumentSchema.partial()
export const updateFolderSchema = insertFolderSchema.partial()
