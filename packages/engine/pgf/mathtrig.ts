// pgfmath's trigonometric functions as pgf defines them (pgfmathfunctions.trigonometric.code.tex), in degrees
// (trig format=deg, pgf's default): sine and cosine interpolated linearly between the whole degrees of the
// \pgfmath@cos@<n> table, the inverses looked up in the \pgfmath@acos@ and \pgfmath@atan@ tables at thousandths,
// everything on TeX registers. The tables are data/pgf/tables.json, generated from TeX.

import { UNITY } from "../layout/arith"
import { pgfTables } from "../latex/data"
import { Unsupported } from "../latex/unsupported"
import { toNumber } from "./fixed"
import { abs, divide, f1, f2, intPart, pt, reciprocal, returnOne, type PgfFunction, type PgfMathCtx } from "./mathfunctions"

/** \pgfmath@cos@0…181, \pgfmath@acos@0…1000 and \pgfmath@atan@0…1000, as the macros' texts */
export interface PgfTables { cos: string[]; acos: string[]; atan: string[] }

/** \pgfmath@scale@rad@to@deg */
const radToDeg = (m: PgfMathCtx, x: number) => m.a.times("57.29577", x)

/**
 * \pgfmathsin@ and \pgfmathcos@ (sin is cos of x − 90): x reduced by \divide to [0, 180] and, between whole
 * degrees a and a+1, (1−b)·cos(a) + b·cos(a+1).
 */
function cosine(m: PgfMathCtx, a: string, shift: number): string {
  const cos = pgfTables().cos
  let x = pt(m, a) + shift
  // \afterassignment\pgfmath@gobbletilpgfmath@: the integer part of \the\pgfmath@x
  let counta = intPart(m, x).value
  counta = m.a.divide(counta, 360)
  counta = m.a.multiplyInt(counta, -360)
  x += m.a.dimen(`${counta}pt`)
  if (x < 0) x = -x
  if (x >= 180 * UNITY) x = -x + 360 * UNITY
  // \afterassignment\pgfmath@xa: the integer part to the count, the rest (`.5pt`) to \pgfmath@xa
  const split = intPart(m, x)
  counta = split.value
  const xa = m.a.dimen(split.rest)
  if (xa === 0) x = m.a.dimen(`${cos[counta]}pt`)
  else {
    x = -xa + UNITY
    x = m.a.times(cos[counta], x)
    // pgf's guard for a+1 = 181 cannot trigger: a is at most 179 here
    x += m.a.times(cos[counta + 1], xa)
  }
  return returnOne(m, x)
}

const sin = (m: PgfMathCtx, a: string) => cosine(m, a, -90 * UNITY)
const cos = (m: PgfMathCtx, a: string) => cosine(m, a, 0)

/** \pgfmathtan@ and \pgfmathcot@: one function times the reciprocal of the other */
function quotient(m: PgfMathCtx, a: string, num: typeof sin, den: typeof sin): string {
  const r = reciprocal(m, den(m, a))
  const x = m.a.times(r, pt(m, num(m, a)))
  return returnOne(m, x)
}

/** \pgfmath@multiply@thousand: the printed number with its period moved three places right (`#1.#2#3#4#5`) */
function thousand(m: PgfMathCtx, x: number): number {
  const s = toNumber(x) + "000"
  const dot = s.indexOf(".")
  return pt(m, `${s.slice(0, dot)}${s.slice(dot + 1, dot + 4)}.${s.slice(dot + 4)}`)
}

/** \pgfmath@table@lookup: the entry at the integer part, plus the fraction of the way to the next entry */
function lookup(m: PgfMathCtx, x: number, table: string[]): number {
  const s = toNumber(x)
  const dot = s.indexOf(".")
  const n = Number(s.slice(0, dot))
  // past the table \csname makes \relax: a TeX error, not modeled
  if (n >= table.length) throw new Unsupported("pgfmath: inverse trigonometric function out of range")
  let v = m.a.dimen(`${table[n]}pt`)
  if (n + 1 < table.length) {
    const ya = m.a.dimen(`${table[n + 1]}pt`) - v
    v += m.a.times(`0.${s.slice(dot + 1)}`, ya)
  }
  return v
}

/** \pgfmathasin@ and \pgfmathacos@: acos looked up for |x|, then mirrored */
function inverse(m: PgfMathCtx, a: string, sine: boolean): string {
  const xa = pt(m, a)
  let x = thousand(m, xa)
  if (x < 0) x = -x
  x = lookup(m, x, pgfTables().acos)
  if (sine) {
    x = -x + 90 * UNITY
    if (xa < 0) x = -x
  } else if (xa < 0) x = -x + 180 * UNITY
  return returnOne(m, x)
}

/** \pgfmathatan@: looked up for |x| at most 1, through 90 − atan(1/|x|) above */
function atan(m: PgfMathCtx, a: string): string {
  let x = pt(m, a)
  const xa = x
  if (x < 0) x = -x
  const xb = x
  if (x > UNITY) x = pt(m, reciprocal(m, toNumber(x)))
  x = thousand(m, x)
  x = lookup(m, x, pgfTables().atan)
  if (xb > UNITY) x = -x + 90 * UNITY
  if (xa < 0) x = -x
  return returnOne(m, x)
}

/** \pgfmathatan2@ (y first): the axes for |y| below 0.001, else atan of the smaller over the larger magnitude */
function atan2(m: PgfMathCtx, a: string, b: string): string {
  let y = pt(m, a)
  if (y < 0) y = -y
  let x: number
  if (y < pt(m, "0.001")) {
    if (pt(m, b) < 0) x = 180 * UNITY
    else if (pt(m, b) > 0) x = 0
    else x = pt(m, a) < 0 ? -90 * UNITY : 90 * UNITY
  } else {
    const tempa = abs(m, a), tempb = abs(m, b)
    if (pt(m, tempa) > pt(m, tempb)) {
      const r = atan(m, divide(m, b, tempa))
      x = 90 * UNITY + m.a.dimen(`-${r}pt`)
    } else {
      x = pt(m, atan(m, divide(m, tempa, b)))
      if (pt(m, b) < 0) x += 180 * UNITY
    }
    if (pt(m, a) < 0) x = -x
  }
  return returnOne(m, x)
}

export const TRIGONOMETRIC: Record<string, PgfFunction> = {
  deg: f1((m, a) => returnOne(m, radToDeg(m, pt(m, a)))),
  rad: f1((m, a) => returnOne(m, m.a.divide(m.a.times("3.14159", pt(m, a)), 180))), // \pgfmath@scale@deg@to@rad
  sin: f1(sin),
  cos: f1(cos),
  tan: f1((m, a) => quotient(m, a, sin, cos)),
  cot: f1((m, a) => quotient(m, a, cos, sin)),
  sec: f1((m, a) => reciprocal(m, cos(m, a))),
  cosec: f1((m, a) => reciprocal(m, sin(m, a))),
  asin: f1((m, a) => inverse(m, a, true)),
  acos: f1((m, a) => inverse(m, a, false)),
  atan: f1(atan),
  atan2: f2(atan2),
}
