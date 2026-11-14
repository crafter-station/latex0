// The exact page view against pdflatex's own rendering (dev only, on a Mac): for a .tex file,
//   (a) pdflatex (the pinned TeX Live) makes the PDF and macOS's PDFKit rasterizes each page (through osascript's
//       JavaScript: sips and qlmanage draw only a PDF's first page, sips at 72 dpi in Display P3; and a page put on
//       a page of its own with \pdfximage is drawn by Quartz without its soft masks),
//   (b) the engine lays the document out, emit/svg draws its pages and headless Chromium rasterizes them, with the
//       web fonts of public/fonts/tex,
// and the two images of each page (sRGB, `--scale` pixels per bp) are compared on the area they share (pdfTeX's media
// is A4 unless the document sets it; \paperwidth may be letter): the mean difference of the pixels, and the share of
// the inked 4bp cells whose average color differs. Glyphs rasterize differently in the two (Quartz and Skia), so
// the scores say where to look, not whether the pages are equal: the images (<name>-<page>-tex.png, -engine.png and
// -diff.png: black where both have ink, red where only TeX has, blue where only the engine has) go to
// .cache/view/<folder>-<name>/. Link borders and other annotations are a viewer's and are in neither image.
//
// Chromium comes from playwright-core, which is not a dependency of this package: set PLAYWRIGHT_CORE to its
// directory (…/node_modules/playwright-core, with its browser in ~/Library/Caches/ms-playwright).
//
//   PLAYWRIGHT_CORE=… bun engine view:compare <file.tex…> [--scale 2]

import { execFileSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { basename, dirname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { svgPages } from "../../emit/svg"
import { document } from "../../latex/document"
import { imageInfo, type Image } from "../../latex/images"
import { Unsupported } from "../../latex/unsupported"
import "../data"
import { ORACLE_EPOCH, texEnv } from "../tex"
import { parseHeader } from "../unit/header"

export interface PageScore {
  page: number
  /** the mean difference of the pixels' channels, 0 to 1 */
  mean: number
  /** the 4bp cells with ink in either image, and those of them whose average color differs by more than 8%, or by
   *  more than 3% and half of the cell's ink (a thin line that only one image has), however the engine's image is
   *  moved by up to a pixel */
  cells: number; differing: number
  /** the images' sizes in pixels, TeX's and the engine's */
  tex: [number, number]; engine: [number, number]
}
export interface Comparison { name: string; dir: string; texPages: number; enginePages: number; scores: PageScore[]; warnings: string[]; error?: string }

const ENV = texEnv({ SOURCE_DATE_EPOCH: String(ORACLE_EPOCH), FORCE_SOURCE_DATE: "1" })
const CACHE = resolve(process.cwd(), ".cache/view")
const FONTS = resolve(process.cwd(), "public/fonts/tex")

/** What osascript runs: each page of a PDF drawn by PDFKit (its content, no annotations) on white in sRGB, `scale`
 *  pixels per bp, to <prefix>-<page>-tex.png; it prints the number of pages */
const RASTER = `ObjC["import"]("Quartz"); ObjC["import"]("AppKit")
function run(argv) {
  const [pdf, prefix, scaleText] = argv, scale = Number(scaleText)
  const doc = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(pdf))
  const n = doc.pageCount
  for (let i = 0; i < n; i++) {
    const page = doc.pageAtIndex(i)
    page.displaysAnnotations = false
    const b = page.boundsForBox($.kPDFDisplayBoxMediaBox)
    const w = Math.ceil(b.size.width * scale), h = Math.ceil(b.size.height * scale)
    const cx = $.CGBitmapContextCreate(null, w, h, 8, 0, $.CGColorSpaceCreateWithName($.kCGColorSpaceSRGB), $.kCGImageAlphaPremultipliedLast)
    $.CGContextSetRGBFillColor(cx, 1, 1, 1, 1)
    $.CGContextFillRect(cx, $.CGRectMake(0, 0, w, h))
    $.CGContextTranslateCTM(cx, 0, h - b.size.height * scale) // (the page's top edge on the image's)
    $.CGContextScaleCTM(cx, scale, scale)
    page.drawWithBoxToContext($.kPDFDisplayBoxMediaBox, cx)
    const rep = $.NSBitmapImageRep.alloc.initWithCGImage($.CGBitmapContextCreateImage(cx))
    rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $.NSDictionary.dictionary).writeToFileAtomically(prefix + "-" + (i + 1) + "-tex.png", true)
  }
  return String(n)
}
`

/** TeX's pages as PNG files, `scale` pixels per bp: their paths */
function texPages(dir: string, name: string, scale: number): string[] {
  for (const ext of ["aux", "toc", "lof", "lot", "out", "nav", "snm", "pdf"]) rmSync(join(dir, `${name}.${ext}`), { force: true })
  // twice, for references; a TeX error still leaves the pages it shipped
  for (let run = 0; run < 2; run++) {
    try { execFileSync("pdflatex", ["-interaction=nonstopmode", `${name}.tex`], { cwd: dir, env: ENV, stdio: "ignore" }) } catch { /* the log says */ }
  }
  if (!existsSync(join(dir, `${name}.pdf`))) return []
  writeFileSync(join(dir, "raster.js"), RASTER)
  const pages = Number(execFileSync("/usr/bin/osascript", ["-l", "JavaScript", "raster.js", join(dir, `${name}.pdf`), join(dir, name), String(scale)], { cwd: dir, encoding: "utf8" }).trim())
  rmSync(join(dir, "raster.js"))
  return Array.from({ length: pages }, (_, p) => join(dir, `${name}-${p + 1}-tex.png`))
}

/** What runs in the browser: the two images compared on their shared area (from the top left corner) */
const COMPARE = `async ([texUrl, engineUrl]) => {
  const load = async (url) => createImageBitmap(await (await fetch(url)).blob())
  const [a, b] = [await load(texUrl), await load(engineUrl)]
  const w = Math.min(a.width, b.width), h = Math.min(a.height, b.height)
  const pixels = (img) => {
    const c = new OffscreenCanvas(w, h), cx = c.getContext("2d")
    cx.fillStyle = "#fff"; cx.fillRect(0, 0, w, h); cx.drawImage(img, 0, 0)
    return cx.getImageData(0, 0, w, h).data
  }
  const pa = pixels(a), pb = pixels(b)
  const out = new OffscreenCanvas(w, h), ox = out.getContext("2d"), od = ox.createImageData(w, h)
  const CELL = SCALE * 4, cw = Math.ceil(w / CELL), ch = Math.ceil(h / CELL)
  let sum = 0
  for (let i = 0; i < w * h * 4; i += 4) {
    for (let k = 0; k < 3; k++) sum += Math.abs(pa[i + k] - pb[i + k])
    const ta = 255 - (pa[i] * 0.299 + pa[i + 1] * 0.587 + pa[i + 2] * 0.114), eb = 255 - (pb[i] * 0.299 + pb[i + 1] * 0.587 + pb[i + 2] * 0.114)
    od.data[i] = 255 - eb; od.data[i + 1] = 255 - Math.max(ta, eb); od.data[i + 2] = 255 - ta; od.data[i + 3] = 255
  }
  // each cell's average color, the image moved by (dx, dy) pixels (white beyond its edges)
  const averages = (p, dx, dy) => {
    const s = new Float64Array(cw * ch * 3)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const sx = x + dx, sy = y + dy, cell = (Math.floor(y / CELL) * cw + Math.floor(x / CELL)) * 3
      const i = (sy * w + sx) * 4, inside = sx >= 0 && sx < w && sy >= 0 && sy < h
      for (let k = 0; k < 3; k++) s[cell + k] += inside ? p[i + k] : 255
    }
    for (let c = 0; c < cw * ch; c++) {
      const count = Math.min(CELL, w - (c % cw) * CELL) * Math.min(CELL, h - Math.floor(c / cw) * CELL) * 255
      for (let k = 0; k < 3; k++) s[c * 3 + k] /= count
    }
    return s
  }
  // a cell differs if no move of the engine's image by up to a pixel makes its color TeX's (the two rasterizers
  // snap glyphs to pixels differently)
  const sa = averages(pa, 0, 0), moved = []
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) moved.push(averages(pb, dx, dy))
  let cells = 0, differing = 0
  for (let c = 0; c < cw * ch; c++) {
    let ink = 0, best = 1
    for (const sb of moved) {
      let diff = 0
      for (let k = 0; k < 3; k++) { ink = Math.max(ink, 1 - sa[c * 3 + k], 1 - sb[c * 3 + k]); diff = Math.max(diff, Math.abs(sa[c * 3 + k] - sb[c * 3 + k])) }
      best = Math.min(best, diff)
    }
    if (ink > 0.02) { cells++; if (best > 0.08 || (best > 0.03 && best > 0.5 * ink)) differing++ }
  }
  ox.putImageData(od, 0, 0)
  const blob = await out.convertToBlob({ type: "image/png" })
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ""
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  return { mean: sum / (w * h * 3 * 255), cells, differing, tex: [a.width, a.height], engine: [b.width, b.height], diff: btoa(bin) }
}`

/** a function's source as a function playwright runs in the page */
const inPage = (source: string) => new Function("arg", `return (${source})(arg)`)

interface Browser { newPage(o: object): Promise<BrowserPage>; close(): Promise<void> }
interface BrowserPage {
  goto(url: string): Promise<unknown>
  evaluate<T>(fn: unknown, arg?: unknown): Promise<T>
  locator(sel: string): { nth(i: number): { screenshot(o: object): Promise<unknown> } }
  close(): Promise<void>
}

async function launch(): Promise<Browser> {
  const at = process.env.PLAYWRIGHT_CORE
  if (!at) throw new Error("set PLAYWRIGHT_CORE to playwright-core's directory (…/node_modules/playwright-core); it is not a dependency of this package")
  const { chromium } = createRequire(import.meta.url)(resolve(at)) as { chromium: { launch(): Promise<Browser> } }
  return chromium.launch()
}

/** One document compared; the images are left in .cache/view/<name>/ */
async function compare(browser: Browser, file: string, scale: number): Promise<Comparison> {
  const name = basename(file, ".tex")
  const dir = join(CACHE, `${basename(dirname(resolve(file)))}-${name}`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const src = readFileSync(file, "utf8")
  copyFileSync(file, join(dir, `${name}.tex`))
  // the files the document reads: the fixture header's, and those next to it that it names
  const images: Record<string, Image> = {}
  const header = parseHeader(src)
  for (const f of readdirSync(dirname(file))) {
    const path = join(dirname(file), f)
    if (f.endsWith(".tex") || !statSync(path).isFile() || !(header.files.includes(f) || src.includes(f.replace(/\.[^.]*$/, "")))) continue
    copyFileSync(path, join(dir, f))
    try { const info = imageInfo(new Uint8Array(readFileSync(path))); if (info) images[f] = info } catch { /* not an image */ }
  }
  const result: Comparison = { name, dir, texPages: 0, enginePages: 0, scores: [], warnings: [] }
  const tex = texPages(dir, name, scale)
  result.texPages = tex.length
  let svg: ReturnType<typeof svgPages>
  try {
    const laid = document(src, { epoch: ORACLE_EPOCH, driver: "pdftex", images })
    svg = svgPages(laid.trace, laid.view!, { image: (f) => (existsSync(join(dir, f)) ? f : undefined) })
  } catch (e) {
    result.error = e instanceof Unsupported ? `not laid out: ${e.message}` : `engine error: ${(e as Error).message}`
    return result
  }
  result.enginePages = svg.pages.length
  result.warnings = svg.warnings
  // each page 1px per bp (the device's pixels: `scale` per bp), the web fonts loaded
  const faces = svg.fonts.map((f) => `@font-face{font-family:l0-${f};src:url(${pathToFileURL(join(FONTS, `${f}.woff2`)).href}) format("woff2")}`).join("")
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${faces}html,body{margin:0;background:#fff}svg{display:block}div{overflow:hidden}</style></head><body>${
    // (each page in a box of whole pixels, so that every page starts on a pixel)
    svg.pages.map((p) => p.replace(/^<svg([^>]*?) width="([\d.]+)pt" height="([\d.]+)pt"/, (_, a, w, h) => `<div style="width:${Math.ceil(w)}px;height:${Math.ceil(h)}px"><svg${a} width="${w}" height="${h}"`) + "</div>").join("")}</body></html>`
  writeFileSync(join(dir, `${name}.html`), html)
  const page = await browser.newPage({ deviceScaleFactor: scale, viewport: { width: 1000, height: 1000 } })
  await page.goto(pathToFileURL(join(dir, `${name}.html`)).href)
  await page.evaluate(inPage(`async (fonts) => { await Promise.all(fonts.map((f) => document.fonts.load("10px l0-" + f))); await document.fonts.ready }`), svg.fonts)
  for (let p = 0; p < svg.pages.length; p++) {
    const png = join(dir, `${name}-${p + 1}-engine.png`)
    await page.locator("div").nth(p).screenshot({ path: png })
    if (p >= tex.length) continue
    const url = (path: string) => `data:image/png;base64,${readFileSync(path).toString("base64")}`
    const r = await page.evaluate<Omit<PageScore, "page"> & { diff: string }>(inPage(COMPARE.replace(/SCALE/g, String(scale))), [url(tex[p]), url(png)])
    writeFileSync(join(dir, `${name}-${p + 1}-diff.png`), Buffer.from(r.diff, "base64"))
    result.scores.push({ page: p + 1, mean: r.mean, cells: r.cells, differing: r.differing, tex: r.tex, engine: r.engine })
  }
  await page.close()
  return result
}

/** `view:compare`: each document's pages against pdflatex's; the status is 1 if a document was not drawn */
export async function viewCompare(files: string[], scale = 2): Promise<number> {
  if (!files.length) { console.log("usage: view:compare <file.tex…> [--scale 2]"); return 1 }
  const browser = await launch()
  let bad = 0
  try {
    for (const file of files) {
      const r = await compare(browser, file, scale)
      console.log(`${r.name}  (${r.dir})`)
      if (r.error) { console.log(`  ✗ ${r.error}`); bad++; continue }
      if (r.texPages !== r.enginePages) { console.log(`  ✗ ${r.texPages} page(s) from TeX, ${r.enginePages} from the engine`); bad++ }
      for (const s of r.scores) {
        const size = s.tex[0] === s.engine[0] && s.tex[1] === s.engine[1] ? "" : `  (TeX ${s.tex.join("×")}px, engine ${s.engine.join("×")}px: compared on the shared area)`
        console.log(`  page ${s.page}: mean difference ${(s.mean * 100).toFixed(2)}%, ${s.differing} of ${s.cells} inked cells differ (${s.cells ? ((s.differing / s.cells) * 100).toFixed(1) : "0.0"}%)${size}`)
      }
      for (const w of r.warnings ?? []) console.log(`  not drawn: ${w}`)
    }
  } finally {
    await browser.close()
  }
  return bad ? 1 : 0
}
