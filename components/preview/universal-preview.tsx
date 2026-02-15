"use client"

import { useFileStore } from "@/lib/file-store"
import { PdfViewer } from "./pdf-viewer"
import { TextPreview } from "./text-preview"
import { ImagePreview } from "./image-preview"
import { IconFile } from "@tabler/icons-react"

type PreviewType = "pdf" | "image" | "text" | "unsupported"

function getFilePreviewType(fileName: string, hasBlobUrl: boolean): PreviewType {
  const ext = fileName.split(".").pop()?.toLowerCase()

  if (["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(ext || "")) {
    return hasBlobUrl ? "image" : "unsupported"
  }
  if (["txt", "md", "bib", "log", "cls", "sty"].includes(ext || "")) {
    return "text"
  }
  if (ext === "tex") {
    return "pdf"
  }
  if (ext === "pdf") {
    return "pdf"
  }

  return "unsupported"
}

export function UniversalPreview({ zoom = 100 }: { zoom?: number }) {
  const activeFileTabId = useFileStore((s) => s.activeTabId)
  const getFileById = useFileStore((s) => s.getFileById)

  // Always show preview based on the last active file, even during chat
  const file = activeFileTabId ? getFileById(activeFileTabId) : null
  if (!file) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <IconFile className="size-12 mx-auto mb-3 text-muted-foreground/20" />
          <p className="text-sm text-muted-foreground">Open a file to see preview</p>
        </div>
      </div>
    )
  }

  const previewType = getFilePreviewType(file.name, !!file.blobUrl)

  switch (previewType) {
    case "pdf":
      return <PdfViewer zoom={zoom} />
    case "image":
      return <ImagePreview file={file} />
    case "text":
      return <TextPreview file={file} />
    default:
      return (
        <div className="flex h-full items-center justify-center">
          <div className="text-center">
            <IconFile className="size-12 mx-auto mb-3 text-muted-foreground/20" />
            <p className="text-sm text-muted-foreground">
              Preview not available for this file type
            </p>
            <p className="text-xs text-muted-foreground/60 mt-1">{file.name}</p>
          </div>
        </div>
      )
  }
}
