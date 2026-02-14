import { NextRequest, NextResponse } from "next/server"
import { shareRepository } from "@/lib/db/repositories/share-repository"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  const result = await shareRepository.getShareByToken(token)
  if (!result) {
    return NextResponse.json(
      { error: "Share link not found or expired" },
      { status: 404 }
    )
  }

  return NextResponse.json({
    document: {
      id: result.document.id,
      title: result.document.title,
      content: result.document.content,
      createdAt: result.document.createdAt,
      updatedAt: result.document.updatedAt,
    },
    permission: result.permission,
    expiresAt: result.expiresAt,
  })
}
