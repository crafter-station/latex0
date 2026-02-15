"use client"

import * as React from "react"
import { useRouter, useParams } from "next/navigation"
import { NavUser } from "@/components/sidebar/nav-user"
import { SidebarViewTabs } from "@/components/sidebar/sidebar-view-tabs"
import { FilesTab } from "@/components/sidebar/files-tab"
import { ChatsTab } from "@/components/sidebar/chats-tab"
import { useSidebarViewStore } from "@/lib/sidebar-view-store"
import { useProjectStore } from "@/lib/project-store"
import { useDocumentStore } from "@/lib/document-store"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { ThemeSwitcherButton } from "@/components/theme-switcher-button"
import { useUserIdentity } from "@/hooks/use-user-identity"

function SidebarResizeHandle() {
  const handlePointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      const wrapper = document.querySelector("[data-slot='sidebar-wrapper']") as HTMLElement
      if (!wrapper) return

      const startX = e.clientX
      const startWidth = parseInt(
        getComputedStyle(wrapper).getPropertyValue("--sidebar-width") || "320",
        10
      )

      const onPointerMove = (ev: PointerEvent) => {
        const delta = ev.clientX - startX
        const newWidth = Math.max(240, Math.min(480, startWidth + delta))
        wrapper.style.setProperty("--sidebar-width", `${newWidth}px`)
      }

      const onPointerUp = () => {
        document.removeEventListener("pointermove", onPointerMove)
        document.removeEventListener("pointerup", onPointerUp)
        document.body.style.cursor = ""
        document.body.style.userSelect = ""
      }

      document.body.style.cursor = "col-resize"
      document.body.style.userSelect = "none"
      document.addEventListener("pointermove", onPointerMove)
      document.addEventListener("pointerup", onPointerUp)
    },
    []
  )

  return (
    <div
      onPointerDown={handlePointerDown}
      className="absolute -right-2 top-0 bottom-0 w-2 cursor-col-resize z-20"
    />
  )
}

function ProjectName() {
  const params = useParams<{ projectId?: string }>()
  const projects = useProjectStore((s) => s.projects)
  const activeDocumentId = useDocumentStore((s) => s.activeDocumentId)
  const documents = useDocumentStore((s) => s.documents)

  const project = params?.projectId
    ? projects.find((p) => p.id === params.projectId)
    : null

  const doc = activeDocumentId
    ? documents.find((d) => d.id === activeDocumentId)
    : null

  const name = project?.name || doc?.title || "Playground"

  return (
    <div className="px-2 py-3">
      <span className="text-base font-medium truncate block">{name}</span>
    </div>
  )
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { user, isLoading } = useUserIdentity()
  const activeView = useSidebarViewStore((s) => s.activeView)
  const router = useRouter()

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <div className="relative h-full">
        <SidebarResizeHandle />
        <div className="flex h-full flex-col">
          <SidebarHeader>
            <SidebarMenu>
              <SidebarMenuItem>
                <div className="flex items-center justify-between w-full">
                  <SidebarMenuButton
                    asChild
                    className="data-[slot=sidebar-menu-button]:!p-1.5 flex-1"
                  >
                    <button
                      onClick={() => router.push("/projects")}
                      className="flex items-center gap-2"
                    >
                      <div className="flex h-6 w-6 items-center justify-center rounded-full border border-foreground/20 bg-background">
                        <span className="font-mono text-xs font-bold">0</span>
                      </div>
                      <span className="font-mono text-sm font-semibold tracking-wider">
                        LATEX<span className="text-muted-foreground">0</span>
                      </span>
                      <span className="rounded border border-foreground/10 bg-foreground/5 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-foreground/40">
                        Beta
                      </span>
                    </button>
                  </SidebarMenuButton>
                  <ThemeSwitcherButton />
                </div>
              </SidebarMenuItem>
            </SidebarMenu>

            <ProjectName />

            <SidebarViewTabs />
          </SidebarHeader>
          <SidebarContent>
            {activeView === "files" ? <FilesTab /> : <ChatsTab />}
          </SidebarContent>
          <SidebarFooter>
            {!isLoading && user && <NavUser user={user} />}
          </SidebarFooter>
        </div>
      </div>
    </Sidebar>
  )
}
