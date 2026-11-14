"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useFileStore } from "@/lib/file-store"
import { bundleLatexFiles } from "@/lib/latex-bundler"
import { findMainFile } from "@/lib/file-utils"
import { PDF_REGION, type ExactRequest, type ExactResponse } from "@/lib/exact/protocol"
import type { PdfPictures } from "@/lib/exact/pdf-regions"
import { HtmlPreview } from "./html-preview"

interface ExactPreviewProps {
  zoom?: number
}

const fontFaces = (fonts: string[]) =>
  fonts.map((f) => `@font-face{font-family:l0-${f};src:url(/fonts/tex/${f}.woff2) format("woff2")}`).join("")

// The exact page view: the document laid out as TeX lays it out (the zero-dependency engine, in a
// worker) and drawn as SVG pages, glyph for glyph where pdfTeX puts them. A document the engine
// cannot lay out exactly yet falls back to the HTML preview, saying why. While typing, a document is
// often broken for a moment (an open brace, half a command): the last pages stay up, and the fallback
// only takes over when the document still cannot be laid out after STALE_MS.
const STALE_MS = 1500

type Laid = Extract<ExactResponse, { ok: true }>
const REGION_IMAGE = new RegExp(`<image href="${PDF_REGION}(\\d+)"[^>]*/>`, "g")

/** The pages with the pictures of their PDF regions: an image whose picture is not drawn yet is left out (it
 *  comes when the picture is ready); one that cannot be drawn is named */
function withPictures(r: Laid, pictures: PdfPictures | null): { pages: string[]; warnings: string[] } {
  if (!r.pdfRegions.length) return { pages: r.pages, warnings: r.warnings }
  const pages = r.pages.map((svg) => svg.replace(REGION_IMAGE, (image, n) => {
    const url = pictures?.url(r.pdfRegions[Number(n)])
    return url ? image.replace(`${PDF_REGION}${n}`, url) : ""
  }))
  const failed = r.pdfRegions.flatMap((region) => {
    const why = pictures?.failure(region)
    return why ? [`the image ${region.name} (${why})`] : []
  })
  return { pages, warnings: [...r.warnings, ...new Set(failed)] }
}

export function ExactPreview({ zoom = 100 }: ExactPreviewProps) {
  const files = useFileStore((s) => s.files)
  const worker = useRef<Worker | null>(null)
  const nextId = useRef(0)
  const [result, setResult] = useState<ExactResponse | null>(null)
  // the last document laid out; what the download prints and what stays up while the source is broken
  const [drawn, setDrawn] = useState<{ pages: string[]; fonts: string[]; warnings: string[]; ms: number } | null>(null)
  const pagesRef = useRef<{ pages: string[]; fonts: string[] } | null>(null)
  // the pictures of the PDF files' pages the document includes (pdf.js, loaded with the first such document)
  const pictures = useRef<PdfPictures | null>(null)
  const loading = useRef<Promise<void> | null>(null)
  const laid = useRef<Laid | null>(null)
  const show = useCallback((r: Laid) => {
    const pages = { ...withPictures(r, pictures.current), fonts: r.fonts, ms: r.ms }
    pagesRef.current = pages
    setDrawn(pages)
  }, [])
  const draw = useCallback((r: Laid) => {
    laid.current = r
    show(r)
    if (!r.pdfRegions.length && !pictures.current) return
    const again = () => { if (laid.current) show(laid.current) }
    if (pictures.current) return pictures.current.show(r.pdfRegions, again)
    loading.current ??= import("@/lib/exact/pdf-regions").then(({ PdfPictures }) => {
      pictures.current = new PdfPictures()
      if (laid.current) pictures.current.show(laid.current.pdfRegions, again)
    })
  }, [show])
  useEffect(() => () => {
    laid.current = null
    void loading.current?.then(() => { pictures.current?.dispose(); pictures.current = null; loading.current = null })
  }, [])
  const staleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [fallback, setFallback] = useState(false)
  const settle = useCallback((r: ExactResponse) => {
    setResult(r)
    if (staleTimer.current) clearTimeout(staleTimer.current)
    staleTimer.current = null
    if (r.ok) {
      draw(r)
      setFallback(false)
    } else if (pagesRef.current) {
      staleTimer.current = setTimeout(() => {
        pagesRef.current = null
        laid.current = null
        setFallback(true)
      }, STALE_MS)
    } else {
      setFallback(true)
    }
  }, [draw])
  // 100% fits the page to the panel's width
  const [panelWidth, setPanelWidth] = useState(0)
  const observer = useRef<ResizeObserver | null>(null)
  const measure = (el: HTMLDivElement | null) => {
    observer.current?.disconnect()
    if (!el) return
    // (the scrolling panel, not the pages' container: that one grows with the pages when they are zoomed)
    observer.current = new ResizeObserver(([entry]) => setPanelWidth(entry.contentRect.width - 32))
    observer.current.observe(el)
  }

  useEffect(() => {
    const w = new Worker(new URL("../../lib/exact/engine.worker.ts", import.meta.url), { type: "module" })
    w.onmessage = (e: MessageEvent<ExactResponse>) => {
      if (e.data.id !== nextId.current) return // a newer edit is on its way
      settle(e.data)
    }
    worker.current = w
    return () => {
      w.terminate()
      worker.current = null
      if (staleTimer.current) clearTimeout(staleTimer.current)
    }
  }, [settle])

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
        settle({ id, ok: false, reason: e instanceof Error ? e.message : "bundling failed" })
      })
  }, [files, settle])

  // Download: the browser prints the SVG pages, one per sheet at the document's paper size.
  useEffect(() => {
    const onDownload = (e: Event) => {
      if (!pagesRef.current) return
      e.stopImmediatePropagation()
      const main = findMainFile(useFileStore.getState().files)
      // (the pictures of PDF figures still being drawn are waited for: the print has them)
      void Promise.resolve(loading.current).then(() => pictures.current?.settled()).then(() => {
        const last = pagesRef.current
        if (last) printPages(last.pages, last.fonts, (main?.name ?? "document").replace(/\.tex$/i, ""))
      })
    }
    window.addEventListener("latex0:download-pdf", onDownload)
    return () => window.removeEventListener("latex0:download-pdf", onDownload)
  }, [])

  if (result && !result.ok && fallback) {
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
    // (a plain scrolling panel: zoomed pages are wider than it, and scroll sideways)
    <div ref={measure} className="relative h-full flex-1 overflow-auto">
      {drawn && <style>{fontFaces(drawn.fonts)}</style>}
      <div className="pointer-events-none sticky top-2 z-10 -mb-7 ml-auto mr-3 w-fit select-none rounded-full bg-muted/70 px-2.5 py-1 text-[10px] font-medium text-muted-foreground backdrop-blur-sm">
        Exact view · beta{drawn ? ` · ${drawn.pages.length} page${drawn.pages.length === 1 ? "" : "s"} · ${result?.ok ? `${Math.round(drawn.ms)} ms` : "editing…"}` : ""}
      </div>
      {drawn && drawn.warnings.length > 0 && (
        <div className="mx-3 mt-9 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
          The layout is exact, but the preview does not draw: {drawn.warnings.join("; ")}.
        </div>
      )}
      <div className="flex w-max min-w-full flex-col items-center gap-4 p-4">
        {!drawn ? (
          <div className="p-8 text-sm text-muted-foreground">Laying out…</div>
        ) : (
          drawn.pages.map((svg, i) => (
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
    </div>
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
  // the fonts and the images (a picture of a PDF figure is a blob URL of this page's) are loaded before printing
  const images = [...new Set([...doc.querySelectorAll("image")].map((el) => el.getAttribute("href") ?? ""))].filter(Boolean).map((href) => {
    const image = doc.createElement("img")
    image.src = href
    return image.decode().catch(() => {})
  })
  void Promise.all([...fonts.map((f) => doc.fonts.load(`10pt l0-${f}`)), ...images]).then(() => {
    win.addEventListener("afterprint", cleanup, { once: true })
    win.focus()
    win.print()
    setTimeout(cleanup, 60000)
  })
}
