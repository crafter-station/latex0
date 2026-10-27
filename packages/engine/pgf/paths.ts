// pgf's paths: construction (pgfcorepathconstruct.code.tex), the soft path it builds
// (pgfsyssoftpath.code.tex) and its use (pgfcorepathusage.code.tex). Points go through the current
// transformation and into the soft path as \the prints them; each enlarges the path's extent and, while
// relevant, the picture's (\pgf@protocolsizes). So far the moves alone, and \pgfusepath's keys that draw
// nothing.

import { Unsupported } from "../latex/unsupported"
import { toNumber } from "./fixed"
import type { PgfPointMacro } from "./points"
import { emptyExtent, type PgfState, type SoftPathItem } from "./state"
import { transformPoint } from "./transformations"

/** 2^30 sp: from here on TeX reading a register (or \the's text) says "Dimension too large" (not modeled) */
const TOO_LARGE = 0o10000000000

/** \pgf@protocolsizes{#1}{#2} (67–81) */
export function protocolSizes(s: PgfState, x: number, y: number) {
  if (Math.abs(x) >= TOO_LARGE || Math.abs(y) >= TOO_LARGE) throw new Unsupported(`pgf: a point at ${toNumber(x)}pt, ${toNumber(y)}pt`)
  const ext = [s.path]
  if (s.local.relevant) ext.unshift(s.picture)
  for (const e of ext) {
    if (x < e.minX) e.minX = x
    if (x > e.maxX) e.maxX = x
    if (y < e.minY) e.minY = y
    if (y > e.maxY) e.maxY = y
  }
}

/** \pgf@resetpathsizes (85–90) */
export function resetPathSizes(s: PgfState) { s.path = emptyExtent() }

/** \pgfsyssoftpath@addtocurrentpath (the buffers only make TeX faster) */
function add(s: PgfState, item: SoftPathItem) { s.softPath.push(item) }

/** \pgf@nlt@moveto, the linear one (34–37) */
function moveto(s: PgfState, x: number, y: number) {
  protocolSizes(s, x, y)
  add(s, { op: "moveto", x, y })
}

/** \pgfpathmoveto{#1} (60–65) */
export function pgfPathMoveTo(s: PgfState, p: PgfPointMacro) {
  const q = transformPoint(s, p())
  moveto(s, q.x, q.y)
  s.last = q
}

/** the keys of \pgfusepath (6–12) modeled so far */
const USES = new Set(["discard", "use as bounding box"])

/** \pgfusepath{#1} (49–141): the soft path emptied; after `use as bounding box`, nothing enlarges the picture */
export function pgfUsePath(s: PgfState, keys: string[]) {
  for (const k of keys) if (!USES.has(k)) throw new Unsupported(`pgf: \\pgfusepath key ${k}`)
  if (keys.includes("use as bounding box")) s.setLocal({ relevant: false })
  s.softPath = []
  resetPathSizes(s)
}
