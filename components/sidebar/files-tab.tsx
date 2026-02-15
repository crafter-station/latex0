"use client"

import { FileTree } from "@/components/sidebar/file-tree"
import { DocumentOutline } from "@/components/editor/document-outline"
import { FileActionsDropdown } from "@/components/sidebar/file-actions-dropdown"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
} from "@/components/ui/sidebar"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { IconChevronRight, IconList } from "@tabler/icons-react"

export function FilesTab() {
  return (
    <>
      <SidebarGroup className="flex-1 min-h-0">
        <SidebarGroupLabel className="flex items-center justify-between">
          <span>Files</span>
          <FileActionsDropdown />
        </SidebarGroupLabel>
        <SidebarGroupContent className="overflow-y-auto">
          <FileTree />
        </SidebarGroupContent>
      </SidebarGroup>

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
    </>
  )
}
