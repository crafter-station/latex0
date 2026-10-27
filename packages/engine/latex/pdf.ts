// A PDF file as pdfTeX reads it for \pdfximage (pdftoepdf.cc's read_pdf_info, through xpdf): its pages' boxes and
// rotation, nothing else. The cross-reference tables and streams (XRef.cc: the newest entry of an object wins, a
// hybrid file's XRefStm read after its table), objects in object streams, FlateDecode with PNG predictors, the page
// tree walked as xpdf walks it (Catalog.cc: /Count trusted to find a page), and the attributes pages inherit
// (Page.cc's PageAttrs: MediaBox, CropBox and Rotate; the other boxes default to the crop box; every box clipped to
// the media box). Numbers are read as xpdf's lexer reads them (Lexer.cc). A file xpdf would have to repair, an
// encrypted one, or one with another filter is reported as unsupported, never guessed at.

import { inflate } from "./inflate"

/** x1 y1 x2 y2 with x1 ≤ x2 and y1 ≤ y2, in bp */
export type PdfBox = [number, number, number, number]

/** One page: its five boxes, and /Rotate in [0, 360) */
export interface PdfPage { media: PdfBox; crop: PdfBox; bleed: PdfBox; trim: PdfBox; art: PdfBox; rotate: number }

/** A PDF file's pages (null: one xpdf finds no page dictionary for, which pdfTeX crashes on when it writes it), or
 *  why the engine cannot read them */
export interface Pdf { kind: "pdf"; pages: (PdfPage | null)[]; unsupported?: string }

class Real { constructor(readonly v: number) {} }
class Name { constructor(readonly s: string) {} }
class Ref { constructor(readonly num: number, readonly gen: number) {} }
class Cmd { constructor(readonly s: string) {} }
class Str { constructor(readonly s: string) {} }
class Stream { constructor(readonly dict: Dict, readonly buf: Uint8Array, readonly start: number) {} }
type Dict = Map<string, Obj>
type Obj = null | boolean | number | Real | Name | Ref | Cmd | Str | Obj[] | Dict | Stream
const EOF = new Cmd("")

class Damaged extends Error {}

// Lexer.cc's specialChars: 1 white space, 2 a delimiter
const SPECIAL = new Uint8Array(256)
for (const c of [0, 9, 10, 12, 13, 32]) SPECIAL[c] = 1
for (const c of "()<>[]{}/%") SPECIAL[c.charCodeAt(0)] = 2
const isDigit = (c: number) => c >= 48 && c <= 57
const hex = (c: number) => (isDigit(c) ? c - 48 : c >= 65 && c <= 70 ? c - 55 : c >= 97 && c <= 102 ? c - 87 : -1)

/** Lexer.cc's getObj over bytes from `pos` */
class Lexer {
  constructor(readonly buf: Uint8Array, public pos: number) {}
  private look = () => (this.pos < this.buf.length ? this.buf[this.pos] : -1)
  next(): Obj {
    const b = this.buf
    let c: number
    for (;;) { // white space and comments
      c = this.look()
      if (c < 0) return EOF
      if (c === 37) { while (this.pos < b.length && b[this.pos] !== 10 && b[this.pos] !== 13) this.pos++ }
      else if (SPECIAL[c] === 1) this.pos++
      else break
    }
    this.pos++
    if (isDigit(c) || c === 43 || c === 45 || c === 46) return this.number(c)
    if (c === 40) { // a literal string: only skipped (with its nesting and escapes)
      let depth = 1
      while (depth && this.pos < b.length) {
        const d = b[this.pos++]
        if (d === 92) this.pos++
        else if (d === 40) depth++
        else if (d === 41) depth--
      }
      return new Str("")
    }
    if (c === 47) { // a name, with #xx escapes
      let s = ""
      while (this.pos < b.length && !SPECIAL[b[this.pos]]) {
        const d = b[this.pos++]
        if (d === 35 && hex(this.look()) >= 0 && this.pos + 1 < b.length && hex(b[this.pos + 1]) >= 0) { s += String.fromCharCode(hex(b[this.pos]) * 16 + hex(b[this.pos + 1])); this.pos += 2 }
        else s += String.fromCharCode(d)
      }
      return new Name(s)
    }
    if (c === 60) {
      if (this.look() === 60) { this.pos++; return new Cmd("<<") }
      while (this.pos < b.length && b[this.pos] !== 62) this.pos++ // a hex string
      this.pos++
      return new Str("")
    }
    if (c === 62) { if (this.look() === 62) { this.pos++; return new Cmd(">>") } throw new Damaged("a stray >") }
    if (c === 91 || c === 93 || c === 123 || c === 125) return new Cmd(String.fromCharCode(c))
    if (c === 41) throw new Damaged("a stray )")
    let s = String.fromCharCode(c)
    while (this.pos < b.length && !SPECIAL[b[this.pos]]) s += String.fromCharCode(b[this.pos++])
    return s === "true" ? true : s === "false" ? false : s === "null" ? null : new Cmd(s)
  }
  /** an integer, or a real accumulated digit by digit (xf + 0.1ⁿ × digit) as xpdf does, with its leniencies */
  private number(c: number): Obj {
    let neg = false, doubleMinus = false, xi = 0, xf = 0
    const real = () => {
      let scale = 0.1
      for (;;) {
        const d = this.look()
        if (d === 45) { this.pos++; continue }
        if (!isDigit(d)) break
        this.pos++; xf = xf + scale * (d - 48); scale *= 0.1
      }
      while (this.look() === 45 || isDigit(this.look())) this.pos++
      return new Real(neg ? -xf : xf)
    }
    if (c === 45) {
      neg = true
      if (this.look() === 45) { doubleMinus = true; while (this.look() === 45) this.pos++ }
    } else if (c === 46) return real()
    else if (c !== 43) xf = xi = c - 48
    for (;;) {
      const d = this.look()
      if (isDigit(d)) { this.pos++; xi = (xi * 10 + (d - 48)) | 0; if (xf < 1e20) xf = xf * 10 + (d - 48) }
      else if (d === 46) { this.pos++; return real() }
      else break
    }
    while (this.look() === 45 || isDigit(this.look())) this.pos++
    return doubleMinus ? 0 : neg ? -xi | 0 : xi
  }
  /** Lexer::skipToNextLine */
  skipLine(): void {
    while (this.pos < this.buf.length) {
      const c = this.buf[this.pos++]
      if (c === 10) return
      if (c === 13) { if (this.look() === 10) this.pos++; return }
    }
  }
}

/** Parser.cc's getObj: arrays, dictionaries, `n g R` references, and a dictionary followed by stream data */
class Parser {
  private buf: Obj[] = []
  constructor(readonly lexer: Lexer) {}
  private shift(): Obj { return this.buf.length ? this.buf.shift()! : this.lexer.next() }
  private peek(i: number): Obj { while (this.buf.length <= i) this.buf.push(this.lexer.next()); return this.buf[i] }
  get(streams = false, depth = 0): Obj {
    if (depth > 500) throw new Damaged("objects nested too deep")
    const t = this.shift()
    if (t instanceof Cmd && t.s === "[") {
      const out: Obj[] = []
      for (;;) {
        const p = this.peek(0)
        if (p === EOF) throw new Damaged("an array without its end")
        if (p instanceof Cmd && p.s === "]") { this.shift(); return out }
        out.push(this.get(false, depth + 1))
      }
    }
    if (t instanceof Cmd && t.s === "<<") {
      const d: Dict = new Map()
      for (;;) {
        const k = this.shift()
        if (k instanceof Cmd && k.s === ">>") break
        if (k === EOF) throw new Damaged("a dictionary without its end")
        if (!(k instanceof Name)) throw new Damaged("a dictionary key that is not a name")
        const v = this.peek(0)
        if (v instanceof Cmd && v.s === ">>") throw new Damaged("a dictionary key without a value")
        d.set(k.s, this.get(false, depth + 1))
      }
      const s = this.peek(0)
      if (streams && s instanceof Cmd && s.s === "stream") {
        if (this.buf.length !== 1) throw new Damaged("stream data after a lookahead")
        this.buf = []
        this.lexer.skipLine()
        return new Stream(d, this.lexer.buf, this.lexer.pos)
      }
      return d
    }
    if (typeof t === "number") {
      const g = this.peek(0), r = this.peek(1)
      if (typeof g === "number" && r instanceof Cmd && r.s === "R") { this.shift(); this.shift(); return new Ref(t, g) }
    }
    return t
  }
}

interface Entry { type: 0 | 1 | 2; offset: number; gen: number }

/** XRef.cc: the cross-reference entries, the trailer, and fetching objects */
class Xref {
  entries = new Map<number, Entry>()
  trailer: Dict | null = null
  private objStreams = new Map<number, { nums: number[]; objs: Obj[] }>()
  constructor(readonly buf: Uint8Array) {
    const pos = this.startXref()
    const seen = new Set<number>()
    for (let p: number | null = pos; p !== null;) p = this.readXref(p, seen, false)
    if (!this.trailer) throw new Damaged("no trailer")
  }
  /** the number after the last "startxref" in the file's last 1024 bytes */
  private startXref(): number {
    const b = this.buf, from = Math.max(0, b.length - 1024)
    for (let i = b.length - 9; i >= from; i--) {
      if (String.fromCharCode(...b.subarray(i, i + 9)) !== "startxref") continue
      let p = i + 9
      while (p < b.length && SPECIAL[b[p]] === 1) p++
      let n = 0, digits = 0
      while (p < b.length && isDigit(b[p])) { n = n * 10 + b[p++] - 48; digits++ }
      if (!digits || n === 0) break
      return n
    }
    throw new Damaged("no startxref")
  }
  /** one xref table or stream at `pos`; the /Prev position, or null */
  private readXref(pos: number, seen: Set<number>, hybrid: boolean): number | null {
    if (seen.has(pos)) return null // (a loop: xpdf stops with what it has)
    seen.add(pos)
    const b = this.buf
    let i = pos
    while (i < b.length && i < pos + 100 && SPECIAL[b[i]] === 1) i++
    if (!hybrid && String.fromCharCode(...b.subarray(i, i + 4)) === "xref" && SPECIAL[b[i + 4]] === 1) return this.readTable(i + 5, seen)
    const p = new Parser(new Lexer(b, pos))
    const num = p.get(), gen = p.get(), obj = p.get()
    if (typeof num !== "number" || typeof gen !== "number" || !(obj instanceof Cmd && obj.s === "obj")) {
      if (hybrid) return null
      throw new Damaged("no cross-reference data")
    }
    const s = p.get(true)
    if (!(s instanceof Stream)) throw new Damaged("no cross-reference stream")
    return this.readStream(s)
  }
  private set(i: number, e: Entry): void { if (!this.entries.has(i)) this.entries.set(i, e) }
  private readTable(start: number, seen: Set<number>): number | null {
    const b = this.buf
    let p = start
    const space = () => { while (p < b.length && SPECIAL[b[p]] === 1) p++ }
    const int = () => {
      let n = 0
      if (!isDigit(b[p])) throw new Damaged("a bad xref table")
      while (p < b.length && isDigit(b[p])) n = n * 10 + b[p++] - 48
      if (SPECIAL[b[p]] !== 1) throw new Damaged("a bad xref table")
      return n
    }
    for (;;) {
      space()
      if (b[p] === 116) { // "trailer"
        if (String.fromCharCode(...b.subarray(p, p + 7)) !== "trailer") throw new Damaged("a bad xref table")
        p += 7
        break
      }
      const first = int(); space(); const n = int()
      for (let i = first; i < first + n; i++) {
        space(); const offset = int(); space(); const gen = int(); space()
        const t = b[p++]
        if ((t !== 110 && t !== 102) || SPECIAL[b[p]] !== 1) throw new Damaged("a bad xref entry")
        if (!this.entries.has(i)) {
          // (an xref table that claims to start at 1 for object 0's free entry)
          if (i === 1 && first === 1 && offset === 0 && gen === 65535 && t === 102) this.entries.set(0, { type: 0, offset, gen })
          else this.entries.set(i, { type: t === 110 ? 1 : 0, offset, gen })
        }
        p++
      }
    }
    const trailer = new Parser(new Lexer(b, p)).get()
    if (!(trailer instanceof Map)) throw new Damaged("a bad trailer")
    const prev = trailer.get("Prev")
    this.trailer ??= trailer
    const stm = this.resolve(trailer.get("XRefStm") ?? null)
    if (typeof stm === "number") this.readXref(stm >>> 0, seen, true)
    return typeof prev === "number" ? prev >>> 0 : prev instanceof Ref ? prev.num >>> 0 : null
  }
  private readStream(s: Stream): number | null {
    const d = s.dict
    const size = d.get("Size"), w = d.get("W"), index = d.get("Index")
    if (typeof size !== "number" || size < 0 || !Array.isArray(w) || w.length < 3) throw new Damaged("a bad xref stream")
    const ws = w.slice(0, 3).map((x) => this.resolve(x))
    if (!ws.every((x): x is number => typeof x === "number") || ws.some((x) => x < 0 || x > 8)) throw new Damaged("a bad xref stream")
    const data = this.decode(s)
    let p = 0
    const field = (k: number) => {
      let v = 0
      for (let j = 0; j < k; j++) { if (p >= data.length) throw new Damaged("a short xref stream"); v = v * 256 + data[p++] }
      return v
    }
    const section = (first: number, n: number) => {
      for (let i = first; i < first + n; i++) {
        const type = ws[0] === 0 ? 1 : field(ws[0]), offset = field(ws[1]), gen = field(ws[2])
        if (type > 2) throw new Damaged("a bad xref stream entry")
        if (gen > 0x7fffffff && type !== 0) throw new Damaged("a bad xref stream entry")
        this.set(i, { type: type as Entry["type"], offset, gen })
      }
    }
    if (Array.isArray(index)) {
      for (let i = 0; i + 1 < index.length; i += 2) {
        const first = this.resolve(index[i]), n = this.resolve(index[i + 1])
        if (typeof first !== "number" || typeof n !== "number" || first < 0 || n < 0) throw new Damaged("a bad xref stream index")
        section(first, n)
      }
    } else section(0, size)
    this.trailer ??= d
    const prev = d.get("Prev")
    return typeof prev === "number" ? prev >>> 0 : null
  }
  /** an object's value, references followed (XRef::fetch); null for a free or missing one */
  resolve(o: Obj, depth = 0): Obj {
    while (o instanceof Ref) {
      if (depth++ > 100) throw new Damaged("a reference loop")
      o = this.fetch(o.num, o.gen)
    }
    return o
  }
  fetch(num: number, gen: number): Obj {
    const e = this.entries.get(num)
    if (!e) return null
    if (e.type === 1) {
      if (e.gen !== gen) return null
      const p = new Parser(new Lexer(this.buf, e.offset))
      const n = p.get(), g = p.get(), o = p.get()
      return n === num && g === gen && o instanceof Cmd && o.s === "obj" ? p.get(true) : null
    }
    if (e.type === 2) { // in object stream e.offset, at index e.gen (its generation is not checked)
      const s = this.entries.get(e.offset)
      if (!s || s.type !== 1) return null
      let os = this.objStreams.get(e.offset)
      if (!os) this.objStreams.set(e.offset, os = this.objectStream(e.offset))
      return os.nums[e.gen] === num ? os.objs[e.gen] : null
    }
    return null
  }
  /** XRef.cc's ObjectStream: /N objects after a header of number-offset pairs, from /First */
  private objectStream(num: number): { nums: number[]; objs: Obj[] } {
    const s = this.resolve(new Ref(num, this.entries.get(num)!.gen))
    if (!(s instanceof Stream)) throw new Damaged("an object stream that is not a stream")
    const n = this.resolve(s.dict.get("N") ?? null), first = this.resolve(s.dict.get("First") ?? null)
    if (typeof n !== "number" || n <= 0 || typeof first !== "number" || first < 0 || n > 1000000) throw new Damaged("a bad object stream")
    const data = this.decode(s)
    const head = new Parser(new Lexer(data.subarray(0, first), 0))
    const nums: number[] = [], offs: number[] = []
    for (let i = 0; i < n; i++) {
      const a = head.get(), b = head.get()
      if (typeof a !== "number" || typeof b !== "number" || a < 0 || b < 0 || (i > 0 && b < offs[i - 1])) throw new Damaged("a bad object stream header")
      nums.push(a); offs.push(b)
    }
    const objs: Obj[] = []
    for (let i = 0; i < n; i++) objs.push(new Parser(new Lexer(data.subarray(0, i === n - 1 ? data.length : first + offs[i + 1]), first + offs[i])).get())
    return { nums, objs }
  }
  /** a stream's data through its filters: none, or FlateDecode with a PNG predictor or none */
  decode(s: Stream): Uint8Array {
    const length = this.resolve(s.dict.get("Length") ?? null)
    const filter = this.resolve(s.dict.get("Filter") ?? null), parms = this.resolve(s.dict.get("DecodeParms") ?? null)
    const filters = (Array.isArray(filter) ? filter : filter === null ? [] : [filter]).map((f) => this.resolve(f))
    const params = (Array.isArray(parms) ? parms : [parms]).map((f) => this.resolve(f ?? null))
    const end = typeof length === "number" && length >= 0 && s.start + length <= s.buf.length ? s.start + length : null
    if (!filters.length) {
      if (end === null) throw new Damaged("a stream without a usable /Length")
      return s.buf.subarray(s.start, end)
    }
    if (filters.length > 1 || !(filters[0] instanceof Name) || filters[0].s !== "FlateDecode") throw new Unreadable("a PDF stream with a filter other than FlateDecode")
    let data: Uint8Array
    try { data = inflate(s.buf.subarray(s.start, end ?? s.buf.length)) } catch { throw new Damaged("a bad FlateDecode stream") }
    const p = params[0]
    return p instanceof Map ? this.predictor(data, p) : data
  }
  /** Stream.cc's StreamPredictor for /Predictor 10–15 (each row says its PNG filter), none for 1 */
  private predictor(data: Uint8Array, p: Dict): Uint8Array {
    const get = (k: string, def: number) => { const v = this.resolve(p.get(k) ?? null); return typeof v === "number" ? v : def }
    const pred = get("Predictor", 1), colors = get("Colors", 1), bpc = get("BitsPerComponent", 8), columns = get("Columns", 1)
    if (pred === 1) return data
    if (pred < 10 || pred > 15 || colors < 1 || colors > 32 || ![1, 2, 4, 8, 16].includes(bpc) || columns < 1) throw new Unreadable(`a PDF stream with /Predictor ${pred}`)
    const bpp = Math.ceil((colors * bpc) / 8), row = Math.ceil((columns * colors * bpc) / 8)
    const rows = Math.floor(data.length / (row + 1))
    const out = new Uint8Array(rows * row), prev = new Uint8Array(row)
    for (let r = 0; r < rows; r++) {
      const type = data[r * (row + 1)], cur = data.subarray(r * (row + 1) + 1, (r + 1) * (row + 1)), o = out.subarray(r * row, (r + 1) * row)
      for (let i = 0; i < row; i++) {
        const a = i >= bpp ? o[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0
        let x = cur[i]
        if (type === 1) x += a
        else if (type === 2) x += b
        else if (type === 3) x += (a + b) >> 1
        else if (type === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); x += pa <= pb && pa <= pc ? a : pb <= pc ? b : c }
        o[i] = x & 255
      }
      prev.set(o)
    }
    return out
  }
}

/** A file the engine does not read (xpdf would) */
class Unreadable extends Error {}

/** PageAttrs, what a page tree node passes to its kids */
interface Attrs { media: PdfBox; crop: PdfBox; haveCrop: boolean; rotate: number }

/** PageAttrs::readBox: four numbers, each limited to ±1e9, the corners put in order; null when not that */
function readBox(x: Xref, d: Dict, key: string): PdfBox | null {
  const a = x.resolve(d.get(key) ?? null)
  if (!Array.isArray(a) || a.length !== 4) return null
  const v = a.map((e) => x.resolve(e)).map((e) => (typeof e === "number" ? e : e instanceof Real ? e.v : null))
  if (v.some((e) => e === null)) return null
  let [x1, y1, x2, y2] = (v as number[]).map((e) => Math.min(1e9, Math.max(-1e9, e)))
  if (x1 > x2) [x1, x2] = [x2, x1]
  if (y1 > y2) [y1, y2] = [y2, y1]
  return [x1, y1, x2, y2]
}

/** PageAttrs(attrs, dict): the inherited MediaBox, CropBox and Rotate (8.5 × 11 in when nothing gives a media box) */
function pageAttrs(x: Xref, parent: Attrs | null, d: Dict): Attrs & { dict: Dict } {
  const media = readBox(x, d, "MediaBox") ?? parent?.media ?? [0, 0, 612, 792]
  const ownCrop = readBox(x, d, "CropBox")
  const haveCrop = ownCrop !== null || (parent?.haveCrop ?? false)
  const crop = ownCrop ?? (haveCrop ? parent!.crop : media)
  const r = x.resolve(d.get("Rotate") ?? null)
  let rotate = typeof r === "number" ? r : parent?.rotate ?? 0
  rotate = ((rotate % 360) + 360) % 360
  return { media, crop, haveCrop, rotate, dict: d }
}

/** PDFRectangle::clipTo */
function clip(b: PdfBox, to: PdfBox): PdfBox {
  const c = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
  return [c(b[0], to[0], to[2]), c(b[1], to[1], to[3]), c(b[2], to[0], to[2]), c(b[3], to[1], to[3])]
}

/** Page::Page: the boxes of a page dictionary under its attributes, clipped to the media box; xpdf's blank 50 × 50
 *  page when the dictionary is malformed (its /Annots or /Contents of the wrong type) */
function page(x: Xref, a: Attrs & { dict: Dict }): PdfPage {
  const d = a.dict
  const box = (k: string) => readBox(x, d, k) ?? a.crop
  const bad = (k: string) => { const v = d.get(k) ?? null; return !(v === null || v instanceof Ref || Array.isArray(v)) }
  if (bad("Annots") || bad("Contents")) return blank()
  const m = a.media
  return { media: m, crop: clip(a.crop, m), bleed: clip(box("BleedBox"), m), trim: clip(box("TrimBox"), m), art: clip(box("ArtBox"), m), rotate: a.rotate }
}
const blank = (): PdfPage => ({ media: [0, 0, 50, 50], crop: [0, 0, 50, 50], bleed: [0, 0, 50, 50], trim: [0, 0, 50, 50], art: [0, 0, 50, 50], rotate: 0 })

interface Node { ref: Ref; count: number; parent: Node | null; attrs?: Attrs & { dict: Dict }; kids?: Node[] }

/** Catalog.cc's countPageTree: the pages under a node, counted (loops count 0) */
function countTree(x: Xref, ref: Obj, touched: Set<number>): number {
  let node: Obj = ref
  if (ref instanceof Ref) {
    if (touched.has(ref.num)) return 0
    touched.add(ref.num)
    node = x.fetch(ref.num, ref.gen)
  }
  if (!(node instanceof Map)) return 0
  let kids = node.get("Kids") ?? null
  if (kids instanceof Ref) {
    if (touched.has(kids.num)) return 0
    touched.add(kids.num)
    kids = x.fetch(kids.num, kids.gen)
  }
  if (!Array.isArray(kids)) return 1
  let n = 0
  for (const k of kids) n += countTree(x, k, touched)
  return n
}

/** Catalog::loadPage2: page number pg (relPg pages into `node`), the tree walked by the kids' /Count; null where
 *  xpdf makes a blank page with no page dictionary */
function loadPage(x: Xref, relPg: number, node: Node): PdfPage | null {
  if (relPg >= node.count) return null
  if (!node.kids) {
    for (let p = node.parent; p; p = p.parent) if (p.ref.num === node.ref.num && p.ref.gen === node.ref.gen) return null
    const obj = x.fetch(node.ref.num, node.ref.gen)
    if (!(obj instanceof Map)) return null
    const attrs = pageAttrs(x, node.parent?.attrs ?? null, obj)
    const kids = x.resolve(obj.get("Kids") ?? null)
    if (!Array.isArray(kids)) return page(x, attrs)
    node.attrs = attrs
    node.kids = []
    for (const k of kids) {
      if (!(k instanceof Ref)) continue
      const kid = x.fetch(k.num, k.gen)
      if (!(kid instanceof Map)) continue
      const c = x.resolve(kid.get("Count") ?? null)
      node.kids.push({ ref: k, count: typeof c === "number" ? c : 1, parent: node })
    }
  }
  for (const kid of node.kids) {
    if (relPg < kid.count) return loadPage(x, relPg, kid)
    relPg -= kid.count
  }
  return null
}

/** The pages of a PDF file (null: not one, its first bytes not "%PDF-") */
export function pdfInfo(bytes: Uint8Array): Pdf | null {
  if (String.fromCharCode(...bytes.subarray(0, 5)) !== "%PDF-") return null
  try {
    const x = new Xref(bytes)
    const trailer = x.trailer!
    if (trailer.has("Encrypt")) throw new Unreadable("an encrypted PDF file")
    const root = trailer.get("Root")
    if (!(root instanceof Ref)) throw new Damaged("no /Root")
    const catalog = x.fetch(root.num, root.gen)
    if (!(catalog instanceof Map)) throw new Damaged("no catalog")
    const top = catalog.get("Pages")
    if (!(top instanceof Ref)) throw new Damaged("no /Pages")
    const topObj = x.fetch(top.num, top.gen)
    if (!(topObj instanceof Map)) throw new Damaged("no /Pages")
    const count = x.resolve(topObj.get("Count") ?? null)
    let n = typeof count === "number" ? count : 1
    if (typeof count === "number" && (n === 0 || n > 50000)) n = countTree(x, top, new Set())
    if (n < 0) throw new Damaged("a negative page count")
    const tree: Node = { ref: top, count: n, parent: null }
    const pages: (PdfPage | null)[] = []
    for (let i = 0; i < n; i++) pages.push(loadPage(x, i, tree))
    return { kind: "pdf", pages }
  } catch (e) {
    if (e instanceof Unreadable) return { kind: "pdf", pages: [], unsupported: e.message }
    if (e instanceof Damaged) return { kind: "pdf", pages: [], unsupported: `a PDF file pdfTeX reads only by repairing it (${e.message})` }
    throw e
  }
}
