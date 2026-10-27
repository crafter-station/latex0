// TeX's scanners for numbers, dimensions and glue, "TeX: The Program"
// §§ 440–463, integer-exact. They read a source string the way TeX reads
// tokens: a run of spaces is one space token, control words swallow the spaces
// after them, and keywords match letters in either case. Errors are TeX's
// messages, with TeX's recovery (§§ 446, 456, 459, 460).

import { UNITY } from "./arith"

export const MAX_DIMEN = 0o7777777777 // 2^30 - 1
const INFINITY = 0o17777777777 // 2^31 - 1
const TWO = 0o400000 // 2^17

export type Order = 0 | 1 | 2 | 3 // normal, fil, fill, filll
export interface GlueSpec { width: number; stretch: number; stretchOrder: Order; shrink: number; shrinkOrder: Order }

/** An internal quantity (a register or parameter) as § 413 would fetch it. */
export type Internal = { level: "int"; value: number } | { level: "dimen"; value: number } | { level: "glue"; value: GlueSpec }

export interface ScanEnv {
  /** quad and x-height of the current font (§§ 455, 558) */
  em: number
  ex: number
  /** pdfTeX's \pdfpxdimen, for px; default 1bp (65782sp) as in pdfTeX */
  px?: number
  /** \mag, for true units (§ 457); default 1000 */
  mag?: number
  /** Resolve a control sequence to an internal quantity. It may scan further (a register number). */
  internal?: (name: string, s: Scanner) => Internal | undefined
}

type Tok = { cs: string; ch?: undefined; end: number } | { cs?: undefined; ch: string; end: number }
const isSpace = (c: string) => c === " " || c === "\n" || c === "\t" || c === "\r"
const isLetter = (c: string) => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z")

/** round_decimals (§ 102): k decimal digits → the nearest fraction of 2^16. */
export function roundDecimals(digits: number[]): number {
  let a = 0
  for (let k = digits.length - 1; k >= 0; k--) a = Math.trunc((a + digits[k] * TWO) / 10)
  return Math.trunc((a + 1) / 2)
}

export class Scanner {
  pos = 0
  readonly errors: string[] = []
  private arithError = false
  constructor(readonly src: string, readonly env: ScanEnv) {}

  /** The token at `pos` without consuming it (null at the end). */
  peek(at = this.pos): Tok | null {
    const s = this.src
    if (at >= s.length) return null
    const c = s[at]
    if (isSpace(c)) {
      let j = at + 1
      while (j < s.length && isSpace(s[j])) j++
      return { ch: " ", end: j }
    }
    if (c !== "\\") return { ch: c, end: at + 1 }
    let j = at + 1
    if (j < s.length && isLetter(s[j])) {
      while (j < s.length && isLetter(s[j])) j++
      const name = s.slice(at + 1, j)
      while (j < s.length && isSpace(s[j])) j++ // state S after a control word
      return { cs: name, end: j }
    }
    return { cs: s[j] ?? "", end: Math.min(j + 1, s.length) }
  }
  private next(): Tok | null { const t = this.peek(); if (t) this.pos = t.end; return t }
  rest(): string { return this.src.slice(this.pos) }

  /** <Scan an optional space> (§ 443) */
  private optionalSpace() { const t = this.peek(); if (t?.ch === " ") this.pos = t.end }
  /** <Get the next non-blank non-sign token> (§ 441): skips spaces and signs; true if negative. Leaves pos at the token. */
  private signs(): boolean {
    let negative = false
    for (;;) {
      const t = this.peek()
      if (t?.ch === " ") { this.pos = t.end; continue }
      if (t?.ch === "-") { negative = !negative; this.pos = t.end; continue }
      if (t?.ch === "+") { this.pos = t.end; continue }
      return negative
    }
  }
  /** scan_keyword (§ 407): optional leading spaces, then the letters in either case. */
  keyword(word: string): boolean {
    let p = this.pos
    let t = this.peek(p)
    while (t?.ch === " ") { p = t.end; t = this.peek(p) }
    for (const c of word) {
      if (!t || t.ch === undefined || (t.ch !== c && t.ch !== c.toUpperCase())) return false
      p = t.end; t = this.peek(p)
    }
    this.pos = p
    return true
  }
  private internal(): Internal | undefined {
    const t = this.peek()
    if (!t || t.cs === undefined || !this.env.internal) return undefined
    const save = this.pos
    this.pos = t.end
    const q = this.env.internal(t.cs, this)
    if (!q) this.pos = save
    return q
  }

  /** scan_int (§ 440) */
  scanInt(): { value: number; radix: number; /** the number ended with a space token, which it consumed */ spaced: boolean } {
    const negative = this.signs()
    let value: number, radix = 0, spaced = false
    const t = this.peek()
    const q = t?.ch === "`" ? undefined : this.internal()
    if (t?.ch === "`") {
      // § 442: an alphabetic constant, then an optional space
      this.pos = t.end
      const c = this.peek()
      const code = c?.ch ?? (c?.cs.length === 1 ? c.cs : undefined)
      if (c && code !== undefined) { value = code.codePointAt(0)!; this.pos = c.end; this.optionalSpace() }
      else { this.errors.push("Improper alphabetic constant"); value = 48 } // back_error: the token stays
    } else if (q) {
      value = q.level === "int" ? q.value : q.level === "dimen" ? q.value : q.value.width // coerced (§ 429)
    } else {
      // § 444: a numeric constant
      radix = 10
      let m = 214748364
      if (t?.ch === "'") { radix = 8; m = 0o2000000000; this.pos = t.end }
      else if (t?.ch === '"') { radix = 16; m = 0o1000000000; this.pos = t.end }
      let vacuous = true, ok = true
      value = 0
      for (;;) {
        const u = this.peek()
        const c = u?.ch
        let d: number
        if (c !== undefined && c >= "0" && c <= "9" && c.charCodeAt(0) - 48 < radix) d = c.charCodeAt(0) - 48
        else if (radix === 16 && c !== undefined && c >= "A" && c <= "F") d = c.charCodeAt(0) - 55
        else break
        vacuous = false
        if (value >= m && (value > m || d > 7 || radix !== 10)) {
          if (ok) { this.errors.push("Number too big"); value = INFINITY; ok = false }
        } else value = value * radix + d
        this.pos = u!.end
      }
      if (vacuous) { this.errors.push("Missing number, treated as zero"); value = 0 }
      else if (this.peek()?.ch === " ") { this.optionalSpace(); spaced = true }
    }
    if (negative) value = -value
    return { value, radix, spaced }
  }

  /** scan_dimen (§ 448): `mu` for math units, `inf` to allow fil units; sets the order. */
  scanDimen(mu = false, inf = false, shortcut?: number): { value: number; order: Order } {
    let f = 0, order: Order = 0, negative = false, value: number
    this.arithError = false
    attach: {
      if (shortcut === undefined) {
        negative = this.signs()
        const q = this.internal()
        if (q && q.level !== "int") { value = q.level === "dimen" ? q.value : q.value.width; break attach } // § 449
        if (q) value = q.value
        else {
          const t = this.peek()
          let radix = 10, spaced = false
          if (t?.ch === "." || t?.ch === ",") value = 0
          else ({ value, radix, spaced } = this.scanInt())
          const u = this.peek()
          if (radix === 10 && !spaced && (u?.ch === "." || u?.ch === ",")) {
            // § 452: up to 17 digits matter; one space after them is consumed
            this.pos = u.end
            const digits: number[] = []
            for (let d = this.peek(); d?.ch !== undefined && d.ch >= "0" && d.ch <= "9"; d = this.peek()) {
              if (digits.length < 17) digits.push(d.ch.charCodeAt(0) - 48)
              this.pos = d.end
            }
            f = roundDecimals(digits)
            this.optionalSpace()
          }
        }
      } else value = shortcut
      if (value < 0) { negative = !negative; value = -value }

      // § 453: units
      fraction: {
        if (inf && this.keyword("fil")) { // § 454
          order = 1
          while (this.keyword("l")) {
            if (order === 3) this.errors.push("Illegal unit of measure (replaced by filll)")
            else order = (order + 1) as Order
          }
          break fraction
        }
        // § 455: units that are internal dimensions, then em, ex (and pdfTeX's px)
        const save = value
        while (this.peek()?.ch === " ") this.pos = this.peek()!.end // non-blank non-call token: the blanks stay consumed
        const q = this.internal()
        let v: number | undefined
        if (q) {
          if (mu) { if (q.level === "glue") v = q.value.width; else { this.errors.push("Incompatible glue units"); v = q.level === "int" ? q.value : q.value } }
          else v = q.level === "int" ? q.value : q.level === "dimen" ? q.value : q.value.width
        } else {
          if (!mu && this.keyword("em")) { v = this.env.em; this.optionalSpace() }
          else if (!mu && this.keyword("ex")) { v = this.env.ex; this.optionalSpace() }
          else if (!mu && this.keyword("px")) { v = this.env.px ?? 65782; this.optionalSpace() } // pdfTeX
        }
        if (v !== undefined) {
          value = this.multAndAdd(save, v, this.xnOverD(v, f, 0o200000).value, MAX_DIMEN)
          break attach
        }
        if (mu) { // § 456
          if (!this.keyword("mu")) this.errors.push("Illegal unit of measure (mu inserted)")
          break fraction
        }
        if (this.keyword("true")) { // § 457
          const mag = this.env.mag ?? 1000
          if (mag !== 1000) {
            const r = this.xnOverD(value, 1000, mag)
            value = r.value
            f = Math.trunc((1000 * f + 0o200000 * r.remainder) / mag)
            value += Math.trunc(f / 0o200000); f %= 0o200000
          }
        }
        if (this.keyword("pt")) break fraction
        // § 458
        const UNITS: [string, number, number][] = [["in", 7227, 100], ["pc", 12, 1], ["cm", 7227, 254], ["mm", 7227, 2540], ["bp", 7227, 7200], ["dd", 1238, 1157], ["cc", 14856, 1157], ["nd", 685, 642], ["nc", 1370, 107]] // nd, nc: pdfTeX
        const unit = UNITS.find(([k]) => this.keyword(k))
        if (unit) {
          const [, num, denom] = unit
          const r = this.xnOverD(value, num, denom)
          value = r.value
          f = Math.trunc((num * f + 0o200000 * r.remainder) / denom)
          value += Math.trunc(f / 0o200000); f %= 0o200000
        } else if (this.keyword("sp")) {
          this.optionalSpace()
          break attach
        } else {
          this.errors.push("Illegal unit of measure (pt inserted)") // § 459
          break fraction
        }
      }
      // attach_fraction
      if (value >= 0o40000) this.arithError = true
      else value = value * UNITY + f
      this.optionalSpace()
    }
    // attach_sign (§ 460)
    if (this.arithError || Math.abs(value!) >= 0o10000000000) {
      this.errors.push("Dimension too large")
      value = MAX_DIMEN
      this.arithError = false
    }
    if (negative) value = -value!
    return { value: value!, order }
  }

  /** scan_glue (§ 461) */
  scanGlue(mu = false): GlueSpec {
    const negative = this.signs()
    let width: number
    const q = this.internal()
    if (q?.level === "glue") {
      const g = q.value
      return negative ? { width: -g.width, stretch: -g.stretch, stretchOrder: g.stretchOrder, shrink: -g.shrink, shrinkOrder: g.shrinkOrder } : { ...g }
    }
    if (q?.level === "int") width = this.scanDimen(mu, false, negative ? -q.value : q.value).value
    else if (q?.level === "dimen") width = negative ? -q.value : q.value
    else { width = this.scanDimen(mu, false).value; if (negative) width = -width }
    // § 462
    const g: GlueSpec = { width, stretch: 0, stretchOrder: 0, shrink: 0, shrinkOrder: 0 }
    if (this.keyword("plus")) { const d = this.scanDimen(mu, true); g.stretch = d.value; g.stretchOrder = d.order }
    if (this.keyword("minus")) { const d = this.scanDimen(mu, true); g.shrink = d.value; g.shrinkOrder = d.order }
    return g
  }

  /** xn_over_d (§ 107) with its remainder; overflow sets arith_error as TeX does. */
  private xnOverD(x: number, n: number, d: number): { value: number; remainder: number } {
    const positive = x >= 0
    if (!positive) x = -x
    const t = (x % 0o100000) * n
    let u = Math.floor(x / 0o100000) * n + Math.floor(t / 0o100000)
    const v = (u % d) * 0o100000 + (t % 0o100000)
    if (Math.floor(u / d) >= 0o100000) this.arithError = true
    else u = 0o100000 * Math.floor(u / d) + Math.floor(v / d)
    return positive ? { value: u, remainder: v % d } : { value: -u, remainder: -(v % d) }
  }

  /** mult_and_add (§ 105): n·x + y, or arith_error past max_answer. */
  private multAndAdd(n: number, x: number, y: number, maxAnswer: number): number {
    if (n < 0) { x = -x; n = -n }
    if (n === 0) return y
    if (x <= Math.trunc((maxAnswer - y) / n) && -x <= Math.trunc((maxAnswer + y) / n)) return n * x + y
    this.arithError = true
    return 0
  }
}

/**
 * e-TeX's \dimexpr (etex.ch, scan_expr), read after the \dimexpr: terms added and subtracted, each a dimension or a
 * parenthesized expression, times an integer (then perhaps divided by one: one rounded step) or divided by one (rounded,
 * halves away from zero); a \relax after it is consumed
 */
export function dimexpr(s: Scanner): number {
  const skip = () => { for (let t = s.peek(); t?.ch === " "; t = s.peek()) s.pos = t.end }
  const round = (a: number, d: number): number => { // a/d rounded, halves away from zero
    if (d === 0) throw new Error("\\dimexpr: division by zero")
    if (!Number.isSafeInteger(2 * a)) throw new Error("\\dimexpr: a product too large here")
    const q = Math.floor((2 * Math.abs(a) + Math.abs(d)) / (2 * Math.abs(d)))
    return (a < 0) !== (d < 0) ? -q : q
  }
  const factor = (): number => {
    skip()
    const t = s.peek()
    if (t?.ch !== "(") return s.scanDimen().value
    s.pos = t.end
    const v = expr()
    skip()
    const c = s.peek()
    if (c?.ch !== ")") throw new Error("\\dimexpr: missing )")
    s.pos = c.end
    return v
  }
  const term = (): number => {
    let v = factor()
    for (;;) {
      skip()
      const t = s.peek()
      if (t?.ch === "*") {
        s.pos = t.end
        const n = s.scanInt().value
        skip()
        const u = s.peek()
        if (u?.ch === "/") { s.pos = u.end; v = round(v * n, s.scanInt().value) }
        else v = v * n
      } else if (t?.ch === "/") { s.pos = t.end; v = round(v, s.scanInt().value) }
      else return v
    }
  }
  const expr = (): number => {
    let v = term()
    for (;;) {
      skip()
      const t = s.peek()
      if (t?.ch === "+") { s.pos = t.end; v += term() }
      else if (t?.ch === "-") { s.pos = t.end; v -= term() }
      else break
    }
    if (Math.abs(v) > MAX_DIMEN) throw new Error("\\dimexpr: arithmetic overflow")
    return v
  }
  const v = expr()
  const t = s.peek()
  if (t?.cs === "relax") s.pos = t.end
  return v
}

/** A whole string as one dimension, e.g. "12.5pt", ".3\\textwidth". Throws on TeX errors or leftovers. */
export function parseDimen(src: string, env: ScanEnv): number {
  const s = new Scanner(src, env)
  const { value } = s.scanDimen()
  if (s.errors.length || s.rest().trim()) throw new Error(`bad dimension "${src}": ${s.errors[0] ?? `unexpected "${s.rest().trim()}"`}`)
  return value
}

/**
 * <factor><dimen register> (`.5\\dimen0`, graphics' scale factors, pgf's `0.99627\\pgf@x`): the register scaled
 * as scan_dimen does it (nx_plus_y, xn_over_d). With `errors`, TeX's errors are collected there and TeX's
 * recovery value returned (Dimension too large: ±max_dimen); without, an error throws.
 */
export function times(f: string, value: number, errors?: string[]): number {
  const env: ScanEnv = { em: 0, ex: 0, internal: (name) => (name === "reg" ? { level: "dimen", value } : undefined) }
  if (!errors) return parseDimen(`${f}\\reg`, env)
  const s = new Scanner(`${f}\\reg`, env)
  const v = s.scanDimen().value
  if (s.rest().trim()) throw new Error(`bad factor "${f}"`)
  errors.push(...s.errors)
  return v
}

/** A whole string as glue, e.g. "10pt plus 2pt minus 1fil" (shrink must be finite in paragraphs). */
export function parseGlue(src: string, env: ScanEnv): GlueSpec {
  const s = new Scanner(src, env)
  const g = s.scanGlue()
  if (s.errors.length || s.rest().trim()) throw new Error(`bad glue "${src}": ${s.errors[0] ?? `unexpected "${s.rest().trim()}"`}`)
  return g
}
