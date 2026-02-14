import { NextResponse } from "next/server"
import { z } from "zod"
import { withAuth } from "@/lib/api/with-auth"
import { validateRequest } from "@/lib/api/validate"
import { projectRepository } from "@/lib/db/repositories/project-repository"

export const GET = withAuth(async (_req, { userId }) => {
  const allProjects = await projectRepository.findAllByUser(userId)
  return NextResponse.json(allProjects)
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
