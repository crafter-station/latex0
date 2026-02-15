"use client"

import { useFileStore, type FileNode } from "@/lib/file-store"
import { findAllFiles } from "@/lib/file-utils"
import {
  isImageFile,
  formatFileSize,
  generateLatexInclude,
} from "@/lib/upload-helpers"
import { IconCopy, IconExternalLink, IconTrash, IconPhoto } from "@tabler/icons-react"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"

export function ImageGallery() {
  const files = useFileStore((s) => s.files)
  const deleteFile = useFileStore((s) => s.deleteFile)
  const allFiles = findAllFiles(files)
  const images = allFiles.filter((f) => f.blobUrl && isImageFile(f.name))

  if (images.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center">
        <IconPhoto className="size-8 text-muted-foreground/40" />
        <p className="text-xs text-muted-foreground">
          No images yet. Upload images via the file tree, editor drag-drop, or paste.
        </p>
      </div>
    )
  }

  function handleCopyLatex(file: FileNode) {
    const latex = generateLatexInclude(file.name)
    navigator.clipboard.writeText(latex)
  }

  return (
    <div className="grid grid-cols-2 gap-1.5 p-2">
      {images.map((img) => (
        <ContextMenu key={img.id}>
          <ContextMenuTrigger>
            <div className="group relative aspect-square rounded-lg overflow-hidden border border-border/50 bg-muted/30 cursor-pointer hover:border-border transition-colors">
              <img
                src={img.blobUrl}
                alt={img.name}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-1 pt-4 opacity-0 group-hover:opacity-100 transition-opacity">
                <p className="text-[10px] text-white truncate font-medium">
                  {img.name}
                </p>
                {img.blobMetadata && (
                  <p className="text-[9px] text-white/70">
                    {formatFileSize(img.blobMetadata.size)}
                  </p>
                )}
              </div>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-44">
            <ContextMenuItem onClick={() => handleCopyLatex(img)}>
              <IconCopy className="size-4 mr-2" />
              Copy LaTeX Code
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => window.open(img.blobUrl, "_blank")}
            >
              <IconExternalLink className="size-4 mr-2" />
              Open in New Tab
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              onClick={() => deleteFile(img.id)}
              className="text-destructive focus:text-destructive"
            >
              <IconTrash className="size-4 mr-2" />
              Delete
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      ))}
    </div>
  )
}
