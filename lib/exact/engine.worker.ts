/// <reference lib="webworker" />
// The exact engine off the main thread: lays out a document and draws its pages as SVG. The engine reads
// its data synchronously, so a file not fetched yet stops the layout with Missing; the worker fetches it
// (from /engine-data) and lays the document out again. After the first documents, everything is cached.

import { document, imageInfo, installData, svgPages, Unsupported, type DataSource, type Image } from "@latex0/engine"
import type { ExactRequest, ExactResponse } from "./protocol"

class Missing extends Error {
  constructor(readonly path: string) { super(`missing ${path}`) }
}

const files = new Map<string, unknown>()
const read = <T>(path: string): T => {
  if (!files.has(path)) throw new Missing(path)
  return files.get(path) as T
}
const source: DataSource = {
  font: (name) => read(`fonts/${name}.json`),
  documentClass: (cls) => read(`classes/${cls}.json`),
  hyphenation: (language) => read(`hyphenation/${language}.json`),
  math: () => read("math/latex.json"),
  webfonts: () => read("webfonts.json"),
}

installData(source)

const pending = new Map<string, Promise<void>>()
function fetchData(path: string): Promise<void> {
  let p = pending.get(path)
  if (!p) {
    p = fetch(`/engine-data/${path}`).then(async (r) => {
      if (!r.ok) throw new Unsupported(`engine data ${path}`)
      files.set(path, await r.json())
    })
    pending.set(path, p)
    p.catch(() => pending.delete(path))
  }
  return p
}
// what nearly every document needs, fetched together up front
const COMMON = ["math/latex.json", "webfonts.json", "hyphenation/en-us.json", "classes/article.json",
  ...["cmr10", "cmr7", "cmr5", "cmmi10", "cmmi7", "cmmi5", "cmsy10", "cmsy7", "cmsy5", "cmex10", "cmbx10", "cmbx12", "cmti10", "cmr12", "cmr17", "cmr8", "cmr6", "cmr9", "cmtt10", "cmsl10"].map((f) => `fonts/${f}.json`)]
const ready = Promise.allSettled(COMMON.map(fetchData))

const bitmaps = new Map<string, Image | null>()
async function bitmap(url: string): Promise<Image | null> {
  if (!bitmaps.has(url)) {
    try { bitmaps.set(url, imageInfo(new Uint8Array(await (await fetch(url)).arrayBuffer()))) } catch { bitmaps.set(url, null) }
  }
  return bitmaps.get(url)!
}

let latest = 0
async function typeset({ id, source: text, images }: ExactRequest): Promise<ExactResponse | null> {
  await ready
  const info: Record<string, Image> = {}
  for (const [name, url] of Object.entries(images)) {
    const b = await bitmap(url)
    if (b) info[name] = b
  }
  for (let tries = 0; tries < 200; tries++) {
    if (id !== latest) return null // a newer edit came in
    try {
      const t = performance.now()
      const result = document(text, { images: info })
      const { pages, fonts } = svgPages(result.trace, result.view!, { image: (name) => images[name] })
      return { id, ok: true, pages, fonts, ms: performance.now() - t }
    } catch (e) {
      if (e instanceof Missing) { await fetchData(e.path); continue }
      const reason = e instanceof Unsupported ? e.message : `engine error: ${e instanceof Error ? e.message : String(e)}`
      return { id, ok: false, reason }
    }
  }
  return { id, ok: false, reason: "too many engine data files" }
}

self.onmessage = (e: MessageEvent<ExactRequest>) => {
  latest = e.data.id
  void typeset(e.data).then((r) => { if (r) self.postMessage(r) })
}
