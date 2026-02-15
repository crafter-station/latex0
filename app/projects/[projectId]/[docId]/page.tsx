"use client"

import { useEffect, useRef, useState } from "react"
import { useParams } from "next/navigation"
import { IdeLayout } from "@/components/layout/ide-layout"
import { useDocuments } from "@/hooks/use-documents"
import { useProjectStore } from "@/lib/project-store"
import { useFileStore } from "@/lib/file-store"

export default function EditorPage() {
  const { projectId, docId } = useParams<{ projectId: string; docId: string }>()
  const { loadDocument, isAuthenticated } = useDocuments()
  const setActiveProjectId = useProjectStore((s) => s.setActiveProjectId)
  const requestCompile = useFileStore((s) => s.requestCompile)
  const loadedRef = useRef<string | null>(null)
  const [isReady, setIsReady] = useState(false)

  // Sync project store with URL params
  useEffect(() => {
    if (projectId) setActiveProjectId(projectId)
  }, [projectId, setActiveProjectId])

  useEffect(() => {
    if (!isAuthenticated || !docId || loadedRef.current === docId) return
    loadedRef.current = docId
    setIsReady(false)
    loadDocument(docId).then(() => {
      setIsReady(true)
      requestCompile()
    })
  }, [docId, isAuthenticated, loadDocument, requestCompile])

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
