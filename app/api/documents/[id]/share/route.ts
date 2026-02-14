import { NextResponse } from "next/server"
import { withAuth } from "@/lib/api/with-auth"
import { validateRequest } from "@/lib/api/validate"
import { documentRepository } from "@/lib/db/repositories/document-repository"
import { shareRepository } from "@/lib/db/repositories/share-repository"
import { insertDocumentShareSchema } from "@/lib/db/schema"

export const GET = withAuth<{ id: string }>(async (_req, { userId, params }) => {
  const { id } = params
  const doc = await documentRepository.findById(id, userId)
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const shares = await shareRepository.getSharesByDocument(id)
  return NextResponse.json(shares)
})

const createShareSchema = insertDocumentShareSchema.pick({
  permission: true,
}).extend({
  sharedWith: insertDocumentShareSchema.shape.sharedWith.optional(),
  expiresAt: insertDocumentShareSchema.shape.expiresAt.optional(),
})

export const POST = withAuth<{ id: string }>(async (req, { userId, params }) => {
  const { id } = params
  const doc = await documentRepository.findById(id, userId)
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const result = await validateRequest(req, createShareSchema)
  if ("error" in result) return result.error

  const { sharedWith, permission, expiresAt } = result.data

  const share = await shareRepository.createShare({
    documentId: id,
    sharedBy: userId,
    sharedWith: sharedWith || undefined,
    permission,
    expiresAt: expiresAt || undefined,
  })

  const newVisibility = sharedWith ? "shared" : "public"
  await shareRepository.updateDocumentVisibility(id, newVisibility)

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

  const doc = await documentRepository.findById(id, userId)
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const revoked = await shareRepository.revokeShare(shareId, userId)
  if (!revoked) {
    return NextResponse.json({ error: "Share not found" }, { status: 404 })
  }

  const remainingShares = await shareRepository.getSharesByDocument(id)
  if (remainingShares.length === 0) {
    await shareRepository.updateDocumentVisibility(id, "private")
  }

  return NextResponse.json({ success: true })
})
