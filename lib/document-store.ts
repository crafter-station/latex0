import { create } from "zustand"

export type SaveStatus = "saved" | "saving" | "unsaved" | "error"

export interface DocumentMeta {
  id: string
  title: string
  folder: string
  createdAt: string
  updatedAt: string
}

interface DocumentStore {
  documents: DocumentMeta[]
  activeDocumentId: string | null
  isLoading: boolean
  saveStatus: SaveStatus
  saveError: string | null
  setDocuments: (docs: DocumentMeta[]) => void
  setActiveDocumentId: (id: string | null) => void
  setLoading: (loading: boolean) => void
  setSaveStatus: (status: SaveStatus, error?: string) => void
  addDocument: (doc: DocumentMeta) => void
  removeDocument: (id: string) => void
  updateDocumentMeta: (id: string, data: Partial<DocumentMeta>) => void
}

export const useDocumentStore = create<DocumentStore>((set) => ({
  documents: [],
  activeDocumentId: null,
  isLoading: false,
  saveStatus: "saved" as SaveStatus,
  saveError: null,

  setDocuments: (documents) => set({ documents }),
  setActiveDocumentId: (id) => set({ activeDocumentId: id }),
  setLoading: (isLoading) => set({ isLoading }),
  setSaveStatus: (saveStatus, error) => set({ saveStatus, saveError: error || null }),

  addDocument: (doc) =>
    set((state) => ({ documents: [doc, ...state.documents] })),

  removeDocument: (id) =>
    set((state) => ({
      documents: state.documents.filter((d) => d.id !== id),
      activeDocumentId:
        state.activeDocumentId === id ? null : state.activeDocumentId,
    })),

  updateDocumentMeta: (id, data) =>
    set((state) => ({
      documents: state.documents.map((d) =>
        d.id === id ? { ...d, ...data } : d
      ),
    })),
}))
