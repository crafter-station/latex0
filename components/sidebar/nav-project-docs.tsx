"use client"

import { useRouter, useParams } from "next/navigation"
import { IconFileDescription, IconPlus } from "@tabler/icons-react"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { useDocuments } from "@/hooks/use-documents"
import { useProjectStore, docUrl } from "@/lib/project-store"

export function NavProjectDocs() {
  const router = useRouter()
  const params = useParams<{ docId?: string }>()
  const { documents, isLoading, createDocument } = useDocuments()
  const activeProjectId = useProjectStore((s) => s.activeProjectId)

  if (!activeProjectId) return null

  const projectDocs = documents.filter((d) => d.projectId === activeProjectId)

  async function handleCreate() {
    const doc = await createDocument("Untitled Document", activeProjectId)
    if (doc) {
      router.push(docUrl(doc.id, activeProjectId))
    }
  }

  if (isLoading) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton disabled>
            <span className="text-sidebar-foreground/30 text-xs">Loading...</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    )
  }

  return (
    <SidebarMenu>
      {projectDocs.map((doc) => (
        <SidebarMenuItem key={doc.id}>
          <SidebarMenuButton
            isActive={doc.id === params.docId}
            onClick={() => router.push(docUrl(doc.id, activeProjectId))}
            className="text-xs"
          >
            <IconFileDescription className="size-3.5 shrink-0" />
            <span className="truncate">{doc.title}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
      {projectDocs.length === 0 && (
        <SidebarMenuItem>
          <SidebarMenuButton
            onClick={handleCreate}
            className="text-sidebar-foreground/50 text-xs"
          >
            <IconPlus className="size-3.5" />
            <span>New Document</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      )}
    </SidebarMenu>
  )
}
