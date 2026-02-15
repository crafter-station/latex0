import { NextResponse } from "next/server"
import { z } from "zod"
import { withAuth } from "@/lib/api/with-auth"
import { validateRequest } from "@/lib/api/validate"
import { projectRepository } from "@/lib/db/repositories/project-repository"

export const GET = withAuth<{ id: string }>(async (_req, { userId, params }) => {
  const { id } = params
  const project = await projectRepository.findById(id, userId)
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const contents = await projectRepository.getContents(id, userId)
  return NextResponse.json({ project, ...contents })
})

const updateProjectSchema = z.object({
  name: z.string().min(1).transform((s) => s.trim()).optional(),
  parentId: z.string().nullable().optional(),
  description: z.string().optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .nullable()
    .optional(),
})

export const PATCH = withAuth<{ id: string }>(async (req, { userId, params }) => {
  const { id } = params
  const result = await validateRequest(req, updateProjectSchema)
  if ("error" in result) return result.error

  const { name, parentId, description, color } = result.data

  try {
    if (name !== undefined) {
      const project = await projectRepository.rename(id, userId, name)
      if (!project) {
        return NextResponse.json({ error: "Not found" }, { status: 404 })
      }
      return NextResponse.json(project)
    }

    if (parentId !== undefined) {
      const project = await projectRepository.move(id, userId, parentId)
      if (!project) {
        return NextResponse.json({ error: "Not found" }, { status: 404 })
      }
      return NextResponse.json(project)
    }

    if (description !== undefined || color !== undefined) {
      const project = await projectRepository.updateDetails(id, userId, {
        description,
        color: color ?? undefined,
      })
      if (!project) {
        return NextResponse.json({ error: "Not found" }, { status: 404 })
      }
      return NextResponse.json(project)
    }

    return NextResponse.json({ error: "No updates provided" }, { status: 400 })
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to update project"
    return NextResponse.json({ error: message }, { status: 400 })
  }
})

export const DELETE = withAuth<{ id: string }>(async (_req, { userId, params }) => {
  const { id } = params
  const deleted = await projectRepository.delete(id, userId)
  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  return NextResponse.json({ success: true })
})
