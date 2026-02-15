"use client"

import { useSidebarViewStore } from "@/lib/sidebar-view-store"
import type { SidebarView } from "@/lib/sidebar-view-store"

const tabs: { value: SidebarView; label: string }[] = [
  { value: "files", label: "Files" },
  { value: "chats", label: "Chats" },
]

export function SidebarViewTabs() {
  const { activeView, setActiveView } = useSidebarViewStore()

  return (
    <div className="flex items-center gap-3 px-2">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          onClick={() => setActiveView(tab.value)}
          className={`text-sm pb-2 border-b-2 transition-colors cursor-pointer ${
            activeView === tab.value
              ? "border-foreground text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
