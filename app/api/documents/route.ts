import { NextResponse } from "next/server"
import { withAuth } from "@/lib/api/with-auth"
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

export const GET = withAuth(async (_req, { userId }) => {
  const docs = await documentRepository.findAllByUser(userId)
  return NextResponse.json(docs)
})

export const POST = withAuth(async (req, { userId }) => {
  const body = await req.json()
  const { title, content, folder, projectId } = body

  const doc = await documentRepository.create({
    title: title || "Untitled Document",
    content: content || DEFAULT_CONTENT,
    folder: folder || "root",
    projectId: projectId || null,
    userId,
  })

  return NextResponse.json(doc, { status: 201 })
})
