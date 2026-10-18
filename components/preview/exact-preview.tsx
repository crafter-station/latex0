"use client"

import { useEffect, useRef, useState } from "react"
import { useFileStore } from "@/lib/file-store"
import { bundleLatexFiles } from "@/lib/latex-bundler"
import { findMainFile } from "@/lib/file-utils"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { ExactRequest, ExactResponse } from "@/lib/exact/protocol"
import { HtmlPreview } from "./html-preview"

interface ExactPreviewProps {
  zoom?: number
}

const fontFaces = (fonts: string[]) =>
  fonts.map((f) => `@font-face{font-family:l0-${f};src:url(/fonts/tex/${f}.woff2) format("woff2")}`).join("")

// The exact page view: the document laid out as TeX lays it out (the zero-dependency engine, in a
// worker) and drawn as SVG pages, glyph for glyph where pdfTeX puts them. A document the engine
// cannot lay out exactly yet falls back to the HTML preview, saying why.
export function ExactPreview({ zoom = 100 }: ExactPreviewProps) {
  const files = useFileStore((s) => s.files)
  const worker = useRef<Worker | null>(null)
  const nextId = useRef(0)
  const [result, setResult] = useState<ExactResponse | null>(null)
  const pagesRef = useRef<{ pages: string[]; fonts: string[] } | null>(null)
  // 100% fits the page to the panel's width
  const [panelWidth, setPanelWidth] = useState(0)
  const observer = useRef<ResizeObserver | null>(null)
  const measure = (el: HTMLDivElement | null) => {
    observer.current?.disconnect()
    if (!el) return
    observer.current = new ResizeObserver(([entry]) => setPanelWidth(entry.contentRect.width))
    observer.current.observe(el)
  }

  useEffect(() => {
    const w = new Worker(new URL("../../lib/exact/engine.worker.ts", import.meta.url), { type: "module" })
    w.onmessage = (e: MessageEvent<ExactResponse>) => {
      if (e.data.id !== nextId.current) return // a newer edit is on its way
      setResult(e.data)
      pagesRef.current = e.data.ok ? { pages: e.data.pages, fonts: e.data.fonts } : null
    }
    worker.current = w
    return () => {
      w.terminate()
      worker.current = null
    }
  }, [])

  useEffect(() => {
    if (!files.length) return
    const id = ++nextId.current
    const main = findMainFile(files)
    bundleLatexFiles(files, main)
      .then(({ source, images }) => {
        if (id !== nextId.current) return
        const urls: Record<string, string> = {}
        for (const [path, v] of Object.entries(images)) urls[path] = v.url
        const req: ExactRequest = { id, source, images: urls }
        worker.current?.postMessage(req)
      })
      .catch((e) => {
        if (id !== nextId.current) return
        setResult({ id, ok: false, reason: e instanceof Error ? e.message : "bundling failed" })
      })
  }, [files])

  // Download: the browser prints the SVG pages, one per sheet at the document's paper size.
  useEffect(() => {
    const onDownload = (e: Event) => {
      const drawn = pagesRef.current
      if (!drawn) return
      e.stopImmediatePropagation()
      const main = findMainFile(useFileStore.getState().files)
      printPages(drawn.pages, drawn.fonts, (main?.name ?? "document").replace(/\.tex$/i, ""))
    }
    window.addEventListener("latex0:download-pdf", onDownload)
    return () => window.removeEventListener("latex0:download-pdf", onDownload)
  }, [])

  if (result && !result.ok) {
    return (
      <div className="relative flex h-full flex-col">
        <div className="mx-3 mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
          The exact view can&apos;t lay out this document yet ({result.reason}). Showing the approximate preview.
        </div>
        <div className="min-h-0 flex-1">
          <HtmlPreview zoom={zoom} />
        </div>
      </div>
    )
  }

  return (
    <ScrollArea className="relative h-full flex-1">
      {result?.ok && <style>{fontFaces(result.fonts)}</style>}
      <div className="pointer-events-none sticky top-2 z-10 -mb-7 ml-auto mr-3 w-fit select-none rounded-full bg-muted/70 px-2.5 py-1 text-[10px] font-medium text-muted-foreground backdrop-blur-sm">
        Exact view · beta{result?.ok ? ` · ${result.pages.length} page${result.pages.length === 1 ? "" : "s"} · ${Math.round(result.ms)} ms` : ""}
      </div>
      <div ref={measure} className="flex flex-col items-center gap-4 p-4">
        {!result ? (
          <div className="p-8 text-sm text-muted-foreground">Laying out…</div>
        ) : (
          result.ok &&
          result.pages.map((svg, i) => (
            <div
              key={i}
              className="shrink-0 shadow-lg [&>svg]:block [&>svg]:h-auto [&>svg]:w-full"
              style={{ width: pageWidth(svg, panelWidth - 32, zoom) }}
              // The engine escapes every text and attribute it writes into the SVG.
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          ))
        )}
      </div>
    </ScrollArea>
  )
}

/** A page's width in CSS px: the panel's width at 100%, scaled by the zoom */
function pageWidth(svg: string, fit: number, zoom: number): number {
  const pt = Number(svg.match(/width="([\d.]+)pt"/)?.[1] ?? 612)
  return Math.max(100, (fit > 0 ? fit : (pt * 4) / 3) * (zoom / 100))
}

function printPages(pages: string[], fonts: string[], title: string): void {
  const size = pages[0]?.match(/width="([\d.]+)pt" height="([\d.]+)pt"/)
  if (!size) return
  const iframe = document.createElement("iframe")
  iframe.setAttribute("aria-hidden", "true")
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden"
  document.body.appendChild(iframe)
  const doc = iframe.contentDocument
  const win = iframe.contentWindow
  if (!doc || !win) {
    iframe.remove()
    return
  }
  doc.open()
  doc.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title.replace(/[&<>]/g, "")}</title><style>` +
      `${fontFaces(fonts).replace(/url\(\//g, `url(${location.origin}/`)}` +
      `@page{size:${size[1]}pt ${size[2]}pt;margin:0}html,body{margin:0;padding:0}svg{display:block;break-after:page}` +
      `</style></head><body>${pages.join("")}</body></html>`
  )
  doc.close()
  let done = false
  const cleanup = () => {
    if (done) return
    done = true
    setTimeout(() => iframe.remove(), 1000)
  }
  void Promise.all(fonts.map((f) => doc.fonts.load(`10pt l0-${f}`))).then(() => {
    win.addEventListener("afterprint", cleanup, { once: true })
    win.focus()
    win.print()
    setTimeout(cleanup, 60000)
  })
}
