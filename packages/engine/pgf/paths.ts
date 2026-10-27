// pgf's paths: construction (pgfcorepathconstruct.code.tex), the soft path it builds
// (pgfsyssoftpath.code.tex) and its use (pgfcorepathusage.code.tex). Points go through the current
// transformation and into the soft path as \the prints them; each enlarges the path's extent and, while
// relevant, the picture's (\pgf@protocolsizes). \pgfusepath hands the soft path to the driver, its rounded
// corners processed (round.ts). Arrow tips, double lines and the non-linear transformations are later units: what would need
// them is not modeled here.

import { Unsupported } from "../latex/unsupported"
import { addArrow, prepareEndOfPath, prepareStartOfPath } from "./arrows"
import type { PgfDriver } from "./drivers"
import { toNumber } from "./fixed"
import { pgfProcessRound, roundCornerIfNeeded } from "./round"
import { pgfPoint, qpoint, type PgfPoint, type PgfPointMacro } from "./points"
import { emptyExtent, EMPTY_EXTENT, type PgfState, type SoftPathItem } from "./state"
import { mul, transformPoint } from "./transformations"

/** 2^30 sp: from here on TeX reading a register (or \the's text) says "Dimension too large" (not modeled) */
const TOO_LARGE = 0o10000000000

/**
 * \pgf@protocolsizes{#1}{#2} (67–81). `staleY`: #2 is a register whose assignment `<register><number>pt` is
 * still scanning for its optional space, which expands the \ifdim's that follow: until one of them is true
 * (its \global stops the scan), they compare the register's old value.
 */
export function protocolSizes(s: PgfState, x: number, y: number, staleY?: number) {
  if (Math.abs(x) >= TOO_LARGE || Math.abs(y) >= TOO_LARGE) throw new Unsupported(`pgf: a point at ${toNumber(x)}pt, ${toNumber(y)}pt`)
  let pending = staleY !== undefined
  const old = staleY ?? y
  const test = (holds: boolean, set: () => void) => {
    if (!holds) return
    pending = false
    set()
  }
  const ext = [s.path]
  if (s.local.relevant) ext.unshift(s.picture)
  for (const e of ext) {
    test(x < e.minX, () => { e.minX = x })
    test(x > e.maxX, () => { e.maxX = x })
    test((pending ? old : y) < e.minY, () => { e.minY = y })
    test((pending ? old : y) > e.maxY, () => { e.maxY = y })
  }
}

/** \pgf@process{#1}: `\global\pgf@x=\pgf@x` reads a point past max_dimen with TeX's error (only \advance makes one) */
function processed(p: PgfPoint): PgfPoint {
  if (Math.abs(p.x) >= TOO_LARGE || Math.abs(p.y) >= TOO_LARGE) throw new Unsupported(`pgf: a point at ${toNumber(p.x)}pt, ${toNumber(p.y)}pt`)
  return p
}

/** \pgf@resetpathsizes (85–90) */
export function resetPathSizes(s: PgfState) { s.path = emptyExtent() }

/** \pgfsyssoftpath@addtocurrentpath (the buffers only make TeX faster) */
function add(s: PgfState, item: SoftPathItem) { s.softPath.push(item) }

/** \pgf@nlt@moveto, the linear one (34–37) */
export function moveto(s: PgfState, x: number, y: number) {
  protocolSizes(s, x, y)
  add(s, { op: "moveto", x, y })
  s.lastMoveTo = { x, y }
}
export function lineto(s: PgfState, x: number, y: number) {
  protocolSizes(s, x, y)
  add(s, { op: "lineto", x, y })
}
export function curveto(s: PgfState, x1: number, y1: number, x2: number, y2: number, x: number, y: number, staleY1?: number) {
  protocolSizes(s, x1, y1, staleY1)
  protocolSizes(s, x2, y2)
  protocolSizes(s, x, y)
  add(s, { op: "curveto", x1, y1, x2, y2, x, y })
}
/** \pgfsyssoftpath@closepath (121–123) (its token carries the last moveto, for arrow tips) */
function closepath(s: PgfState) { add(s, { op: "closepath", ...s.lastMoveTo }) }

/** \pgfpathmoveto{#1} (60–65) */
export function pgfPathMoveTo(s: PgfState, p: PgfPointMacro) {
  const q = transformPoint(s, p())
  moveto(s, q.x, q.y)
  s.last = q
}

/** \pgfpathlineto{#1} (110–116) */
export function pgfPathLineTo(s: PgfState, p: PgfPointMacro) {
  const q = transformPoint(s, p())
  roundCornerIfNeeded(s)
  lineto(s, q.x, q.y)
  s.last = q
}

/** \pgfpathclose (121–124) */
export function pgfPathClose(s: PgfState) {
  roundCornerIfNeeded(s)
  closepath(s)
}

/** \pgfpathcurveto{#1}{#2}{#3} (128–140) */
export function pgfPathCurveTo(s: PgfState, p1: PgfPointMacro, p2: PgfPointMacro, p3: PgfPointMacro) {
  const b = transformPoint(s, p3()), a = transformPoint(s, p2()), c = transformPoint(s, p1())
  roundCornerIfNeeded(s)
  curveto(s, c.x, c.y, a.x, a.y, b.x, b.y)
  s.last = b
}

/**
 * \pgfpathrectangle{#1}{#2} (663–703): corner and size. Under no transformation and no rounded corners the
 * soft path takes a rectangle with the size as given; otherwise four lines, closed, and a move to the corner.
 */
export function pgfPathRectangle(s: PgfState, corner: PgfPointMacro, size: PgfPointMacro) {
  const z = processed(size())
  if (s.local.transform.identity && !s.local.cornerArc) {
    const c = transformPoint(s, corner())
    add(s, { op: "rect", x: c.x, y: c.y, w: z.x, h: z.y })
    protocolSizes(s, c.x, c.y)
    protocolSizes(s, c.x + z.x, c.y + z.y)
    return
  }
  const { x: xb, y: yb } = processed(corner())
  const xa = z.x + xb, ya = z.y + yb
  pgfPathMoveTo(s, qpoint(xa, ya))
  pgfPathLineTo(s, qpoint(xb, ya))
  pgfPathLineTo(s, qpoint(xb, yb))
  pgfPathLineTo(s, qpoint(xa, yb))
  pgfPathClose(s)
  pgfPathMoveTo(s, qpoint(xb, yb))
}

/** \pgfpathrectanglecorners{#1}{#2} (706–714): #1 evaluated twice, by it and by \pgfpathrectangle */
export function pgfPathRectangleCorners(s: PgfState, a: PgfPointMacro, b: PgfPointMacro) {
  const q = b(), p = a()
  pgfPathRectangle(s, a, qpoint(q.x - p.x, q.y - p.y))
}

/** the Bézier factor of a quarter ellipse */
const K = "0.55228475"

/**
 * \pgfpathellipse{#1}{#2}{#3} (549–652): centre and the two axes; four quarter curves from the end of the
 * first axis, closed, then a move to the centre. The last point on the path stays where it was.
 */
export function pgfPathEllipse(s: PgfState, center: PgfPointMacro, axisA: PgfPointMacro, axisB: PgfPointMacro) {
  const t = s.local.transform
  const { x: xc, y: yc } = transformPoint(s, center())
  let { x: xa, y: ya } = transformPoint(s, axisA())
  xa -= t.x; ya -= t.y
  let { x: xb, y: yb } = transformPoint(s, axisB())
  xb -= t.x; yb -= t.y
  moveto(s, xa + xc, ya + yc)
  // each quarter: the first control point from the axis ahead, the second from the axis behind, the end
  // the axis ahead (all from the centre). The first control point is assigned to \pgf@xc, \pgf@yc by
  // `\pgf@xc<x>pt\pgf@yc<y>pt` (\pgf@temp) right before \pgf@nlt@curveto: \pgf@yc is the centre's while
  // the curve's first \ifdim's expand.
  const quarter = (from: PgfPoint, to: PgfPoint) => {
    const c1 = { x: mul(K, to.x) + from.x + xc, y: mul(K, to.y) + from.y + yc }
    const c2 = { x: mul(K, from.x) + to.x + xc, y: mul(K, from.y) + to.y + yc }
    curveto(s, c1.x, c1.y, c2.x, c2.y, to.x + xc, to.y + yc, yc)
  }
  quarter({ x: xa, y: ya }, { x: xb, y: yb })
  xa = -xa; ya = -ya
  quarter({ x: xb, y: yb }, { x: xa, y: ya })
  xb = -xb; yb = -yb
  quarter({ x: xa, y: ya }, { x: xb, y: yb })
  xa = -xa; ya = -ya
  quarter({ x: xb, y: yb }, { x: xa, y: ya })
  closepath(s)
  moveto(s, xc, yc)
}

/** \pgfpathcircle{#1}{#2} (657): \pgfpathellipse with the axes \pgfpoint{#2}{0pt}, \pgfpoint{0pt}{#2} */
export const pgfPathCircle = (s: PgfState, center: PgfPointMacro, r: string) => pgfPathEllipse(s, center, () => pgfPoint(s, r, "0pt"), () => pgfPoint(s, "0pt", r))

/**
 * \pgfsyssoftpath@invokecurrentpath (42–46): each token's \pgfsys@ command. The coordinates are \the's text,
 * which \pgf@sys@bp scans again (a rectangle's size too large).
 */
export function invoke(s: PgfState, d: PgfDriver) {
  for (const i of s.softPath) {
    // (a specialround token gobbles its coordinates, a closepath token ignores them)
    if (i.op === "specialround") continue
    if (i.op === "closepath") { d.closepath(); continue }
    for (const [k, v] of Object.entries(i)) if (k !== "op" && Math.abs(v as number) >= TOO_LARGE) throw new Unsupported(`pgf: a path coordinate of ${toNumber(v as number)}pt`)
    switch (i.op) {
      case "moveto": d.moveto(i.x, i.y); break
      case "lineto": d.lineto(i.x, i.y); break
      case "curveto": d.curveto(i.x1, i.y1, i.x2, i.y2, i.x, i.y); break
      case "rect": d.rect(i.x, i.y, i.w, i.h); break
    }
  }
}

/** the keys of \pgfusepath (6–12) */
const USES = new Set(["stroke", "draw", "fill", "clip", "discard", "use as bounding box"])

/**
 * \pgfusepath{#1} (49–141): the soft path stroked, filled and/or clipped, then emptied. A stroked path enlarges
 * the picture by half the line width around the path's extent. With no arrow tips (\pgf@tips@mode `on draw`,
 * no tip set), a stroked path that is not closed is drawn in a group of its own.
 */
export function pgfUsePath(s: PgfState, d: PgfDriver, keys: string[]) {
  for (const k of keys) if (!USES.has(k)) throw new Unsupported(`pgf: \\pgfusepath key ${k}`)
  const stroke = keys.includes("stroke") || keys.includes("draw")
  const fill = keys.includes("fill"), clip = keys.includes("clip")
  // (with none of them, the soft path is emptied unused)
  // \pgfprocessround on a path used (an unused one is emptied first)
  if (stroke || fill || clip) pgfProcessRound(s)
  const action = fill && stroke ? () => d.fillstroke() : fill ? () => d.fill() : stroke ? () => d.stroke() : clip ? () => d.discardpath() : null
  if (s.local.relevant && stroke && s.picture.maxX !== -EMPTY_EXTENT) {
    const p = s.picture, q = s.path, half = (sign: string) => mul(`${sign}.5`, s.lineWidth)
    const minX = q.minX + half("-"), minY = q.minY + half("-"), maxX = q.maxX + half(""), maxY = q.maxY + half("")
    if (minX < p.minX) p.minX = minX
    if (minY < p.minY) p.minY = minY
    if (maxX > p.maxX) p.maxX = maxX
    if (maxY > p.maxY) p.maxY = maxY
  }
  if (clip) {
    invoke(s, d)
    d.clipnext()
    action?.()
    s.setLocal({ relevant: false })
  } else if (stroke) {
    // \pgfprocesscheckclosed: a rectangle or a closepath token; an open path gets its arrow tips (arrows.ts)
    const open = !s.softPath.some((i) => i.op === "rect" || i.op === "closepath")
    const end = open ? prepareEndOfPath(s, d) : null
    if (open) s.begingroup()
    const start = open ? prepareStartOfPath(s, d) : null
    invoke(s, d)
    action?.()
    if (open) {
      addArrow(s, d, start)
      s.endgroup()
      addArrow(s, d, end)
    }
  } else if (action) {
    invoke(s, d)
    action()
  }
  if (keys.includes("use as bounding box")) s.setLocal({ relevant: false })
  s.softPath = []
  resetPathSizes(s)
}
