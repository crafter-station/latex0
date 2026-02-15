"use client"

import { PdfViewer } from "./pdf-viewer"

export function UniversalPreview({ zoom = 100 }: { zoom?: number }) {
  return <PdfViewer zoom={zoom} />
}
