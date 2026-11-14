// The exact page view: each shipped page as an SVG drawing of the paper, as pdfTeX's PDF shows it. The trace
// gives every glyph and rule where pdfTeX puts it; the page's marks (emit/trace) give, in the order of the
// page's content stream, what pdfTeX writes besides: the color stack's operators, \pdfsave, \pdfsetmatrix and
// \pdfrestore, \pdfliteral (what pgf's pdfTeX driver draws: pgfsys-pdftex.def over pgfsys-common-pdf.def),
// images and form XObjects. The pages are drawn by interpreting that stream with a PDF graphics state:
//
// - pdfTeX keeps an origin, where it believes the user space's (0, 0) is (pdf_origin_h, pdf_origin_v). A
//   \pdfliteral without `direct` or `page`, \pdfsave, \pdfsetmatrix and \pdfrestore first move it to the current
//   position (pdf_set_origin: `1 0 0 1 dx dy cm`); rules, images and forms are placed relative to it (in a q … Q of
//   their own), and text first moves it back to the page's corner (pdf_begin_text). The origin is pdfTeX's
//   variable, not part of the graphics state: `Q` does not bring it back, which is why \pdfsave and \pdfrestore
//   must be at one position. (Checked against the content streams pdfTeX 1.40.27 writes.)
// - The color stack 0 writes its operators as they are (`direct`), and its current color again at the start of
//   each page. Glyphs are filled; a rule is `re f`, or a stroked line when it is at most 1bp thin (pdf_set_rule).
// - A form (\pdfrefxform) is its box shipped on its own, clipped to the box, in the state where it is shown.
//
// Glyphs are drawn with the web fonts tools/webfonts/build.py makes from the Type 1 fonts pdfTeX embeds.
// What cannot be drawn is named in `warnings`, never dropped silently.

import { webfontData } from "../latex/data"
import type { Trace, TraceGlyph, TraceRule } from "../trace/schema"
import type { PageForm, PageMark } from "./trace"

/** What drawing the pages needs besides the trace */
export interface PageView {
  /** \paperwidth and \paperheight */
  paper: { width: number; height: number }
  /** where the DVI origin is on the paper: pdfTeX's \pdfhorigin and \pdfvorigin, 1in, plus \hoffset and \voffset */
  origin: { h: number; v: number }
  /** each page's whatsits, images and forms (emit/trace's shipOut) */
  marks: PageMark[][]
  /** the form XObjects the pages and each other show (\pdfxform), by number */
  forms?: Record<number, PageForm>
}

export interface SvgOptions {
  /** an image file's URL (an \includegraphics name); none: the image is left out, with a warning */
  image?: (name: string) => string | undefined
}

export interface SvgPages {
  /** each page as an <svg> element sized in PostScript points (bp, CSS's pt) */
  pages: string[]
  /** the web font files the pages use (public/fonts/tex/<file>.woff2), font family `l0-<file>` */
  fonts: string[]
  /** what the pages hold that is not drawn (or not drawn as the PDF shows it), each named once */
  warnings: string[]
}

/** PostScript points (bp) per sp: 72.27pt = 72bp */
const K = 72 / (65536 * 72.27)
/** sp as PostScript points (bp), the PDF's and CSS's unit */
const pt = (sp: number) => +(sp * K).toFixed(3)
/** 1bp in sp (pdfTeX's one_bp) */
const ONE_BP = 65782
const escape = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)
/** a coordinate, as short as the literals' five decimals allow */
const n = (v: number) => String(+v.toFixed(5))

/** A PDF matrix [a b c d e f]: (x, y) goes to (ax + cy + e, bx + dy + f), SVG's matrix(a b c d e f) */
type Matrix = readonly [number, number, number, number, number, number]
/** first `m`, then `k` (PDF's `m cm` under the matrix `k`) */
const mul = (m: Matrix, k: Matrix): Matrix => [
  m[0] * k[0] + m[1] * k[2], m[0] * k[1] + m[1] * k[3],
  m[2] * k[0] + m[3] * k[2], m[2] * k[1] + m[3] * k[3],
  m[4] * k[0] + m[5] * k[2] + k[4], m[4] * k[1] + m[5] * k[3] + k[5],
]
function inverse(m: Matrix): Matrix | null {
  const det = m[0] * m[3] - m[1] * m[2]
  if (!det) return null
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det]
}
const svgMatrix = (m: Matrix) => `matrix(${m.map((v, i) => String(+v.toFixed(i < 4 ? 6 : 4))).join(" ")})`

/** color components as CSS, "" for black (SVG's default fill) */
function css(v: number[]): string {
  const rgb = v.length === 3 ? v : v.length === 1 ? [v[0], v[0], v[0]] : v.length === 4 ? v.slice(0, 3).map((c) => (1 - c) * (1 - v[3])) : [0, 0, 0]
  const hex = rgb.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, "0")).join("")
  return hex === "000000" ? "" : `#${hex}`
}

/** dvips's color special operand as CSS: `rgb r g b`, `gray g`, `cmyk c m y k` (a named color is black) */
function dvipsColor(spec: string): string {
  const [model, ...v] = spec.trim().split(/\s+/)
  return model === "rgb" || model === "gray" || model === "cmyk" ? css(v.map(Number)) : ""
}

// ---- PDF objects, as far as a form's resources need them ----

type Pdf = number | string | boolean | Pdf[] | { [key: string]: Pdf }
const PDF_TOKEN = /<<|>>|\[|\]|\((?:\\[\s\S]|[^\\()])*\)|<[0-9A-Fa-f\s]*>|\/[^\s/[\]<>()]*|[^\s/[\]<>()]+|[<>()]/g
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)$/

/** The entries of a dictionary's body (`/Key value …`; names keep their slash, `n g R` is the string "n g R");
 *  what does not parse is skipped */
function pdfDict(text: string): { [key: string]: Pdf } {
  const t = text.match(PDF_TOKEN) ?? []
  let i = 0
  const value = (): Pdf => {
    const w = t[i++]
    if (w === "<<") return dict()
    if (w === "[") {
      const a: Pdf[] = []
      while (i < t.length && t[i] !== "]") a.push(value())
      i++
      return a
    }
    if (NUMBER.test(w)) {
      if (NUMBER.test(t[i] ?? "") && t[i + 1] === "R") { i += 2; return `${w} ${t[i - 2]} R` }
      return Number(w)
    }
    return w === "true" ? true : w === "false" ? false : w
  }
  const dict = (): { [key: string]: Pdf } => {
    const d: { [key: string]: Pdf } = {}
    while (i < t.length && t[i] !== ">>") {
      if (t[i][0] !== "/") { i++; continue }
      const key = t[i++].slice(1)
      if (i < t.length && t[i] !== ">>") d[key] = value()
    }
    i++
    return d
  }
  return dict()
}
const isDict = (v: Pdf | undefined): v is { [key: string]: Pdf } => typeof v === "object" && !Array.isArray(v)
const numbers = (v: Pdf | undefined, count?: number): number[] | null =>
  Array.isArray(v) && v.every((x) => typeof x === "number") && (count === undefined || v.length === count) ? (v as number[]) : null

/** an exponential function (type 2) of `components` values at x */
function exponential(f: { [key: string]: Pdf }, x: number, components: number): number[] | null {
  if (f.FunctionType !== 2) return null
  const dom = numbers(f.Domain, 2) ?? [0, 1]
  const c0 = numbers(f.C0) ?? [0], c1 = numbers(f.C1) ?? [1]
  if (c0.length !== components || c1.length !== components) return null
  const p = Math.pow(Math.min(dom[1], Math.max(dom[0], x)), typeof f.N === "number" ? f.N : 1)
  return c0.map((c, i) => c + p * (c1[i] - c))
}

/** A shading's function over [t0, t1] as gradient stops (offsets from 0 to 1): an exponential function (type 2) or a
 *  stitching of them (type 3), what pgf's shadings are; null for anything else */
function gradientStops(f: Pdf | undefined, t0: number, t1: number, components: number): { offset: number; color: string }[] | null {
  if (!isDict(f) || !(t1 > t0)) return null
  const out: { offset: number; color: string }[] = []
  /** `g` from t = lo to hi, its input going from e0 to e1 */
  const piece = (g: Pdf, lo: number, hi: number, e0: number, e1: number): boolean => {
    if (!isDict(g)) return false
    const steps = (typeof g.N === "number" ? g.N : 1) === 1 ? 1 : 8
    for (let k = 0; k <= steps; k++) {
      const c = exponential(g, e0 + (k / steps) * (e1 - e0), components)
      if (!c) return false
      out.push({ offset: (lo + (k / steps) * (hi - lo) - t0) / (t1 - t0), color: css(c) })
    }
    return true
  }
  if (f.FunctionType === 2) return piece(f, t0, t1, t0, t1) ? out : null
  if (f.FunctionType !== 3) return null
  const dom = numbers(f.Domain, 2), bounds = numbers(f.Bounds), encode = numbers(f.Encode), fns = f.Functions
  if (!dom || !bounds || !encode || !Array.isArray(fns) || bounds.length !== fns.length - 1 || encode.length !== 2 * fns.length) return null
  for (let k = 0; k < fns.length; k++) {
    const lo = k ? bounds[k - 1] : dom[0], hi = k < fns.length - 1 ? bounds[k] : dom[1]
    const a = Math.max(lo, t0), b = Math.min(hi, t1)
    if (!(b > a)) continue
    const enc = (t: number) => encode[2 * k] + (hi > lo ? (t - lo) / (hi - lo) : 0) * (encode[2 * k + 1] - encode[2 * k])
    if (!piece(fns[k], a, b, enc(a), enc(b))) return null
  }
  return out.length ? out : null
}

/** pgf's blend modes (pgfsys-common-pdf.def 97–112: the ExtGState /pgf@bm<Mode>) as CSS's mix-blend-mode */
const BLEND: Record<string, string> = {
  Normal: "", Multiply: "multiply", Screen: "screen", Overlay: "overlay", Darken: "darken", Lighten: "lighten", ColorDodge: "color-dodge", ColorBurn: "color-burn",
  HardLight: "hard-light", SoftLight: "soft-light", Difference: "difference", Exclusion: "exclusion", Hue: "hue", Saturation: "saturation", Color: "color", Luminosity: "luminosity",
}

// ---- the graphics state ----

interface GState {
  /** user space to the page's SVG coordinates (the PDF's CTM, then the flip to SVG's y axis) */
  ctm: Matrix
  /** nonstroking and stroking colors as CSS ("" black) and opacities (ExtGState's ca and CA) */
  fill: string; stroke: string; ca: number; CA: number
  width: number; cap: number; join: number; miter: number; dash: number[]; phase: number
  /** the ids of the clipping path's <clipPath> and the soft mask's <mask> ("" none), CSS's blend mode ("" normal) */
  clip: string; mask: string; blend: string
}
const INITIAL: Omit<GState, "ctm"> = { fill: "", stroke: "", ca: 1, CA: 1, width: 1, cap: 0, join: 0, miter: 10, dash: [], phase: 0, clip: "", mask: "", blend: "" }

/** A page being drawn: its elements, in groups that carry a clipping path, a mask and a transformation */
class Page {
  readonly out: string[] = []
  private open = ""
  private depth = 0
  private ids = 0
  /** forms being drawn inside one another */
  nesting = 0
  constructor(readonly id: string, readonly width: number, readonly height: number, readonly view: PageView, readonly options: SvgOptions,
    readonly warn: (what: string) => void, readonly font: (name: string) => [file: string, codes: number[]]) {}

  newId(kind: string) { return `${this.id}${kind}${++this.ids}` }

  /** an element drawn in the state `gs`, under the transformation `transform` (an SVG transform, "" none) */
  emit(el: string, gs: GState, transform: string) {
    // a mask and a blend mode apply to each object by itself; a clipping path and a transformation to any run of them
    const alone = gs.mask !== "" || gs.blend !== ""
    const key = `${gs.clip} ${gs.mask} ${gs.blend} ${transform}`
    if (alone || key !== this.open) {
      this.close()
      const attrs = (gs.clip ? ` clip-path="url(#${gs.clip})"` : "") + (gs.mask ? ` mask="url(#${gs.mask})"` : "") + (gs.blend ? ` style="mix-blend-mode:${gs.blend}"` : "")
      // (the clipping path and the mask are in the page's coordinates: on a group outside the transformation's)
      if (attrs) { this.out.push(`<g${attrs}>`); this.depth++ }
      if (transform) { this.out.push(`<g transform="${transform}">`); this.depth++ }
      this.open = alone ? "\0" : key
    }
    this.out.push(el)
  }
  close() {
    for (; this.depth; this.depth--) this.out.push("</g>")
    this.open = ""
  }
  /** a definition (a clipping path, a gradient, a mask's start or end), outside the groups */
  define(el: string) {
    this.close()
    this.out.push(el)
  }
  /** the clipping path `d` (in the user space of `ctm`) inside the clipping path `parent`: its id */
  clipPath(d: string, ctm: Matrix, parent: string, rule: string): string {
    const id = this.newId("c")
    this.define(`<clipPath id="${id}"${parent ? ` clip-path="url(#${parent})"` : ""}><path d="${d}" transform="${svgMatrix(ctm)}"${rule === "evenodd" ? ` clip-rule="evenodd"` : ""}/></clipPath>`)
    return id
  }
}

type Operand = number | string | number[]
type Segment = [cmd: string, ...points: number[]]

/** the whatsits of pdfTeX that draw nothing: destinations, links and annotations (a viewer's, not the page's content) */
const NOT_DRAWN = /^\\pdf(?:dest|startlink|endlink|annot|outline|thread|startthread|endthread|catalog|info|names|refobj|obj|snaprefpoint|snapy|snapycomp|savepos)\b/
/** dvips's specials that draw: PostScript code and files (not hyperref's pdfmarks, `ps:SDict begin …`; headers and
 *  `!` only define) */
const POSTSCRIPT = /^\\special\{\s*(ps:(?!\s*SDict begin)|"|psfile=|PSfile=)/

/** A content stream being drawn: a page's, or a form's */
class Stream {
  private gs: GState
  private saved: GState[] = []
  /** the current path in the user space of `pathCtm`, its current point and its subpath's start */
  private path: Segment[] = []
  private pathCtm: Matrix | null = null
  private current: [number, number] = [0, 0]
  private start: [number, number] = [0, 0]
  /** the rule of a pending W or W* */
  private clipRule = ""
  /** how many glyphs and rules are drawn */
  private g = 0
  private r = 0
  private resourceDict: { [key: string]: Pdf } | null = null
  /** the stream's own origin: the paper's or the form's lower left corner */
  private readonly corner: [number, number]

  /**
   * `oh`, `ov`: pdfTeX's origin, the position (in the stream's sp) of the user space's (0, 0) when `gs.ctm` was set.
   * `ph`, `pv`: the offset of the stream's positions in its plain SVG coordinates (the page's: where the DVI origin
   * is on the paper). `stack`: the color stack 0.
   */
  constructor(private readonly page: Page, gs: GState, private readonly src: { glyphs: TraceGlyph[]; rules: TraceRule[]; marks: PageMark[] },
    private oh: number, private ov: number, private readonly ph: number, private readonly pv: number, private readonly stack: string[], private readonly resources: string) {
    this.gs = gs
    this.corner = [oh, ov]
  }

  private set(patch: Partial<GState>) { this.gs = { ...this.gs, ...patch } }
  private x(h: number) { return pt(this.ph + h) }
  private y(v: number) { return pt(this.pv + v) }
  /** a position in user space, as pdfTeX computes it from its origin */
  private user(h: number, v: number): [number, number] { return [(h - this.oh) * K, (this.ov - v) * K] }

  /** pdf_set_origin: the user space's origin moved to the position */
  private setOrigin(h: number, v: number) {
    const [dx, dy] = this.user(h, v)
    if (dx || dy) this.set({ ctm: mul([1, 0, 0, 1, dx, dy], this.gs.ctm) })
    this.oh = h
    this.ov = v
  }

  /** What takes the plain SVG coordinates of the stream's positions (x(), y()) to where the state draws them: "" in
   *  the page's own state */
  private transform(): string {
    const m = mul(mul([1, 0, 0, 1, -(this.ph + this.oh) * K, -(this.pv + this.ov) * K], [1, 0, 0, -1, 0, 0]), this.gs.ctm)
    const same = Math.abs(m[0] - 1) < 1e-9 && Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9 && Math.abs(m[3] - 1) < 1e-9 && Math.abs(m[4]) < 1e-6 && Math.abs(m[5]) < 1e-6
    return same ? "" : svgMatrix(m)
  }

  draw() {
    for (const m of this.src.marks) {
      if (m.kind === "image") { this.advance(m.glyphs, m.rules); this.image(m); continue }
      if (m.kind === "form") { this.advance(m.glyphs, m.rules); this.form(m); continue }
      const t = m.text
      let a: RegExpMatchArray | null
      if ((a = t.match(/^\\pdfliteral( direct| page)?\{([\s\S]*)\}$/))) {
        this.advance(m.glyphs, m.rules)
        if (!a[1]) this.setOrigin(m.h, m.v)
        this.operators(a[2])
      } else if (t === "\\pdfsave" || t === "\\pdfrestore" || (a = t.match(/^\\pdfsetmatrix\{([\s\S]*)\}$/))) {
        this.advance(m.glyphs, m.rules)
        this.setOrigin(m.h, m.v)
        this.operators(t === "\\pdfsave" ? "q" : t === "\\pdfrestore" ? "Q" : `${a![1]} 0 0 cm`)
      } else if ((a = t.match(/^\\pdfcolorstack (\d+) (push|pop|set|current)(?: ?(\{[\s\S]*\}))?$/))) {
        if (a[1] !== "0") { this.page.warn(`\\pdfcolorstack ${a[1]} (a color stack other than 0)`); continue }
        this.advance(m.glyphs, m.rules)
        this.color(a[2], a[3] ?? "")
      } else if ((a = t.match(/^\\special\{color (?:(push|pop) ?)?([\s\S]*)\}$/))) {
        this.advance(m.glyphs, m.rules)
        this.color(a[1] ?? "set", a[2])
      } else if (POSTSCRIPT.test(t)) this.page.warn(`\\special{${t.match(POSTSCRIPT)![1]}…} (PostScript, the dvips driver's drawing)`)
      else if (/^\\special\{\s*background\b/.test(t)) this.page.warn("\\special{background …} (the page's color)")
      else if (/^\\pdf/.test(t) && !NOT_DRAWN.test(t)) this.page.warn(`${t.match(/^\\pdf[a-z]*/)![0]}`)
    }
    this.advance(this.src.glyphs.length, this.src.rules.length)
  }

  /** the color stack: `spec` is pdfTeX's `{operators}` or dvips's `model values` */
  private color(action: string, spec: string) {
    const s = this.stack
    if (action === "push") s.push(spec)
    else if (action === "pop") { if (s.length > 1) s.pop() }
    else if (action === "set") s[s.length - 1] = spec
    this.currentColor()
  }
  /** the stack's top written: its operators, or dvips's color for filling and stroking */
  currentColor() {
    const top = this.stack[this.stack.length - 1]
    const pdf = top.match(/^\{([\s\S]*)\}$/)
    if (pdf) this.operators(pdf[1])
    else { const c = dvipsColor(top); this.set({ fill: c, stroke: c }) }
  }

  // ---- glyphs, rules, images, forms ----

  /** the glyphs and rules up to the counts, in the current state: the rules, then the glyphs */
  private advance(glyphs: number, rules: number) {
    if (this.r >= rules && this.g >= glyphs) return
    const gs = this.gs, transform = this.transform()
    for (; this.r < rules; this.r++) {
      const rule = this.src.rules[this.r]
      // pdf_set_rule: a rule at most 1bp high or wide is a stroked line
      const thin = rule.height <= ONE_BP || rule.width <= ONE_BP
      const color = thin ? gs.stroke : gs.fill, alpha = thin ? gs.CA : gs.ca
      this.page.emit(`<rect x="${this.x(rule.h)}" y="${this.y(rule.v - rule.height)}" width="${pt(rule.width)}" height="${pt(rule.height)}"${color ? ` fill="${color}"` : ""}${alpha !== 1 ? ` fill-opacity="${alpha}"` : ""}/>`, gs, transform)
    }
    // a run of glyphs on one baseline in one font is one <text>, each glyph at its own x
    const paint = `${gs.fill ? ` fill="${gs.fill}"` : ""}${gs.ca !== 1 ? ` fill-opacity="${gs.ca}"` : ""}`
    let run: TraceGlyph[] = []
    const flush = () => {
      if (!run.length) return
      const [file, codes] = this.page.font(run[0].font)
      const chars = run.map((gl) => String.fromCodePoint(codes[gl.char] || 0xfffd)).join("")
      this.page.emit(`<text x="${run.map((gl) => this.x(gl.h)).join(" ")}" y="${this.y(run[0].v)}" font-family="l0-${file}" font-size="${pt(run[0].size)}"${paint}>${escape(chars)}</text>`, gs, transform)
      run = []
    }
    for (; this.g < glyphs; this.g++) {
      const gl = this.src.glyphs[this.g], prev = run[run.length - 1]
      if (prev && (prev.font !== gl.font || prev.size !== gl.size || prev.v !== gl.v)) flush()
      run.push(gl)
    }
    if (!run.length) return
    flush()
    // pdf_begin_text: the origin back at the corner
    this.setOrigin(this.corner[0], this.corner[1])
  }

  private image(m: PageMark & { kind: "image" }) {
    const url = this.page.options.image?.(m.name)
    if (!url) return this.page.warn(`the image ${m.name} (no file given)`)
    const gs = this.gs
    this.page.emit(`<image href="${escape(url)}" x="${this.x(m.h)}" y="${this.y(m.v - m.height)}" width="${pt(m.width)}" height="${pt(m.height + m.depth)}" preserveAspectRatio="none"${gs.ca !== 1 ? ` opacity="${gs.ca}"` : ""}/>`, gs, this.transform())
  }

  /** \pdfrefxform: `q 1 0 0 1 x y cm /Fm Do Q`, the form's lower left corner at the box's */
  private form(m: PageMark & { kind: "form" }) {
    const [x, y] = this.user(m.h, m.v + m.depth)
    this.showForm(m.number, { ...this.gs, ctm: mul([1, 0, 0, 1, x, y], this.gs.ctm) })
  }
  /** the form drawn in the state `gs`, whose user space is the form's */
  private showForm(number: number, gs: GState) {
    const f = this.page.view.forms?.[number]
    if (!f) return this.page.warn(`the form XObject ${number} (its content is not known)`)
    if (this.page.nesting >= 16) return this.page.warn(`the form XObject ${number} (forms nested too deep)`)
    const clip = this.page.clipPath(`M0 0H${pt(f.width)}V${pt(f.height + f.depth)}H0Z`, gs.ctm, gs.clip, "")
    this.page.nesting++
    // (a form's color stack starts from the stack's initial color; nothing is written at its start)
    new Stream(this.page, { ...gs, clip }, f, 0, f.height + f.depth, 0, 0, ["{0 g 0 G}"], f.resources).draw()
    this.page.nesting--
  }

  // ---- content stream operators ----

  /** the operators of a literal, a color or a matrix */
  private operators(text: string) {
    const tokens = text.match(PDF_TOKEN) ?? []
    let operands: Operand[] = []
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]
      if (t === "[") {
        const a: number[] = []
        for (i++; i < tokens.length && tokens[i] !== "]"; i++) a.push(Number(tokens[i]))
        operands.push(a)
      } else if (NUMBER.test(t)) operands.push(Number(t))
      else if (t[0] === "/" || (t.length > 1 && (t[0] === "(" || t[0] === "<"))) operands.push(t) // (a name, a string)
      else {
        this.operator(t, operands)
        operands = []
      }
    }
  }

  private operator(op: string, operands: Operand[]) {
    /** the operator's `count` numbers, or null (then it is not drawn) */
    const nums = (count: number): number[] | null => {
      const v = operands.slice(-count)
      if (operands.length >= count && v.every((x) => typeof x === "number" && Number.isFinite(x))) return v as number[]
      this.page.warn(`\\pdfliteral operator ${op} (its operands)`)
      return null
    }
    let v: number[] | null
    switch (op) {
      case "q": this.saved.push(this.gs); break
      case "Q":
        if (this.saved.length) this.gs = this.saved.pop()!
        else this.page.warn("\\pdfliteral operator Q (nothing saved)")
        break
      case "cm": if ((v = nums(6))) this.set({ ctm: mul(v as unknown as Matrix, this.gs.ctm) }); break
      case "w": if ((v = nums(1))) this.set({ width: v[0] }); break
      case "J": if ((v = nums(1))) this.set({ cap: v[0] }); break
      case "j": if ((v = nums(1))) this.set({ join: v[0] }); break
      case "M": if ((v = nums(1))) this.set({ miter: v[0] }); break
      case "d": {
        const [dash, phase] = operands.slice(-2)
        if (Array.isArray(dash) && typeof phase === "number" && dash.every(Number.isFinite)) this.set({ dash, phase })
        else this.page.warn("\\pdfliteral operator d (its operands)")
        break
      }
      case "i": case "ri": break // (flatness and rendering intent: nothing a page shows)
      case "g": if ((v = nums(1))) this.set({ fill: css(v) }); break
      case "G": if ((v = nums(1))) this.set({ stroke: css(v) }); break
      case "rg": if ((v = nums(3))) this.set({ fill: css(v) }); break
      case "RG": if ((v = nums(3))) this.set({ stroke: css(v) }); break
      case "k": if ((v = nums(4))) this.set({ fill: css(v) }); break
      case "K": if ((v = nums(4))) this.set({ stroke: css(v) }); break
      case "m": if ((v = nums(2))) { this.segment(["M", v[0], v[1]]); this.current = this.start = [v[0], v[1]] } break
      case "l": if ((v = nums(2))) { this.segment(["L", v[0], v[1]]); this.current = [v[0], v[1]] } break
      case "c": if ((v = nums(6))) { this.segment(["C", ...v]); this.current = [v[4], v[5]] } break
      case "v": if ((v = nums(4))) { this.segment(["C", ...this.current, ...v]); this.current = [v[2], v[3]] } break
      case "y": if ((v = nums(4))) { this.segment(["C", v[0], v[1], v[2], v[3], v[2], v[3]]); this.current = [v[2], v[3]] } break
      case "h": this.closePath(); break
      case "re":
        if ((v = nums(4))) {
          const [x, y, w, h] = v
          this.segment(["M", x, y]); this.segment(["L", x + w, y]); this.segment(["L", x + w, y + h]); this.segment(["L", x, y + h]); this.segment(["Z"])
          this.current = this.start = [x, y]
        }
        break
      case "S": this.paint(null, true); break
      case "s": this.closePath(); this.paint(null, true); break
      case "f": case "F": this.paint("nonzero", false); break
      case "f*": this.paint("evenodd", false); break
      case "B": this.paint("nonzero", true); break
      case "B*": this.paint("evenodd", true); break
      case "b": this.closePath(); this.paint("nonzero", true); break
      case "b*": this.closePath(); this.paint("evenodd", true); break
      case "n": this.paint(null, false); break
      case "W": this.clipRule = "nonzero"; break
      case "W*": this.clipRule = "evenodd"; break
      case "sh": this.shading(String(operands[operands.length - 1] ?? "")); break
      case "gs": this.extGState(String(operands[operands.length - 1] ?? "")); break
      default: this.page.warn(`\\pdfliteral operator ${op}${OPERATORS[op] ? ` (${OPERATORS[op]})` : ""}`)
    }
  }

  private segment(s: Segment) {
    if (!this.path.length) this.pathCtm = this.gs.ctm
    else if (this.pathCtm !== this.gs.ctm) {
      // the matrix changed inside the path: the new points in the path's first user space
      const back = inverse(this.pathCtm!)
      if (back) {
        const t = mul(this.gs.ctm, back)
        for (let i = 1; i < s.length; i += 2) {
          const x = s[i] as number, y = s[i + 1] as number
          s[i] = x * t[0] + y * t[2] + t[4]
          s[i + 1] = x * t[1] + y * t[3] + t[5]
        }
      }
    }
    this.path.push(s)
  }
  private closePath() {
    if (!this.path.length) return
    this.path.push(["Z"])
    this.current = this.start
  }
  /** the current path as an SVG path in the user space of `ctm` */
  private pathData(ctm: Matrix): string {
    let t: Matrix | null = null
    if (this.pathCtm && this.pathCtm !== ctm && this.pathCtm.some((v, i) => v !== ctm[i])) {
      const back = inverse(ctm)
      if (back) t = mul(this.pathCtm, back)
    }
    return this.path.map(([cmd, ...p]) => {
      const out: string[] = []
      for (let i = 0; i < p.length; i += 2) out.push(t ? `${n(p[i] * t[0] + p[i + 1] * t[2] + t[4])} ${n(p[i] * t[1] + p[i + 1] * t[3] + t[5])}` : `${n(p[i])} ${n(p[i + 1])}`)
      return cmd + out.join(" ")
    }).join("")
  }

  /** a path-painting operator: fill by the rule (null: no fill), stroke, then the pending clip; the path ends */
  private paint(fill: string | null, stroke: boolean) {
    const gs = this.gs
    const d = this.pathData(gs.ctm)
    if (d && (fill !== null || stroke)) {
      let attrs = ""
      if (fill === null) attrs += ` fill="none"`
      else attrs += `${gs.fill ? ` fill="${gs.fill}"` : ""}${fill === "evenodd" ? ` fill-rule="evenodd"` : ""}${gs.ca !== 1 ? ` fill-opacity="${gs.ca}"` : ""}`
      if (stroke) {
        attrs += ` stroke="${gs.stroke || "#000"}"`
        // (a width of 0 is the thinnest line the device draws)
        if (gs.width === 0) attrs += ` stroke-width="1" vector-effect="non-scaling-stroke"`
        else if (gs.width !== 1) attrs += ` stroke-width="${n(gs.width)}"`
        if (gs.cap === 1 || gs.cap === 2) attrs += ` stroke-linecap="${gs.cap === 1 ? "round" : "square"}"`
        if (gs.join === 1 || gs.join === 2) attrs += ` stroke-linejoin="${gs.join === 1 ? "round" : "bevel"}"`
        if (gs.miter !== 10) attrs += ` stroke-miterlimit="${n(gs.miter)}"`
        if (gs.dash.some((x) => x > 0)) attrs += ` stroke-dasharray="${gs.dash.map(n).join(" ")}"${gs.phase ? ` stroke-dashoffset="${n(gs.phase)}"` : ""}`
        if (gs.CA !== 1) attrs += ` stroke-opacity="${gs.CA}"`
      }
      this.page.emit(`<path d="${d}" transform="${svgMatrix(gs.ctm)}"${attrs}/>`, gs, "")
    }
    if (this.clipRule && d) this.set({ clip: this.page.clipPath(d, gs.ctm, gs.clip, this.clipRule) })
    this.clipRule = ""
    this.path = []
    this.pathCtm = null
  }

  /** `/Name sh`: the shading of the stream's resources painted over the clipping path */
  private shading(name: string) {
    this.resourceDict ??= pdfDict(this.resources)
    const all = this.resourceDict.Shading
    const sh = isDict(all) ? all[name.slice(1)] : undefined
    const not = (why: string) => this.page.warn(`the shading ${name} (${why})`)
    if (!isDict(sh)) return not("not among the resources")
    const components = ({ "/DeviceRGB": 3, "/DeviceGray": 1, "/DeviceCMYK": 4 } as Record<string, number>)[String(sh.ColorSpace)]
    if (!components) return not(`the color space ${String(sh.ColorSpace)}`)
    if (sh.ShadingType !== 2 && sh.ShadingType !== 3) return not(`shading type ${String(sh.ShadingType)}`)
    const domain = numbers(sh.Domain, 2) ?? [0, 1]
    const stops = gradientStops(sh.Function, domain[0], domain[1], components)
    if (!stops) return not("its function")
    const extend = Array.isArray(sh.Extend) ? sh.Extend.map((x) => x === true) : [false, false]
    const gs = this.gs, id = this.page.newId("s"), FAR = 20000
    const stopsText = stops.map((s) => `<stop offset="${n(s.offset)}" stop-color="${s.color || "#000"}"/>`).join("")
    let d: string
    if (sh.ShadingType === 2) {
      const c = numbers(sh.Coords, 4)
      if (!c) return not("its coordinates")
      const [x0, y0, x1, y1] = c
      const len = Math.hypot(x1 - x0, y1 - y0)
      if (!len) return // (a shading of no length paints nothing)
      // the band between the axis's ends (beyond an end that extends), across the whole clipping path
      const ux = (x1 - x0) / len, uy = (y1 - y0) / len
      const ax = x0 - (extend[0] ? FAR * ux : 0), ay = y0 - (extend[0] ? FAR * uy : 0), bx = x1 + (extend[1] ? FAR * ux : 0), by = y1 + (extend[1] ? FAR * uy : 0)
      const px = -uy * FAR, py = ux * FAR
      d = `M${n(ax + px)} ${n(ay + py)}L${n(bx + px)} ${n(by + py)}L${n(bx - px)} ${n(by - py)}L${n(ax - px)} ${n(ay - py)}Z`
      this.page.define(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${n(x0)}" y1="${n(y0)}" x2="${n(x1)}" y2="${n(y1)}">${stopsText}</linearGradient>`)
    } else {
      const c = numbers(sh.Coords, 6)
      if (!c) return not("its coordinates")
      const [x0, y0, r0, x1, y1, r1] = c
      // what an SVG gradient is: the first circle inside the second, painted from the first circle outwards
      if (Math.hypot(x1 - x0, y1 - y0) + r0 > r1) return not("a radial shading whose first circle is not inside its second")
      if (!extend[0] && r0 > 0) return not("a radial shading with an unpainted centre")
      d = extend[1] ? `M${-FAR} ${-FAR}H${FAR}V${FAR}H${-FAR}Z` : `M${n(x1 - r1)} ${n(y1)}a${n(r1)} ${n(r1)} 0 1 0 ${n(2 * r1)} 0a${n(r1)} ${n(r1)} 0 1 0 ${n(-2 * r1)} 0Z`
      this.page.define(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${n(x1)}" cy="${n(y1)}" r="${n(r1)}" fx="${n(x0)}" fy="${n(y0)}" fr="${n(r0)}">${stopsText}</radialGradient>`)
    }
    this.page.emit(`<path d="${d}" transform="${svgMatrix(gs.ctm)}" fill="url(#${id})"${gs.ca !== 1 ? ` fill-opacity="${gs.ca}"` : ""}/>`, gs, "")
  }

  /** `/Name gs`: pgf's ExtGState resources, which it names after what they set (pgfsys-common-pdf.def 67–112,
   *  pgfsys-pdftex.def 305–326): /pgf@CA<v>, /pgf@ca<v>, /pgf@bm<Mode>, /pgfsmask<the mask form's number> */
  private extGState(name: string) {
    let a: RegExpMatchArray | null
    if ((a = name.match(/^\/pgf@(CA|ca)(\d*\.?\d+)$/))) this.set(a[1] === "CA" ? { CA: Number(a[2]) } : { ca: Number(a[2]) })
    else if ((a = name.match(/^\/pgf@bm(\w+)$/)) && BLEND[a[1]] !== undefined) this.set({ blend: BLEND[a[1]] })
    else if ((a = name.match(/^\/pgfsmask(\d+)$/))) {
      // a luminosity soft mask: the form drawn (on black) in the user space of now; what is painted from here on
      // shows as far as the mask is light
      if (!this.page.view.forms?.[Number(a[1])]) return this.page.warn(`the soft mask ${name} (its form is not known): what it fades is drawn unfaded`)
      const id = this.page.newId("m")
      this.page.define(`<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${this.page.width}" height="${this.page.height}">`)
      this.showForm(Number(a[1]), { ...INITIAL, ctm: this.gs.ctm })
      this.page.define("</mask>")
      this.set({ mask: id })
    } else this.page.warn(`the graphics state ${name}`)
  }
}

/** what the operators that are not drawn are, for the warnings */
const OPERATORS: Record<string, string> = {
  Do: "an XObject", BT: "text", ET: "text", Tj: "text", TJ: "text", Tf: "text", Td: "text", Tm: "text", BI: "an inline image", ID: "an inline image", EI: "an inline image",
  cs: "a color space", CS: "a color space", sc: "a color in a color space", SC: "a color in a color space", scn: "a pattern or a color in a color space", SCN: "a pattern or a color in a color space",
}

/** The pages of a layout as SVG */
export function svgPages(trace: Trace, view: PageView, options: SvgOptions = {}): SvgPages {
  const { fonts: webfonts, codes } = webfontData()
  const used = new Set<string>(), warnings = new Set<string>()
  const W = pt(view.paper.width), H = pt(view.paper.height)
  const font = (name: string): [string, number[]] => {
    if (!webfonts[name]) throw new Error(`no web font for ${name}`)
    const [file, vector] = webfonts[name]
    used.add(file)
    return [file, codes[vector]]
  }
  /** the color stack, across pages as pdfTeX's is: its top is the current color */
  const stack: string[] = ["{0 g 0 G}"]
  const pages = trace.pages.map((page, i) => {
    const p = new Page(`l0p${i + 1}`, W, H, view, options, (what) => warnings.add(what), font)
    // the PDF's default user space (bp from the paper's lower left corner) in SVG's; pdfTeX's origin there
    const gs: GState = { ...INITIAL, ctm: [1, 0, 0, -1, 0, view.paper.height * K] }
    const stream = new Stream(p, gs, { glyphs: page.glyphs, rules: page.rules, marks: view.marks[i] ?? [] }, -view.origin.h, view.paper.height - view.origin.v, view.origin.h, view.origin.v, stack, "")
    stream.currentColor()
    stream.draw()
    p.close()
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}pt" height="${H}pt" stroke-miterlimit="10"><rect width="${W}" height="${H}" fill="#fff"/>${p.out.join("")}</svg>`
  })
  return { pages, fonts: [...used].sort(), warnings: [...warnings] }
}
