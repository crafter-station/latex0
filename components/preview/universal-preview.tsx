"use client"

import { ExactPreview } from "./exact-preview"
import { HtmlPreview } from "./html-preview"

export function UniversalPreview({ zoom = 100, exact = false }: { zoom?: number; exact?: boolean }) {
  return exact ? <ExactPreview zoom={zoom} /> : <HtmlPreview zoom={zoom} />
}
