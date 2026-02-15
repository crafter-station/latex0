"use client"

import { useCallback, useRef, useState, useEffect } from "react"
import { cn } from "@/lib/utils"
import { useFileStore } from "@/lib/file-store"
import { useContentStore } from "@/lib/content-store"
import { useChatStore } from "@/lib/chat-store"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { SnippetPanel } from "./snippet-panel"
import {
  IconFileText,
  IconMessage,
  IconChevronRight,
} from "@tabler/icons-react"

interface TabItem {
  type: "file" | "chat"
  id: string
  label: string
}

export function EditorToolbar() {
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

  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const checkOverflow = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setCanScrollRight(el.scrollWidth > el.clientWidth + el.scrollLeft + 1)
  }, [])

  useEffect(() => {
    checkOverflow()
    const el = scrollRef.current
    if (!el) return
    el.addEventListener("scroll", checkOverflow)
    const observer = new ResizeObserver(checkOverflow)
    observer.observe(el)
    return () => {
      el.removeEventListener("scroll", checkOverflow)
      observer.disconnect()
    }
  }, [checkOverflow])

  const scrollRight = useCallback(() => {
    scrollRef.current?.scrollBy({ left: 120, behavior: "smooth" })
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
    <div className="flex h-10 shrink-0 items-center gap-1 px-2">
      <SidebarTrigger className="shrink-0" />

      {/* Tabs */}
      <div
        ref={scrollRef}
        className="flex items-center gap-1 min-w-0 overflow-hidden"
      >
        {allTabs.map((tab) => {
          const active = isActive(tab)
          return (
            <button
              key={`${tab.type}-${tab.id}`}
              className={cn(
                "group flex items-center gap-1.5 px-2.5 py-1 text-sm whitespace-nowrap rounded-full transition-colors shrink-0",
                active
                  ? "border border-border bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
              onClick={() => handleTabClick(tab)}
              onDoubleClick={(e) => {
                e.preventDefault()
                handleTabClose(e, tab)
              }}
            >
              {tab.type === "file" ? (
                <IconFileText className="size-3.5" />
              ) : (
                <IconMessage className="size-3.5" />
              )}
              <span className="max-w-[120px] truncate text-xs">{tab.label}</span>
            </button>
          )
        })}
      </div>

      {/* Scroll right chevron */}
      {canScrollRight && (
        <button
          onClick={scrollRight}
          className="shrink-0 flex items-center justify-center size-6 rounded-full text-muted-foreground hover:text-foreground transition-colors"
        >
          <IconChevronRight className="size-3.5" />
        </button>
      )}

      {/* Tools / Snippets */}
      <div className="shrink-0 ml-auto">
        <SnippetPanel onInsert={handleSnippetInsert} />
      </div>
    </div>
  )
}
