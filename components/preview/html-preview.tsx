"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useFileStore } from "@/lib/file-store"
import { bundleLatexFiles } from "@/lib/latex-bundler"
import { findMainFile } from "@/lib/file-utils"
import { ScrollArea } from "@/components/ui/scroll-area"
import { render, LATEX_CSS } from "@/lib/latex"

interface HtmlPreviewProps {
  zoom?: number
}

// Instant, client-side LaTeX -> HTML preview. Replaces the remote PDF compile:
// every edit re-renders locally in well under a millisecond, so there is no
// debounce and no network round-trip.
export function HtmlPreview({ zoom = 100 }: HtmlPreviewProps) {
  // Subscribing to `files` re-runs this on every content edit (the store
  // returns a fresh array each keystroke).
  const files = useFileStore((s) => s.files)
  const [html, setHtml] = useState("")
  const [error, setError] = useState<string | null>(null)
  const renderToken = useRef(0)

  useEffect(() => {
    const token = ++renderToken.current
    if (!files.length) {
      setHtml("")
      return
    }
    const main = findMainFile(files)
    bundleLatexFiles(files, main)
      .then(({ source, images }) => {
        if (token !== renderToken.current) return // a newer edit won
        const imageMap: Record<string, string> = {}
        for (const [path, v] of Object.entries(images)) imageMap[path] = v.url
        try {
          setHtml(render(source, { images: imageMap }))
          setError(null)
        } catch (e) {
          setError(e instanceof Error ? e.message : "Render failed")
        }
      })
      .catch((e) => {
        if (token !== renderToken.current) return
        setError(e instanceof Error ? e.message : "Render failed")
      })
  }, [files])

  // Browser print (Cmd/Ctrl+P) is the zero-dependency "export to PDF".
  useEffect(() => {
    const onDownload = () => window.print()
    window.addEventListener("latex0:download-pdf", onDownload)
    return () => window.removeEventListener("latex0:download-pdf", onDownload)
  }, [])

  const rootStyle = useMemo(
    () => ({ fontSize: `${(16 * zoom) / 100}px` }),
    [zoom]
  )

  return (
    <ScrollArea className="relative h-full flex-1">
      <style>{LATEX_CSS}</style>
      <div className="flex items-start justify-center p-4 min-h-full">
        {error ? (
          <div className="w-full max-w-2xl rounded-lg border border-destructive/50 bg-destructive/10 p-4">
            <h3 className="mb-2 font-semibold text-destructive">Render Error</h3>
            <pre className="whitespace-pre-wrap text-sm text-destructive/80">{error}</pre>
          </div>
        ) : (
          <div className="w-full max-w-[210mm] bg-white shadow-lg rounded-lg overflow-hidden dark:invert dark:hue-rotate-180">
            <div
              className="l0-root px-[18mm] py-[16mm]"
              style={rootStyle}
              // Engine output is escaped at every text boundary in render.ts.
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </div>
        )}
      </div>
      <div className="pointer-events-none sticky bottom-2 ml-auto mr-3 w-fit select-none rounded-full bg-muted/70 px-2.5 py-1 text-[10px] font-medium text-muted-foreground backdrop-blur-sm">
        Rendered by latex0 · experimental zero-dependency parser
      </div>
    </ScrollArea>
  )
}
