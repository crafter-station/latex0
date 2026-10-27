// pgf's rounded corners: \pgfsetcornersarced (pgfcorepathconstruct.code.tex 62–77) marks each corner a path
// construction ends in with a specialround token, and \pgfusepath replaces the marked corners by curves
// (\pgfprocessround, pgfcorepathprocessing.code.tex 249–465, line numbers cite it). The processing runs on the
// soft path's tokens as TeX has them (a curve is three tokens, a rectangle two, a closepath carries the last
// moveto), every coordinate a register's value, so the new points are TeX's to the sp.

import { Unsupported } from "../latex/unsupported"
import { toNumber } from "./fixed"
import { pointLineAtDistance, type PgfPoint, type PgfPointMacro } from "./points"
import type { PgfState, SoftPathItem } from "./state"
import { mul } from "./transformations"

/** 2^30 sp: TeX reading a larger coordinate says "Dimension too large" (not modeled) */
const TOO_LARGE = 0o10000000000

/** \pgfsetcornersarced{#1} (64–72): the point's coordinates, the corners left alone when both are 0pt */
export function pgfSetCornersArced(s: PgfState, p: PgfPointMacro) {
  const { x, y } = p()
  s.setLocal({ cornerArc: x === 0 && y === 0 ? null : { x, y } })
}

/** \pgf@roundcornerifneeded (75–77) */
export function roundCornerIfNeeded(s: PgfState) {
  const a = s.local.cornerArc
  if (a) s.softPath.push({ op: "specialround", x: a.x, y: a.y })
}

type Kind = "moveto" | "lineto" | "rectcorner" | "rectsize" | "supporta" | "supportb" | "curveto" | "closepath" | "specialround" | "stop"
interface Token { k: Kind; x: number; y: number }

function tokens(path: SoftPathItem[]): Token[] {
  const out: Token[] = []
  for (const i of path) {
    if (i.op === "curveto") out.push({ k: "supporta", x: i.x1, y: i.y1 }, { k: "supportb", x: i.x2, y: i.y2 }, { k: "curveto", x: i.x, y: i.y })
    else if (i.op === "rect") out.push({ k: "rectcorner", x: i.x, y: i.y }, { k: "rectsize", x: i.w, y: i.h })
    else out.push({ k: i.op, x: i.x, y: i.y })
  }
  return out
}

function items(ts: Token[]): SoftPathItem[] {
  const out: SoftPathItem[] = []
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i]
    if (t.k === "supporta" && ts[i + 1]?.k === "supportb" && ts[i + 2]?.k === "curveto") {
      const b = ts[i + 1], c = ts[i + 2]
      out.push({ op: "curveto", x1: t.x, y1: t.y, x2: b.x, y2: b.y, x: c.x, y: c.y })
      i += 2
    } else if (t.k === "rectcorner" && ts[i + 1]?.k === "rectsize") {
      out.push({ op: "rect", x: t.x, y: t.y, w: ts[i + 1].x, h: ts[i + 1].y })
      i++
    } else if (t.k === "moveto" || t.k === "lineto" || t.k === "closepath" || t.k === "specialround") out.push({ op: t.k, x: t.x, y: t.y })
    else throw new Unsupported("pgf: a rounded path whose curves or rectangles came apart")
  }
  return out
}

/** the Bézier factor of the quarter circle replacing a corner (\pgfprocess@@specialround) */
const K = "0.5522847"

/** \pgfprocessround{#1}{#2} (249–278): the soft path with its marked corners rounded */
export function pgfProcessRound(s: PgfState): void {
  if (!s.softPath.some((i) => i.op === "specialround")) return
  const T = [...tokens(s.softPath), { k: "stop", x: 0, y: 0 } as Token]
  const at = (j: number): Token => {
    const t = T[j]
    if (!t) throw new Unsupported("pgf: a rounded corner at the end of the path")
    return t
  }
  // \pgfprocess@newpath, …@moveto, …@firstto, …@segment
  const newpath: Token[] = []
  let moveto: Token | null = null, firstto: PgfPoint | null = null, segment: Token[] = []
  let xa = 0, ya = 0, xc = 0, yc = 0, savex = 0, savey = 0
  /** `\pgf@xa=#2`: the coordinate read as a dimension */
  const read = (v: number) => {
    if (Math.abs(v) >= TOO_LARGE) throw new Unsupported(`pgf: a rounded path's coordinate of ${toNumber(v)}pt`)
    return v
  }
  const lineAt = (d: number, from: PgfPoint, to: PgfPoint): PgfPoint => {
    const r = pointLineAtDistance(`${toNumber(d)}pt`, from, to, s.units)
    if (r.errors.length) throw new Unsupported(`pgf: a rounded corner: ${r.errors[0]}`)
    read(r.point.x); read(r.point.y)
    return r.point
  }
  /** \pgfprocess@@specialround (371–427): the corner `t` replaced by a curve from (xa, ya) towards (xc, yc) */
  const specialRound = (t: Token) => {
    const xb = read(t.x), yb = read(t.y)
    const p = lineAt(savex, { x: xb, y: yb }, { x: xa, y: ya })
    xa = p.x; ya = p.y
    segment.push({ k: t.k, x: xa, y: ya })
    const q = lineAt(savey, { x: xb, y: yb }, { x: xc, y: yc })
    xc = q.x; yc = q.y
    segment.push({ k: "supporta", x: xa + mul(K, xb - xa), y: ya + mul(K, yb - ya) })
    segment.push({ k: "supportb", x: xc + mul(K, xb - xc), y: yc + mul(K, yb - yc) })
    segment.push({ k: "curveto", x: xc, y: yc })
    xa = t.x; ya = t.y
  }
  /** \pgfprocess@specialroundcope (337–363): the corner at the end of T[i] (a lineto or a curve's end) */
  const cope = (i: number): number => {
    const t2 = at(i + 1)
    if (t2.k === "lineto" || t2.k === "supporta" || t2.k === "closepath") { xc = read(t2.x); yc = read(t2.y) }
    else if (t2.k === "specialround") { const t3 = at(i + 2); xc = read(t3.x); yc = read(t3.y) } // \pgfprocess@@findrightcoordinates
    else return i
    specialRound(at(i))
    return i + 1
  }
  let i = 0
  for (;;) {
    const t = at(i)
    if (t.k === "stop") break
    if (t.k === "specialround") {
      // \pgfprocess@round (280–313) and \pgfprocess@specialround (315–335)
      savex = t.x; savey = t.y
      i++
      if (savex === 0 && savey === 0) continue
      const t1 = at(i)
      if (!firstto) firstto = { x: t1.x, y: t1.y }
      if (t1.k === "lineto") i = cope(i)
      else if (t1.k === "supporta") {
        // \pgfprocess@specialroundcurveto (429–433): the supports kept, the curve's end rounded
        const t2 = at(i + 1)
        segment.push(t1, t2)
        xa = read(t2.x); ya = read(t2.y)
        i = cope(i + 2)
      } else if (t1.k === "closepath" && moveto && firstto) {
        // \pgfprocess@specialroundclose (435–450): a line back to the moveto, its corner rounded towards the
        // subpath's first point; the subpath then begins (and closes) where the curve ends
        // (\pgfprocess@cleanupafterclose 462–466)
        xc = read(firstto.x); yc = read(firstto.y)
        specialRound({ k: "lineto", x: moveto.x, y: moveto.y })
        moveto = { k: "moveto", x: xc, y: yc }
        segment.push({ k: "closepath", x: xc, y: yc })
        xa = xc; ya = yc
        i++
      }
      continue
    }
    if (!firstto) firstto = { x: t.x, y: t.y }
    xa = read(t.x); ya = read(t.y)
    if (t.k === "moveto") {
      if (moveto) newpath.push(moveto)
      newpath.push(...segment)
      moveto = t
      firstto = null
      segment = []
    } else segment.push(t)
    i++
  }
  if (moveto) newpath.push(moveto)
  newpath.push(...segment)
  s.softPath = items(newpath)
}
