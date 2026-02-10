"use client"

import { useEffect, useRef } from "react"
import { useParams } from "next/navigation"
import { IdeLayout } from "@/components/layout/ide-layout"
import { useDocuments } from "@/hooks/use-documents"

export default function DocumentPage() {
  const { id } = useParams<{ id: string }>()
  const { loadDocument, isAuthenticated } = useDocuments()
  const loadedRef = useRef<string | null>(null)

  useEffect(() => {
    if (!isAuthenticated || !id || loadedRef.current === id) return
    loadedRef.current = id
    loadDocument(id)
  }, [id, isAuthenticated, loadDocument])

  return <IdeLayout />
}
