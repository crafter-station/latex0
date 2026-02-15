"use client"

import { useState, useRef, useEffect } from "react"
import {
  IconFile,
  IconFolder,
  IconFolderOpen,
  IconFilePlus,
  IconFolderPlus,
  IconChevronRight,
  IconPhotoPlus,
  IconPhoto,
  IconCopy,
  IconExternalLink,
} from "@tabler/icons-react"
import { useFileStore, type FileNode } from "@/lib/file-store"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { cn } from "@/lib/utils"
import {
  isImageFile,
  uploadAndAddToTree,
  generateLatexInclude,
  formatFileSize,
} from "@/lib/upload-helpers"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"

export function FileTree() {
  const files = useFileStore((s) => s.files)
  const activeTabId = useFileStore((s) => s.activeTabId)
  const openFile = useFileStore((s) => s.openFile)
  const createFile = useFileStore((s) => s.createFile)
  const createFolder = useFileStore((s) => s.createFolder)
  const renameFile = useFileStore((s) => s.renameFile)
  const deleteFile = useFileStore((s) => s.deleteFile)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleStartRename(fileId: string, currentName: string) {
    setEditingId(fileId)
    setEditingName(currentName)
  }

  function handleRenameSubmit(fileId: string) {
    if (editingName.trim()) {
      renameFile(fileId, editingName.trim())
    }
    setEditingId(null)
  }

  function handleCancelRename() {
    setEditingId(null)
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const uploadFiles = Array.from(e.target.files || [])
    for (const file of uploadFiles.filter((f) => isImageFile(f.name))) {
      try {
        await uploadAndAddToTree(file)
      } catch {
        // Error already handled by uploadAndAddToTree
      }
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-end px-2 mb-1">
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex h-5 w-5 items-center justify-center rounded-sm hover:bg-sidebar-accent"
            title="Upload Image"
          >
            <IconPhotoPlus size={14} />
          </button>
          <button
            onClick={() => createFile("untitled.tex")}
            className="flex h-5 w-5 items-center justify-center rounded-sm hover:bg-sidebar-accent"
            title="New File"
          >
            <IconFilePlus size={14} />
          </button>
          <button
            onClick={() => createFolder("folder")}
            className="flex h-5 w-5 items-center justify-center rounded-sm hover:bg-sidebar-accent"
            title="New Folder"
          >
            <IconFolderPlus size={14} />
          </button>
        </div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/svg+xml,image/webp,application/pdf"
        multiple
        className="hidden"
        onChange={handleFileUpload}
      />
      {files.map((file) => (
        <FileTreeNode
          key={file.id}
          file={file}
          depth={0}
          activeId={activeTabId}
          editingId={editingId}
          editingName={editingName}
          onEditingNameChange={setEditingName}
          onOpen={openFile}
          onStartRename={handleStartRename}
          onRenameSubmit={handleRenameSubmit}
          onCancelRename={handleCancelRename}
          onDelete={deleteFile}
          onCreateFile={createFile}
          onCreateFolder={createFolder}
        />
      ))}
    </div>
  )
}

interface FileTreeNodeProps {
  file: FileNode
  depth: number
  activeId: string | null
  editingId: string | null
  editingName: string
  onEditingNameChange: (name: string) => void
  onOpen: (id: string) => void
  onStartRename: (id: string, name: string) => void
  onRenameSubmit: (id: string) => void
  onCancelRename: () => void
  onDelete: (id: string) => void
  onCreateFile: (name: string, parentId?: string) => void
  onCreateFolder: (name: string, parentId?: string) => void
}

function FileTreeNode({
  file,
  depth,
  activeId,
  editingId,
  editingName,
  onEditingNameChange,
  onOpen,
  onStartRename,
  onRenameSubmit,
  onCancelRename,
  onDelete,
  onCreateFile,
  onCreateFolder,
}: FileTreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  const inputRef = useRef<HTMLInputElement>(null)

  const isEditing = editingId === file.id
  const isActive = activeId === file.id
  const isImage = !!(file.blobUrl && isImageFile(file.name))

  useEffect(() => {
    if (!isEditing) return
    // Delay focus so Radix ContextMenu finishes closing and releasing focus
    const timer = setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus()
        // Select filename without extension
        const dotIndex = inputRef.current.value.lastIndexOf(".")
        inputRef.current.setSelectionRange(0, dotIndex > 0 ? dotIndex : inputRef.current.value.length)
      }
    }, 50)
    return () => clearTimeout(timer)
  }, [isEditing])

  function handleCopyLatexCode() {
    const latex = generateLatexInclude(file.name)
    navigator.clipboard.writeText(latex)
  }

  const fileIcon = isImage ? (
    <div className="size-4 rounded overflow-hidden shrink-0">
      <img
        src={file.blobUrl}
        alt={file.name}
        className="w-full h-full object-cover"
      />
    </div>
  ) : (
    <IconFile className="size-4 shrink-0 text-sidebar-foreground/70" />
  )

  const nodeContent = (
    <div
      className={cn(
        "flex items-center gap-1.5 px-2 py-1 rounded-sm cursor-pointer text-sm transition-colors",
        isActive
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "hover:bg-sidebar-accent/50 text-sidebar-foreground"
      )}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
      onClick={() => {
        if (file.type === "file") onOpen(file.id)
        else setIsExpanded(!isExpanded)
      }}
    >
      {file.type === "folder" ? (
        <>
          <IconChevronRight
            className={cn(
              "size-3 shrink-0 transition-transform",
              isExpanded && "rotate-90"
            )}
          />
          {isExpanded ? (
            <IconFolderOpen className="size-4 shrink-0 text-sidebar-foreground/70" />
          ) : (
            <IconFolder className="size-4 shrink-0 text-sidebar-foreground/70" />
          )}
        </>
      ) : (
        <>
          <span className="w-3" />
          {fileIcon}
        </>
      )}
      {isEditing ? (
        <input
          ref={inputRef}
          value={editingName}
          onChange={(e) => onEditingNameChange(e.target.value)}
          onBlur={() => onRenameSubmit(file.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onRenameSubmit(file.id)
            if (e.key === "Escape") onCancelRename()
          }}
          onClick={(e) => e.stopPropagation()}
          className="flex-1 min-w-0 rounded-sm border border-sidebar-accent bg-sidebar px-1 py-0 text-sm outline-none focus:border-sidebar-primary"
        />
      ) : (
        <span className="truncate">{file.name}</span>
      )}
      {isImage && file.blobMetadata && (
        <span className="ml-auto text-[10px] text-muted-foreground shrink-0">
          {formatFileSize(file.blobMetadata.size)}
        </span>
      )}
    </div>
  )

  const wrappedNode = isImage ? (
    <HoverCard openDelay={300} closeDelay={100}>
      <HoverCardTrigger asChild>{nodeContent}</HoverCardTrigger>
      <HoverCardContent side="right" className="w-56 p-2">
        <img
          src={file.blobUrl}
          alt={file.name}
          className="w-full rounded-md object-contain max-h-40"
        />
        <div className="mt-2 space-y-0.5">
          <p className="text-xs font-medium truncate">{file.name}</p>
          {file.blobMetadata && (
            <p className="text-[10px] text-muted-foreground">
              {file.blobMetadata.width && file.blobMetadata.height
                ? `${file.blobMetadata.width}×${file.blobMetadata.height} · `
                : ""}
              {formatFileSize(file.blobMetadata.size)}
            </p>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  ) : (
    nodeContent
  )

  return (
    <div>
      <ContextMenu>
        <ContextMenuTrigger>{wrappedNode}</ContextMenuTrigger>
        <ContextMenuContent className="w-44">
          {file.type === "folder" && (
            <>
              <ContextMenuItem onClick={() => onCreateFile("untitled.tex", file.id)}>
                <IconFilePlus className="size-4 mr-2" />
                New File
              </ContextMenuItem>
              <ContextMenuItem onClick={() => onCreateFolder("folder", file.id)}>
                <IconFolderPlus className="size-4 mr-2" />
                New Folder
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          {isImage && (
            <>
              <ContextMenuItem onClick={handleCopyLatexCode}>
                <IconCopy className="size-4 mr-2" />
                Copy LaTeX Code
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => window.open(file.blobUrl, "_blank")}
              >
                <IconExternalLink className="size-4 mr-2" />
                Open in New Tab
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          <ContextMenuItem onClick={() => onStartRename(file.id, file.name)}>
            Rename
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onClick={() => onDelete(file.id)}
            className="text-destructive focus:text-destructive"
          >
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {file.type === "folder" && isExpanded && file.children && (
        <div>
          {file.children.map((child) => (
            <FileTreeNode
              key={child.id}
              file={child}
              depth={depth + 1}
              activeId={activeId}
              editingId={editingId}
              editingName={editingName}
              onEditingNameChange={onEditingNameChange}
              onOpen={onOpen}
              onStartRename={onStartRename}
              onRenameSubmit={onRenameSubmit}
              onCancelRename={onCancelRename}
              onDelete={onDelete}
              onCreateFile={onCreateFile}
              onCreateFolder={onCreateFolder}
            />
          ))}
        </div>
      )}
    </div>
  )
}
