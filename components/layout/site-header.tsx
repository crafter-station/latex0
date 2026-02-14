"use client"

import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { useDocumentStore, type SaveStatus } from "@/lib/document-store"
import { IconCheck, IconLoader2, IconPointFilled, IconAlertTriangle } from "@tabler/icons-react"

function SaveStatusIndicator() {
  const saveStatus = useDocumentStore((s) => s.saveStatus)
  const activeDocumentId = useDocumentStore((s) => s.activeDocumentId)

  if (!activeDocumentId) return null

  const config: Record<SaveStatus, { icon: React.ReactNode; label: string; className: string }> = {
    saved: {
      icon: <IconCheck className="size-3.5" />,
      label: "Saved",
      className: "text-emerald-600 dark:text-emerald-400",
    },
    saving: {
      icon: <IconLoader2 className="size-3.5 animate-spin" />,
      label: "Saving...",
      className: "text-muted-foreground",
    },
    unsaved: {
      icon: <IconPointFilled className="size-3.5" />,
      label: "Unsaved",
      className: "text-amber-500 dark:text-amber-400",
    },
    error: {
      icon: <IconAlertTriangle className="size-3.5" />,
      label: "Save failed",
      className: "text-destructive",
    },
  }

  const { icon, label, className } = config[saveStatus]

  return (
    <div className={`flex items-center gap-1 text-xs ${className}`}>
      {icon}
      <span>{label}</span>
    </div>
  )
}

export function SiteHeader() {
  return (
    <header className="flex h-[--header-height] shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-[--header-height]">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 data-[orientation=vertical]:h-4"
        />
        <h1 className="text-base font-medium">Documents</h1>
        <SaveStatusIndicator />
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" asChild size="sm" className="hidden sm:flex">
            <a
              href="https://github.com"
              rel="noopener noreferrer"
              target="_blank"
              className="dark:text-foreground"
            >
              GitHub
            </a>
          </Button>
        </div>
      </div>
    </header>
  )
}
