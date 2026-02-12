import { auth } from "@clerk/nextjs/server"
import { NextRequest, NextResponse } from "next/server"
import { documentRepository } from "@/lib/db/repositories/document-repository"

const DEFAULT_CONTENT = `\\documentclass[12pt]{article}

\\title{Untitled Document}
\\author{Author}
\\date{\\today}

\\begin{document}

\\maketitle

\\section{Introduction}
Start writing here...

\\end{document}
`

export async function GET() {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const docs = await documentRepository.findAllByUser(userId)
  return NextResponse.json(docs)
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json()
  const { title, content, folder } = body

  const doc = await documentRepository.create({
    title: title || "Untitled Document",
    content: content || DEFAULT_CONTENT,
    folder: folder || "root",
    userId,
  })

  return NextResponse.json(doc, { status: 201 })
}
