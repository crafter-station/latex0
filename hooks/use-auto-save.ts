"use client"

import { useEffect, useRef } from "react"
import { useDocumentStore } from "@/lib/document-store"
import { useFileStore } from "@/lib/file-store"
import { useUserIdentity } from "@/hooks/use-user-identity"
import { serializeFileTree } from "@/lib/content-parser"

const AUTO_SAVE_DELAY_MS = 2000
const MAX_RETRIES = 3
const INITIAL_DELAY_MS = 1000

async function saveWithRetry(
  documentId: string,
  content: string,
  retries = 0
): Promise<void> {
  try {
    const res = await fetch(`/api/documents/${documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    })
    if (!res.ok) throw new Error(`Save failed: ${res.status}`)
  } catch (err) {
    if (retries < MAX_RETRIES) {
      const delay = INITIAL_DELAY_MS * Math.pow(2, retries)
      console.warn(`[useAutoSave] Retry ${retries + 1}/${MAX_RETRIES} after ${delay}ms`)
      await new Promise((resolve) => setTimeout(resolve, delay))
      return saveWithRetry(documentId, content, retries + 1)
    }
    throw err
  }
}

export function useAutoSave() {
  const activeDocumentId = useDocumentStore((s) => s.activeDocumentId)
  const setSaveStatus = useDocumentStore((s) => s.setSaveStatus)
  const files = useFileStore((s) => s.files)
  const { user } = useUserIdentity()
  const isAuthenticated = user?.isAuthenticated ?? false
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedContentRef = useRef<string>("")

  useEffect(() => {
    // Skip auto-save in playground (unauthenticated users)
    if (!isAuthenticated) return

    if (!activeDocumentId) return

    const serialized = serializeFileTree(files)

    if (serialized === lastSavedContentRef.current) return

    setSaveStatus("unsaved")

    if (timerRef.current) clearTimeout(timerRef.current)

    timerRef.current = setTimeout(async () => {
      setSaveStatus("saving")
      try {
        await saveWithRetry(activeDocumentId, serialized)
        lastSavedContentRef.current = serialized
        setSaveStatus("saved")
      } catch (err) {
        console.error("[useAutoSave] Failed to save after retries:", err)
        setSaveStatus("error", err instanceof Error ? err.message : "Save failed")
      }
    }, AUTO_SAVE_DELAY_MS)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [files, activeDocumentId, setSaveStatus, isAuthenticated])
}
