"use client"

import { useEffect, useRef, useCallback } from "react"
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
  const pendingContentRef = useRef<string | null>(null)
  const documentIdRef = useRef<string | null>(null)

  // Keep documentId ref current for beforeunload handler
  documentIdRef.current = activeDocumentId

  // Flush pending save synchronously (for beforeunload)
  const flushSync = useCallback(() => {
    const docId = documentIdRef.current
    const pending = pendingContentRef.current
    if (!docId || !pending) return

    // Cancel the debounce timer
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null

    // Use keepalive fetch so browser completes it after unload
    fetch(`/api/documents/${docId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: pending }),
      keepalive: true,
    }).catch(() => {})

    pendingContentRef.current = null
  }, [])

  // Flush unsaved changes when leaving the page
  useEffect(() => {
    if (!isAuthenticated) return

    const handleBeforeUnload = () => flushSync()
    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => window.removeEventListener("beforeunload", handleBeforeUnload)
  }, [isAuthenticated, flushSync])

  useEffect(() => {
    // Skip auto-save in playground (unauthenticated users)
    if (!isAuthenticated) return

    if (!activeDocumentId) return

    const serialized = serializeFileTree(files)

    if (serialized === lastSavedContentRef.current) {
      pendingContentRef.current = null
      return
    }

    // Track what's pending so beforeunload can flush it
    pendingContentRef.current = serialized
    setSaveStatus("unsaved")

    if (timerRef.current) clearTimeout(timerRef.current)

    timerRef.current = setTimeout(async () => {
      setSaveStatus("saving")
      try {
        await saveWithRetry(activeDocumentId, serialized)
        lastSavedContentRef.current = serialized
        pendingContentRef.current = null
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
