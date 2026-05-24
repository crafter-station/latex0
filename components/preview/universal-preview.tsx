"use client"

import { HtmlPreview } from "./html-preview"

export function UniversalPreview({ zoom = 100 }: { zoom?: number }) {
  return <HtmlPreview zoom={zoom} />
}
