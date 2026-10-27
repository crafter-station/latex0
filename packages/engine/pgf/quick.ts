// pgf's quick commands (pgfcorequick.code.tex, line numbers cite it): path construction straight into the soft
// path, the coordinates as given (no transformation, no extent, no last point), and its use with no arrow tips,
// no bounding box and no group. Each coordinate is \pgfsys@ text the driver scans as a dimension.

import type { PgfDriver } from "./drivers"
import { TexArith } from "./fixed"
import { invoke, resetPathSizes } from "./paths"
import type { PgfState } from "./state"

/** a coordinate as \pgf@sys@bp scans it */
const dimen = (s: PgfState, x: string) => new TexArith(s.units).dimen(x)

/** \pgfpathqmoveto{#1}{#2} (27) */
export function pgfPathQMoveTo(s: PgfState, x: string, y: string) { s.softPath.push({ op: "moveto", x: dimen(s, x), y: dimen(s, y) }) }
/** \pgfpathqlineto{#1}{#2} (42) */
export function pgfPathQLineTo(s: PgfState, x: string, y: string) { s.softPath.push({ op: "lineto", x: dimen(s, x), y: dimen(s, y) }) }
/** \pgfpathqcurveto{#1}…{#6} (61) */
export function pgfPathQCurveTo(s: PgfState, x1: string, y1: string, x2: string, y2: string, x: string, y: string) {
  const [a, b, c, d, e, f] = [x1, y1, x2, y2, x, y].map((v) => dimen(s, v))
  s.softPath.push({ op: "curveto", x1: a, y1: b, x2: c, y2: d, x: e, y: f })
}

/** \pgfsyssoftpath@flushcurrentpath, the \pgfsys@ command, \pgf@resetpathsizes */
function use(s: PgfState, d: PgfDriver, action: () => void) {
  invoke(s, d)
  s.softPath = []
  action()
  resetPathSizes(s)
}
/** \pgfusepathqstroke (100–104) */
export const pgfUsePathQStroke = (s: PgfState, d: PgfDriver) => use(s, d, () => d.stroke())
/** \pgfusepathqfill (109–113) */
export const pgfUsePathQFill = (s: PgfState, d: PgfDriver) => use(s, d, () => d.fill())
/** \pgfusepathqfillstroke (118–122) */
export const pgfUsePathQFillStroke = (s: PgfState, d: PgfDriver) => use(s, d, () => d.fillstroke())
/** \pgfusepathqclip (127–132) */
export const pgfUsePathQClip = (s: PgfState, d: PgfDriver) => use(s, d, () => { d.clipnext(); d.discardpath() })
