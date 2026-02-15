"use client"

import { useChatStore } from "@/lib/chat-store"
import { useContentStore } from "@/lib/content-store"
import { useSidebarViewStore } from "@/lib/sidebar-view-store"
import { ChatSessionItem } from "@/components/sidebar/chat-session-item"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
} from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { IconPlus, IconMessage } from "@tabler/icons-react"

export function ChatsTab() {
  const sessions = useChatStore((s) => s.sessions)
  const activeSessionId = useChatStore((s) => s.activeSessionId)
  const createSession = useChatStore((s) => s.createSession)
  const deleteSession = useChatStore((s) => s.deleteSession)
  const setActiveSession = useChatStore((s) => s.setActiveSession)
  const setActiveContent = useContentStore((s) => s.setActiveContent)

  function handleCreateChat() {
    const session = createSession()
    setActiveContent("chat", session.id)
  }

  function handleSelectChat(id: string) {
    setActiveSession(id)
    setActiveContent("chat", id)
  }

  function handleDeleteChat(id: string) {
    deleteSession(id)
  }

  return (
    <SidebarGroup className="flex-1">
      <SidebarGroupLabel className="flex items-center justify-between">
        <span>Chats</span>
        <Button
          size="icon"
          variant="ghost"
          className="h-5 w-5"
          onClick={handleCreateChat}
        >
          <IconPlus className="size-3.5" />
        </Button>
      </SidebarGroupLabel>

      <SidebarGroupContent>
        {sessions.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <IconMessage className="size-8 mx-auto mb-2 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No chats yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Click + to start a conversation</p>
          </div>
        ) : (
          <ScrollArea className="flex-1">
            <SidebarMenu>
              {sessions.map((session) => (
                <ChatSessionItem
                  key={session.id}
                  session={session}
                  isActive={activeSessionId === session.id}
                  onClick={() => handleSelectChat(session.id)}
                  onDelete={() => handleDeleteChat(session.id)}
                />
              ))}
            </SidebarMenu>
          </ScrollArea>
        )}
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
