"use client"

import { useEffect, useRef, useState } from "react"
import { useParams } from "next/navigation"
import { IdeLayout } from "@/components/layout/ide-layout"
import { useDocuments } from "@/hooks/use-documents"

export default function DocumentPage() {
  const { id } = useParams<{ id: string }>()
  const { loadDocument, isAuthenticated } = useDocuments()
  const loadedRef = useRef<string | null>(null)
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    if (!isAuthenticated || !id || loadedRef.current === id) return
    loadedRef.current = id
    setIsReady(false)
    loadDocument(id).then(() => setIsReady(true))
  }, [id, isAuthenticated, loadDocument])

  if (!isReady) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-sm text-muted-foreground animate-pulse">
          Loading document...
        </div>
      </div>
    )
  }

  return <IdeLayout />
}
