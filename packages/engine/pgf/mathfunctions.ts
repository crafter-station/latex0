// pgfmath's functions as pgf defines them (pgfmathfunctions.basic.code.tex, …round…, …misc…,
// …trigonometric… for pi), on TeX registers: each takes its arguments as the strings the parser hands it,
// assigns them to dimen registers with `#1pt`, computes with TeX's arithmetic and returns \pgfmathresult,
// the result register printed by \pgf@sys@tonumber. pgf's own algorithms throughout (long division digit
// by digit, the reciprocal through 10^9, ln's polynomial, exp's series), never floating point.

import { UNITY } from "../layout/arith"
import { toNumber, type TexArith } from "./fixed"

/** what a function needs from the parser: the registers and pgf's error reporting */
export interface PgfMathCtx {
  a: TexArith
  /** \pgfmath@error: a PGF Math error TeX reports (and goes on) */
  error(message: string): void
}

/** a pgfmath function: its arity (`...`: any number, handed over as one braced list) and its macro */
export interface PgfFunction { arity: number | "..."; fn: (m: PgfMathCtx, args: string[]) => string }

const pt = (m: PgfMathCtx, s: string) => m.a.dimen(`${s}pt`)

/** \pgfmath@returnone: the register reassigned (attach_sign's bound applies) and printed */
const returnOne = (m: PgfMathCtx, x: number) => toNumber(m.a.reassign(x))

/** `\c@pgfmath@counta\the<dimen>`: the integer part, and the rest (`.5pt`) pgf's \afterassignment reads */
const intPart = (m: PgfMathCtx, x: number) => m.a.int(`${toNumber(x)}pt`)

/**
 * The undelimited arguments TeX takes from a list such as `{1}{2}{3}` (spaces skipped, one token or one
 * braced group each, braces stripped).
 */
export function texArgs(s: string): string[] {
  const out: string[] = []
  let i = 0
  for (;;) {
    while (s[i] === " ") i++
    if (i >= s.length) return out
    if (s[i] !== "{") { out.push(s[i++]); continue }
    let depth = 0, j = i
    for (; j < s.length; j++) {
      if (s[j] === "{") depth++
      else if (s[j] === "}" && --depth === 0) break
    }
    out.push(s.slice(i + 1, j))
    i = j + 1
  }
}

/** \pgfmathdivide@ (basic): TeX's \divide for an integer divisor, the reciprocal below 1, else long division */
function divide(m: PgfMathCtx, a: string, b: string): string {
  let x = pt(m, a), y = pt(m, b)
  let sign = ""
  if (y === 0) m.error(`You've asked me to divide \`${a}' by \`${b}', but I cannot divide any number by \`${b}'`)
  const { value: counta, rest } = intPart(m, y)
  if (m.a.dimen(rest) === 0) x = m.a.divide(x, counta)
  else {
    if (x < 0) { sign = "-"; x = -x }
    if (y < 0) { sign += "-"; y = -y }
    if (y < UNITY) x = m.a.times(sign + reciprocal(m, toNumber(y)), x)
    else x = pt(m, sign + longDivision(m, x, y))
  }
  return returnOne(m, x)
}

/** \pgfmathdivide@@: the quotient's digits, one \divide each, the divisor shifted a decimal place at a time */
function longDivision(m: PgfMathCtx, x: number, y: number): string {
  const small = pt(m, "0.00002") // \pgfmath@small@number
  let result = "0", period = true
  while (small < x && small < y) {
    if (y > x) {
      if (period) { result += "."; period = false }
      y = dimenByTen(m, y)
      if (y > x) result += "0"
    } else {
      let counta = m.a.divide(x, y)
      x -= m.a.times(String(counta), y)
      let append = true
      // behind the period a "digit" can be 10 or more: carry one into the last digit
      if (!period && counta > 9) {
        result = advanceLastDigit(m, result)
        counta -= 10
        if (counta === 0) append = false
      }
      if (append) result += String(counta)
    }
  }
  return result
}

/** \pgfmathdivide@advance@last@digit: one unit of the last decimal place (at most five) added, printed without a trailing .0 */
function advanceLastDigit(m: PgfMathCtx, result: string): string {
  const digits = result.length - result.indexOf(".") - 1
  const ya = pt(m, result) + pt(m, ["1", "0.1", "0.01", "0.001", "0.0001"][digits] ?? "0.00001")
  const [int, frac] = toNumber(ya).split(".") // \pgfmath@tonumber@notrailingzero
  return `${int}.${Number(frac) === 0 ? "" : frac}`
}

/** \pgfmathdivide@dimenbyten: the printed number's integer part moved one place into the fraction */
function dimenByTen(m: PgfMathCtx, y: number): number {
  const [int, frac] = toNumber(y).split(".")
  const i = m.a.int(int).value
  const tens = m.a.divide(i, 10)
  const ones = m.a.multiplyInt(tens, -10) + i
  return pt(m, `${tens}.${ones}${frac}`)
}

/** \pgfmathreciprocal@: 1/x from 10^9 divided by x's digits (five decimals, three above 100) */
function reciprocal(m: PgfMathCtx, s: string): string {
  let x = pt(m, s)
  if (x === 0) m.error(`You asked me to calculate \`1/${s}', but I cannot divide any number by zero`)
  const temp = toNumber(x)
  const dot = temp.indexOf(".")
  const int = temp.slice(0, dot), d = (temp.slice(dot + 1) + "0000000").slice(0, 5)
  if (m.a.int(d).value === 0) {
    x = m.a.divide(UNITY, m.a.int(int).value) // an integer: TeX's \divide
  } else {
    const big = m.a.int(int).value > 100
    let counta = m.a.int(big ? int + d.slice(0, 3) : int + d).value
    let countb = m.a.divide(1000000000, counta)
    counta = m.a.divide(countb, 10000)
    x = pt(m, String(counta))
    countb += m.a.multiplyInt(counta, -10000)
    let y = pt(m, String(countb))
    if (big) y = m.a.divide(y, 1000000)
    else for (let k = 0; k < 4; k++) y = m.a.times(".1", y) // "Yes! This way is more accurate. Go figure..."
    x += y
  }
  return returnOne(m, x)
}

/** \pgfmathmod@: a − b·⌊a/b⌋ with the quotient truncated by \divide on the sp values */
function mod(m: PgfMathCtx, a: string, b: string): string {
  const xa = pt(m, a)
  let xb = pt(m, b)
  const counta = m.a.divide(xa, xb)
  xb = m.a.multiplyDimen(xb, counta)
  return returnOne(m, xa - xb)
}

/** \pgfmathln@: the argument scaled by 2^k into [1, 2] (or so), then A+(B+(C+(D+(E+F·x)·x)·x)·x)·x, plus k, times ln 2 */
function ln(m: PgfMathCtx, a: string): string {
  let x = pt(m, a)
  if (!(x > 0)) m.error(`I cannot calculate the logarithm of \`${a}'`)
  let k = 0
  const p = (s: string) => pt(m, s)
  if (x > p("2")) {
    // \ifdim x<2^(k+1)pt, nested; 13 at most
    k = 1
    while (k < 13 && !(x < p(String(2 ** (k + 1))))) k++
    x = m.a.divide(x, 2 ** k)
  } else if (x < p("1")) {
    const gt = (s: string) => x > p(s)
    if (gt("0.0078125")) {
      if (gt("0.125")) k = gt("0.5") ? -1 : -2
      else if (gt("0.03125")) k = gt("0.0625") ? -3 : -4
      else k = gt("0.015625") ? -5 : -6
    } else if (gt("0.00048828125")) {
      if (gt("0.001953125")) k = gt("0.00390625") ? -7 : -8
      else k = gt("0.0009765625") ? -9 : -10
    } else if (gt("0.0001220703125")) k = gt("0.0002441406256") ? -11 : -12
    else k = -13
    x = m.a.multiplyDimen(x, 2 ** -k)
  }
  const temp = toNumber(x)
  x = m.a.times("0.04300521312", x)
  x += p("-.4025153233")
  x = m.a.times(temp, x)
  x += p("1.589480044")
  x = m.a.times(temp, x)
  x += p("-3.489886985")
  x = m.a.times(temp, x)
  x += p("5.047861502")
  x = m.a.times(temp, x)
  x += p("-2.787927935")
  x += p(String(k))
  x = m.a.times("0.6931471806", x)
  return returnOne(m, x)
}

/** \pgfmathexp@: the series 1 + x + x²/2! + … until it stops changing; 1/e^|x| for negative x; 1sp below −9 */
function exp(m: PgfMathCtx, a: string): string {
  let xc = pt(m, a)
  const yc = pt(m, a)
  let x: number
  if (xc < pt(m, "-9")) x = 1
  else {
    if (xc < 0) xc = -xc
    x = UNITY
    let xa = UNITY, xb = x
    for (let counter = 1; ; counter++) {
      xa = m.a.divide(xa, counter)
      xa = m.a.times(toNumber(xc), xa)
      x += xa
      // \ifdim and the assignment read x through scan_dimen: past max_dimen, max_dimen (and an error each)
      if (m.a.reassign(x) === xb) break
      xb = m.a.reassign(x)
    }
    if (yc < 0) x = pt(m, reciprocal(m, toNumber(x)))
  }
  return returnOne(m, x)
}

/** \pgfmathpow@: repeated squaring for an integer exponent (through the reciprocal if negative), else exp(y·ln x) */
function pow(m: PgfMathCtx, a: string, b: string): string {
  let xa = pt(m, a)
  const xb = pt(m, b)
  let x: number
  if (xa === 0) x = xb === 0 ? UNITY : 0
  else {
    let { value: counta, rest } = intPart(m, xb)
    x = m.a.dimen(rest) // \afterassignment\pgfmath@x
    if (counta < 0) {
      counta = -counta
      xa = pt(m, reciprocal(m, a))
    }
    if (x === 0) {
      x = UNITY
      while (counta > 0) {
        if (counta % 2 !== 0) x = m.a.times(toNumber(x), xa)
        if (counta > 1) xa = m.a.times(toNumber(xa), xa)
        counta = m.a.divide(counta, 2)
      }
    } else {
      x = pt(m, ln(m, a))
      x = m.a.times(toNumber(xb), x)
      x = pt(m, exp(m, toNumber(x)))
    }
  }
  return returnOne(m, x)
}

/** \pgfmathmax@ / \pgfmathmin@: from ∓16383pt, each item until an empty one */
function extremum(m: PgfMathCtx, list: string, larger: boolean): string {
  let x = pt(m, larger ? "-16383" : "16383")
  for (const item of texArgs(list)) {
    if (item === "") break
    const v = pt(m, item)
    if (larger ? v > x : v < x) x = v
  }
  return returnOne(m, x)
}

/**
 * \pgfmathscientific (misc): #1e#2 with the mantissa's digits kept (five and five decimals) and 10^|#2| from
 * \pgfmathpow@ as an integer factor; below e−4 the result is 0.
 */
export function scientific(m: PgfMathCtx, mantissa: string, exponent: number): string {
  let x = pt(m, mantissa)
  let sign = "+", temp = mantissa
  if (x < 0) { sign = "-"; temp = mantissa.slice(1) }
  if (!mantissa.includes(".")) temp += ".0"
  const dot = temp.indexOf(".")
  const int = temp.slice(0, dot), digits = temp.slice(dot + 1) + "00000000000"
  const mantissaA = digits.slice(0, 5), mantissaB = digits.slice(5, 10)
  if (exponent < -4) x = 0
  else {
    const factor = String(m.a.int(pow(m, "10", String(Math.abs(exponent)))).value)
    if (exponent < 0) x = m.a.divide(pt(m, `${int}.${mantissaA}`), m.a.int(factor).value)
    else {
      const f = m.a.int(factor).value
      let counta = m.a.multiplyInt(m.a.int(int).value, f)
      let countb = m.a.multiplyInt(m.a.int(mantissaA).value, f)
      let countc = countb
      countb = m.a.divide(countb, 100000)
      counta += countb
      countb = m.a.multiplyInt(countb, 100000)
      countc -= countb
      countb = m.a.divide(m.a.multiplyInt(m.a.int(mantissaB).value, f), 100000)
      countc += countb + 100000
      x = pt(m, `${sign}${counta}.${String(countc).slice(1)}`)
    }
  }
  return returnOne(m, x)
}

const f1 = (fn: (m: PgfMathCtx, a: string) => string): PgfFunction => ({ arity: 1, fn: (m, [a]) => fn(m, a) })
const f2 = (fn: (m: PgfMathCtx, a: string, b: string) => string): PgfFunction => ({ arity: 2, fn: (m, [a, b]) => fn(m, a, b) })
const constant = (v: string): PgfFunction => ({ arity: 0, fn: () => v })

/** the functions by name (\pgfmathdeclarefunction), with the parser's operators' names among them */
export const FUNCTIONS: Record<string, PgfFunction> = {
  add: f2((m, a, b) => returnOne(m, pt(m, a) + pt(m, b))), // \advance: no overflow check until the return
  subtract: f2((m, a, b) => returnOne(m, pt(m, a) - pt(m, b))),
  neg: f1((m, a) => toNumber(pt(m, `-${a}`))),
  multiply: f2((m, a, b) => {
    const x = pt(m, a), y = pt(m, b)
    return returnOne(m, m.a.times(toNumber(y), x))
  }),
  divide: f2(divide),
  reciprocal: f1(reciprocal),
  mod: f2(mod),
  Mod: f2((m, a, b) => {
    let x = pt(m, mod(m, a, b))
    if (x < 0) x += pt(m, b)
    return toNumber(x)
  }),
  abs: f1((m, a) => {
    const x = pt(m, a)
    return returnOne(m, x < 0 ? -x : x)
  }),
  sign: f1((m, a) => {
    const x = pt(m, a)
    return x > 0 ? "1" : x === 0 ? "0" : "-1"
  }),
  real: f1((m, a) => toNumber(pt(m, a))),
  round: f1((m, a) => {
    const x = pt(m, a)
    const { value, rest } = intPart(m, x)
    let counta = value
    if (m.a.dimen(rest) >= UNITY / 2) counta += x < 0 ? -1 : 1
    return toNumber(pt(m, String(counta)))
  }),
  floor: f1((m, a) => {
    const x = pt(m, a)
    const { value, rest } = intPart(m, x)
    let counta = value
    if (x < 0 && m.a.dimen(rest) > 0) counta -= 1
    return returnOne(m, pt(m, String(counta)))
  }),
  ceil: f1((m, a) => {
    let x = pt(m, a)
    const { value: counta } = intPart(m, x)
    const y = x + pt(m, `-${counta}`)
    x = pt(m, String(counta))
    if (y > 0) x += UNITY
    return returnOne(m, x)
  }),
  max: { arity: "...", fn: (m, [list]) => extremum(m, list, true) },
  min: { arity: "...", fn: (m, [list]) => extremum(m, list, false) },
  pow: f2(pow),
  ln: f1(ln),
  log2: f1((m, a) => returnOne(m, m.a.times("1.442695041", pt(m, ln(m, a))))),
  log10: f1((m, a) => returnOne(m, m.a.times("0.43429441", pt(m, ln(m, a))))),
  exp: f1(exp),
  e: constant("2.718281828"),
  pi: constant("3.141592654"),
}
