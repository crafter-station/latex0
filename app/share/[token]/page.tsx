"use client"

import { useEffect, useState, use } from "react"
import { useRouter } from "next/navigation"

interface SharedDocument {
  id: string
  title: string
  content: string
  createdAt: string
  updatedAt: string
}

export default function SharedDocumentPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = use(params)
  const router = useRouter()
  const [doc, setDoc] = useState<SharedDocument | null>(null)
  const [permission, setPermission] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadSharedDoc() {
      try {
        const res = await fetch(`/api/share/${token}`)
        if (!res.ok) {
          setError("This share link is invalid or has expired.")
          return
        }
        const data = await res.json()
        setDoc(data.document)
        setPermission(data.permission)

        // If user has edit access, redirect to the editor
        if (data.permission === "edit") {
          router.push(`/playground/${data.document.id}`)
          return
        }
      } catch {
        setError("Failed to load shared document.")
      } finally {
        setLoading(false)
      }
    }
    loadSharedDoc()
  }, [token, router])

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading shared document...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-background">
        <p className="text-destructive">{error}</p>
        <a href="/" className="text-sm text-primary underline">
          Go to LaTeX0
        </a>
      </div>
    )
  }

  if (!doc) return null

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Header */}
      <header className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-medium">{doc.title}</h1>
          <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {permission === "view" ? "View only" : "Editable"}
          </span>
        </div>
        <a href="/" className="text-sm text-primary hover:underline">
          Open in LaTeX0
        </a>
      </header>

      {/* Read-only content viewer */}
      <div className="flex-1 overflow-auto p-6">
        <pre className="mx-auto max-w-4xl whitespace-pre-wrap rounded-lg border bg-muted/50 p-6 font-mono text-sm">
          {doc.content}
        </pre>
      </div>
    </div>
  )
}
