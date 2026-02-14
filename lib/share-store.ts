import { create } from "zustand"
import type { DocumentShare, SharePermission, UserPermission } from "@/lib/db/schema"

interface ShareStore {
  shares: DocumentShare[]
  isLoading: boolean
  currentPermission: UserPermission

  setShares: (shares: DocumentShare[]) => void
  setLoading: (loading: boolean) => void
  setCurrentPermission: (permission: UserPermission) => void

  fetchShares: (documentId: string) => Promise<void>
  createShare: (
    documentId: string,
    params: { sharedWith?: string; permission: SharePermission; expiresAt?: string }
  ) => Promise<DocumentShare | null>
  revokeShare: (documentId: string, shareId: string) => Promise<void>
}

export const useShareStore = create<ShareStore>((set) => ({
  shares: [],
  isLoading: false,
  currentPermission: "owner",

  setShares: (shares) => set({ shares }),
  setLoading: (isLoading) => set({ isLoading }),
  setCurrentPermission: (currentPermission) => set({ currentPermission }),

  fetchShares: async (documentId) => {
    set({ isLoading: true })
    try {
      const res = await fetch(`/api/documents/${documentId}/share`)
      if (res.ok) {
        const shares = await res.json()
        set({ shares })
      }
    } catch (err) {
      console.error("[ShareStore] Failed to fetch shares:", err)
    } finally {
      set({ isLoading: false })
    }
  },

  createShare: async (documentId, params) => {
    try {
      const res = await fetch(`/api/documents/${documentId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      })
      if (res.ok) {
        const share = await res.json()
        set((state) => ({ shares: [...state.shares, share] }))
        return share
      }
    } catch (err) {
      console.error("[ShareStore] Failed to create share:", err)
    }
    return null
  },

  revokeShare: async (documentId, shareId) => {
    try {
      const res = await fetch(
        `/api/documents/${documentId}/share?shareId=${shareId}`,
        { method: "DELETE" }
      )
      if (res.ok) {
        set((state) => ({
          shares: state.shares.filter((s) => s.id !== shareId),
        }))
      }
    } catch (err) {
      console.error("[ShareStore] Failed to revoke share:", err)
    }
  },
}))
