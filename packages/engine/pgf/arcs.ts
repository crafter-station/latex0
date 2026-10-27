// pgf's arcs (pgfcorepathconstruct.code.tex, line numbers cite it): \pgfpatharc splits an arc into pieces of at
// most 90° (90° steps past 115°, 60° between 90° and 115°), each a Bézier curve whose supports lie on the tangents at
// 4/3·tan(¼ of its angle) (0.55228475 for a quarter), all in TeX's dimension arithmetic from the current point.

import { Unsupported } from "../latex/unsupported"
import { printScaled } from "../layout/arith"
import { TexArith, toNumber } from "./fixed"
import { pgfmathParse } from "./mathparser"
import { curveto } from "./paths"
import { pgfPointPolar, type PgfPoint } from "./points"
import { roundCornerIfNeeded } from "./round"
import type { PgfState } from "./state"
import { mul, pgfTransformTriangle, transformPoint } from "./transformations"

const PT = 65536
const pt = (x: number) => `${printScaled(x)}pt`

function parse(s: PgfState, e: string): string {
  const r = pgfmathParse(e, s.units)
  if (r.errors.length) throw new Unsupported(`pgf: ${r.errors[0]}`)
  return r.result
}

/**
 * \pgfpatharc{#1}{#2}{#3} (289–333): from the current point, the arc from angle #1 to #2 of the ellipse with radii
 * #3 (`r` or `rx and ry`); `space` typesets the blank after each piece that a growing angle splits off
 */
export function pgfPathArc(s: PgfState, start: string, end: string, radius: string, space: () => void) {
  const a = new TexArith(s.units)
  const ta = parse(s, start), tb = parse(s, end)
  // \pgf@arc@get@radii#1and #2\pgf@arc@stop
  const and = radius.indexOf("and ")
  const [r1, r2] = and < 0 ? [radius, radius] : [radius.slice(0, and), radius.slice(and + 4)]
  const ra = parse(s, r1), rb = parse(s, r2)
  let angleA = a.dimen(`${ta}pt`)
  const angleB = a.dimen(`${tb}pt`)
  if (a.errors.length) throw new Unsupported(`pgf: ${a.errors[0]}`)
  for (;;) {
    const d = Math.abs(angleA - angleB)
    if (!(d > 90 * PT)) break
    const step = d > 115 * PT ? 90 * PT : 60 * PT
    if (angleB > angleA) {
      arcPiece(s, angleA, angleA + step, ra, rb)
      space()
      angleA += step
    } else {
      arcPiece(s, angleA, angleA - step, ra, rb)
      angleA -= step
    }
  }
  roundCornerIfNeeded(s)
  arcPiece(s, angleA, angleB, ra, rb)
}

/** \pgf@arc (345–420): one piece, from \pgf@path@lastx */
function arcPiece(s: PgfState, angleA: number, angleB: number, ra: string, rb: string) {
  const a = new TexArith(s.units)
  let tempa = a.dimen(`${ra}pt`), tempb = a.dimen(`${rb}pt`)
  const span = Math.abs(angleB - angleA)
  const f = span === 90 * PT ? "0.55228475" : parse(s, `1.333333333*tan(.25*${toNumber(span)})`)
  tempa = mul(f, tempa)
  tempb = mul(f, tempb)
  const t = s.local.transform
  const linear = (p: PgfPoint): PgfPoint => { const q = transformPoint(s, p); return { x: q.x - t.x, y: q.y - t.y } }
  const polar = (angle: number, r: string) => transformPoint(s, pgfPointPolar(s, toNumber(angle), r))
  const up = angleB > angleA
  const support = linear(pgfPointPolar(s, toNumber(angleA + (up ? 90 : -90) * PT), `${pt(tempa)} and ${pt(tempb)}`))
  const xa = s.last.x + support.x, ya = s.last.y + support.y
  const radii = `${ra}pt and ${rb}pt`
  const q1 = polar(angleA, radii)
  let xb = s.last.x - q1.x, yb = s.last.y - q1.y
  const q2 = polar(angleB, radii)
  xb += q2.x
  yb += q2.y
  const back = linear(pgfPointPolar(s, toNumber(angleB + (up ? -90 : 90) * PT), `${pt(tempa)} and ${pt(tempb)}`))
  curveto(s, xa, ya, xb + back.x, yb + back.y, xb, yb)
  s.last = { x: xb, y: yb }
}

/** \pgfpatharcaxes{#1}{#2}{#3}{#4} (422–427): the arc on the ellipse of axes #3 and #4, a unit circle under \pgftransformtriangle */
export function pgfPathArcAxes(s: PgfState, start: string, end: string, x: PgfPoint, y: PgfPoint, space: () => void) {
  s.begingroup()
  pgfTransformTriangle(s, { x: 0, y: 0 }, x, y)
  pgfPathArc(s, start, end, "1pt", space)
  s.endgroup()
}
