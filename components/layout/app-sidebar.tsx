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
  IconList,
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
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
} from "@/components/ui/sidebar"
import { ThemeSwitcherButton } from "@/components/theme-switcher-button"
import { useUserIdentity } from "@/hooks/use-user-identity"
import { DocumentOutline } from "@/components/editor/document-outline"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { IconChevronRight } from "@tabler/icons-react"

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
      soon: false,
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
      soon: false,
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

        {/* Document Outline */}
        <Collapsible defaultOpen className="group/outline">
          <SidebarGroup>
            <CollapsibleTrigger asChild>
              <SidebarGroupLabel className="cursor-pointer hover:bg-accent/50 rounded-md transition-colors">
                <IconList className="size-3.5 mr-1.5" />
                Outline
                <IconChevronRight className="ml-auto size-3.5 transition-transform group-data-[state=open]/outline:rotate-90" />
              </SidebarGroupLabel>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <SidebarGroupContent>
                <ScrollArea className="max-h-48">
                  <DocumentOutline />
                </ScrollArea>
              </SidebarGroupContent>
            </CollapsibleContent>
          </SidebarGroup>
        </Collapsible>

        <NavSecondary items={data.navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        {!isLoading && user && <NavUser user={user} />}
      </SidebarFooter>
    </Sidebar>
  )
}
