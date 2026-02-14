"use client"

import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useDocumentStore, type SaveStatus } from "@/lib/document-store"
import { useVersionStore } from "@/lib/version-store"
import { useProjectStore } from "@/lib/project-store"
import { ShareDialog } from "@/components/share/share-dialog"
import { IconCheck, IconLoader2, IconPointFilled, IconAlertTriangle, IconHistory, IconChevronRight } from "@tabler/icons-react"

function SaveStatusIndicator() {
  const saveStatus = useDocumentStore((s) => s.saveStatus)
  const saveError = useDocumentStore((s) => s.saveError)
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

  if (saveStatus === "error") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={`flex items-center gap-1 text-xs ${className}`}>
            {icon}
            <span>{label}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">{saveError || "Unknown error"}</p>
          <p className="text-xs text-muted-foreground">Your work is safe locally</p>
        </TooltipContent>
      </Tooltip>
    )
  }

  return (
    <div className={`flex items-center gap-1 text-xs ${className}`}>
      {icon}
      <span>{label}</span>
    </div>
  )
}

export function SiteHeader() {
  const activeDocumentId = useDocumentStore((s) => s.activeDocumentId)
  const documents = useDocumentStore((s) => s.documents)
  const openHistory = useVersionStore((s) => s.openHistory)
  const isHistoryOpen = useVersionStore((s) => s.isHistoryOpen)
  const { projects, activeProjectId } = useProjectStore()

  const activeDoc = documents.find((d) => d.id === activeDocumentId)
  const activeProject = projects.find((p) => p.id === activeProjectId)

  return (
    <header className="flex h-[--header-height] shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-[--header-height]">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 data-[orientation=vertical]:h-4"
        />
        <div className="flex items-center gap-1 text-sm min-w-0">
          {activeProject ? (
            <>
              <span className="text-muted-foreground truncate max-w-[120px]">{activeProject.name}</span>
              {activeDoc && (
                <>
                  <IconChevronRight className="size-3 text-muted-foreground/50 shrink-0" />
                  <span className="font-medium truncate">{activeDoc.title}</span>
                </>
              )}
            </>
          ) : (
            <span className="font-medium">{activeDoc?.title ?? "Documents"}</span>
          )}
        </div>
        <SaveStatusIndicator />
        <div className="ml-auto flex items-center gap-2">
          {activeDocumentId && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className={`gap-1.5 ${isHistoryOpen ? "bg-accent" : ""}`}
                onClick={openHistory}
              >
                <IconHistory className="size-4" />
                <span className="hidden sm:inline">History</span>
              </Button>
              <ShareDialog />
            </>
          )}
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
