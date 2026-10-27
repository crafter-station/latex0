// \pgfpathgrid (pgfcorepathconstruct.code.tex 1127–1226, line numbers cite it): the horizontal lines from the first
// multiple of the y step at or above the lower corner, then the vertical ones, each a move and a line through the
// transformation (a last one 0.01pt short of the far side when the steps miss it), then a move to the second corner.

import { moveto, lineto } from "./paths"
import type { PgfPoint } from "./points"
import type { PgfState } from "./state"
import { transformPoint } from "./transformations"

/** 0.01pt */
const HUNDREDTH = 655

/**
 * the grid between the corners `a` and `b` with the steps; `space` typesets the blank that ends each
 * \pgf@pos@transform's line (two a grid line)
 */
export function pgfPathGrid(s: PgfState, stepx: number, stepy: number, a: PgfPoint, b: PgfPoint, space: () => void) {
  const xa = Math.min(a.x, b.x), xb = Math.max(a.x, b.x), ya = Math.min(a.y, b.y), yb = Math.max(a.y, b.y)
  const line = (p: PgfPoint, q: PgfPoint) => {
    const m = transformPoint(s, p)
    space()
    moveto(s, m.x, m.y)
    const l = transformPoint(s, q)
    space()
    lineto(s, l.x, l.y)
  }
  /** the lines across one axis: from the first multiple of the step from `lo`, while below `hi`, then one just short of it */
  const lines = (lo: number, hi: number, step: number, draw: (v: number) => void) => {
    let v = Math.trunc(lo / step) * step
    if (v < lo) v += step
    do { draw(v); v += step } while (v < hi)
    v -= HUNDREDTH
    if (v < hi) draw(v)
  }
  if (stepy > HUNDREDTH) lines(ya, yb, stepy, (y) => line({ x: xa, y }, { x: xb, y }))
  if (stepx > HUNDREDTH) lines(xa, xb, stepx, (x) => line({ x, y: ya }, { x, y: yb }))
  const e = transformPoint(s, b)
  moveto(s, e.x, e.y)
}
