import { create } from "zustand"
import type { DocumentVersion } from "@/lib/db/schema"

interface VersionStore {
  versions: DocumentVersion[]
  isLoading: boolean
  isHistoryOpen: boolean
  selectedVersionId: string | null
  total: number

  setVersions: (versions: DocumentVersion[]) => void
  setLoading: (loading: boolean) => void

  fetchVersions: (documentId: string) => Promise<void>
  createCheckpoint: (documentId: string) => Promise<void>
  restoreVersion: (documentId: string, versionId: string) => Promise<boolean>
  getVersionContent: (
    documentId: string,
    versionId: string
  ) => Promise<DocumentVersion | null>

  openHistory: () => void
  closeHistory: () => void
  selectVersion: (versionId: string | null) => void
}

export const useVersionStore = create<VersionStore>((set, get) => ({
  versions: [],
  isLoading: false,
  isHistoryOpen: false,
  selectedVersionId: null,
  total: 0,

  setVersions: (versions) => set({ versions }),
  setLoading: (isLoading) => set({ isLoading }),

  fetchVersions: async (documentId) => {
    set({ isLoading: true })
    try {
      const res = await fetch(`/api/documents/${documentId}/versions`)
      if (res.ok) {
        const data = await res.json()
        set({ versions: data.versions, total: data.total })
      }
    } catch (err) {
      console.error("[VersionStore] Failed to fetch versions:", err)
    } finally {
      set({ isLoading: false })
    }
  },

  createCheckpoint: async (documentId) => {
    try {
      const res = await fetch(`/api/documents/${documentId}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ triggerType: "manual" }),
      })
      if (res.ok) {
        // Refetch to get updated list
        await get().fetchVersions(documentId)
      }
    } catch (err) {
      console.error("[VersionStore] Failed to create checkpoint:", err)
    }
  },

  restoreVersion: async (documentId, versionId) => {
    try {
      const res = await fetch(
        `/api/documents/${documentId}/versions/${versionId}`,
        { method: "POST" }
      )
      if (res.ok) {
        await get().fetchVersions(documentId)
        return true
      }
    } catch (err) {
      console.error("[VersionStore] Failed to restore version:", err)
    }
    return false
  },

  getVersionContent: async (documentId, versionId) => {
    try {
      const res = await fetch(
        `/api/documents/${documentId}/versions/${versionId}`
      )
      if (res.ok) {
        return await res.json()
      }
    } catch (err) {
      console.error("[VersionStore] Failed to get version:", err)
    }
    return null
  },

  openHistory: () => set({ isHistoryOpen: true }),
  closeHistory: () => set({ isHistoryOpen: false, selectedVersionId: null }),
  selectVersion: (versionId) => set({ selectedVersionId: versionId }),
}))
