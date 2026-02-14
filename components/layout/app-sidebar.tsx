"use client"

import * as React from "react"
import {
  IconFileDescription,
  IconFolder,
  IconSearch,
  IconSettings,
  IconList,
} from "@tabler/icons-react"

import { ProjectSwitcher } from "@/components/sidebar/project-selector"
import { NavProjectDocs } from "@/components/sidebar/nav-project-docs"
import { FileTree } from "@/components/sidebar/file-tree"
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { IconChevronRight } from "@tabler/icons-react"

const data = {
  navMain: [
    {
      title: "Projects",
      url: "/projects",
      icon: IconFolder,
    },
    {
      title: "Templates",
      url: "#",
      icon: IconFileDescription,
    },
  ],
  navSecondary: [
    {
      title: "Search",
      url: "#",
      icon: IconSearch,
    },
    {
      title: "Settings",
      url: "#",
      icon: IconSettings,
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
          <SidebarMenuItem>
            <ProjectSwitcher />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />

        {/* Project Documents */}
        <SidebarGroup>
          <SidebarGroupLabel>Documents</SidebarGroupLabel>
          <SidebarGroupContent>
            <NavProjectDocs />
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Editor Files */}
        <SidebarGroup className="flex-1 min-h-0">
          <SidebarGroupLabel>Files</SidebarGroupLabel>
          <SidebarGroupContent className="overflow-y-auto">
            <FileTree />
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Outline */}
        <Collapsible defaultOpen className="group/outline shrink-0">
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
                <DocumentOutline />
              </SidebarGroupContent>
            </CollapsibleContent>
          </SidebarGroup>
        </Collapsible>

        {/* Settings always pinned at bottom — never overlapped */}
        <NavSecondary items={data.navSecondary} className="shrink-0" />
      </SidebarContent>
      <SidebarFooter>
        {!isLoading && user && <NavUser user={user} />}
      </SidebarFooter>
    </Sidebar>
  )
}
