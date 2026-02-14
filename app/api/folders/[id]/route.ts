import { NextResponse } from "next/server"
import { z } from "zod"
import { withAuth } from "@/lib/api/with-auth"
import { validateRequest } from "@/lib/api/validate"
import { folderRepository } from "@/lib/db/repositories/folder-repository"

export const GET = withAuth<{ id: string }>(async (_req, { userId, params }) => {
  const { id } = params
  const folder = await folderRepository.findById(id, userId)
  if (!folder) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const contents = await folderRepository.getContents(id, userId)
  return NextResponse.json({ folder, ...contents })
})

const updateFolderSchema = z.object({
  name: z.string().min(1).transform((s) => s.trim()).optional(),
  parentId: z.string().nullable().optional(),
})

export const PATCH = withAuth<{ id: string }>(async (req, { userId, params }) => {
  const { id } = params
  const result = await validateRequest(req, updateFolderSchema)
  if ("error" in result) return result.error

  const { name, parentId } = result.data

  try {
    if (name !== undefined) {
      const folder = await folderRepository.rename(id, userId, name)
      if (!folder) {
        return NextResponse.json({ error: "Not found" }, { status: 404 })
      }
      return NextResponse.json(folder)
    }

    if (parentId !== undefined) {
      const folder = await folderRepository.move(id, userId, parentId)
      if (!folder) {
        return NextResponse.json({ error: "Not found" }, { status: 404 })
      }
      return NextResponse.json(folder)
    }

    return NextResponse.json({ error: "No updates provided" }, { status: 400 })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update folder"
    return NextResponse.json({ error: message }, { status: 400 })
  }
})

export const DELETE = withAuth<{ id: string }>(async (_req, { userId, params }) => {
  const { id } = params
  const deleted = await folderRepository.delete(id, userId)
  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  return NextResponse.json({ success: true })
})
