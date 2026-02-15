import { NextResponse } from "next/server"
import { z } from "zod"
import { withAuth } from "@/lib/api/with-auth"
import { validateRequest } from "@/lib/api/validate"
import { documentRepository } from "@/lib/db/repositories/document-repository"
import { versionRepository } from "@/lib/db/repositories/version-repository"
import { shareRepository } from "@/lib/db/repositories/share-repository"
import { versionTrigger } from "@/lib/db/schema"

export const GET = withAuth<{ id: string }>(async (req, { userId, params }) => {
  const { id } = params

  const permission = await shareRepository.getUserPermission(id, userId)
  if (!permission) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const { searchParams } = new URL(req.url)
  const limit = parseInt(searchParams.get("limit") || "20")
  const offset = parseInt(searchParams.get("offset") || "0")

  const versions = await versionRepository.getVersions(id, limit, offset)
  const total = await versionRepository.getVersionCount(id)

  return NextResponse.json({ versions, total })
})

const createVersionSchema = z.object({
  triggerType: z.enum(versionTrigger).default("manual"),
})

export const POST = withAuth<{ id: string }>(async (req, { userId, params }) => {
  const { id } = params
  const doc = await documentRepository.findById(id, userId)
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const result = await validateRequest(req, createVersionSchema)
  const triggerType = "error" in result ? "manual" : result.data.triggerType

  const version = await versionRepository.createVersion({
    documentId: id,
    content: doc.content,
    title: doc.title,
    triggerType,
    userId,
  })

  return NextResponse.json(version, { status: 201 })
})
