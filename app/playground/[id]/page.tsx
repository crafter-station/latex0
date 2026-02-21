"use client"

import { useEffect, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { IdeLayout } from "@/components/layout/ide-layout"
import { useDocuments } from "@/hooks/use-documents"
import { useUserIdentity } from "@/hooks/use-user-identity"
import { useFileStore } from "@/lib/file-store"

/**
 * Legacy route — kept for backward compatibility.
 * Authenticated users with a projectId on the doc get redirected to /projects/[projectId]/[docId].
 * Otherwise loads the editor here (unauthenticated or docs without a project).
 */
export default function LegacyDocumentPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { user, isLoading: authLoading } = useUserIdentity()
  const { loadDocument, isAuthenticated } = useDocuments()
  const requestCompile = useFileStore((s) => s.requestCompile)
  const loadedRef = useRef<string | null>(null)
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    if (authLoading || !id || loadedRef.current === id) return
    if (!isAuthenticated) {
      loadedRef.current = id
      loadDocument(id).then(() => {
        setIsReady(true)
        requestCompile()
      })
      return
    }

    // Check if the doc belongs to a project and redirect
    async function checkAndRedirect() {
      try {
        const res = await fetch(`/api/documents/${id}`)
        if (res.ok) {
          const doc = await res.json()
          if (doc.projectId) {
            router.replace(`/projects/${doc.projectId}/${id}`)
            return
          }
        }
      } catch { /* fall through */ }

      // No project — load here
      loadedRef.current = id
      loadDocument(id).then(() => {
        setIsReady(true)
        requestCompile()
      })
    }
    checkAndRedirect()
  }, [id, authLoading, isAuthenticated, loadDocument, requestCompile, router])

  if (!isReady) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="text-sm text-muted-foreground animate-pulse">
          Loading document...
        </div>
      </div>
    )
  }

  return <IdeLayout />
}
