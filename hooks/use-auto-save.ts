"use client"

import { useEffect, useRef } from "react"
import { useDocumentStore } from "@/lib/document-store"
import { useFileStore } from "@/lib/file-store"

const AUTO_SAVE_DELAY_MS = 2000

export function useAutoSave() {
  const activeDocumentId = useDocumentStore((s) => s.activeDocumentId)
  const files = useFileStore((s) => s.files)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedContentRef = useRef<string>("")

  useEffect(() => {
    if (!activeDocumentId) return

    const mainFile = files.find((f) => f.id === "main")
    const currentContent = mainFile?.content || ""

    if (currentContent === lastSavedContentRef.current) return

    if (timerRef.current) clearTimeout(timerRef.current)

    timerRef.current = setTimeout(async () => {
      try {
        await fetch(`/api/documents/${activeDocumentId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: currentContent }),
        })
        lastSavedContentRef.current = currentContent
      } catch (err) {
        console.error("[useAutoSave] Failed to save:", err)
      }
    }, AUTO_SAVE_DELAY_MS)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [files, activeDocumentId])
}
