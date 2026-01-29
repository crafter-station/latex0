import { create } from "zustand"

export interface SelectionContext {
  text: string
  startLine: number
  endLine: number
  fileName: string
}

interface SelectionContextStore {
  context: SelectionContext | null
  setContext: (context: SelectionContext | null) => void
  clearContext: () => void
}

export const useSelectionContext = create<SelectionContextStore>((set) => ({
  context: null,
  setContext: (context) => set({ context }),
  clearContext: () => set({ context: null }),
}))
