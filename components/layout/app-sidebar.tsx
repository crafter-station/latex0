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
  IconPhoto,
} from "@tabler/icons-react"

import { FolderTree } from "@/components/sidebar/folder-tree"
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
import { ImageGallery } from "@/components/sidebar/image-gallery"
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
        <FolderTree />

        {/* Scrollable middle area — sections share available space, never push settings off-screen */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto gap-2">
          {/* Project Files */}
          <Collapsible defaultOpen className="group/files shrink-0">
            <SidebarGroup>
              <CollapsibleTrigger asChild>
                <SidebarGroupLabel className="cursor-pointer hover:bg-accent/50 rounded-md transition-colors">
                  <IconFolder className="size-3.5 mr-1.5" />
                  Project Files
                  <IconChevronRight className="ml-auto size-3.5 transition-transform group-data-[state=open]/files:rotate-90" />
                </SidebarGroupLabel>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <SidebarGroupContent>
                  <FileTree />
                </SidebarGroupContent>
              </CollapsibleContent>
            </SidebarGroup>
          </Collapsible>

          {/* Document Outline */}
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

          {/* Image Gallery */}
          <Collapsible className="group/images shrink-0">
            <SidebarGroup>
              <CollapsibleTrigger asChild>
                <SidebarGroupLabel className="cursor-pointer hover:bg-accent/50 rounded-md transition-colors">
                  <IconPhoto className="size-3.5 mr-1.5" />
                  Images
                  <IconChevronRight className="ml-auto size-3.5 transition-transform group-data-[state=open]/images:rotate-90" />
                </SidebarGroupLabel>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <SidebarGroupContent>
                  <ImageGallery />
                </SidebarGroupContent>
              </CollapsibleContent>
            </SidebarGroup>
          </Collapsible>
        </div>

        {/* Settings always pinned at bottom — never overlapped */}
        <NavSecondary items={data.navSecondary} className="shrink-0" />
      </SidebarContent>
      <SidebarFooter>
        {!isLoading && user && <NavUser user={user} />}
      </SidebarFooter>
    </Sidebar>
  )
}
