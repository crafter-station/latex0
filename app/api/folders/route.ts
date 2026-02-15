import { NextResponse } from "next/server"
import { z } from "zod"
import { withAuth } from "@/lib/api/with-auth"
import { validateRequest } from "@/lib/api/validate"
import { folderRepository } from "@/lib/db/repositories/folder-repository"

export const GET = withAuth(async (_req, { userId }) => {
  const allFolders = await folderRepository.findAllByUser(userId)
  return NextResponse.json(allFolders)
})

const createFolderSchema = z.object({
  name: z.string().min(1).transform((s) => s.trim()),
  parentId: z.string().nullish(),
})

export const POST = withAuth(async (req, { userId }) => {
  const result = await validateRequest(req, createFolderSchema)
  if ("error" in result) return result.error

  const { name, parentId } = result.data

  try {
    const folder = await folderRepository.create({
      name,
      parentId: parentId || null,
      userId,
    })
    return NextResponse.json(folder, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create folder"
    return NextResponse.json({ error: message }, { status: 400 })
  }
})
