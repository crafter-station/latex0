"use client"

import * as React from "react"
import {
  IconChartBar,
  IconDashboard,
  IconFileDescription,
  IconFolder,
  IconHelp,
  IconSearch,
  IconSettings,
  IconUsers,
} from "@tabler/icons-react"

import { NavDocuments } from "@/components/sidebar/nav-documents"
import { NavMain } from "@/components/sidebar/nav-main"
import { NavSecondary } from "@/components/sidebar/nav-secondary"
import { NavUser } from "@/components/sidebar/nav-user"
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

const data = {
  navMain: [
    {
      title: "Dashboard",
      url: "#",
      icon: IconDashboard,
      soon: true,
    },
    {
      title: "Projects",
      url: "#",
      icon: IconFolder,
      soon: true,
    },
    {
      title: "Templates",
      url: "#",
      icon: IconFileDescription,
      soon: true,
    },
    {
      title: "Analytics",
      url: "#",
      icon: IconChartBar,
      soon: true,
    },
    {
      title: "Team",
      url: "#",
      icon: IconUsers,
      soon: true,
    },
  ],
  navSecondary: [
    {
      title: "Settings",
      url: "#",
      icon: IconSettings,
      soon: true,
    },
    {
      title: "Get Help",
      url: "#",
      icon: IconHelp,
      soon: true,
    },
    {
      title: "Search",
      url: "#",
      icon: IconSearch,
      soon: true,
    },
  ],
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { user, isLoading } = useUserIdentity()

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
                <a href="/" className="flex items-center gap-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full border border-foreground/20 bg-background">
                    <span className="font-mono text-xs font-bold">0</span>
                  </div>
                  <span className="font-mono text-sm font-semibold tracking-wider">
                    LATEX<span className="text-muted-foreground">0</span>
                  </span>
                  <span className="rounded border border-foreground/10 bg-foreground/5 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-foreground/40">
                    Beta
                  </span>
                </a>
              </SidebarMenuButton>
              <ThemeSwitcherButton />
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
        <NavDocuments />
        <NavSecondary items={data.navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        {!isLoading && user && <NavUser user={user} />}
      </SidebarFooter>
    </Sidebar>
  )
}
