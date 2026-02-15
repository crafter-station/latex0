"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { useDocumentStore } from "@/lib/document-store"
import { useVersionStore } from "@/lib/version-store"
import { ShareDialog } from "@/components/share/share-dialog"
import { IconHistory } from "@tabler/icons-react"

export function SiteHeader() {
  const activeDocumentId = useDocumentStore((s) => s.activeDocumentId)
  const openHistory = useVersionStore((s) => s.openHistory)
  const isHistoryOpen = useVersionStore((s) => s.isHistoryOpen)

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b px-4">
      <div className="flex items-center gap-2">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-1 data-[orientation=vertical]:h-4"
        />
        <Link
          href="/projects"
          className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
        >
          <span className="font-mono text-sm font-bold">
            LATEX<span className="text-muted-foreground">0</span>
          </span>
        </Link>
      </div>

      <div className="flex items-center gap-2">
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
      </div>
    </header>
  )
}
