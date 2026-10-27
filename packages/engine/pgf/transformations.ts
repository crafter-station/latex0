// pgf's coordinate transformations (pgfcoretransformations.code.tex, line numbers cite it): the matrix entries
// are macros holding \pgf@sys@tonumber's text, the translation two dimen registers, and every product is
// TeX's `<factor><dimen register>`, so the transformed points are TeX's to the sp. All of it is local to
// TeX's groups (PgfState.local).

import { times } from "../layout/dimen"
import { Unsupported } from "../latex/unsupported"
import type { PgfDriver } from "./drivers"
import { TexArith, toNumber } from "./fixed"
import type { PgfUnits } from "./mathparser"
import { parse, pgfPoint, pgfPointOrigin, reciprocalOf, setLength, trig, type PgfPoint, type PgfPointMacro } from "./points"
import { IDENTITY, type PgfState, type PgfTransform } from "./state"

/** `<factor><dimen register>` as TeX scans it; past max_dimen TeX would complain (not modeled) */
export function mul(factor: string, x: number): number {
  const errors: string[] = []
  const v = times(factor, x, errors)
  if (errors.length) throw new Unsupported(`pgf: ${factor} times ${toNumber(x)}pt: ${errors[0]}`)
  return v
}

/** \pgf@pos@transform@glob (74–85): the point through the current transformation */
export const transformPoint = (s: PgfState, p: PgfPoint): PgfPoint => applyTransform(s.local.transform, p)

/** \pgf@pos@transform@glob under the transformation `t` */
export function applyTransform(t: PgfTransform, p: PgfPoint): PgfPoint {
  let { x, y } = p
  if (!t.identity) {
    const temp = x
    x = mul(t.aa, x) + mul(t.ba, y)
    y = mul(t.bb, y) + mul(t.ab, temp)
  }
  return { x: x + t.x, y: y + t.y }
}

/** \pgfpointtransformed{#1} (pgfcorepoints.code.tex 43–48) */
export const pgfPointTransformed = transformPoint

/** \pgftransformcm{#1}{#2}{#3}{#4}{#5} (136–182): the matrix and the shift #5 applied before the current transformation */
export function pgfTransformCm(s: PgfState, a: string, b: string, c: string, d: string, shift: PgfPointMacro) {
  const t = s.local.transform
  const { x: xc, y: yc } = shift()
  let x = setLength(a, s), y = setLength(b, s)
  const xa = mul(t.aa, x) + mul(t.ba, y)
  const ya = mul(t.ab, x) + mul(t.bb, y)
  x = setLength(c, s); y = setLength(d, s)
  const xb = mul(t.aa, x) + mul(t.ba, y)
  const yb = mul(t.ab, x) + mul(t.bb, y)
  x = mul(t.aa, xc) + mul(t.ba, yc) + t.x
  y = mul(t.ab, xc) + mul(t.bb, yc) + t.y
  const aa = toNumber(xa), ab = toNumber(ya), ba = toNumber(xb), bb = toNumber(yb)
  const identity = `${aa},${ba},${ab},${bb}` === "1.0,0.0,0.0,1.0"
  s.setLocal({ transform: { aa, ab, ba, bb, x, y, identity } })
}

/**
 * \pgftransforminvert (156–206): the inverse of `t`, its matrix entries \pgf@sys@tonumber's text: the
 * reciprocals of a diagonal matrix, else the adjugate times the reciprocal of the determinant.
 */
export function pgfTransformInvert(t: PgfTransform, units: PgfUnits): PgfTransform {
  let x = -t.x, y = -t.y
  if (t.identity) return { ...t, x, y }
  let { aa, ab, ba, bb } = t
  if (`${ab},${ba}` === "0.0,0.0") {
    aa = reciprocalOf(aa, units)
    bb = reciprocalOf(bb, units)
  } else {
    const a = new TexArith(units)
    // \advance: no overflow check
    const det = mul(bb, a.dimen(`${aa}pt`)) - mul(ab, a.dimen(`${ba}pt`))
    let r = a.dimen(`${reciprocalOf(toNumber(det), units)}pt`)
    const nAa = toNumber(mul(bb, r)), nBb = toNumber(mul(aa, r))
    r = -r
    const nBa = toNumber(mul(ba, r)), nAb = toNumber(mul(ab, r))
    ;[aa, ab, ba, bb] = [nAa, nAb, nBa, nBb]
  }
  const temp = x
  x = mul(aa, x) + mul(ba, y)
  y = mul(bb, y) + mul(ab, temp)
  return { aa, ab, ba, bb, x, y, identity: false }
}

/** \pgftransformreset (208–216) */
export function pgfTransformReset(s: PgfState) { s.setLocal({ transform: IDENTITY }) }

/** \pgftransformresetnontranslations (220–226) */
export function pgfTransformResetNonTranslations(s: PgfState) {
  const { x, y } = s.local.transform
  s.setLocal({ transform: { ...IDENTITY, x, y } })
}

/** \pgftransformshift{#1} (232) */
export const pgfTransformShift = (s: PgfState, p: PgfPointMacro) => pgfTransformCm(s, "1", "0", "0", "1", p)
/** \pgftransformxshift{#1} (233): \pgfpoint{#1}{+0pt} */
export const pgfTransformXShift = (s: PgfState, x: string) => pgfTransformShift(s, () => pgfPoint(s, x, "+0pt"))
/** \pgftransformyshift{#1} (234): \pgfpoint{+0pt}{#1} */
export const pgfTransformYShift = (s: PgfState, y: string) => pgfTransformShift(s, () => pgfPoint(s, "+0pt", y))

/** \pgftransformscale{#1} (240) */
export const pgfTransformScale = (s: PgfState, f: string) => pgfTransformCm(s, f, "0", "0", f, pgfPointOrigin)
/** \pgftransformxscale{#1} (241) */
export const pgfTransformXScale = (s: PgfState, f: string) => pgfTransformCm(s, f, "0", "0", "1.0", pgfPointOrigin)
/** \pgftransformyscale{#1} (242) */
export const pgfTransformYScale = (s: PgfState, f: string) => pgfTransformCm(s, "1.0", "0", "0", f, pgfPointOrigin)
/** \pgftransformxslant{#1} (247) */
export const pgfTransformXSlant = (s: PgfState, f: string) => pgfTransformCm(s, "1.0", "0", f, "1.0", pgfPointOrigin)
/** \pgftransformyslant{#1} (248) */
export const pgfTransformYSlant = (s: PgfState, f: string) => pgfTransformCm(s, "1.0", f, "0", "1.0", pgfPointOrigin)

/** \pgftransformrotate{#1} (253–263): \pgfmathsin@ and \pgfmathcos@ of the angle */
export function pgfTransformRotate(s: PgfState, angle: string) {
  const a = parse(angle, s.units)
  const sin = trig("sin", a, s.units), cos = trig("cos", a, s.units)
  const x = new TexArith(s.units).dimen(`${sin}pt`)
  pgfTransformCm(s, cos, sin, toNumber(-x), cos, pgfPointOrigin)
}

/** \pgflowlevelsynccm (414–421): the transformation handed to the driver, then reset; what follows does not enlarge the picture */
export function pgfLowLevelSyncCm(s: PgfState, d: PgfDriver) {
  const t = s.local.transform
  d.transformcm(t.aa, t.ab, t.ba, t.bb, t.x, t.y)
  pgfTransformReset(s)
  s.setLocal({ relevant: false })
}
