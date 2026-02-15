"use client"

import { useState } from "react"
import { useChatStore, type ChatSession } from "@/lib/chat-store"
import { IconMessage, IconDots, IconPencil, IconTrash } from "@tabler/icons-react"
import {
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuAction,
} from "@/components/ui/sidebar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface ChatSessionItemProps {
  session: ChatSession
  isActive: boolean
  onClick: () => void
  onDelete: () => void
}

export function ChatSessionItem({ session, isActive, onClick, onDelete }: ChatSessionItemProps) {
  const renameSession = useChatStore((s) => s.renameSession)
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(session.name)

  function handleRename() {
    setIsRenaming(true)
    setRenameValue(session.name)
  }

  function handleRenameSubmit() {
    if (renameValue.trim()) {
      renameSession(session.id, renameValue.trim())
    }
    setIsRenaming(false)
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton isActive={isActive} onClick={onClick} className="w-full">
        <IconMessage className="size-4 shrink-0" />
        {isRenaming ? (
          <input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRenameSubmit()
              if (e.key === "Escape") setIsRenaming(false)
            }}
            onClick={(e) => e.stopPropagation()}
            autoFocus
            className="flex-1 min-w-0 bg-transparent text-sm outline-none border-b border-foreground/20"
          />
        ) : (
          <span className="flex-1 truncate text-sm">{session.name}</span>
        )}
        {session.messages.length > 0 && !isRenaming && (
          <span className="text-xs text-muted-foreground shrink-0">
            {session.messages.length}
          </span>
        )}
      </SidebarMenuButton>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction showOnHover>
            <IconDots className="size-4" />
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start">
          <DropdownMenuItem onClick={handleRename}>
            <IconPencil className="size-4 mr-2" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={onDelete}
            className="text-destructive focus:text-destructive"
          >
            <IconTrash className="size-4 mr-2" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  )
}
