"use client"

import { useFileStore } from "@/lib/file-store"
import { PdfViewer } from "./pdf-viewer"
import { TextPreview } from "./text-preview"
import { IconFile } from "@tabler/icons-react"
import { isImageFile } from "@/lib/upload-helpers"

type PreviewType = "pdf" | "text" | "unsupported"

function getFilePreviewType(fileName: string): PreviewType {
  const ext = fileName.split(".").pop()?.toLowerCase()

  if (["txt", "md", "bib", "log", "cls", "sty"].includes(ext || "")) {
    return "text"
  }
  if (ext === "tex" || ext === "pdf") {
    return "pdf"
  }

  return "unsupported"
}

export function UniversalPreview({ zoom = 100 }: { zoom?: number }) {
  const activeFileTabId = useFileStore((s) => s.activeTabId)
  const getFileById = useFileStore((s) => s.getFileById)

  const file = activeFileTabId ? getFileById(activeFileTabId) : null

  // If an image is selected, keep showing the PDF — right panel is always PDF
  if (!file || (file.blobUrl && isImageFile(file.name))) {
    return <PdfViewer zoom={zoom} />
  }

  const previewType = getFilePreviewType(file.name)

  switch (previewType) {
    case "pdf":
      return <PdfViewer zoom={zoom} />
    case "text":
      return <TextPreview file={file} />
    default:
      return <PdfViewer zoom={zoom} />
  }
}
