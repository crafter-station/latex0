import { NextResponse } from "next/server"
import { withAuth } from "@/lib/api/with-auth"
import { versionRepository } from "@/lib/db/repositories/version-repository"
import { shareRepository } from "@/lib/db/repositories/share-repository"

export const GET = withAuth<{ id: string; versionId: string }>(
  async (_req, { userId, params }) => {
    const { id, versionId } = params

    const permission = await shareRepository.getUserPermission(id, userId)
    if (!permission) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const version = await versionRepository.getVersionById(versionId)
    if (!version || version.documentId !== id) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 })
    }

    return NextResponse.json(version)
  }
)

// POST to restore a version
export const POST = withAuth<{ id: string; versionId: string }>(
  async (_req, { userId, params }) => {
    const { id, versionId } = params

    const permission = await shareRepository.getUserPermission(id, userId)
    if (permission !== "owner") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const result = await versionRepository.restoreVersion(versionId, userId)
    if (!result) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 })
    }

    return NextResponse.json(result)
  }
)
