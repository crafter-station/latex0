// Gaps: what the engine does not lay out yet, ranked by how many documents it
// stops. Each document is laid out by the engine alone (no TeX), so any corpus
// works: the fixtures, the starter corpus, a folder of real documents. A
// document stops at its first construct not laid out; one that throws anything
// else is an engine bug and is listed apart, as is a laid-out document whose pages cannot be drawn (emit/svg).

import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { bitmapInfo, type Bitmap } from "../latex/images"
import { svgPages } from "../emit/svg"
import { document } from "../latex/document"
import { paragraph } from "../latex/paragraph"
import { Unsupported } from "../latex/unsupported"
import "./data"
import { ADAPTERS } from "./unit/adapters"
import { collectFixtures } from "./unit/run"

/** A reason without the text it quotes, so documents stopped by the same construct group together. */
export const reasonKey = (message: string) => message.replace(/"[^"]*"/g, "…").trim()

/** A fixture names its layout in its header (% engine: paragraph); anything else is a whole document, laid out as the
 *  fixture runner does (its header's driver and image files), or, with no fixture header, as the app does (pdfTeX) */
const layoutOf = (src: string, path: string) =>
  /^% engine: paragraph$/m.test(src) ? paragraph
  : /^% fixture:/m.test(src) ? (s: string) => ADAPTERS.document(s, { unit: "sp", mag: 1000, pages: [] }, path)
  : (s: string) => document(s, { images: siblingImages(path) })

/** The PNG and JPEG files next to a document, as the app gives it the project's uploads */
function siblingImages(path: string): Record<string, Bitmap> {
  const dir = dirname(path), out: Record<string, Bitmap> = {}
  for (const f of readdirSync(dir)) {
    if (!/\.(png|jpe?g)$/i.test(f)) continue
    const b = bitmapInfo(new Uint8Array(readFileSync(join(dir, f))))
    if (b) out[f] = b
  }
  return out
}

export function gaps(paths: string[], examples = 3): number {
  const files = collectFixtures(paths)
  const reasons = new Map<string, string[]>()
  const bugs: string[] = []
  let laidOut = 0
  for (const f of files) {
    const name = relative(process.cwd(), f)
    try {
      const src = readFileSync(f, "utf8")
      const r = layoutOf(src, f)(src)
      if (r.view) svgPages(r.trace, r.view)
      laidOut++
    } catch (e) {
      if (!(e instanceof Unsupported)) { bugs.push(`${name}: ${(e as Error).message}`); continue }
      const key = reasonKey(e.message)
      reasons.set(key, [...(reasons.get(key) ?? []), name])
    }
  }
  const ranked = [...reasons].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
  console.log(`${laidOut}/${files.length} documents laid out; ${files.length - laidOut - bugs.length} stopped at a construct not laid out yet; ${bugs.length} engine errors\n`)
  for (const [key, docs] of ranked) {
    console.log(`${String(docs.length).padStart(4)}  ${key}`)
    for (const d of docs.slice(0, examples)) console.log(`        ${d}`)
  }
  if (bugs.length) console.log(`\nengine errors (bugs, not gaps):\n${bugs.map((b) => `  ${b}`).join("\n")}`)
  return bugs.length ? 1 : 0
}
