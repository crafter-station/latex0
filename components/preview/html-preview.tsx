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
  // The download handler is registered once; keep the latest rendered HTML in a
  // ref so it always prints the current document, not a stale closure.
  const htmlRef = useRef("")
  htmlRef.current = html

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

  // "Export to PDF" = browser print, but of *only* the rendered document. We
  // print a detached iframe containing just the document HTML + LaTeX CSS, so
  // the editor/panels never leak into the output (true WYSIWYG of the preview).
  useEffect(() => {
    const onDownload = () => {
      const main = findMainFile(useFileStore.getState().files)
      const title = (main?.name ?? "document").replace(/\.tex$/i, "")
      printDocument(htmlRef.current, title)
    }
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
      <div className="pointer-events-none sticky top-2 z-10 -mb-7 ml-auto mr-3 w-fit select-none rounded-full bg-muted/70 px-2.5 py-1 text-[10px] font-medium text-muted-foreground backdrop-blur-sm">
        Rendered by latex0 · experimental zero-dependency parser
      </div>
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
    </ScrollArea>
  )
}

// Print just the rendered document via a detached iframe. The iframe carries
// only the LaTeX CSS + document HTML — none of the surrounding IDE chrome — so
// the printout/PDF matches the preview exactly. `@page` supplies the LaTeX-like
// margins (the on-screen 18mm/16mm padding lives on the React wrapper, not in
// LATEX_CSS, so we restate it here).
function printDocument(html: string, title: string): void {
  if (typeof document === "undefined" || !html) return

  const iframe = document.createElement("iframe")
  iframe.setAttribute("aria-hidden", "true")
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden"
  document.body.appendChild(iframe)

  const doc = iframe.contentDocument
  if (!doc) {
    iframe.remove()
    return
  }

  doc.open()
  doc.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeForHtml(title)}</title>` +
      `<style>${LATEX_CSS}` +
      `@page{margin:16mm 18mm}` +
      `html,body{margin:0;padding:0;background:#fff}` +
      `.l0-root{color:#000}` +
      `</style></head><body><div class="l0-root">${html}</div></body></html>`
  )
  doc.close()

  const win = iframe.contentWindow
  if (!win) {
    iframe.remove()
    return
  }

  let done = false
  const cleanup = () => {
    if (done) return
    done = true
    // Defer removal so the print dialog has fully grabbed the document.
    setTimeout(() => iframe.remove(), 1000)
  }

  const triggerPrint = async () => {
    // Wait for images (blob URLs) to settle so they aren't blank in the PDF.
    const imgs = Array.from(doc.images)
    await Promise.all(
      imgs.map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise<void>((res) => {
              img.addEventListener("load", () => res(), { once: true })
              img.addEventListener("error", () => res(), { once: true })
            })
      )
    )
    win.addEventListener("afterprint", cleanup, { once: true })
    win.focus()
    win.print()
    // Safari/Firefox don't always fire afterprint — clean up defensively.
    setTimeout(cleanup, 60000)
  }

  // The written document is usually ready synchronously after close(), but wait
  // for load if it isn't.
  if (doc.readyState === "complete") void triggerPrint()
  else iframe.addEventListener("load", () => void triggerPrint(), { once: true })
}

function escapeForHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"))
}
