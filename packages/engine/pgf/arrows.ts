// pgf's arrow tips (pgfcorearrows.code.tex, the path ends in pgfcorepathusage.code.tex; line numbers cite
// those; arrows.meta's tips cite pgflibraryarrows.meta.code.tex). An arrow tip specification is parsed
// into a sequence of tip kinds (\pgfsetarrowsstart, \pgfsetarrowsend). The first use of a tip with a given
// line width and parameters instantiates it (\pgf@arrows@instantiate): its setup code computes its ends
// and convex hull, and its drawing code runs once with the protocol buffered, the literals it writes kept
// as the tip's code. Every use then shortens the path by the tip's length, draws the code in a graphic
// scope under the transformation that points the tip along the path, and adds the hull to the picture.
// The setup and drawing code run in the picture's horizontal list: their stray spaces (\pgfdeclarearrow's
// codes keep the end of line after `{`; \pgfarrowsdeclare's are trimmed) are \glue 0.0 there, and their
// quick lengths' \unskip take a glue off. Tip options other than none, reversed and swapped tips, bending
// and double lines are not modeled.

import { Unsupported } from "../latex/unsupported"
import type { PgfDriver } from "./drivers"
import { TexArith, toNumber } from "./fixed"
import { pgfSetDash, pgfSetFillColor, pgfSetLineWidth } from "./graphicstate"
import { FUNCTIONS, reciprocal, type PgfMathCtx } from "./mathfunctions"
import { TRIGONOMETRIC } from "./mathtrig"
import { invoke, pgfPathClose, pgfPathCurveTo, pgfPathLineTo, pgfPathMoveTo, resetPathSizes } from "./paths"
import { pgfPointNormalised, pointLineAtDistance, qpoint, setLength, type PgfPoint } from "./points"
import { beginPgfScope, endPgfScope } from "./scopes"
import type { PgfState, SoftPathItem } from "./state"
import { mul, pgfLowLevelSyncCm, pgfTransformCm, pgfTransformReset, pgfTransformShift, pgfTransformXShift } from "./transformations"

/** a tip sequence: the tip kinds in order, `.` marking the line's end */
export type PgfTipSequence = readonly string[]

/** the registers and switches a tip's options set (\pgfarrowlength …, \ifpgfarrowroundjoin …) */
interface Params { length: number; width: number; inset: number; lineWidth: number; sep: number; roundCap: boolean; roundJoin: boolean; harpoon: boolean; open: boolean }

/** what instantiating a tip keeps: its ends (\pgf@ar@ends@), its hull (\pgf@ar@hull@), its code (\pgf@ar@cache@) */
interface Instance { tip: number; back: number; line: number; hull: PgfPoint[]; code: string }

/** a tip kind: its default options (immediate ones, then late ones), its parameters, its setup and drawing code */
interface Kind {
  defaults(s: PgfState, p: Params, late: (() => void)[]): void
  /** the parameters part of \pgf@arrow@fullname */
  key(p: Params): string
  /** the setup code: the ends and hull set in `i`; what the drawing code needs, returned */
  setup(s: PgfState, p: Params, i: Instance): number[]
  draw(s: PgfState, d: PgfDriver, p: Params, saved: number[]): void
}

const PT = 65536
const a0 = new TexArith({ em: 0, ex: 0 })
const dimen = (x: string) => a0.dimen(x)
const tn = toNumber

/** pgfmath's internal functions (\pgfmathdivide@ …) on printed numbers; a TeX error would leave material (not modeled) */
function math(s: PgfState) {
  const errors: string[] = []
  const m: PgfMathCtx = { a: new TexArith(s.units), error: (message) => errors.push(message) }
  const done = (r: string) => {
    errors.push(...m.a.errors.splice(0))
    if (errors.length) throw new Unsupported(`pgf: an arrow tip: ${errors[0]}`)
    return r
  }
  return {
    divide: (a: number, b: number) => done(FUNCTIONS.divide.fn(m, [tn(a), tn(b)])),
    sqrt: (a: number) => done(FUNCTIONS.sqrt.fn(m, [tn(a)])),
    atan2: (a: number, b: number) => done(TRIGONOMETRIC.atan2.fn(m, [tn(a), tn(b)])),
    tan: (a: number) => done(TRIGONOMETRIC.tan.fn(m, [tn(a)])),
    reciprocal: (a: string) => done(reciprocal(m, a)),
    sin: (a: number) => done(TRIGONOMETRIC.sin.fn(m, [tn(a)])),
    cos: (a: number) => done(TRIGONOMETRIC.cos.fn(m, [tn(a)])),
  }
}

/** \pgfmathsetlength{+<dimen>}: TeX's assignment, then \unskip */
const quick = (s: PgfState, x: number) => setLength(`+${tn(x)}pt`, s)

/** \pgfarrowssavethe (742–746): the end of line after its last brace is a space */
const savethe = (s: PgfState) => s.space()

/** \pgfarrowsupperhullpoint{x}{y} (761–770): the point, and below the axis its mirror (no harpoon) */
function upperHull(i: Instance, x: number, y: number) {
  i.hull.push({ x, y })
  if (y > 0) i.hull.push({ x, y: -y })
}

/** \pgfusepathqstroke, …qfill, …qfillstroke (pgfcorequick.code.tex 100–122) */
function quickUse(s: PgfState, d: PgfDriver, use: "stroke" | "fill" | "fillstroke") {
  invoke(s, d)
  s.softPath = []
  d[use]()
  resetPathSizes(s)
}

/** `\pgfqpoint{<f1>\reg}{<f2>\reg}` */
const q = (x: number, y: number) => qpoint(x, y)

/**
 * The old arrow declarations (\pgfarrowsdeclare, 1096–1098; their codes 1118–1210): the setup code's
 * extends through quick lengths, the code trimmed of its ends' spaces; the parameter is `0`.
 */
function old(left: (s: PgfState, a: number) => number, right: (s: PgfState, a: number) => number, base: (s: PgfState) => number, draw: (s: PgfState, d: PgfDriver, a: number) => void): Kind {
  return {
    defaults: () => {},
    key: () => "0",
    setup: (s, _p, i) => {
      const a = base(s)
      i.back = quick(s, left(s, a)) // \pgfarrowsleftextend{+…}
      s.space()
      i.tip = quick(s, right(s, a)) // \pgfarrowsrightextend{+…}
      return []
    },
    draw: (s, d) => draw(s, d, base(s)),
  }
}

/** `0.28pt` and .3 of the line width, the unit of stealth and latex (1119–1124) */
const unit28 = (s: PgfState) => dimen("0.28pt") + mul(".3", s.lineWidth)

const KINDS: Record<string, Kind> = {
  // to (1146–1171)
  to: old((s) => dimen("-0.84pt") + mul("-1.3", s.lineWidth), (s) => dimen("0.21pt") + mul(".625", s.lineWidth), () => 0, (s, d) => {
    const a = unit28(s)
    pgfSetLineWidth(s, d, `${tn(mul("0.8", s.lineWidth))}pt`)
    pgfSetDash(s, d, [], "+0pt")
    d.cap("round")
    d.join("round")
    pgfPathMoveTo(s, q(mul("-3", a), mul("4", a)))
    s.space()
    pgfPathCurveTo(s, q(mul("-2.75", a), mul("2.5", a)), q(0, mul("0.25", a)), q(mul("0.75", a), 0))
    s.space()
    pgfPathCurveTo(s, q(0, mul("-0.25", a)), q(mul("-2.75", a), mul("-2.5", a)), q(mul("-3", a), mul("-4", a)))
    s.space()
    quickUse(s, d, "stroke")
  }),
  // stealth (1118–1143)
  stealth: old((_s, a) => mul("-3", a), (_s, a) => mul("5", a), unit28, (s, d, a) => {
    pgfPathMoveTo(s, q(mul("5", a), 0))
    s.space()
    pgfPathLineTo(s, q(mul("-3", a), mul("4", a)))
    s.space()
    pgfPathLineTo(s, q(0, 0))
    s.space()
    pgfPathLineTo(s, q(mul("-3", a), mul("-4", a)))
    s.space()
    quickUse(s, d, "fill")
  }),
  // latex (1196–1222)
  latex: old((_s, a) => mul("-1", a), (_s, a) => mul("9", a), unit28, (s, d, a) => {
    pgfPathMoveTo(s, q(mul("9", a), 0))
    s.space()
    pgfPathCurveTo(s, q(mul("6.3333", a), mul(".5", a)), q(mul("2", a), mul("2", a)), q(mul("-1", a), mul("3.75", a)))
    s.space()
    pgfPathLineTo(s, q(mul("-1", a), mul("-3.75", a)))
    s.space()
    pgfPathCurveTo(s, q(mul("2", a), mul("-2", a)), q(mul("6.3333", a), mul("-.5", a)), q(mul("9", a), 0))
    s.space()
    quickUse(s, d, "fill")
  }),
}

/** \pgfarrowslinewidthdependent{#1}{#2}{#3} (587–606): #1 + #2\pgflinewidth, or with an inner line (a double line)
 *  #1 + #2((1 - #3/2)\pgflinewidth - (#3/2)\pgfinnerlinewidth), each step a register */
function lineWidthDependent(s: PgfState, base: string, factor: string, outer = "0") {
  const inner = s.local.inner
  if (!inner) return dimen(base) + mul(factor, s.lineWidth)
  let xa = s.lineWidth
  xa += mul(outer, mul("-.5", s.lineWidth))
  xa += mul(outer, mul("-.5", inner.width))
  return dimen(base) + mul(factor, xa)
}
/** \pgfarrowslengthdependent{#1}{#2}{#3} (609–613): #1 + #2\pgfarrowlength + #3\pgflinewidth */
const lengthDependent = (s: PgfState, p: Params, base: string, factor: string, lw: string) => dimen(base) + mul(factor, p.length) + mul(lw, s.lineWidth)

/** the parameters of Latex, Stealth and Computer Modern Rightarrow (`parameters = {…}`) */
const metaKey = (p: Params, inset: boolean, flags: string) => `${tn(p.lineWidth)},${tn(p.length)},${tn(p.width)},${inset ? `${tn(p.inset)},` : ""}${flags}`

/** a miter's factor (Latex, Stealth): sqrt(1 + k·(a/b)²), each step a register */
function miter(m: ReturnType<typeof math>, a: number, b: number, k: string): string {
  const quot = m.divide(a, b)
  let x = dimen(`${quot}pt`)
  x = mul(quot, x)
  x = mul(k, x)
  x += PT
  return m.sqrt(x)
}

// arrows.meta (pgflibraryarrows.meta.code.tex)
const META: Record<string, Kind> = {
  // Computer Modern Rightarrow (663–758)
  "Computer Modern Rightarrow": {
    defaults: (s, p, late) => {
      p.length = lineWidthDependent(s, "1.6pt", "2.2")
      late.push(() => { p.width = lengthDependent(s, p, "0.0pt", "2.096774", "0") })
      late.push(() => { p.lineWidth = lineWidthDependent(s, "0.0pt", "1", "1") })
      p.roundCap = p.roundJoin = true
    },
    key: (p) => metaKey(p, false, `${p.roundJoin ? "j" : ""}${p.roundCap ? "c" : ""}`),
    setup: (s, p, i) => {
      s.space()
      const a = p.length - p.lineWidth, b = p.width - p.lineWidth
      savethe(s)
      savethe(s)
      if (!p.roundJoin) throw new Unsupported("pgf: Computer Modern Rightarrow with a miter join")
      i.tip = mul(".5", p.lineWidth)
      i.line = mul("-.5", p.lineWidth)
      i.back = -a + mul("-.5", p.lineWidth)
      i.hull.push({ x: mul(".5", p.lineWidth), y: mul(".5", p.lineWidth) }, { x: mul(".5", p.lineWidth), y: mul("-.5", p.lineWidth) })
      upperHull(i, -a + mul(".5", p.lineWidth), mul(".5", b) + mul(".5", p.lineWidth))
      upperHull(i, -a + mul("-.5", p.lineWidth), mul(".5", b) + mul(".5", p.lineWidth))
      return [a, b]
    },
    draw: (s, d, p, [a, b]) => {
      s.space()
      pgfSetDash(s, d, [], "+0pt")
      d.cap(p.roundCap ? "round" : "butt")
      d.join(p.roundJoin ? "round" : "miter")
      if (p.lineWidth !== s.lineWidth) pgfSetLineWidth(s, d, `+${tn(p.lineWidth)}pt`)
      pgfPathMoveTo(s, q(-a, mul(".5", b)))
      s.space()
      pgfPathCurveTo(s, q(mul("-0.81731", a), mul(".2", b)), q(mul("-0.41019", a), mul("0.05833333", b)), q(0, 0))
      s.space()
      pgfPathCurveTo(s, q(mul("-0.41019", a), mul("-0.05833333", b)), q(mul("-0.81731", a), mul("-.2", b)), q(-a, mul("-.5", b)))
      s.space()
      quickUse(s, d, "stroke")
    },
  },
  // Latex (809–900)
  Latex: {
    defaults: (s, p, late) => {
      p.length = lineWidthDependent(s, "3.0pt", "4.5", ".8")
      late.push(() => { p.width = lengthDependent(s, p, "0.0pt", ".75", "0") })
      late.push(() => { p.lineWidth = lineWidthDependent(s, "0.0pt", "1", "1") })
    },
    key: (p) => metaKey(p, false, `${p.roundJoin ? "j" : ""}`),
    setup: (s, p, i) => {
      s.space()
      const x = mul(".2", p.length)
      if (x < p.lineWidth) p.lineWidth = x
      savethe(s)
      const m = math(s)
      const xc = mul(miter(m, p.length, p.width, "9"), p.lineWidth)
      let a = p.length
      a += mul("-.5", xc)
      a += mul("-.5", p.lineWidth)
      i.back = mul("-.5", p.lineWidth)
      s.space()
      i.line = 0
      s.space()
      if (p.roundJoin) throw new Unsupported("pgf: Latex with a round join")
      i.tip = p.length + mul("-.5", p.lineWidth)
      s.space()
      savethe(s)
      const n = pgfPointNormalised({ x: mul(".3", p.length), y: mul(".2333333", p.width) }, s.units)
      const yc = n.y + PT, xc2 = n.x
      let b = mul(m.divide(yc, xc2), p.lineWidth)
      b = mul("-.5", b)
      b += mul(".5", p.width)
      savethe(s)
      i.hull.push({ x: p.length + mul("-.5", p.lineWidth), y: 0 }, { x: mul("-.5", p.lineWidth), y: mul(".5", p.width) }, { x: mul("-.5", p.lineWidth), y: mul("-.5", p.width) })
      return [a, b]
    },
    draw: (s, d, p, [a, b]) => {
      s.space()
      pgfSetDash(s, d, [], "+0pt")
      d.join(p.roundJoin ? "round" : "miter")
      if (p.lineWidth !== s.lineWidth) pgfSetLineWidth(s, d, `+${tn(p.lineWidth)}pt`)
      pgfPathMoveTo(s, q(a, 0))
      s.space()
      pgfPathCurveTo(s, q(mul(".877192", a), mul(".077922", b)), q(mul(".337381", a), mul(".519480", b)), q(0, b))
      s.space()
      pgfPathLineTo(s, q(0, -b))
      s.space()
      pgfPathCurveTo(s, q(mul(".337381", a), mul("-.519480", b)), q(mul(".877192", a), mul("-.077922", b)), q(a, 0))
      s.space()
      pgfPathClose(s)
      quickUse(s, d, p.open ? "stroke" : p.lineWidth > 0 ? "fillstroke" : "fill")
    },
  },
  // Stealth (903–1028)
  Stealth: {
    defaults: (s, p, late) => {
      p.length = lineWidthDependent(s, "3.0pt", "4.5", ".8")
      late.push(() => { p.width = lengthDependent(s, p, "0.0pt", ".75", "0") })
      late.push(() => { p.inset = lengthDependent(s, p, "0.0pt", "0.325", "0") })
      late.push(() => { p.lineWidth = lineWidthDependent(s, "0.0pt", "1", "1") })
    },
    key: (p) => metaKey(p, true, `${p.roundJoin ? "j" : ""}`),
    setup: (s, p, i) => {
      s.space()
      let x = p.length - p.inset
      x = mul(".25", x)
      if (x < p.lineWidth) p.lineWidth = x
      const m = math(s)
      // front miter
      let xc = mul(miter(m, p.length, p.width, "4"), p.lineWidth)
      xc = mul(".5", xc)
      // back miter
      let ya = mul(".5", p.width)
      let yb = dimen(`${m.atan2(p.length, ya)}pt`)
      ya = dimen(`${m.atan2(p.inset, ya)}pt`)
      yb -= ya
      yb = mul(".5", yb)
      let yc = mul(m.reciprocal(m.tan(yb)), p.lineWidth)
      yc = mul(".5", yc)
      ya += yb
      const sin = m.sin(ya), cos = m.cos(ya)
      ya = mul(sin, yc)
      yb = mul(cos, yc)
      if (p.inset === 0) ya = mul(".5", p.lineWidth)
      // inset miter
      yc = mul(miter(m, p.inset, p.width, "4"), p.lineWidth)
      yc = mul(".5", yc)
      const a = p.length - xc - ya
      const b = mul(".5", p.width) - yb
      if (p.roundJoin) throw new Unsupported("pgf: Stealth with a round join")
      i.back = 0
      s.space()
      i.line = p.inset + yc + mul("-.25", p.lineWidth)
      s.space()
      i.tip = p.length
      s.space()
      i.hull.push({ x: p.length, y: 0 })
      upperHull(i, 0, mul(".5", p.width))
      i.hull.push({ x: p.inset, y: 0 })
      s.space() // \pgfarrowssetvisualbackend
      p.inset += yc
      for (let k = 0; k < 5; k++) savethe(s)
      return [a, b, ya]
    },
    draw: (s, d, p, [a, b, ya]) => {
      s.space()
      pgfSetDash(s, d, [], "+0pt")
      d.join(p.roundJoin ? "round" : "miter")
      if (p.lineWidth !== s.lineWidth) pgfSetLineWidth(s, d, `+${tn(p.lineWidth)}pt`)
      pgfPathMoveTo(s, q(a + ya, 0))
      s.space()
      pgfPathLineTo(s, q(ya, b))
      s.space()
      pgfPathLineTo(s, q(p.inset, 0))
      s.space()
      pgfPathLineTo(s, q(ya, -b))
      s.space()
      pgfPathClose(s)
      quickUse(s, d, p.open ? "stroke" : p.lineWidth > 0 ? "fillstroke" : "fill")
    },
  },
}

/** what pgf has declared: the tip kinds, the shorthands (`means`) and the start names (\pgf@ar@start@) */
interface Registry { kinds: Record<string, Kind>; means: Record<string, string>; start: Record<string, string>; cache: Map<string, Instance> }

const registries = new WeakMap<PgfState, Registry>()
function registry(s: PgfState): Registry {
  let r = registries.get(s)
  if (!r) {
    // pgfcorearrows.code.tex 1069–1079, 1145, 1185, 1222: `<->`, `>-<`, `|` and To, Bar
    r = {
      kinds: { ...KINDS }, cache: new Map(),
      means: { ">": "To", "<": ">[reversed]", To: "to" },
      start: { "<": ">", ">": "<", to: "to", stealth: "stealth", latex: "latex", To: "To" },
    }
    registries.set(s, r)
  }
  return r
}

/** the tips and their instances one state has, for another: \pgf@ar@cache@… are global, one set for a document's pictures */
export function shareArrows(from: PgfState, to: PgfState) { registries.set(to, registry(from)) }

/** \usetikzlibrary{arrows.meta} (\usepgflibrary): its tips, `LaTeX` and To as Computer Modern Rightarrow (1592–1598) */
export function pgfArrowsMeta(s: PgfState) {
  const r = registry(s)
  Object.assign(r.kinds, META)
  for (const k of Object.keys(META)) r.start[k] = k
  Object.assign(r.means, { LaTeX: "Latex", To: "Computer Modern Rightarrow" })
  r.start.LaTeX = "LaTeX"
}

/**
 * The tip kinds a shorthand or kind name stands for (\pgf@arrow@handle@shorthand@empty: the shorthand's
 * sequence, parsed when it was declared)
 */
function expand(r: Registry, name: string): string[] {
  if (r.kinds[name]) return [name]
  const m = r.means[name]
  if (m === undefined) throw new Unsupported(`pgf: unknown arrow tip kind ${name}`)
  return parseSpec(r, m, false)
}

/**
 * \pgfarrows@parser (297–368): the names up to each `[` (a known kind or shorthand, else its first
 * character alone), their options, `.` for the line's end. With `start`, the names are translated to the
 * end names (\pgf@arrow@swapper) and the sequence reversed.
 */
function parseSpec(r: Registry, spec: string, start: boolean): string[] {
  const out: string[][] = []
  let rest = `${spec}[]`
  const known = (n: string) => r.kinds[n] !== undefined || r.means[n] !== undefined
  const swap = (n: string) => (start ? r.start[n] ?? "undefined" : n)
  while (rest !== "") {
    const open = rest.indexOf("[")
    if (open < 0) break
    let name = rest.slice(0, open).trim()
    const close = rest.indexOf("]", open)
    let options = rest.slice(open + 1, close)
    rest = rest.slice(close + 1)
    if (name === "") { if (options.trim() !== "") throw new Unsupported("pgf: arrow tip options"); continue }
    if (name !== "." && !known(swap(name))) {
      // \pgf@arrows@single@char@parser: the first character, without options; the rest is parsed on
      rest = `${name.slice(1)}[${options}]${rest}`
      name = name[0]
      options = ""
      if (name !== "." && !known(swap(name))) throw new Unsupported(`pgf: unknown arrow tip kind ${name}`)
    }
    if (options.trim() !== "") throw new Unsupported("pgf: arrow tip options")
    out.push(name === "." ? ["."] : expand(r, swap(name)))
  }
  if (start) out.reverse()
  return out.flat()
}

/** \pgfsetarrowsstart{#1} (436–447) */
export function pgfSetArrowsStart(s: PgfState, spec: string) { s.setLocal({ startTips: parseSpec(registry(s), spec, true) }) }
/** \pgfsetarrowsend{#1} (272–283) */
export function pgfSetArrowsEnd(s: PgfState, spec: string) { s.setLocal({ endTips: parseSpec(registry(s), spec, false) }) }
/** \pgfsetarrows{#1-#2} (1016–1020), without options */
export function pgfSetArrows(s: PgfState, spec: string) {
  const dash = spec.indexOf("-")
  if (spec.trimStart().startsWith("[") || dash < 0) throw new Unsupported(`pgf: \\pgfsetarrows{${spec}}`)
  pgfSetArrowsStart(s, spec.slice(0, dash))
  pgfSetArrowsEnd(s, spec.slice(dash + 1))
}
/** \pgfsetshortenstart{#1}, \pgfsetshortenend{#1} (pgfcorepathusage.code.tex 288–289) */
export function pgfSetShortenStart(s: PgfState, x: string) { s.setLocal({ shortenStart: setLength(x, s) }) }
export function pgfSetShortenEnd(s: PgfState, x: string) { s.setLocal({ shortenEnd: setLength(x, s) }) }

/**
 * \pgfarrows@getid{#1}{#2} (632–652): the tip's options run (defaults, then the late ones), and the tip
 * instantiated (654–702) if its full name (\pgf@arrow@fullname: kind, line width, parameters) is new.
 */
function getId(s: PgfState, d: PgfDriver, name: string): { i: Instance; p: Params } {
  const r = registry(s)
  const kind = r.kinds[name]
  const p: Params = { length: 0, width: 0, inset: 0, lineWidth: 0, sep: 0, roundCap: false, roundJoin: false, harpoon: false, open: false }
  const late: (() => void)[] = []
  kind.defaults(s, p, late)
  for (const f of late) f()
  const key = `${name}@${tn(s.lineWidth)}@0.0pt@@@@${kind.key(p)}`
  const cached = r.cache.get(key)
  if (cached) return { i: cached, p }
  const i: Instance = { tip: 0, back: 0, line: 0, hull: [], code: "" }
  s.begingroup()
  const saved = kind.setup(s, p, i)
  // the code, protocolled once (\pgfinterruptpath: the path and its sizes kept aside)
  const outer = s.protocol
  s.begingroup()
  const path = s.softPath, sizes = s.path, last = s.last, lastMoveTo = s.lastMoveTo
  s.softPath = []
  s.setLocal({ relevant: false })
  pgfTransformReset(s)
  s.protocol = ""
  s.sw.buffered = true
  beginPgfScope(s, d)
  kind.draw(s, d, p, saved)
  endPgfScope(s, d)
  i.code = s.protocol
  s.softPath = path
  s.path = sizes
  s.last = last
  s.lastMoveTo = lastMoveTo
  s.endgroup()
  s.protocol = outer
  s.endgroup()
  r.cache.set(key, i)
  s.space() // (the end of line after \pgf@arrows@instantiate{#1})
  return { i, p }
}

/**
 * \pgf@arrow@compute@shortening (790–825): the path's shortening (\pgf@xa: from the tip to the line end,
 * or to the back end after `.`) and the sequence's length (\pgf@xb), each tip's getid in a group.
 */
function shortening(s: PgfState, d: PgfDriver, tips: PgfTipSequence): { xa: number; xb: number } {
  let xa = 0, xb = 0, after = false
  for (const t of tips) {
    if (t === ".") { after = true; continue }
    s.begingroup()
    const { i, p } = getId(s, d, t)
    s.endgroup()
    xb += i.tip
    xb -= i.back
    xb += p.sep
    if (after) xa += i.tip + p.sep - i.back
    else xa = i.tip + p.sep - i.line
  }
  return { xa, xb }
}

/** \pgf@arrow@drawer (887–913): one tip, its back end at the origin, in a graphic scope under the synced transformation; the hull into the picture */
function drawTip(s: PgfState, d: PgfDriver, name: string) {
  s.begingroup()
  const { i, p } = getId(s, d, name)
  // \pgf@arrow@drawer@shift (939–944)
  pgfTransformXShift(s, `${tn(-i.back)}pt`)
  const xc = i.tip + p.sep - i.back
  s.begingroup()
  beginPgfScope(s, d)
  // \pgf@arrows@color@setup (925–937): the fill colour pgfstrokecolor (a name)
  if (s.strokeColor !== s.fillColor) pgfSetFillColor(d, s.strokeColor.slice(s.strokeColor.indexOf("|") + 1), true)
  pgfLowLevelSyncCm(s, d)
  d.protocolLiteral(i.code)
  endPgfScope(s, d)
  hull(s, i.hull)
  s.endgroup()
  s.endgroup()
  pgfTransformXShift(s, `${tn(xc)}pt`)
}

/** \pgf@arrows@rigid@hull, \pgf@arrow@hull@point@first/@other, \pgf@arrow@update@bb (946–1009) */
function hull(s: PgfState, points: PgfPoint[]) {
  if (!s.local.relevant || points.length === 0) return
  const t = s.local.transform
  let xa = 0, ya = 0, xb = 0, yb = 0
  points.forEach(({ x, y }, k) => {
    const X = mul(t.aa, x) + mul(t.ba, y), Y = mul(t.ab, x) + mul(t.bb, y)
    if (k === 0) { xa = xb = X; ya = yb = Y; return }
    if (X < xa) xa = X
    else if (X > xb) xb = X
    if (Y < ya) ya = Y
    else if (Y > yb) yb = Y
  })
  xa += t.x; ya += t.y; xb += t.x; yb += t.y
  const pic = s.picture
  if (pic.maxX === -16000 * PT) Object.assign(pic, { minX: xa, maxX: xb, minY: ya, maxY: yb })
  else {
    if (xa < pic.minX) pic.minX = xa
    if (ya < pic.minY) pic.minY = ya
    if (xb > pic.maxX) pic.maxX = xb
    if (yb > pic.maxY) pic.maxY = yb
  }
}

/** \pgf@arrow@draw@arrow (876–885): the sequence, its tip at the origin */
function drawArrow(s: PgfState, d: PgfDriver, tips: PgfTipSequence, total: number) {
  s.begingroup()
  pgfTransformXShift(s, `${tn(-total)}pt`)
  for (const t of tips) if (t !== ".") drawTip(s, d, t)
  s.endgroup()
}

/** \pgf@do@draw@straightend, …start: the arrow from `from` to `at` (\pgftransformarrow, pgfcoretransformations.code.tex 606–621) */
function drawAt(s: PgfState, d: PgfDriver, tips: PgfTipSequence, total: number, from: PgfPoint, at: PgfPoint) {
  s.begingroup()
  pgfTransformReset(s)
  pgfTransformShift(s, qpoint(at.x, at.y))
  const n = pgfPointNormalised({ x: at.x - from.x, y: at.y - from.y }, s.units)
  pgfTransformCm(s, tn(n.x), tn(n.y), tn(-n.y), tn(n.x), qpoint(0, 0))
  drawArrow(s, d, tips, total)
  s.endgroup()
}

/** an end of the path, as \pgf@prepare@…@of@path leaves it for drawing the tip */
export interface PathEnd { tips: PgfTipSequence; total: number; from: PgfPoint; at: PgfPoint }

const endPoint = (i: SoftPathItem): PgfPoint => ("x" in i ? { x: i.x, y: i.y } : { x: 0, y: 0 })
const same = (a: PgfPoint, b: PgfPoint) => a.x === b.x && a.y === b.y

/** \pgfpointlineatdistance from `at` towards `ref` */
function lineAt(s: PgfState, distance: number, at: PgfPoint, ref: PgfPoint): PgfPoint {
  const r = pointLineAtDistance(`${tn(distance)}pt`, at, ref, s.units)
  if (r.errors.length) throw new Unsupported(`pgf: shortening a path: ${r.errors[0]}`)
  return r.point
}

/**
 * \pgf@prepare@end@of@path (348–399): the last subpath's end shortened by the tips' length and the
 * shortening asked for; the point before it (on a curve its second control point, or before that when
 * they coincide) gives the tip's direction.
 */
export function prepareEndOfPath(s: PgfState, d: PgfDriver): PathEnd | null {
  if (s.softPath.length === 0) return null
  const tips = s.local.endTips
  let worry = tips.length > 0
  let { xa, xb } = shortening(s, d, tips)
  xa += s.local.shortenEnd
  xb += s.local.shortenEnd
  if (xa !== 0) worry = true
  if (!worry) return null
  const path = s.softPath
  const k = path.length - 1
  const lastItem = path[k]
  let lastMove = k
  while (path[lastMove].op !== "moveto") lastMove--
  const at = endPoint(lastItem)
  if (k === lastMove) return { tips, total: xb, from: at, at }
  const before = endPoint(path[k - 1])
  let ref: PgfPoint
  if (lastItem.op === "curveto") {
    const second = { x: lastItem.x2, y: lastItem.y2 }, third = { x: lastItem.x1, y: lastItem.y1 }
    ref = !same(at, second) ? second : same(at, third) ? before : third
  } else if (lastItem.op === "lineto") ref = before
  else throw new Unsupported("pgf: an arrow tip on this path")
  const p = lineAt(s, xa, at, ref)
  if (xa !== 0) s.softPath = [...path.slice(0, k), { ...lastItem, x: p.x, y: p.y }]
  return { tips, total: xb, from: ref, at }
}

/**
 * \pgf@prepare@start@of@path (497–537): the last subpath's start shortened likewise, towards its second
 * point (the third when they coincide), whose token takes that reference point's coordinates.
 */
export function prepareStartOfPath(s: PgfState, d: PgfDriver): PathEnd | null {
  if (s.softPath.length === 0) return null
  const tips = s.local.startTips
  let worry = tips.length > 0
  let { xa, xb } = shortening(s, d, tips)
  xa += s.local.shortenStart
  xb += s.local.shortenStart
  if (xa !== 0) worry = true
  if (!worry) return null
  const path = s.softPath
  let j = path.length - 1
  while (path[j].op !== "moveto") j--
  const first = endPoint(path[j])
  const next = path[j + 1]
  if (!next) return { tips, total: xb, from: first, at: first }
  let ref: PgfPoint
  if (next.op === "curveto") {
    const second = { x: next.x1, y: next.y1 }, third = { x: next.x2, y: next.y2 }
    ref = !same(first, second) ? second : same(first, third) ? endPoint(next) : third
  } else if (next.op === "lineto") ref = endPoint(next)
  else throw new Unsupported("pgf: an arrow tip on this path")
  const p = lineAt(s, xa, first, ref)
  if (xa !== 0) {
    const moved = next.op === "curveto" ? { ...next, x1: ref.x, y1: ref.y } : { ...next, x: ref.x, y: ref.y }
    s.softPath = [...path.slice(0, j), { op: "moveto", x: p.x, y: p.y }, moved, ...path.slice(j + 2)]
  }
  return { tips, total: xb, from: ref, at: first }
}

/** \pgf@add@arrow@at@start, …at@end (618–627, 443–449) */
export function addArrow(s: PgfState, d: PgfDriver, e: PathEnd | null) {
  if (e && e.tips.length) drawAt(s, d, e.tips, e.total, e.from, e.at)
}
