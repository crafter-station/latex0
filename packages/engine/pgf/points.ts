// pgf's point computations (pgfcorepoints.code.tex) on \pgf@x and \pgf@y: a point is the pair of dimen registers
// in sp that \pgf@process leaves. What pgf computes through pgfmath goes through the same functions as
// \pgfmathparse, with TeX's arithmetic and TeX's errors.

import { TexArith, toNumber } from "./fixed"
import { pgfmathParse, pgfmathSetLength, type PgfUnits } from "./mathparser"
import { TRIGONOMETRIC } from "./mathtrig"

export interface PgfPoint { x: number; y: number }

/** a point and TeX's error messages, in order */
export interface PgfPointResult { point: PgfPoint; errors: string[] }

class Ctx {
  readonly a: TexArith
  constructor(private readonly units: PgfUnits, readonly errors: string[]) { this.a = new TexArith(units) }
  error(message: string) { this.errors.push(`Package PGF Math Error: ${message}`) }
  /** a dimen register as pgf hands it to \pgfmathparse: `\the\pgf@x` */
  parse(x: number): string {
    const r = pgfmathParse(`${toNumber(x)}pt`, this.units)
    this.errors.push(...r.errors)
    return r.result
  }
  /** the TeX errors of what ran since, collected */
  flush() { this.errors.push(...this.a.errors.splice(0)) }
}

/**
 * \pgfpointnormalised: (cos α, sin α) for α = \pgfmathatantwo{\the\pgf@y}{\the\pgf@x}, each argument parsed
 * first by \pgfmathatantwo. A point past ±max_dimen (only \advance makes one) is read as max_dimen, positive.
 */
export function pointNormalised(p: PgfPoint, units: PgfUnits, errors: string[] = []): PgfPointResult {
  const m = new Ctx(units, errors)
  // \pgf@process: `\global\pgf@x=\pgf@x\global\pgf@y=\pgf@y` reads the registers through scan_dimen
  const px = m.a.reassign(p.x), py = m.a.reassign(p.y)
  m.flush()
  const y = m.parse(py), x = m.parse(px)
  const angle = TRIGONOMETRIC.atan2.fn(m, [y, x])
  m.flush()
  const point = { x: m.a.dimen(`${TRIGONOMETRIC.cos.fn(m, [angle])}pt`), y: 0 }
  m.flush()
  point.y = m.a.dimen(`${TRIGONOMETRIC.sin.fn(m, [angle])}pt`)
  m.flush()
  return { point, errors }
}

/**
 * \pgfpointlineatdistance{#1}{#2}{#3}: the point at distance #1 (\pgfmathsetlength) from #2 towards #3, the
 * normalised direction's components each a factor of the distance.
 */
export function pointLineAtDistance(distance: string, start: PgfPoint, end: PgfPoint, units: PgfUnits): PgfPointResult {
  const len = pgfmathSetLength(distance, units)
  const errors = [...len.errors]
  // \global\advance: no overflow check
  const { point: dir } = pointNormalised({ x: end.x - start.x, y: end.y - start.y }, units, errors)
  const m = new Ctx(units, errors)
  const xa = m.a.times(toNumber(dir.x), len.value)
  const ya = m.a.times(toNumber(dir.y), len.value)
  m.flush()
  return { point: { x: start.x + xa, y: start.y + ya }, errors }
}
