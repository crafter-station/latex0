"use client"

import { cn } from "@/lib/utils"
import { useFileStore } from "@/lib/file-store"
import { useContentStore } from "@/lib/content-store"
import { useChatStore } from "@/lib/chat-store"
import { IconFileText, IconMessage, IconX } from "@tabler/icons-react"
import { SnippetPanel } from "./snippet-panel"
import { useCallback } from "react"

interface TabItem {
  type: "file" | "chat"
  id: string
  label: string
}

export function ContentTabs() {
  const openFileTabs = useFileStore((s) => s.openTabs)
  const activeFileTabId = useFileStore((s) => s.activeTabId)
  const getFileById = useFileStore((s) => s.getFileById)
  const setActiveTab = useFileStore((s) => s.setActiveTab)
  const closeFileTab = useFileStore((s) => s.closeTab)

  const activeContentType = useContentStore((s) => s.activeContentType)
  const activeContentId = useContentStore((s) => s.activeContentId)
  const setActiveContent = useContentStore((s) => s.setActiveContent)
  const openChatTabs = useContentStore((s) => s.openChatTabs)
  const closeChatTab = useContentStore((s) => s.closeChatTab)

  const sessions = useChatStore((s) => s.sessions)
  const setActiveSession = useChatStore((s) => s.setActiveSession)

  const handleSnippetInsert = useCallback((content: string) => {
    window.dispatchEvent(new CustomEvent("latex0:insert-snippet", { detail: content }))
  }, [])

  const fileTabs: TabItem[] = openFileTabs.map((id) => ({
    type: "file",
    id,
    label: getFileById(id)?.name || "Untitled",
  }))

  const chatTabs: TabItem[] = openChatTabs.map((id) => ({
    type: "chat",
    id,
    label: sessions.find((s) => s.id === id)?.name || "Chat",
  }))

  const allTabs = [...fileTabs, ...chatTabs]

  if (allTabs.length === 0) {
    return (
      <div className="flex h-[33px] items-center border-b border-neutral-200 bg-white px-4 text-sm text-neutral-500 dark:border-neutral-800 dark:bg-black">
        No files open
      </div>
    )
  }

  function isActive(tab: TabItem) {
    if (tab.type === "file") {
      return activeContentType === "file" && activeFileTabId === tab.id
    }
    return activeContentType === "chat" && activeContentId === tab.id
  }

  function handleTabClick(tab: TabItem) {
    if (tab.type === "file") {
      setActiveTab(tab.id)
      setActiveContent("file", tab.id)
    } else {
      setActiveSession(tab.id)
      setActiveContent("chat", tab.id)
    }
  }

  function handleTabClose(e: React.MouseEvent, tab: TabItem) {
    e.stopPropagation()
    if (tab.type === "file") {
      closeFileTab(tab.id)
      // If this was the active content, switch to next file tab
      if (activeContentType === "file" && activeFileTabId === tab.id) {
        const remaining = openFileTabs.filter((id) => id !== tab.id)
        if (remaining.length > 0) {
          const closedIdx = openFileTabs.indexOf(tab.id)
          const nextId = remaining[Math.min(closedIdx, remaining.length - 1)]
          setActiveContent("file", nextId)
        }
      }
    } else {
      closeChatTab(tab.id)
    }
  }

  return (
    <div className="flex h-[33px] items-center gap-0.5 overflow-x-auto border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-black">
      {allTabs.map((tab) => {
        const active = isActive(tab)
        return (
          <div
            key={`${tab.type}-${tab.id}`}
            className={cn(
              "group flex h-full items-center gap-2 border-b-2 px-3 text-sm transition-colors cursor-pointer",
              active
                ? "border-neutral-900 bg-neutral-100 text-neutral-900 dark:border-white dark:bg-neutral-900 dark:text-white"
                : "border-transparent text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-900 dark:hover:text-neutral-300"
            )}
            onClick={() => handleTabClick(tab)}
          >
            <div className="flex items-center gap-2">
              {tab.type === "file" ? (
                <IconFileText className="size-4" />
              ) : (
                <IconMessage className="size-4" />
              )}
              <span className="max-w-[120px] truncate">{tab.label}</span>
            </div>
            <button
              onClick={(e) => handleTabClose(e, tab)}
              className="rounded p-0.5 opacity-0 transition-opacity hover:bg-neutral-300 group-hover:opacity-100 dark:hover:bg-neutral-700"
            >
              <IconX className="size-3" />
            </button>
          </div>
        )
      })}

      <div className="ml-auto shrink-0">
        <SnippetPanel onInsert={handleSnippetInsert} />
      </div>
    </div>
  )
}
