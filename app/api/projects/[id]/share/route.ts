import { NextResponse } from "next/server"
import { z } from "zod"
import { withAuth } from "@/lib/api/with-auth"
import { validateRequest } from "@/lib/api/validate"
import { projectRepository } from "@/lib/db/repositories/project-repository"
import { projectShareRepository } from "@/lib/db/repositories/project-share-repository"

export const GET = withAuth<{ id: string }>(async (_req, { userId, params }) => {
  const { id } = params
  const project = await projectRepository.findById(id, userId)
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const shares = await projectShareRepository.getSharesByProject(id)
  return NextResponse.json(shares)
})

const createShareSchema = z.object({
  sharedWith: z.string().optional(),
  permission: z.enum(["view", "edit"]),
  expiresAt: z.string().datetime().optional(),
})

export const POST = withAuth<{ id: string }>(async (req, { userId, params }) => {
  const { id } = params
  const project = await projectRepository.findById(id, userId)
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const result = await validateRequest(req, createShareSchema)
  if ("error" in result) return result.error

  const { sharedWith, permission, expiresAt } = result.data

  const share = await projectShareRepository.createShare({
    projectId: id,
    sharedBy: userId,
    sharedWith: sharedWith || undefined,
    permission,
    expiresAt: expiresAt ? new Date(expiresAt) : undefined,
  })

  return NextResponse.json(share, { status: 201 })
})

export const DELETE = withAuth<{ id: string }>(async (req, { userId, params }) => {
  const { id } = params
  const { searchParams } = new URL(req.url)
  const shareId = searchParams.get("shareId")

  if (!shareId) {
    return NextResponse.json(
      { error: "shareId query parameter required" },
      { status: 400 }
    )
  }

  const project = await projectRepository.findById(id, userId)
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const revoked = await projectShareRepository.revokeShare(shareId, userId)
  if (!revoked) {
    return NextResponse.json({ error: "Share not found" }, { status: 404 })
  }

  return NextResponse.json({ success: true })
})
