"use client"

import { useEffect } from "react"
import { useFileStore } from "@/lib/file-store"
import { useUserIdentity } from "@/hooks/use-user-identity"
import { serializeFileTree, parseDocumentContent } from "@/lib/content-parser"

const PLAYGROUND_STORAGE_KEY = "latex0-playground-state"

export function usePlaygroundPersistence() {
  const files = useFileStore((s) => s.files)
  const setFiles = useFileStore((s) => s.setFiles)
  const { user } = useUserIdentity()
  const isAuthenticated = user?.isAuthenticated ?? false

  // Load from localStorage on mount (playground only)
  useEffect(() => {
    if (isAuthenticated) return

    const saved = localStorage.getItem(PLAYGROUND_STORAGE_KEY)
    if (saved) {
      try {
        const parsed = parseDocumentContent(saved)
        setFiles(parsed)
      } catch (err) {
        console.error("[Playground] Failed to restore state:", err)
      }
    }
  }, [isAuthenticated, setFiles])

  // Save to localStorage on change (playground only)
  useEffect(() => {
    if (isAuthenticated) return

    const serialized = serializeFileTree(files)
    localStorage.setItem(PLAYGROUND_STORAGE_KEY, serialized)
  }, [files, isAuthenticated])
}
