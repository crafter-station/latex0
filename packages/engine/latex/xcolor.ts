// xcolor with the dvips driver: color expressions as the \special{color push …} text they become.
// Named colors are xcolor's base set; \definecolor normalizes its numbers (\XC@calcN); RGB goes through
// the driver's \divide (truncating), HTML through xcolor's \rdivide (five digits, rounded by the sixth).

import { printScaled } from "../layout/arith"
import { roundDecimals } from "../layout/dimen"
import type { Node } from "../layout/nodes"
import { Unsupported } from "./unsupported"

export class ColorUnsupported extends Unsupported {}

/** xcolor's base colors (\definecolorset … in xcolor.sty), in the model the driver gets */
const BASE: Record<string, string> = {
  red: "rgb 1 0 0", green: "rgb 0 1 0", blue: "rgb 0 0 1", brown: "rgb 0.75 0.5 0.25", lime: "rgb 0.75 1 0", orange: "rgb 1 0.5 0",
  pink: "rgb 1 0.75 0.75", purple: "rgb 0.75 0 0.25", teal: "rgb 0 0.5 0.5", violet: "rgb 0.5 0 0.5",
  cyan: "cmyk 1 0 0 0", magenta: "cmyk 0 1 0 0", yellow: "cmyk 0 0 1 0", olive: "cmyk 0 0 1 0.5",
  black: "gray 0", darkgray: "gray 0.25", gray: "gray 0.5", lightgray: "gray 0.75", white: "gray 1",
}

/** \strip@pt of a dimension in sp */
const stripPt = (sp: number) => printScaled(sp).replace(/\.0$/, "")

/** the dvips driver's \color@RGB: each value \divide'd by 255 as a dimension in pt */
const driverRGB = (v: number) => stripPt(Math.trunc((v * 65536) / 255))

/** xcolor's \rdivide of v by 255 (for HTML): five digits of the quotient, then 1sp more if the sixth is over 4 */
function rdivide255(v: number): string {
  const b = 255 * 65536
  let a = v * 65536, count = Math.trunc(a / b)
  const digits: number[] = []
  for (let i = 0; i < 6; i++) {
    a = (a - count * b) * 10
    count = Math.trunc(a / b)
    if (i < 5) digits.push(count)
  }
  const whole = Math.trunc(v / 255)
  let sp = whole * 65536 + roundDecimals(digits)
  if (count > 4) sp += 1
  return stripPt(sp)
}

/** \XC@calcN: a number as \definecolor keeps it (0.5 for .5, 1 for 1.0; anything from 1 up is 1) */
function calcN(x: string): string {
  const m = x.trim().match(/^(\d*)(?:\.(\d*))?$/)
  if (!m) throw new ColorUnsupported(`color value ${x}`)
  if (Number(m[1] || "0") > 0) return "1"
  const frac = ((m[2] ?? "") + "00000").slice(0, 5).replace(/0+$/, "")
  return frac ? `0.${frac}` : "0"
}

const values = (s: string) => s.split(",").map((x) => x.trim())

/** a decimal as TeX scans it before a unit: its integer part and the fraction of 2^16 (round_decimals, 17 digits) */
function decimal(x: string): { neg: boolean; int: number; frac: number } {
  const m = x.trim().match(/^(-?)(\d*)(?:\.(\d*))?$/)
  if (!m) throw new ColorUnsupported(`number ${x}`)
  return { neg: m[1] === "-", int: Number(m[2] || "0"), frac: roundDecimals([...(m[3] ?? "").slice(0, 17)].map(Number)) }
}
/** "x\dimen": the decimal times a dimension (x's integer part times it, plus xn_over_d by the fraction) */
function times(x: string, d: number): number {
  const { neg, int, frac } = decimal(x)
  const v = int * d + Math.floor((d * frac) / 65536)
  return neg ? -v : v
}
/** \rshift: \the\dimen with the decimal point one place to the left, scanned again */
function rshift(sp: number): number {
  const neg = sp < 0, t = printScaled(Math.abs(sp))
  const [i, f] = t.split(".")
  const shifted = `${i.slice(0, -1) || "0"}.${i.slice(-1)}${f}`
  const v = times(shifted, 65536)
  return neg ? -v : v
}

type Model = "rgb" | "cmyk" | "gray"
interface Col { model: Model; v: string[] }
const parseSpec = (s: string): Col => { const [model, ...v] = s.split(" "); return { model: model as Model, v } }
/** a color in another model, for a mix: gray to rgb or cmyk, and white and black in any */
function convert(c: Col, to: Model): Col {
  if (c.model === to) return c
  if (c.model === "gray" && to === "rgb") return { model: to, v: [c.v[0], c.v[0], c.v[0]] }
  if (c.model === "gray" && to === "cmyk") return { model: to, v: ["0", "0", "0", stripPt(65536 - times(c.v[0], 65536))] }
  throw new ColorUnsupported(`a ${c.model} color mixed into ${to}`)
}

/** The colors of a document: xcolor's base set and \definecolor's */
export class Colors {
  private defs = new Map<string, string>(Object.entries(BASE))

  /** a model and its values as the driver's \special text, raw (\textcolor[model]{…}) or normalized (\definecolor) */
  private modelSpec(model: string, vals: string, normalize: boolean): string {
    const n = (x: string) => (normalize ? calcN(x) : x)
    const v = values(vals)
    switch (model) {
      case "rgb": if (v.length !== 3) break; return `rgb ${v.map(n).join(" ")}`
      case "cmyk": if (v.length !== 4) break; return `cmyk ${v.map(n).join(" ")}`
      case "gray": if (v.length !== 1) break; return `gray ${n(v[0])}`
      case "RGB": if (v.length !== 3 || !v.every((x) => /^\d+$/.test(x) && Number(x) <= 255)) break; return `rgb ${v.map((x) => driverRGB(Number(x))).join(" ")}`
      case "HTML": {
        const h = vals.trim()
        if (!/^[0-9A-Fa-f]{6}$/.test(h)) break
        return `rgb ${[0, 2, 4].map((i) => rdivide255(parseInt(h.slice(i, i + 2), 16))).join(" ")}`
      }
    }
    throw new ColorUnsupported(`color [${model}]{${vals}}`)
  }

  /** whether the name is a defined color (\@ifundefinedcolor) */
  has(name: string) { return this.defs.has(name) }

  /** \definecolor{name}{model}{values} */
  define(name: string, model: string, vals: string) { this.defs.set(name.trim(), this.modelSpec(model.trim(), vals, true)) }

  /** \color[model]{spec} or \color{expression}: the \special text */
  spec(expr: string, model?: string): string {
    if (model !== undefined) return this.modelSpec(model.trim(), expr, false)
    const e = expr.replace(/\s+/g, "")
    // name!p!name!p…, with white after a last percentage; - (once) for the complement (names may hold . and @)
    const m = e.match(/^(-?)([A-Za-z][A-Za-z0-9.@]*)((?:!\d+(?:\.\d+)?(?:![A-Za-z][A-Za-z0-9.@]*)?)*)!?$/)
    if (!m) throw new ColorUnsupported(`color ${expr}`)
    const named = (n: string): Col => { const d = this.defs.get(n); if (d === undefined) throw new ColorUnsupported(`color ${n}`); return parseSpec(d) }
    let c = named(m[2])
    for (const step of m[3].matchAll(/!(\d+(?:\.\d+)?)(?:!([A-Za-z][A-Za-z0-9.@]*))?/g)) {
      const d = convert(named(step[2] ?? "white"), c.model)
      // \XC@mix: each part p\p@ times the first and (100-p)\p@ times the second, \rrshift'ed
      const a = times(step[1], 65536), b = 100 * 65536 - a
      c = { model: c.model, v: c.v.map((x, i) => stripPt(rshift(rshift(times(x, a) + times(d.v[i], b))))) }
    }
    if (m[1]) {
      if (c.model === "rgb") c = { model: c.model, v: c.v.map((x) => stripPt(65536 - times(x, 65536))) }
      else throw new ColorUnsupported(`the complement of a ${c.model} color`)
    }
    return `${c.model} ${c.v.join(" ")}`
  }
}

/** \color[model]{spec} in a style */
export const COLOR_CMD = /\\color\s*(?:\[([^\]{}]*)\])?\s*\{([^{}]*)\}/g

/** xcolor (dvips driver): \set@color's push and \reset@color's pop; the document's color while it is loaded */
/** a color package is loaded (xcolor, or color: siunitx loads it at \begin{document}), and the default color as
 *  the driver gets it: xcolor's black, or color.sty's named Black (dvips.def's \current@color " Black") */
export const xcolor = { on: false, normal: "gray 0" }
export const colorPush = (spec = xcolor.normal): Node => ({ kind: "whatsit", text: `\\special{color push ${spec}}` })
export const colorPop = (): Node => ({ kind: "whatsit", text: "\\special{color pop}" })
/** with xcolor, \color@setgroup (\sbox, \mbox): the current color pushed in the box and popped at its end */
export const setgroup = (nodes: Node[]): Node[] => (xcolor.on ? [colorPush(), ...nodes, colorPop()] : nodes)
