"use client"

import { useState } from "react"
import type { FileNode } from "@/lib/file-store"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { IconZoomIn, IconZoomOut, IconZoomReset } from "@tabler/icons-react"
import { formatFileSize } from "@/lib/upload-helpers"

interface ImagePreviewProps {
  file: FileNode
}

export function ImagePreview({ file }: ImagePreviewProps) {
  const [zoom, setZoom] = useState(100)

  if (!file.blobUrl) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p className="text-sm">Image not available</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <h3 className="text-sm font-medium">{file.name}</h3>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setZoom((z) => Math.max(10, z - 10))}
          >
            <IconZoomOut className="size-4" />
          </Button>
          <span className="text-xs text-muted-foreground w-10 text-center">
            {zoom}%
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setZoom((z) => Math.min(300, z + 10))}
          >
            <IconZoomIn className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setZoom(100)}
          >
            <IconZoomReset className="size-4" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="flex items-center justify-center min-h-full p-8">
          <img
            src={file.blobUrl}
            alt={file.name}
            style={{
              transform: `scale(${zoom / 100})`,
              transformOrigin: "center",
            }}
            className="max-w-full"
          />
        </div>
      </ScrollArea>

      {file.blobMetadata && (
        <div className="border-t px-4 py-2 text-xs text-muted-foreground flex items-center gap-2">
          {file.blobMetadata.width && file.blobMetadata.height && (
            <span>{file.blobMetadata.width} x {file.blobMetadata.height}</span>
          )}
          <span>{formatFileSize(file.blobMetadata.size)}</span>
        </div>
      )}
    </div>
  )
}
