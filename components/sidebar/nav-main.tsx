"use client"

import { IconCirclePlusFilled, IconMail, type Icon } from "@tabler/icons-react"
import { useRouter } from "next/navigation"
import { useState, useCallback } from "react"

import { Button } from "@/components/ui/button"
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

export function NavMain({
  items,
}: {
  items: {
    title: string
    url: string
    icon?: Icon
    soon?: boolean
  }[]
}) {
  const router = useRouter()
  const { createDocument, isAuthenticated } = useDocuments()
  const updateFileContent = useFileStore((s) => s.updateFileContent)
  const [templateGalleryOpen, setTemplateGalleryOpen] = useState(false)

  const handleQuickCreate = useCallback(async () => {
    if (isAuthenticated) {
      const doc = await createDocument("Untitled Document")
      if (doc) {
        router.push(`/playground/${doc.id}`)
      }
    } else {
      router.push("/playground")
    }
  }, [isAuthenticated, createDocument, router])

  const handleSelectTemplate = useCallback((content: string, name: string) => {
    if (isAuthenticated) {
      createDocument(name).then((doc) => {
        if (doc) {
          router.push(`/playground/${doc.id}`)
          // Content will be set after navigation
          setTimeout(() => {
            updateFileContent("main", content)
          }, 500)
        }
      })
    } else {
      updateFileContent("1", content)
      router.push("/playground")
    }
  }, [isAuthenticated, createDocument, router, updateFileContent])

  const handleItemClick = useCallback((title: string) => {
    if (title === "Templates") {
      setTemplateGalleryOpen(true)
    }
  }, [])

  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-2">
        <SidebarMenu>
          <SidebarMenuItem className="flex items-center gap-2">
            <SidebarMenuButton
              tooltip="Quick Create"
              className="bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground min-w-8 duration-200 ease-linear"
              onClick={handleQuickCreate}
            >
              <IconCirclePlusFilled />
              <span>Quick Create</span>
            </SidebarMenuButton>
            <Button
              size="icon"
              className="size-8 group-data-[collapsible=icon]:opacity-0"
              variant="outline"
            >
              <IconMail />
              <span className="sr-only">Inbox</span>
            </Button>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarMenu>
          {items.map((item) => {
            const isDisabled = item.soon && item.title !== "Templates"
            return (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton
                  tooltip={item.title}
                  disabled={isDisabled}
                  onClick={() => handleItemClick(item.title)}
                >
                  {item.icon && <item.icon />}
                  <span>{item.title}</span>
                  {isDisabled && (
                    <span className="ml-auto rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-white/30">
                      Soon
                    </span>
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          })}
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
