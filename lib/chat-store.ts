import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { nanoid } from 'nanoid'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

export interface ChatSession {
  id: string
  name: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
}

interface ChatStore {
  sessions: ChatSession[]
  activeSessionId: string | null

  createSession: () => ChatSession
  deleteSession: (id: string) => void
  setActiveSession: (id: string | null) => void
  addMessage: (sessionId: string, message: Omit<ChatMessage, 'id' | 'timestamp'>) => void
  renameSession: (id: string, name: string) => void
  clearSession: (id: string) => void
}

export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => ({
      sessions: [],
      activeSessionId: null,

      createSession: () => {
        const session: ChatSession = {
          id: nanoid(),
          name: 'New Chat',
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }
        set((state) => ({
          sessions: [session, ...state.sessions],
          activeSessionId: session.id,
        }))
        return session
      },

      deleteSession: (id) => {
        const { activeSessionId, sessions } = get()
        const newSessions = sessions.filter((s) => s.id !== id)
        set({
          sessions: newSessions,
          activeSessionId: activeSessionId === id
            ? newSessions[0]?.id ?? null
            : activeSessionId,
        })
      },

      setActiveSession: (id) => set({ activeSessionId: id }),

      addMessage: (sessionId, message) => {
        set((state) => ({
          sessions: state.sessions.map((s) => {
            if (s.id !== sessionId) return s
            const newMessage: ChatMessage = {
              ...message,
              id: nanoid(),
              timestamp: Date.now(),
            }
            const updated = {
              ...s,
              messages: [...s.messages, newMessage],
              updatedAt: Date.now(),
            }
            // Auto-name from first user message
            if (s.name === 'New Chat' && message.role === 'user') {
              updated.name = message.content.slice(0, 40) + (message.content.length > 40 ? '...' : '')
            }
            return updated
          }),
        }))
      },

      renameSession: (id, name) => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === id ? { ...s, name, updatedAt: Date.now() } : s
          ),
        }))
      },

      clearSession: (id) => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === id ? { ...s, messages: [], updatedAt: Date.now() } : s
          ),
        }))
      },
    }),
    {
      name: 'latex0-chat-store',
      version: 1,
    }
  )
)
