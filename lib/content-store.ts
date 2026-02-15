import { create } from 'zustand'

export type ContentType = 'file' | 'chat'

interface ContentStore {
  activeContentType: ContentType
  activeContentId: string | null
  openChatTabs: string[]

  setActiveContent: (type: ContentType, id: string) => void
  openChatTab: (id: string) => void
  closeChatTab: (id: string) => void
}

export const useContentStore = create<ContentStore>((set, get) => ({
  activeContentType: 'file',
  activeContentId: null,
  openChatTabs: [],

  setActiveContent: (type, id) => {
    if (type === 'chat') {
      const { openChatTabs } = get()
      if (!openChatTabs.includes(id)) {
        set({
          activeContentType: type,
          activeContentId: id,
          openChatTabs: [...openChatTabs, id],
        })
        return
      }
    }
    set({ activeContentType: type, activeContentId: id })
  },

  openChatTab: (id) => {
    const { openChatTabs } = get()
    if (!openChatTabs.includes(id)) {
      set({ openChatTabs: [...openChatTabs, id] })
    }
  },

  closeChatTab: (id) => {
    const { openChatTabs, activeContentId, activeContentType } = get()
    const newTabs = openChatTabs.filter((t) => t !== id)

    if (activeContentType === 'chat' && activeContentId === id) {
      // Switch to next chat tab or fall back to file
      if (newTabs.length > 0) {
        const closedIndex = openChatTabs.indexOf(id)
        const nextId = newTabs[Math.min(closedIndex, newTabs.length - 1)]
        set({ openChatTabs: newTabs, activeContentId: nextId })
      } else {
        // Fall back to active file tab
        set({
          openChatTabs: newTabs,
          activeContentType: 'file',
          activeContentId: null,
        })
      }
    } else {
      set({ openChatTabs: newTabs })
    }
  },
}))
