"use client"

import { cn } from "@/lib/utils"
import { useFiles } from "@/hooks/use-files"
import { IconFileText, IconX } from "@tabler/icons-react"
import { SnippetPanel } from "./snippet-panel"
import { useCallback } from "react"

export function EditorTabs() {
  const { openTabs, activeTabId, setActiveTab, closeTab, getFileById } = useFiles()

  const handleSnippetInsert = useCallback((content: string) => {
    window.dispatchEvent(new CustomEvent("latex0:insert-snippet", { detail: content }))
  }, [])

  if (openTabs.length === 0) {
    return (
      <div className="flex h-[33px] items-center border-b border-neutral-200 bg-white px-4 text-sm text-neutral-500 dark:border-neutral-800 dark:bg-black">
        No files open
      </div>
    )
  }

  return (
    <div className="flex h-[33px] items-center gap-0.5 overflow-x-auto border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-black">
      {openTabs.map((tabId) => {
        const file = getFileById(tabId)
        if (!file) return null

        const isActive = tabId === activeTabId

        return (
          <div
            key={tabId}
            className={cn(
              "group flex h-full items-center gap-2 border-b-2 px-3 text-sm transition-colors",
              isActive
                ? "border-neutral-900 bg-neutral-100 text-neutral-900 dark:border-white dark:bg-neutral-900 dark:text-white"
                : "border-transparent text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-900 dark:hover:text-neutral-300"
            )}
          >
            <button
              onClick={() => setActiveTab(tabId)}
              className="flex items-center gap-2"
            >
              <IconFileText className="size-4" />
              <span>{file.name}</span>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                closeTab(tabId)
              }}
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
