"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { NavUser } from "@/components/sidebar/nav-user"
import { SidebarViewTabs } from "@/components/sidebar/sidebar-view-tabs"
import { FilesTab } from "@/components/sidebar/files-tab"
import { ChatsTab } from "@/components/sidebar/chats-tab"
import { useSidebarViewStore } from "@/lib/sidebar-view-store"
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

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { user, isLoading } = useUserIdentity()
  const activeView = useSidebarViewStore((s) => s.activeView)
  const router = useRouter()

  return (
    <Sidebar collapsible="offcanvas" {...props}>
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
          <SidebarMenuItem>
            <SidebarViewTabs />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {activeView === "files" ? <FilesTab /> : <ChatsTab />}
      </SidebarContent>
      <SidebarFooter>
        {!isLoading && user && <NavUser user={user} />}
      </SidebarFooter>
    </Sidebar>
  )
}
