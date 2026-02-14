import { create } from "zustand"
import type { Folder } from "@/lib/db/schema"

export interface FolderNode extends Folder {
  children: FolderNode[]
}

interface FolderStore {
  folders: Folder[]
  tree: FolderNode[]
  expandedFolders: Set<string>
  isLoading: boolean

  setFolders: (folders: Folder[]) => void
  setLoading: (loading: boolean) => void

  fetchFolders: () => Promise<void>
  createFolder: (name: string, parentId?: string | null) => Promise<Folder | null>
  renameFolder: (id: string, name: string) => Promise<void>
  moveFolder: (id: string, newParentId: string | null) => Promise<void>
  deleteFolder: (id: string) => Promise<void>
  moveDocument: (documentId: string, folderId: string | null) => Promise<void>
  toggleExpanded: (folderId: string) => void
}

function buildTree(folders: Folder[]): FolderNode[] {
  const map = new Map<string, FolderNode>()
  const roots: FolderNode[] = []

  // Create nodes
  for (const folder of folders) {
    map.set(folder.id, { ...folder, children: [] })
  }

  // Build tree
  for (const folder of folders) {
    const node = map.get(folder.id)!
    if (folder.parentId && map.has(folder.parentId)) {
      map.get(folder.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }

  return roots
}

export const useFolderStore = create<FolderStore>((set, get) => ({
  folders: [],
  tree: [],
  expandedFolders: new Set<string>(),
  isLoading: false,

  setFolders: (folders) => set({ folders, tree: buildTree(folders) }),
  setLoading: (isLoading) => set({ isLoading }),

  fetchFolders: async () => {
    set({ isLoading: true })
    try {
      const res = await fetch("/api/folders")
      if (res.ok) {
        const data = await res.json()
        set({ folders: data, tree: buildTree(data) })
      }
    } catch (err) {
      console.error("[FolderStore] Failed to fetch folders:", err)
    } finally {
      set({ isLoading: false })
    }
  },

  createFolder: async (name, parentId) => {
    try {
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, parentId: parentId || null }),
      })
      if (res.ok) {
        const folder = await res.json()
        const folders = [...get().folders, folder]
        set({ folders, tree: buildTree(folders) })

        // Auto-expand parent
        if (parentId) {
          const expanded = new Set(get().expandedFolders)
          expanded.add(parentId)
          set({ expandedFolders: expanded })
        }

        return folder
      }
    } catch (err) {
      console.error("[FolderStore] Failed to create folder:", err)
    }
    return null
  },

  renameFolder: async (id, name) => {
    try {
      const res = await fetch(`/api/folders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
      if (res.ok) {
        await get().fetchFolders() // Refetch to get updated paths
      }
    } catch (err) {
      console.error("[FolderStore] Failed to rename folder:", err)
    }
  },

  moveFolder: async (id, newParentId) => {
    try {
      const res = await fetch(`/api/folders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentId: newParentId }),
      })
      if (res.ok) {
        await get().fetchFolders()
      }
    } catch (err) {
      console.error("[FolderStore] Failed to move folder:", err)
    }
  },

  deleteFolder: async (id) => {
    try {
      const res = await fetch(`/api/folders/${id}`, { method: "DELETE" })
      if (res.ok) {
        const folders = get().folders.filter((f) => f.id !== id)
        set({ folders, tree: buildTree(folders) })
      }
    } catch (err) {
      console.error("[FolderStore] Failed to delete folder:", err)
    }
  },

  moveDocument: async (documentId, folderId) => {
    try {
      await fetch(`/api/documents/${documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId }),
      })
    } catch (err) {
      console.error("[FolderStore] Failed to move document:", err)
    }
  },

  toggleExpanded: (folderId) => {
    const expanded = new Set(get().expandedFolders)
    if (expanded.has(folderId)) {
      expanded.delete(folderId)
    } else {
      expanded.add(folderId)
    }
    set({ expandedFolders: expanded })
  },
}))
