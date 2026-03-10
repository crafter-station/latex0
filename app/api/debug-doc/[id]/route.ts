import { NextRequest, NextResponse } from "next/server"
import { documentRepository } from "@/lib/db/repositories/document-repository"
import { parseDocumentContent } from "@/lib/content-parser"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const doc = await documentRepository.findByIdUnsafe(id)
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const parsed = parseDocumentContent(doc.content ?? "")
  return NextResponse.json({
    id: doc.id,
    title: doc.title,
    userId: doc.userId,
    contentLength: doc.content?.length ?? 0,
    parsedFileCount: parsed.length,
    parsedFiles: parsed.map((f) => ({
      id: f.id,
      name: f.name,
      type: f.type,
      contentLength: f.content?.length ?? 0,
    })),
  })
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { content } = await req.json()
  const doc = await documentRepository.updateUnsafe(id, { content })
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  return NextResponse.json({ success: true, contentLength: content.length })
}
