"use client"

import { cn } from "@/lib/utils"
import { useFiles } from "@/hooks/use-files"
import { IconFileText, IconX } from "@tabler/icons-react"

export function EditorTabs() {
  const { openTabs, activeTabId, setActiveTab, closeTab, getFileById } = useFiles()

  if (openTabs.length === 0) {
    return (
      <div className="flex h-9 items-center border-b border-neutral-800 bg-black px-4 text-sm text-neutral-500">
        No files open
      </div>
    )
  }

  return (
    <div className="flex h-9 items-center gap-0.5 overflow-x-auto border-b border-neutral-800 bg-black">
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
                ? "border-white bg-neutral-900 text-white"
                : "border-transparent text-neutral-500 hover:bg-neutral-900 hover:text-neutral-300"
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
              className="rounded p-0.5 opacity-0 transition-opacity hover:bg-neutral-700 group-hover:opacity-100"
            >
              <IconX className="size-3" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
