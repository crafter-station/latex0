"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  IconChevronRight,
  IconFolder,
  IconFolderOpen,
  IconFolderPlus,
  IconDots,
  IconPencil,
  IconTrash,
  IconFileDescription,
  IconPlus,
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
  SidebarMenuSub,
  useSidebar,
} from "@/components/ui/sidebar"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { useFolderStore, type FolderNode } from "@/lib/folder-store"
import { useDocumentStore, type DocumentMeta } from "@/lib/document-store"
import { useDocuments } from "@/hooks/use-documents"

function FolderItem({
  node,
  documents,
  activeDocumentId,
  onNavigate,
  onDeleteDocument,
  onRenameDocument,
}: {
  node: FolderNode
  documents: DocumentMeta[]
  activeDocumentId: string | null
  onNavigate: (docId: string) => void
  onDeleteDocument: (docId: string) => void
  onRenameDocument: (docId: string, title: string) => void
}) {
  const { isMobile } = useSidebar()
  const {
    expandedFolders,
    toggleExpanded,
    renameFolder,
    deleteFolder,
    createFolder,
  } = useFolderStore()

  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(node.name)
  const renameRef = useRef<HTMLInputElement>(null)

  const isExpanded = expandedFolders.has(node.id)
  const folderDocs = documents.filter((d) => d.folderId === node.id)

  useEffect(() => {
    if (isRenaming && renameRef.current) {
      renameRef.current.focus()
      renameRef.current.select()
    }
  }, [isRenaming])

  async function handleRename() {
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== node.name) {
      await renameFolder(node.id, trimmed)
    }
    setIsRenaming(false)
  }

  return (
    <Collapsible open={isExpanded} onOpenChange={() => toggleExpanded(node.id)}>
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton>
            <IconChevronRight
              className={`size-3.5 transition-transform ${isExpanded ? "rotate-90" : ""}`}
            />
            {isExpanded ? (
              <IconFolderOpen className="size-4" />
            ) : (
              <IconFolder className="size-4" />
            )}
            {isRenaming ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  handleRename()
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  ref={renameRef}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={handleRename}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setIsRenaming(false)
                  }}
                  className="w-full rounded-sm border border-sidebar-accent bg-sidebar px-1.5 py-0.5 text-sm outline-none focus:border-sidebar-primary"
                />
              </form>
            ) : (
              <span>{node.name}</span>
            )}
          </SidebarMenuButton>
        </CollapsibleTrigger>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuAction
              showOnHover
              className="data-[state=open]:bg-accent rounded-sm"
            >
              <IconDots />
            </SidebarMenuAction>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-40 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align={isMobile ? "end" : "start"}
          >
            <DropdownMenuItem
              onClick={() =>
                createFolder("New Folder", node.id)
              }
            >
              <IconFolderPlus />
              <span>New Subfolder</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                setRenameValue(node.name)
                setIsRenaming(true)
              }}
            >
              <IconPencil />
              <span>Rename</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => deleteFolder(node.id)}
            >
              <IconTrash />
              <span>Delete</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <CollapsibleContent>
          <SidebarMenuSub>
            {/* Child folders */}
            {node.children.map((child) => (
              <FolderItem
                key={child.id}
                node={child}
                documents={documents}
                activeDocumentId={activeDocumentId}
                onNavigate={onNavigate}
                onDeleteDocument={onDeleteDocument}
                onRenameDocument={onRenameDocument}
              />
            ))}

            {/* Documents in this folder */}
            {folderDocs.map((doc) => (
              <DocumentItem
                key={doc.id}
                doc={doc}
                isActive={doc.id === activeDocumentId}
                onNavigate={onNavigate}
                onDelete={onDeleteDocument}
                onRename={onRenameDocument}
              />
            ))}

            {node.children.length === 0 && folderDocs.length === 0 && (
              <SidebarMenuItem>
                <SidebarMenuButton
                  disabled
                  className="text-sidebar-foreground/40 text-xs"
                >
                  <span>Empty folder</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  )
}

function DocumentItem({
  doc,
  isActive,
  onNavigate,
  onDelete,
  onRename,
}: {
  doc: DocumentMeta
  isActive: boolean
  onNavigate: (docId: string) => void
  onDelete: (docId: string) => void
  onRename: (docId: string, title: string) => void
}) {
  const { isMobile } = useSidebar()
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(doc.title)
  const renameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isRenaming && renameRef.current) {
      renameRef.current.focus()
      renameRef.current.select()
    }
  }, [isRenaming])

  function handleRename() {
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== doc.title) {
      onRename(doc.id, trimmed)
    }
    setIsRenaming(false)
  }

  return (
    <SidebarMenuItem>
      {isRenaming ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleRename()
          }}
          className="flex-1 px-2 py-1"
        >
          <input
            ref={renameRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => {
              if (e.key === "Escape") setIsRenaming(false)
            }}
            className="w-full rounded-sm border border-sidebar-accent bg-sidebar px-1.5 py-0.5 text-sm outline-none focus:border-sidebar-primary"
          />
        </form>
      ) : (
        <SidebarMenuButton
          isActive={isActive}
          onClick={() => onNavigate(doc.id)}
        >
          <IconFileDescription className="size-4" />
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
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-32 rounded-lg"
          side={isMobile ? "bottom" : "right"}
          align={isMobile ? "end" : "start"}
        >
          <DropdownMenuItem
            onClick={() => {
              setRenameValue(doc.title)
              setIsRenaming(true)
            }}
          >
            <IconPencil />
            <span>Rename</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => onDelete(doc.id)}
          >
            <IconTrash />
            <span>Delete</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  )
}

export function FolderTree() {
  const router = useRouter()
  const {
    tree,
    isLoading: foldersLoading,
    fetchFolders,
    createFolder,
  } = useFolderStore()

  const {
    documents,
    activeDocumentId,
    isLoading: docsLoading,
    isAuthenticated,
    fetchDocuments,
    createDocument,
    deleteDocument,
    renameDocument,
  } = useDocuments()

  useEffect(() => {
    if (isAuthenticated) {
      fetchFolders()
      fetchDocuments()
    }
  }, [isAuthenticated, fetchFolders, fetchDocuments])

  function handleNavigate(docId: string) {
    router.push(`/playground/${docId}`)
  }

  async function handleCreate() {
    const doc = await createDocument()
    if (doc) {
      router.push(`/playground/${doc.id}`)
    }
  }

  async function handleDelete(docId: string) {
    await deleteDocument(docId)
    if (docId === activeDocumentId) {
      router.push("/playground")
    }
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

  const isLoading = foldersLoading || docsLoading

  // Documents not in any folder
  const rootDocs = documents.filter((d) => !d.folderId)

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel className="flex items-center justify-between">
        <span>Documents</span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => createFolder("New Folder")}
            className="flex h-5 w-5 items-center justify-center rounded-sm hover:bg-sidebar-accent"
            title="New Folder"
          >
            <IconFolderPlus size={14} />
          </button>
          <button
            onClick={handleCreate}
            className="flex h-5 w-5 items-center justify-center rounded-sm hover:bg-sidebar-accent"
            title="New Document"
          >
            <IconPlus size={14} />
          </button>
        </div>
      </SidebarGroupLabel>
      <SidebarMenu>
        {isLoading && (
          <SidebarMenuItem>
            <SidebarMenuButton disabled>
              <span className="text-sidebar-foreground/50">Loading...</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )}

        {!isLoading && (
          <>
            {/* Folder tree */}
            {tree.map((node) => (
              <FolderItem
                key={node.id}
                node={node}
                documents={documents}
                activeDocumentId={activeDocumentId}
                onNavigate={handleNavigate}
                onDeleteDocument={handleDelete}
                onRenameDocument={renameDocument}
              />
            ))}

            {/* Root-level documents (no folder) */}
            {rootDocs.map((doc) => (
              <DocumentItem
                key={doc.id}
                doc={doc}
                isActive={doc.id === activeDocumentId}
                onNavigate={handleNavigate}
                onDelete={handleDelete}
                onRename={renameDocument}
              />
            ))}

            {tree.length === 0 && rootDocs.length === 0 && (
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
          </>
        )}
      </SidebarMenu>
    </SidebarGroup>
  )
}
