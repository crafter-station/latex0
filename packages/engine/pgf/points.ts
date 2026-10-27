// pgf's point computations (pgfcorepoints.code.tex) on \pgf@x and \pgf@y: a point is the pair of dimen registers
// in sp that \pgf@process leaves. What pgf computes through pgfmath goes through the same functions as
// \pgfmathparse, with TeX's arithmetic and TeX's errors.

import { Unsupported } from "../latex/unsupported"
import { times } from "../layout/dimen"
import type { Node } from "../layout/nodes"
import { TexArith, toNumber } from "./fixed"
import { pgfmathParse, pgfmathSetLength, type PgfUnits } from "./mathparser"
import { TRIGONOMETRIC } from "./mathtrig"
import type { PgfState } from "./state"

export interface PgfPoint { x: number; y: number }

/**
 * A point as pgf's commands take it: a macro, evaluated where (and as often as) the command evaluates it,
 * for what evaluating it does besides (a quick \pgfmathsetlength's \unskip).
 */
export type PgfPointMacro = () => PgfPoint

/** \pgfqpoint with registers' values: a macro that does nothing else */
export const qpoint = (x: number, y: number): PgfPointMacro => () => ({ x, y })

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

/** a pgfmath computation as TeX runs it in a picture: a TeX error would leave material in the picture (not modeled) */
function clean<T>(what: string, value: T, errors: string[]): T {
  if (errors.length) throw new Unsupported(`pgf: ${what}: ${errors[0]}`)
  return value
}

/**
 * \pgfmathsetlength{<register>}{#1} (pgfmathcalc.code.tex 30–49) in a picture: em and ex are the document
 * font's (\pgfmath@selectfont), and the quick version (#1 beginning with +) ends in \unskip, which takes
 * a space before it off the picture's list.
 */
export function setLength(expression: string, s: { units: PgfUnits; out: Node[] }): number {
  const r = pgfmathSetLength(expression, s.units)
  if (expression.startsWith("+") && s.out[s.out.length - 1]?.kind === "glue") s.out.pop()
  return clean(expression, r.value, r.errors)
}

/** \pgfmathparse{#1}: \pgfmathresult */
export function parse(expression: string, units: PgfUnits): string {
  const r = pgfmathParse(expression, units)
  return clean(expression, r.result, r.errors)
}

/** `\global\pgf@x=<factor>\pgf@x` */
function scaled(factor: string, x: number): number {
  const errors: string[] = []
  return clean(factor, times(factor, x, errors), errors)
}

/** \pgfmathsin@, \pgfmathcos@ of a number */
export function trig(f: "sin" | "cos", angle: string, units: PgfUnits): string {
  const m = new Ctx(units, [])
  const r = TRIGONOMETRIC[f].fn(m, [angle])
  m.flush()
  return clean(`${f}(${angle})`, r, m.errors)
}

// pgfcorepoints.code.tex, each point the pair \pgf@x, \pgf@y it leaves

/** \pgfpoint{#1}{#2} (27–29) */
export const pgfPoint = (s: PgfState, x: string, y: string): PgfPoint => ({ x: setLength(x, s), y: setLength(y, s) })

/** \pgfpointorigin (38) */
export const pgfPointOrigin = (): PgfPoint => ({ x: 0, y: 0 })

/** \pgfpointadd{#1}{#2} (61–67): \global\advance, which no overflow stops */
export const pgfPointAdd = (a: PgfPoint, b: PgfPoint): PgfPoint => ({ x: b.x + a.x, y: b.y + a.y })

/** \pgfpointdiff{#1}{#2} (52–58): #2 minus #1 */
export const pgfPointDiff = (a: PgfPoint, b: PgfPoint): PgfPoint => ({ x: b.x - a.x, y: b.y - a.y })

/** \pgfpointscale{#1}{#2} (72–77) */
export function pgfPointScale(factor: string, p: PgfPoint, units: PgfUnits): PgfPoint {
  const f = parse(factor, units)
  return { x: scaled(f, p.x), y: scaled(f, p.y) }
}

/** \pgfpointpolar{#1}{#2} (341–359): the radius `r` or `rx and ry`, ry set first */
export function pgfPointPolar(s: PgfState, angle: string, radius: string): PgfPoint {
  const and = radius.indexOf("and ")
  const [rx, ry] = and < 0 ? [radius, radius] : [radius.slice(0, and), radius.slice(and + 4)]
  const y = setLength(ry, s), x = setLength(rx, s)
  const a = parse(angle, s.units)
  return { x: scaled(trig("cos", a, s.units), x), y: scaled(trig("sin", a, s.units), y) }
}

/** \pgfpointxy{#1}{#2} (433–441), on the default vectors \pgf@xx … \pgf@yy: \pgfpoint{1cm}{0cm}, \pgfpoint{0cm}{1cm} (500–501) */
export function pgfPointXY(x: string, y: string, units: PgfUnits): PgfPoint {
  const tx = parse(x, units), ty = parse(y, units)
  const cm = pgfmathSetLength("1cm", units).value
  return { x: scaled(tx, cm) + scaled(ty, 0), y: scaled(tx, 0) + scaled(ty, cm) }
}
