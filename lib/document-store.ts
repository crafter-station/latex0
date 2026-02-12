import { create } from "zustand"

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
  setDocuments: (docs: DocumentMeta[]) => void
  setActiveDocumentId: (id: string | null) => void
  setLoading: (loading: boolean) => void
  addDocument: (doc: DocumentMeta) => void
  removeDocument: (id: string) => void
  updateDocumentMeta: (id: string, data: Partial<DocumentMeta>) => void
}

export const useDocumentStore = create<DocumentStore>((set) => ({
  documents: [],
  activeDocumentId: null,
  isLoading: false,

  setDocuments: (documents) => set({ documents }),
  setActiveDocumentId: (id) => set({ activeDocumentId: id }),
  setLoading: (isLoading) => set({ isLoading }),

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
