"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  IconDots,
  IconFileDescription,
  IconPencil,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { useDocuments } from "@/hooks/use-documents"

export function NavDocuments() {
  const router = useRouter()
  const { isMobile } = useSidebar()
  const {
    documents,
    activeDocumentId,
    isLoading,
    isAuthenticated,
    fetchDocuments,
    createDocument,
    deleteDocument,
    renameDocument,
  } = useDocuments()

  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchDocuments()
  }, [fetchDocuments])

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renamingId])

  function handleNavigate(docId: string) {
    router.push(`/playground/${docId}`)
  }

  async function handleCreate() {
    const doc = await createDocument()
    if (doc) {
      router.push(`/playground/${doc.id}`)
    }
  }

  function handleStartRename(docId: string, currentTitle: string) {
    setRenamingId(docId)
    setRenameValue(currentTitle)
  }

  async function handleConfirmRename(docId: string) {
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== documents.find((d) => d.id === docId)?.title) {
      await renameDocument(docId, trimmed)
    }
    setRenamingId(null)
  }

  function handleCancelRename() {
    setRenamingId(null)
  }

  if (!isAuthenticated) {
    return (
      <SidebarGroup className="group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel>Documents</SidebarGroupLabel>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton>
              <IconFileDescription />
              <span>main.tex</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>
    )
  }

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel className="flex items-center justify-between">
        <span>Documents</span>
        <button
          onClick={handleCreate}
          className="flex h-5 w-5 items-center justify-center rounded-sm hover:bg-sidebar-accent"
        >
          <IconPlus size={14} />
        </button>
      </SidebarGroupLabel>
      <SidebarMenu>
        {isLoading && (
          <SidebarMenuItem>
            <SidebarMenuButton disabled>
              <span className="text-sidebar-foreground/50">Loading...</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )}
        {!isLoading && documents.length === 0 && (
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={handleCreate}
              className="text-sidebar-foreground/50"
            >
              <IconPlus size={14} />
              <span>New Document</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )}
        {documents.map((doc) => (
          <SidebarMenuItem key={doc.id}>
            {renamingId === doc.id ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  handleConfirmRename(doc.id)
                }}
                className="flex-1 px-2 py-1"
              >
                <input
                  ref={renameInputRef}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => handleConfirmRename(doc.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") handleCancelRename()
                  }}
                  className="w-full rounded-sm border border-sidebar-accent bg-sidebar px-1.5 py-0.5 text-sm outline-none focus:border-sidebar-primary"
                />
              </form>
            ) : (
              <SidebarMenuButton
                isActive={doc.id === activeDocumentId}
                onClick={() => handleNavigate(doc.id)}
              >
                <IconFileDescription />
                <span>{doc.title}</span>
              </SidebarMenuButton>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuAction
                  showOnHover
                  className="data-[state=open]:bg-accent rounded-sm"
                >
                  <IconDots />
                  <span className="sr-only">More</span>
                </SidebarMenuAction>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-32 rounded-lg"
                side={isMobile ? "bottom" : "right"}
                align={isMobile ? "end" : "start"}
              >
                <DropdownMenuItem
                  onClick={() => handleStartRename(doc.id, doc.title)}
                >
                  <IconPencil />
                  <span>Rename</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={async () => {
                    await deleteDocument(doc.id)
                    if (doc.id === activeDocumentId) {
                      router.push("/playground")
                    }
                  }}
                >
                  <IconTrash />
                  <span>Delete</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}
