"use client"

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { IdeLayout } from "@/components/layout/ide-layout"
import { useUserIdentity } from "@/hooks/use-user-identity"
import { defaultFiles } from "@/lib/file-store"
import { serializeFileTree } from "@/lib/content-parser"
import type { DocumentMeta } from "@/lib/document-store"

export default function Playground() {
  const router = useRouter()
  const { user, isLoading: authLoading } = useUserIdentity()
  const isAuthenticated = user?.isAuthenticated ?? false
  const redirectingRef = useRef(false)

  // Fetch user's documents (only when authenticated)
  const { data: documents } = useQuery<DocumentMeta[]>({
    queryKey: ["documents"],
    queryFn: async () => {
      const res = await fetch("/api/documents")
      if (!res.ok) throw new Error("Failed to fetch documents")
      return res.json()
    },
    enabled: isAuthenticated,
  })

  useEffect(() => {
    if (authLoading || !isAuthenticated || !documents || redirectingRef.current) return
    redirectingRef.current = true

    if (documents.length > 0) {
      // Redirect to most recently updated document
      const sorted = [...documents].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      )
      router.replace(`/playground/${sorted[0].id}`)
    } else {
      // First time user — create a document with the sample content
      createFirstDocument()
    }

    async function createFirstDocument() {
      try {
        const res = await fetch("/api/documents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: "The Shipping Bible",
            content: serializeFileTree(defaultFiles),
          }),
        })
        if (res.ok) {
          const doc: DocumentMeta = await res.json()
          router.replace(`/playground/${doc.id}`)
        }
      } catch (err) {
        console.error("[Playground] Failed to create initial document:", err)
        redirectingRef.current = false
      }
    }
  }, [authLoading, isAuthenticated, documents, router])

  // While redirecting authenticated users, show a minimal loading state
  if (isAuthenticated) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-sm text-muted-foreground animate-pulse">
          Loading your documents...
        </div>
      </div>
    )
  }

  // Unauthenticated users get the playground as before
  return <IdeLayout />
}
