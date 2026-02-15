"use client"

import { useRouter } from "next/navigation"
import { IconFolder, IconLayoutGrid, IconUsers } from "@tabler/icons-react"
import { useProjectStore } from "@/lib/project-store"
import { ThemeSwitcherButton } from "@/components/theme-switcher-button"
import { NavUser } from "@/components/sidebar/nav-user"
import { useUserIdentity } from "@/hooks/use-user-identity"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

const views = [
  { id: "all" as const, label: "All Projects", icon: IconLayoutGrid },
  { id: "yours" as const, label: "Your Projects", icon: IconFolder },
  { id: "shared" as const, label: "Shared with you", icon: IconUsers },
]

export function ProjectsSidebar() {
  const router = useRouter()
  const { user, isLoading } = useUserIdentity()
  const activeView = useProjectStore((s) => s.dashboardView)
  const setDashboardView = useProjectStore((s) => s.setDashboardView)

  return (
    <Sidebar collapsible="offcanvas" variant="inset">
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
      </SidebarHeader>
      <SidebarContent>
        <SidebarMenu className="px-2 pt-2">
          {views.map((view) => (
            <SidebarMenuItem key={view.id}>
              <SidebarMenuButton
                isActive={activeView === view.id}
                onClick={() => setDashboardView(view.id)}
              >
                <view.icon className="size-4" />
                {view.label}
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter>
        {!isLoading && user && <NavUser user={user} />}
      </SidebarFooter>
    </Sidebar>
  )
}
