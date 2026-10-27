// pgf's shapes and nodes (pgfmoduleshapes.code.tex, line numbers cite it): \pgfnode and \pgfmultipartnode
// with the coordinate, rectangle and circle shapes, the named nodes and their anchors (\pgfpointanchor,
// \pgfpointshapeborder), and the text boxes pgfcorescopes.code.tex places in a picture (\pgfqboxsynced,
// \pgftext). A shape's saved anchors are computed once, when the node is made, from its text box and the
// keys; its anchors from them, each time one is asked for. Several anchors and background paths begin (or
// end) with an end of line that is a space, which lands in the picture as a \glue 0.0 wherever TeX
// evaluates them: the code below emits each one where pgf's source has it. The text itself is typeset by
// the engine through a callback (PgfText), in restricted horizontal mode, in the font the picture began in
// (\pgfinterruptpicture's \pgfutil@selectfont). A node's position is not remembered across pictures
// (`remember picture`), so a node of another picture is used as if it were in this one, as TeX does when
// no position was recorded.

import type { BoxNode, Node } from "../layout/nodes"
import { hpack } from "../layout/pack"
import { Unsupported } from "../latex/unsupported"
import type { PgfDriver } from "./drivers"
import { TexArith, toNumber } from "./fixed"
import { pgfPathCircle, pgfPathRectangleCorners, protocolSizes } from "./paths"
import { parse, pgfPointAdd, pgfPointBorderEllipse, pgfPointBorderRectangle, pgfPointNormalised, pgfPointScale, setLength, trig, type PgfPoint, type PgfPointMacro } from "./points"
import type { PgfState, PgfTransform } from "./state"
import { applyTransform, mul, pgfLowLevelSyncCm, pgfTransformInvert, pgfTransformRotate, pgfTransformShift, pgfTransformXShift, pgfTransformYShift, transformPoint } from "./transformations"

/** What pgf needs of the engine: TeX text in restricted horizontal mode, as the list \hbox{…} would hold. */
export interface PgfText { hlist(src: string): Node[] }

/** The keys a shape reads (/pgf/inner xsep …), as \pgfkeysvalueof gives them when the node is made. */
export interface PgfShapeKeys { innerXSep: string; innerYSep: string; outerXSep: string; outerYSep: string; minimumWidth: string; minimumHeight: string }

/** their initial values (898–906) */
export const SHAPE_KEYS: PgfShapeKeys = { innerXSep: ".3333em", innerYSep: ".3333em", outerXSep: ".5\\pgflinewidth", outerYSep: ".5\\pgflinewidth", minimumWidth: "1pt", minimumHeight: "1pt" }

/**
 * \pgfmathsetlength of a key's value (`\pgfmathsetlength\pgf@xc{\pgfkeysvalueof{…}}`): parsed always, since
 * the quick test sees \pgfkeysvalueof's first expansion, not a `+`. pgfmath reads a register after a
 * number as their product (`\pgfmath@dimen=<number><register>`, pgfmathparser.code.tex 440–445):
 * \pgflinewidth is the one a shape's keys hold (outer sep's initial value); others are not modeled.
 */
function keyLength(s: PgfState, value: string): number {
  const m = value.match(/^\s*([-+]?(?:\d*\.?\d*))\s*\\pgflinewidth\s*$/)
  if (m) return mul(m[1] === "" || m[1] === "+" || m[1] === "-" ? `${m[1]}1` : m[1], s.lineWidth)
  if (value.includes("\\")) throw new Unsupported(`pgf: the key value ${value}`)
  return new TexArith(s.units).dimen(`${parse(value, s.units)}pt`)
}

/** the size of a node's text box (\wd, \ht, \dp of \pgfnodeparttextbox; 0pt for a void box) */
interface TextSize { w: number; h: number; d: number }

/** what \savedanchor and \saveddimen keep (\pgf@sh@savedpoints): points and dimensions */
type Saved = Record<string, PgfPoint | number>

/** an anchor's code, run on the saved points; it leaves its point in \pgf@x, \pgf@y */
type Anchor = (s: PgfState, v: Saved) => PgfPoint

interface Shape {
  /** \savedanchor, \saveddimen (\pgf@sh@s@<shape>), in order */
  save(s: PgfState, t: TextSize, keys: PgfShapeKeys): Saved
  anchors: Record<string, Anchor>
  /** \anchorborder: the point on the border in direction `dir` (\pgf@x, \pgf@y as the code starts) */
  border(s: PgfState, v: Saved, dir: PgfPoint): PgfPoint
  /** \backgroundpath */
  background?(s: PgfState, v: Saved, keys: PgfShapeKeys): void
  /** \nodeparts */
  parts: string[]
}

const pt = (v: Saved, name: string) => v[name] as PgfPoint
const dim = (v: Saved, name: string) => v[name] as number
const half = (x: number) => mul(".5", x)
/** `\pgfmathsetlength\pgf@y{.5ex}` */
const midY = (s: PgfState) => setLength(".5ex", s)

/** the coordinate shape (847–883): a point, every anchor its centre */
const coordinate: Shape = {
  save: (_s, t) => ({ centerpoint: { x: half(t.w), y: half(t.h) + mul("-.5", t.d) } }),
  anchors: Object.fromEntries(
    ["center", "north", "north west", "north east", "west", "east", "mid", "mid west", "mid east", "base", "base west", "base east", "south", "south west", "south east"]
      .map((a): [string, Anchor] => [a, (_s, v) => pt(v, "centerpoint")]),
  ),
  border: (_s, v) => pt(v, "centerpoint"),
  parts: [],
}

/** the rectangle's corner (\northeast 938–976, \southwest 978–1018): `sign` 1 for the north east, -1 for the south west */
function rectangleCorner(s: PgfState, t: TextSize, keys: PgfShapeKeys, sign: 1 | -1): PgfPoint {
  const neg = sign < 0 ? "-" : ""
  let x = t.w
  const xc = keyLength(s, keys.innerXSep)
  x += mul("2", xc)
  const xb = keyLength(s, keys.minimumWidth)
  if (x < xb) x = xb
  x = mul(`${neg}.5`, x)
  x += half(t.w)
  const xa = keyLength(s, keys.outerXSep)
  x += sign * xa
  let y = t.h + t.d
  const yc = keyLength(s, keys.innerYSep)
  y += mul("2", yc)
  const yb = keyLength(s, keys.minimumHeight)
  if (y < yb) y = yb
  y = mul(`${neg}.5`, y)
  y += mul("-.5", t.d)
  y += half(t.h)
  const ya = keyLength(s, keys.outerYSep)
  y += sign * ya
  return { x, y }
}

const rcenter: Anchor = (s, v) => {
  s.space()
  const ne = pt(v, "northeast"), sw = pt(v, "southwest")
  const xa = half(ne.x), ya = half(ne.y)
  return { x: half(sw.x) + xa, y: half(sw.y) + ya }
}

/** the rectangle shape (936–1109) */
const rectangle: Shape = {
  save: (s, t, keys) => ({ northeast: rectangleCorner(s, t, keys, 1), southwest: rectangleCorner(s, t, keys, -1) }),
  anchors: {
    center: rcenter,
    mid: (s, v) => ({ x: rcenter(s, v).x, y: midY(s) }),
    base: (s, v) => ({ x: rcenter(s, v).x, y: 0 }),
    north: (s, v) => { s.space(); const xa = half(pt(v, "southwest").x), ne = pt(v, "northeast"); return { x: half(ne.x) + xa, y: ne.y } },
    south: (s, v) => { s.space(); const xa = half(pt(v, "northeast").x), sw = pt(v, "southwest"); return { x: half(sw.x) + xa, y: sw.y } },
    west: (s, v) => { s.space(); const ya = half(pt(v, "northeast").y), sw = pt(v, "southwest"); return { x: sw.x, y: half(sw.y) + ya } },
    "mid west": (s, v) => ({ x: pt(v, "southwest").x, y: midY(s) }),
    "base west": (_s, v) => ({ x: pt(v, "southwest").x, y: 0 }),
    "north west": (s, v) => { s.space(); return { x: pt(v, "southwest").x, y: pt(v, "northeast").y } },
    "south west": (_s, v) => pt(v, "southwest"),
    east: (_s, v) => { const ya = half(pt(v, "southwest").y), ne = pt(v, "northeast"); return { x: ne.x, y: half(ne.y) + ya } },
    "mid east": (s, v) => ({ x: pt(v, "northeast").x, y: midY(s) }),
    "base east": (_s, v) => ({ x: pt(v, "northeast").x, y: 0 }),
    "north east": (_s, v) => pt(v, "northeast"),
    "south east": (s, v) => { s.space(); return { x: pt(v, "northeast").x, y: pt(v, "southwest").y } },
  },
  // (1079–1100)
  border: (_s, v, dir) => {
    const sw = pt(v, "southwest"), ne = pt(v, "northeast")
    const xc = half(ne.x - sw.x), yc = half(ne.y - sw.y)
    const p = pgfPointBorderRectangle(dir, { x: xc, y: yc })
    return { x: p.x + sw.x + xc, y: p.y + sw.y + yc }
  },
  // (1105–1109): the end of line after `{` and after the second argument are spaces
  background: (s, v, keys) => {
    s.space()
    // \pgfpoint{\pgfkeysvalueof{/pgf/outer xsep}}{…}
    const outer = (): PgfPoint => ({ x: keyLength(s, keys.outerXSep), y: keyLength(s, keys.outerYSep) })
    pgfPathRectangleCorners(s, () => pgfPointAdd(pt(v, "southwest"), outer()), () => pgfPointAdd(pt(v, "northeast"), pgfPointScale("-1", outer(), s.units)))
    s.space()
  },
  parts: ["text"],
}

/** the circle's corner anchors (1278–1301): the centre and 0.707107 of the radius each way; the end of line after `{` is a space */
const diagonal = (sx: string, sy: string): Anchor => (s, v) => {
  s.space()
  const c = pt(v, "centerpoint"), r = dim(v, "radius")
  return { x: c.x + mul(`${sx}0.707107`, r), y: c.y + mul(`${sy}0.707107`, r) }
}

/** the circle shape (1187–1330) */
const circle: Shape = {
  save: (s, t, keys) => {
    const centerpoint = { x: half(t.w), y: half(t.h) + mul("-.5", t.d) }
    // \radius (1197–1263)
    let ya = half(t.h) + half(t.d)
    ya += keyLength(s, keys.innerYSep)
    let xa = half(t.w)
    xa += keyLength(s, keys.innerXSep)
    const n = pgfPointNormalised({ x: xa, y: ya }, s.units)
    const a = new TexArith(s.units)
    if (n.x > n.y) {
      let counta = n.x
      if (counta !== 0) {
        counta = a.divide(counta, 255)
        xa = mul("16", xa)
        if (counta === 0) throw new Unsupported("pgf: a division by zero")
        xa = a.divide(xa, counta)
        xa = mul("16", xa)
      }
    } else {
      let counta = n.y
      if (counta !== 0) {
        counta = a.divide(counta, 255)
        ya = mul("16", ya)
        if (counta === 0) throw new Unsupported("pgf: a division by zero")
        ya = a.divide(ya, counta)
        xa = mul("16", ya)
      }
    }
    let x = xa
    let xb = keyLength(s, keys.minimumWidth), yb = keyLength(s, keys.minimumHeight)
    if (x < half(xb)) x = half(xb)
    if (x < half(yb)) x = half(yb)
    xb = keyLength(s, keys.outerXSep); yb = keyLength(s, keys.outerYSep)
    x += xb < yb ? yb : xb
    return { centerpoint, radius: x }
  },
  anchors: {
    center: (_s, v) => pt(v, "centerpoint"),
    mid: (s, v) => ({ x: pt(v, "centerpoint").x, y: midY(s) }),
    base: (_s, v) => ({ x: pt(v, "centerpoint").x, y: 0 }),
    north: (_s, v) => ({ x: pt(v, "centerpoint").x, y: pt(v, "centerpoint").y + dim(v, "radius") }),
    south: (_s, v) => ({ x: pt(v, "centerpoint").x, y: pt(v, "centerpoint").y - dim(v, "radius") }),
    west: (_s, v) => ({ x: pt(v, "centerpoint").x - dim(v, "radius"), y: pt(v, "centerpoint").y }),
    east: (_s, v) => ({ x: pt(v, "centerpoint").x + dim(v, "radius"), y: pt(v, "centerpoint").y }),
    "mid west": (s, v) => ({ x: pt(v, "centerpoint").x - dim(v, "radius"), y: midY(s) }),
    "mid east": (s, v) => ({ x: pt(v, "centerpoint").x + dim(v, "radius"), y: midY(s) }),
    "base west": (_s, v) => ({ x: pt(v, "centerpoint").x - dim(v, "radius"), y: 0 }),
    "base east": (_s, v) => ({ x: pt(v, "centerpoint").x + dim(v, "radius"), y: 0 }),
    "north west": diagonal("-", ""),
    "south west": diagonal("-", "-"),
    "north east": diagonal("", ""),
    "south east": diagonal("", "-"),
  },
  // (1302–1317)
  border: (s, v, dir) => {
    const r = dim(v, "radius")
    const p = pgfPointBorderEllipse(() => dir, { x: r, y: r }, s.units)
    const c = pt(v, "centerpoint")
    return { x: c.x + p.x, y: c.y + p.y }
  },
  // (1322–1331): the radius less the larger outer separation
  background: (s, v, keys) => {
    let r = dim(v, "radius")
    const xb = keyLength(s, keys.outerXSep), yb = keyLength(s, keys.outerYSep)
    r -= xb < yb ? yb : xb
    pgfPathCircle(s, () => pt(v, "centerpoint"), `${toNumber(r)}pt`)
  },
  parts: ["text"],
}

const SHAPES: Record<string, Shape> = { coordinate, rectangle, circle }

/** what pgf keeps of a named node (\pgf@sh@ns@, \pgf@sh@np@, \pgf@sh@nt@): its shape, saved anchors and transformation */
export interface PgfNodeRecord { shape: string; saved: Saved; transform: PgfTransform }

const registries = new WeakMap<PgfState, Map<string, PgfNodeRecord>>()
/** the named nodes (global) */
export function pgfNodes(s: PgfState): Map<string, PgfNodeRecord> {
  let r = registries.get(s)
  if (!r) registries.set(s, (r = new Map()))
  return r
}

/** the named nodes of `s` kept in `nodes` (TeX's are global: a document's pictures share them) */
export function usePgfNodes(s: PgfState, nodes: Map<string, PgfNodeRecord>) { registries.set(s, nodes) }

/** the anchor `{text}{\pgfpointorigin}` every shape has (\pgfdeclareshape 781) */
const textAnchor: Anchor = () => ({ x: 0, y: 0 })

/**
 * \pgf@sh@reanchor{#1}{#2} (487–498): the anchor, or for a number the border point in that direction
 * (\pgfmathsetcounter, then \pgfqpointpolar{angle}{1pt}).
 */
function reanchor(s: PgfState, shape: Shape, v: Saved, anchor: string): PgfPoint {
  const a = anchor === "text" ? textAnchor : shape.anchors[anchor]
  if (a) return a(s, v)
  if (!/^\s*[-+]?[\d.]/.test(anchor)) throw new Unsupported(`pgf: the anchor ${anchor}`)
  const angle = String(new TexArith(s.units).int(parse(anchor, s.units)).value)
  const one = 65536
  return shape.border(s, v, { x: mul(trig("cos", angle, s.units), one), y: mul(trig("sin", angle, s.units), one) })
}

/**
 * \pgfmultipartnode{#1}{#2}{#3}{#4} (39–118), its text part the box `text` (\pgfnodeparttextbox, null when
 * void): the shape shifted so that the anchor #2 lies at the origin, named #3, its background path made
 * and used by #4, its text box placed at its text anchor.
 */
export function pgfMultipartNode(s: PgfState, d: PgfDriver, shapeName: string, anchor: string, name: string, use: () => void, keys: PgfShapeKeys, text: BoxNode | null) {
  const shape = SHAPES[shapeName]
  if (!shape) throw new Unsupported(`pgf: the shape ${shapeName}`)
  s.begingroup()
  const v = shape.save(s, { w: text?.width ?? 0, h: text?.height ?? 0, d: text?.depth ?? 0 }, keys)
  pgfTransformShift(s, () => {
    const p = reanchor(s, shape, v, anchor)
    return { x: -p.x, y: -p.y }
  })
  reanchor(s, shape, v, anchor) // \pgfsavepgf@process\pgf@sh@sa@#3: evaluated again
  if (name !== "") pgfNodes(s).set(name, { shape: shapeName, saved: v, transform: s.local.transform })
  if (shape.background) {
    shape.background(s, v, keys)
    use()
  }
  for (const part of shape.parts) {
    s.begingroup()
    pgfTransformShift(s, () => reanchor(s, shape, v, part))
    pgfQBoxSynced(s, d, text, true)
    s.endgroup()
  }
  s.endgroup()
}

/**
 * \pgfnode{#1}{#2}{#3}{#4}{#5} (188–200): #3 typeset in a box (\pgfinterruptpicture) as the node's text.
 * The end of line after its group is a space.
 */
export function pgfNode(s: PgfState, d: PgfDriver, t: PgfText, shape: string, anchor: string, text: string, name: string, use: () => void, keys: PgfShapeKeys = SHAPE_KEYS) {
  s.begingroup()
  pgfMultipartNode(s, d, shape, anchor, name, use, keys, hpack(t.hlist(text)))
  s.endgroup()
  s.space()
}

/** \pgfcoordinate{#1}{#2} (425–442): a coordinate node named #1 at #2 (transformed), made at once */
export function pgfCoordinate(s: PgfState, name: string, p: PgfPointMacro) {
  if (name === "") return
  const q = transformPoint(s, p())
  pgfNodes(s).set(name, { shape: "coordinate", saved: { centerpoint: q }, transform: { aa: "1", ab: "0", ba: "0", bb: "1", x: 0, y: 0, identity: false } })
  s.space() // (the end of line after the \xdef's braces)
}

function lookup(name: string, s: PgfState): PgfNodeRecord {
  const n = pgfNodes(s).get(name)
  if (!n) throw new Unsupported(`pgf: no shape named ${name} is known`)
  return n
}

/**
 * \pgfpointanchor{#1}{#2} (531–558): the anchor of the named node, through the node's transformation and
 * back through the inverse of the current one.
 */
export function pgfPointAnchor(s: PgfState, name: string, anchor: string): PgfPoint {
  const n = lookup(name, s)
  const p = applyTransform(n.transform, reanchor(s, SHAPES[n.shape], n.saved, anchor))
  return applyTransform(pgfTransformInvert(s.local.transform, s.units), p)
}

/** 0.04pt: below it (squared, by tenths) a point is the node's centre (627–632) */
const NEAR = new TexArith({ em: 0, ex: 0 }).dimen("0.04pt")

/**
 * \pgfpointshapeborder{#1}{#2} (597–682): the point on the named node's border towards #2, in the node's
 * coordinates relative to its centre; a point within 0.02pt of the centre gives the centre.
 */
export function pgfPointShapeBorder(s: PgfState, name: string, p: PgfPointMacro): PgfPoint {
  const n = lookup(name, s)
  const shape = SHAPES[n.shape]
  const q = applyTransform(pgfTransformInvert(n.transform, s.units), transformPoint(s, p()))
  const c = shape.anchors.center(s, n.saved)
  const xa = q.x - c.x, ya = q.y - c.y
  const tenth = (v: number) => (v < 65536 && v > -65536 ? mul("10", v) : 10 * 65536)
  const xb = tenth(xa), yb = tenth(ya)
  // \dimexpr\Pgf@geT\the\pgf@xb\pgf@xb + …: each factor times its register
  const r = mul(toNumber(xb), xb) + mul(toNumber(yb), yb) < NEAR
    ? reanchor(s, shape, n.saved, "center")
    : shape.border(s, n.saved, { x: xa, y: ya })
  const b = applyTransform(n.transform, r)
  return applyTransform(pgfTransformInvert(s.local.transform, s.units), b)
}

/**
 * \pgfqboxsynced{#1} (pgfcorescopes.code.tex 95–97): the box at the origin under the current transformation
 * (\pgfsys@hboxsynced); `register`: #1 names a box register.
 */
export function pgfQBoxSynced(s: PgfState, d: PgfDriver, box: BoxNode | null, register: boolean) {
  d.hboxsynced(box, register, () => pgfLowLevelSyncCm(s, d))
}

/** \pgftext's options (/pgf/text/…), in order */
export type PgfTextOption = ["left" | "right" | "top" | "bottom" | "base" | "center"] | ["at", PgfPointMacro] | ["x" | "y" | "rotate", string]

/**
 * \pgftext[#1]{#2} (pgfcorescopes.code.tex 112–136): #2 in a box (\pgfinterruptpicture), aligned by the
 * options (centred by default), its four corners protocolled (the bottom ones at y = +depth, as pgf has
 * them) and the box placed at the origin.
 */
export function pgfText(s: PgfState, d: PgfDriver, t: PgfText, options: PgfTextOption[], text: string) {
  const box = hpack(t.hlist(text))
  s.begingroup()
  let h = "center", v = "center"
  for (const o of options) {
    switch (o[0]) {
      case "left": case "right": h = o[0]; break
      case "top": case "bottom": case "base": v = o[0]; break
      case "center": break
      case "at": pgfTransformShift(s, o[1]); break
      case "x": pgfTransformXShift(s, o[1]); break
      case "y": pgfTransformYShift(s, o[1]); break
      case "rotate": pgfTransformRotate(s, o[1]); break
    }
  }
  const quick = (x: number) => `+${toNumber(x)}pt`
  if (h === "center") pgfTransformXShift(s, quick(mul("-.5", box.width)))
  else if (h === "right") pgfTransformXShift(s, quick(-box.width))
  if (v === "bottom") pgfTransformYShift(s, quick(box.depth))
  else if (v === "center") { pgfTransformYShift(s, quick(mul(".5", box.depth))); pgfTransformYShift(s, quick(mul("-.5", box.height))) }
  else if (v === "top") pgfTransformYShift(s, quick(-box.height))
  for (const [x, y] of [[0, box.depth], [box.width, box.depth], [0, box.height], [box.width, box.height]]) {
    const q = transformPoint(s, { x, y })
    protocolSizes(s, q.x, q.y)
  }
  pgfQBoxSynced(s, d, box, true)
  s.endgroup()
}
