// Pictures of the PDF files' pages a document includes (\includegraphics{figure.pdf}). The exact engine lays such an
// image out and says which region of which page fills its box; a browser's <image> cannot show a PDF, so each
// region is drawn once with pdf.js to a transparent PNG (a blob URL) that the page's SVG then shows in the box.
// pdf.js is loaded only when a document has such an image.

import type { PdfRegion } from "./protocol"

/** pixels per bp of the region as it is drawn on the paper: sharp when the page is zoomed to 200% on a dense
 *  screen (about 2.3 CSS px per bp × 2), and 432 dpi in print */
const DENSITY = 6
/** the most pixels a picture has (a full-page figure is then about 290 dpi) */
const MAX_PIXELS = 8_000_000
/** a picture is drawn again when the region is shown this much larger than what the picture was made for */
const REDRAW = 1.25
/** a picture no page shows any more is kept this long (an \includegraphics being edited comes back without a redraw) */
const KEEP_MS = 60_000

type Pdfjs = typeof import("pdfjs-dist/legacy/build/pdf.mjs")
type PdfDocument = Awaited<ReturnType<Pdfjs["getDocument"]>["promise"]>

interface Picture {
  /** the blob URL, and the element that keeps it decoded (a page drawn again shows it at once) */
  url: string
  keep: HTMLImageElement
  /** pixels per bp of the PDF's page */
  scale: number
  usedAt: number
}

let library: Promise<Pdfjs> | null = null
function pdfjs(): Promise<Pdfjs> {
  library ??= import("pdfjs-dist/legacy/build/pdf.mjs").then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString()
    return lib
  })
  library.catch(() => { library = null })
  return library
}

/** a region whatever size it is shown at */
const keyOf = (r: PdfRegion) => `${r.url}|${r.page}|${r.box.join(",")}|${r.rotate}`

/** The pixels per bp of the page a region needs for the size it is drawn at */
function scaleFor(r: PdfRegion): number {
  const turned = r.rotate === 90 || r.rotate === 270
  const w = Math.abs(r.box[2] - r.box[0]), h = Math.abs(r.box[3] - r.box[1])
  const [shownW, shownH] = turned ? [h, w] : [w, h]
  const wanted = DENSITY * Math.max(r.width / shownW, r.height / shownH)
  return Math.min(wanted, Math.sqrt(MAX_PIXELS / (w * h)))
}

export class PdfPictures {
  private pictures = new Map<string, Picture>()
  private failed = new Map<string, string>()
  private drawing = new Map<string, Promise<void>>()
  private documents = new Map<string, Promise<PdfDocument>>()
  private disposed = false

  /** the picture of a region, if one is drawn (at whatever resolution) */
  url(r: PdfRegion): string | undefined {
    return this.pictures.get(keyOf(r))?.url
  }
  /** why a region has no picture and will not get one */
  failure(r: PdfRegion): string | undefined {
    return this.failed.get(keyOf(r))
  }
  /** resolves when nothing is being drawn */
  async settled(): Promise<void> {
    while (this.drawing.size) await Promise.allSettled([...this.drawing.values()])
  }

  /**
   * The regions the pages show now: those without a picture, or with one too coarse for their size, are drawn, and
   * `changed` is called each time one is ready (or has failed). Pictures and files no page has shown for a while
   * are let go.
   */
  show(regions: PdfRegion[], changed: () => void): void {
    const now = Date.now()
    // (the same region can be shown at several sizes: the largest decides)
    const wanted = new Map<string, { region: PdfRegion; scale: number }>()
    for (const r of regions) {
      const key = keyOf(r), scale = scaleFor(r), w = wanted.get(key)
      if (!w || scale > w.scale) wanted.set(key, { region: r, scale })
    }
    for (const [key, { region, scale }] of wanted) {
      const have = this.pictures.get(key)
      if (have) have.usedAt = now
      if (this.failed.has(key) || this.drawing.has(key) || (have && scale <= have.scale * REDRAW)) continue
      const job = this.draw(region, scale)
        .then((picture) => {
          if (this.disposed) return URL.revokeObjectURL(picture.url)
          const old = this.pictures.get(key)
          this.pictures.set(key, picture)
          // (the pages still show the old picture until they are drawn again)
          if (old) setTimeout(() => URL.revokeObjectURL(old.url), 5000)
        }, (e) => { this.failed.set(key, e instanceof Error ? e.message : String(e)) })
        .finally(() => {
          this.drawing.delete(key)
          if (!this.disposed) changed()
        })
      this.drawing.set(key, job)
    }
    for (const [key, p] of this.pictures) {
      if (wanted.has(key) || now - p.usedAt < KEEP_MS) continue
      URL.revokeObjectURL(p.url)
      this.pictures.delete(key)
    }
    const files = new Set([...this.pictures.keys(), ...wanted.keys()].map((k) => k.slice(0, k.indexOf("|"))))
    for (const [file, doc] of this.documents) {
      if (files.has(file)) continue
      this.documents.delete(file)
      void doc.then((d) => d.destroy(), () => {})
    }
    for (const key of this.failed.keys()) if (!wanted.has(key)) this.failed.delete(key)
  }

  dispose(): void {
    this.disposed = true
    for (const p of this.pictures.values()) URL.revokeObjectURL(p.url)
    this.pictures.clear()
    for (const doc of this.documents.values()) void doc.then((d) => d.destroy(), () => {})
    this.documents.clear()
  }

  private document(url: string): Promise<PdfDocument> {
    let doc = this.documents.get(url)
    if (!doc) {
      doc = (async () => {
        const [lib, response] = await Promise.all([pdfjs(), fetch(url)])
        if (!response.ok) throw new Error(`the file could not be fetched (${response.status})`)
        return lib.getDocument({ data: new Uint8Array(await response.arrayBuffer()), verbosity: 0 }).promise
      })()
      this.documents.set(url, doc)
      doc.catch(() => { if (this.documents.get(url) === doc) this.documents.delete(url) })
    }
    return doc
  }

  /** The region drawn at `scale` pixels per bp of the page: what pdfTeX's form XObject of the page shows, its
   *  /BBox the region (nothing outside it) and nothing behind the page's own marks */
  private async draw(r: PdfRegion, scale: number): Promise<Picture> {
    const page = await (await this.document(r.url)).getPage(r.page)
    try {
      // the page as a viewer shows it, turned by `rotate` (pdfTeX's /Matrix), and where the region is in that
      const viewport = page.getViewport({ scale, rotation: r.rotate })
      const [ax, ay, bx, by] = viewport.convertToViewportRectangle(r.box)
      const left = Math.min(ax, bx), top = Math.min(ay, by), width = Math.abs(bx - ax), height = Math.abs(by - ay)
      const canvas = document.createElement("canvas")
      canvas.width = Math.max(1, Math.round(width))
      canvas.height = Math.max(1, Math.round(height))
      const context = canvas.getContext("2d")
      if (!context) throw new Error("no canvas")
      // the region's corner at the canvas's, the region over the whole (rounded) canvas
      const sx = canvas.width / width, sy = canvas.height / height
      await page.render({ canvas, canvasContext: context, viewport, transform: [sx, 0, 0, sy, -left * sx, -top * sy], background: "rgba(0,0,0,0)", annotationMode: 0 }).promise
      const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/png"))
      canvas.width = canvas.height = 0
      if (!blob) throw new Error("the picture could not be made")
      const url = URL.createObjectURL(blob)
      const keep = new Image()
      keep.src = url
      await keep.decode().catch(() => {})
      return { url, keep, scale, usedAt: Date.now() }
    } finally {
      page.cleanup()
    }
  }
}
