import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type SidebarView = 'files' | 'chats'

interface SidebarViewStore {
  activeView: SidebarView
  setActiveView: (view: SidebarView) => void
}

export const useSidebarViewStore = create<SidebarViewStore>()(
  persist(
    (set) => ({
      activeView: 'files',
      setActiveView: (view) => set({ activeView: view }),
    }),
    {
      name: 'latex0-sidebar-view',
      version: 1,
    }
  )
)
