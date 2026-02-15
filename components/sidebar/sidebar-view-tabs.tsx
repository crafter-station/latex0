"use client"

import { IconFiles, IconMessage } from "@tabler/icons-react"
import { useSidebarViewStore } from "@/lib/sidebar-view-store"
import type { SidebarView } from "@/lib/sidebar-view-store"

export function SidebarViewTabs() {
  const { activeView, setActiveView } = useSidebarViewStore()

  const tabs: { value: SidebarView; label: string; icon: typeof IconFiles }[] = [
    { value: "files", label: "Files", icon: IconFiles },
    { value: "chats", label: "Chats", icon: IconMessage },
  ]

  return (
    <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          onClick={() => setActiveView(tab.value)}
          className={`flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            activeView === tab.value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <tab.icon className="size-4" />
          {tab.label}
        </button>
      ))}
    </div>
  )
}
