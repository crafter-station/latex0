"use client"

import * as React from "react"
import {
  IconChartBar,
  IconDashboard,
  IconDatabase,
  IconFileDescription,
  IconFolder,
  IconHelp,
  IconReport,
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

const data = {
  user: {
    name: "Guest User",
    email: "guest@example.com",
    avatar: "/avatars/guest.jpg",
  },
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
  documents: [
    {
      name: "Data Library",
      url: "#",
      icon: IconDatabase,
      soon: true,
    },
    {
      name: "Reports",
      url: "#",
      icon: IconReport,
      soon: true,
    },
    {
      name: "main.tex",
      url: "#",
      icon: IconFileDescription,
    },
  ],
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="data-[slot=sidebar-menu-button]:!p-1.5"
            >
              <a href="/" className="flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-full border border-white/20 bg-black">
                  <span className="font-mono text-xs font-bold text-white">0</span>
                </div>
                <span className="font-mono text-sm font-semibold tracking-wider">
                  LATEX<span className="text-muted-foreground">0</span>
                </span>
                <span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-white/40">
                  Beta
                </span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
        <NavDocuments items={data.documents} />
        <NavSecondary items={data.navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={data.user} />
      </SidebarFooter>
    </Sidebar>
  )
}
