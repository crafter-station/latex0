import { NextResponse } from "next/server"
import { z } from "zod"
import { eq, and, isNull, desc, sql } from "drizzle-orm"
import { withAuth } from "@/lib/api/with-auth"
import { validateRequest } from "@/lib/api/validate"
import { projectRepository } from "@/lib/db/repositories/project-repository"
import { db } from "@/lib/db"
import { documents } from "@/lib/db/schema"

export const GET = withAuth(async (_req, { userId }) => {
  const allProjects = await projectRepository.findAllByUser(userId)

  // Batch-fetch the first document ID per project (single query)
  const projectIds = allProjects.map((p) => p.id)
  let firstDocMap: Record<string, string> = {}

  if (projectIds.length > 0) {
    const firstDocs = await db
      .selectDistinctOn([documents.projectId], {
        projectId: documents.projectId,
        id: documents.id,
      })
      .from(documents)
      .where(
        and(
          eq(documents.userId, userId),
          isNull(documents.folderId),
          sql`${documents.projectId} = ANY(${projectIds})`
        )
      )
      .orderBy(documents.projectId, desc(documents.updatedAt))

    firstDocMap = Object.fromEntries(
      firstDocs
        .filter((d) => d.projectId !== null)
        .map((d) => [d.projectId!, d.id])
    )
  }

  const enriched = allProjects.map((p) => ({
    ...p,
    firstDocumentId: firstDocMap[p.id] ?? null,
  }))

  return NextResponse.json(enriched)
})

const createProjectSchema = z.object({
  name: z.string().min(1).transform((s) => s.trim()),
  parentId: z.string().nullish(),
  description: z.string().optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
})

export const POST = withAuth(async (req, { userId }) => {
  const result = await validateRequest(req, createProjectSchema)
  if ("error" in result) return result.error

  const { name, parentId, description, color } = result.data

  try {
    const project = await projectRepository.create({
      name,
      parentId: parentId || null,
      userId,
      description,
      color,
    })
    return NextResponse.json(project, { status: 201 })
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create project"
    return NextResponse.json({ error: message }, { status: 400 })
  }
})
