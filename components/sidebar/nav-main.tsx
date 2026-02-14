"use client"

import { IconCirclePlusFilled, type Icon } from "@tabler/icons-react"
import { useRouter } from "next/navigation"
import { useState, useCallback } from "react"

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { TemplateGallery } from "@/components/templates/template-gallery"
import { useDocuments } from "@/hooks/use-documents"
import { useFileStore } from "@/lib/file-store"
import { useProjectStore, docUrl } from "@/lib/project-store"

export function NavMain({
  items,
}: {
  items: {
    title: string
    url: string
    icon?: Icon
  }[]
}) {
  const router = useRouter()
  const { createDocument, isAuthenticated } = useDocuments()
  const updateFileContent = useFileStore((s) => s.updateFileContent)
  const [templateGalleryOpen, setTemplateGalleryOpen] = useState(false)

  const activeProjectId = useProjectStore((s) => s.activeProjectId)

  const handleQuickCreate = useCallback(async () => {
    if (isAuthenticated) {
      const doc = await createDocument("Untitled Document", activeProjectId)
      if (doc) {
        router.push(docUrl(doc.id, activeProjectId))
      }
    } else {
      router.push("/playground")
    }
  }, [isAuthenticated, createDocument, router, activeProjectId])

  const handleSelectTemplate = useCallback((content: string, name: string) => {
    if (isAuthenticated) {
      createDocument(name, activeProjectId).then((doc) => {
        if (doc) {
          router.push(docUrl(doc.id, activeProjectId))
          setTimeout(() => {
            updateFileContent("main", content)
          }, 500)
        }
      })
    } else {
      updateFileContent("1", content)
      router.push("/playground")
    }
  }, [isAuthenticated, createDocument, router, updateFileContent, activeProjectId])

  const handleItemClick = useCallback((item: { title: string; url: string }) => {
    if (item.title === "Templates") {
      setTemplateGalleryOpen(true)
    } else if (item.url && item.url !== "#") {
      router.push(item.url)
    }
  }, [router])

  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Quick Create"
              className="bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground min-w-8 duration-200 ease-linear"
              onClick={handleQuickCreate}
            >
              <IconCirclePlusFilled />
              <span>Quick Create</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                tooltip={item.title}
                onClick={() => handleItemClick(item)}
              >
                {item.icon && <item.icon />}
                <span>{item.title}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>

      <TemplateGallery
        open={templateGalleryOpen}
        onOpenChange={setTemplateGalleryOpen}
        onSelectTemplate={handleSelectTemplate}
      />
    </SidebarGroup>
  )
}
