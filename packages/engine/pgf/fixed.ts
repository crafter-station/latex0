// pgf's fixed-point core. Every number pgf computes lives in a TeX register: a dimen register holding the
// value in sp (\pgf@x, \pgfmath@x, …) or a count register, and every number it writes is such a register
// printed with \the (\pgf@sys@tonumber). So the arithmetic here is TeX's, integer-exact: assignments
// scanned by scan_dimen and scan_int (layout/dimen.ts), \advance, \multiply and \divide (§§ 1236–1240),
// with TeX's errors and TeX's recovery values.

import { printScaled } from "../layout/arith"
import { MAX_DIMEN, Scanner, times, type ScanEnv } from "../layout/dimen"
import { Unsupported } from "../latex/unsupported"

/** \pgf@sys@tonumber (pgfsys.code.tex): the register as \the prints it, without the pt */
export const toNumber = printScaled

/** \pgf@sys@bp: the dimension in big points, 0.99627 of its pt, as the protocol gets it (without the trailing space) */
export const sysBp = (x: number): string => printScaled(times("0.99627", x))

/** \pgf@sys@pt: the dimension in pt, as the protocol gets it (without the trailing space) */
export const sysPt = (x: number): string => printScaled(x)

const MAX_INT = 0o17777777777 // 2^31 - 1

/** TeX's register arithmetic as pgf's macros drive it. Errors TeX would report collect in `errors`. */
export class TexArith {
  readonly errors: string[] = []
  private readonly env: ScanEnv
  constructor(units: { em: number; ex: number }) {
    this.env = { em: units.em, ex: units.ex }
  }

  /** `<dimen register>=<src>\relax`: scan_dimen of the whole of `src` */
  dimen(src: string): number {
    const s = new Scanner(src, this.env)
    const v = s.scanDimen().value
    this.check(s, src, ["Dimension too large"])
    return v
  }

  /**
   * `<count register>=<src>`: scan_int at the start of `src`. TeX goes on with what scan_int left, which
   * pgf's \afterassignment then reads (`\c@pgfmath@counta\the\pgfmath@x` leaves `.5pt`).
   */
  int(src: string): { value: number; rest: string } {
    const s = new Scanner(src, this.env)
    const { value } = s.scanInt()
    this.check(s, src, ["Number too big"], true)
    return { value, rest: s.rest() }
  }

  /** `<dimen register>=<factor><dimen register>` (`\pgfmath@x=0.5\pgfmath@x`) */
  times(f: string, x: number): number {
    return times(f, x, this.errors)
  }

  /**
   * A register's value as scan_dimen reads it (`\pgfmath@x\pgfmath@x`, `\ifdim\pgfmath@x=…`): past ±max_dimen,
   * which only \advance can reach, attach_sign (§ 460) complains and reads max_dimen, positive.
   */
  reassign(x: number): number {
    if (Math.abs(x) < 0o10000000000) return x
    this.errors.push("Dimension too large")
    return MAX_DIMEN
  }

  /** `\multiply<dimen register> by n`: nx_plus_y (§ 105); on overflow TeX complains and leaves the register */
  multiplyDimen(x: number, n: number): number {
    return this.multAndAdd(n, x, MAX_DIMEN)
  }

  /** `\multiply<count register> by n`: mult_integers (§ 105) */
  multiplyInt(x: number, n: number): number {
    return this.multAndAdd(n, x, MAX_INT)
  }

  /** `\divide<register> by n`: x_over_n (§ 106), truncating toward zero; by zero TeX complains and leaves the register */
  divide(x: number, n: number): number {
    if (n === 0) { this.errors.push("Arithmetic overflow"); return x }
    return Math.trunc(x / n) || 0
  }

  private multAndAdd(n: number, x: number, max: number): number {
    let a = x, b = n
    if (b < 0) { a = -a; b = -b }
    if (b === 0) return 0
    if (Math.abs(a) <= Math.trunc(max / b)) return b * a
    this.errors.push("Arithmetic overflow")
    return x
  }

  /** TeX errors outside `allowed`, or text left over, would put material into the document: not modeled */
  private check(s: Scanner, src: string, allowed: string[], partial = false) {
    for (const e of s.errors) if (!allowed.includes(e)) throw new Unsupported(`pgf: "${src}" is not a number (${e})`)
    if (!partial && s.rest().trim()) throw new Unsupported(`pgf: "${src}" is not a number`)
    this.errors.push(...s.errors)
  }
}
