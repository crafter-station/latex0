import { NextResponse } from "next/server"
import { withAuth } from "@/lib/api/with-auth"
import { documentRepository } from "@/lib/db/repositories/document-repository"
import { shareRepository } from "@/lib/db/repositories/share-repository"
import { versionRepository } from "@/lib/db/repositories/version-repository"

export const GET = withAuth<{ id: string }>(async (_req, { userId, params }) => {
  const { id } = params

  // Check ownership first
  const doc = await documentRepository.findById(id, userId)
  if (doc) {
    return NextResponse.json({ ...doc, permission: "owner" })
  }

  // Check share access
  const permission = await shareRepository.getUserPermission(id, userId)
  if (permission) {
    const sharedDoc = await documentRepository.findByIdUnsafe(id)
    if (sharedDoc) {
      return NextResponse.json({ ...sharedDoc, permission })
    }
  }

  return NextResponse.json({ error: "Not found" }, { status: 404 })
})

export const PATCH = withAuth<{ id: string }>(async (req, { userId, params }) => {
  const { id } = params
  const body = await req.json()
  const { title, content, folder, folderId } = body

  // Check if user owns the doc
  let doc = await documentRepository.findById(id, userId)

  // If not owner, check for edit share access
  if (!doc) {
    const permission = await shareRepository.getUserPermission(id, userId)
    if (permission === "edit") {
      doc = await documentRepository.updateUnsafe(id, {
        ...(content !== undefined && { content }),
      })
      if (!doc) {
        return NextResponse.json({ error: "Not found" }, { status: 404 })
      }

      if (content !== undefined) {
        const check = await versionRepository.shouldCreateSnapshot(id, content)
        if (check.should) {
          await versionRepository.createVersion({
            documentId: id,
            content,
            title: doc.title,
            triggerType: "auto",
            userId,
          })
        }
      }

      return NextResponse.json(doc)
    }
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const updatedDoc = await documentRepository.update(id, userId, {
    ...(title !== undefined && { title }),
    ...(content !== undefined && { content }),
    ...(folder !== undefined && { folder }),
    ...(folderId !== undefined && { folderId }),
  })

  if (!updatedDoc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  if (content !== undefined) {
    const check = await versionRepository.shouldCreateSnapshot(id, content)
    if (check.should) {
      await versionRepository.createVersion({
        documentId: id,
        content,
        title: updatedDoc.title,
        triggerType: "auto",
        userId,
      })
    }
  }

  return NextResponse.json(updatedDoc)
})

export const DELETE = withAuth<{ id: string }>(async (_req, { userId, params }) => {
  const { id } = params
  const deleted = await documentRepository.delete(id, userId)
  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  return NextResponse.json({ success: true })
})
