// Displayed formulas: "TeX: The Program" §§ 1145–1149 (going into display
// math: \predisplaysize from the last line of the paragraph so far,
// \displaywidth and \displayindent from the paragraph's shape) and
// §§ 1199–1206 (finishing the display: centering the formula, placing the
// equation number, choosing the regular or the short skips, the penalties
// around it). As in e-TeX, the formula's box and the number's box are display
// boxes (dlist).

import { FIL, FILL, FILLL, NORMAL, SHRINKING, STRETCHING, kern, paramGlue, penalty, glue as mkGlue, type BoxNode, type Node } from "./nodes"
import { hpack } from "./pack"
import type { GlueSpec } from "./dimen"

const MAX_DIMEN = 0o7777777777
const half = (x: number) => (x % 2 !== 0 ? Math.trunc((x + 1) / 2) : Math.trunc(x / 2))

/**
 * § 1146: how far the last line's visible material reaches, plus two ems of
 * the current font, or max_dimen when it depends on stretched or shrunk glue.
 * -max_dimen when nothing came before the display (`\noindent$$`).
 */
export function preDisplaySize(justBox: BoxNode | null, quad: number): number {
  if (!justBox) return -MAX_DIMEN
  let v = justBox.shift + 2 * quad, w = -MAX_DIMEN
  for (const p of justBox.list) {
    let d: number, visible = false
    switch (p.kind) {
      case "char": case "hlist": case "vlist": d = p.width ?? 0; visible = true; break
      case "rule": d = p.width ?? 0; visible = true; break
      case "kern": case "math": d = p.width; break
      case "glue":
        d = p.width
        if (justBox.glueSign === STRETCHING) { if (justBox.glueOrder === p.stretchOrder && p.stretch !== 0) v = MAX_DIMEN }
        else if (justBox.glueSign === SHRINKING) { if (justBox.glueOrder === p.shrinkOrder && p.shrink !== 0) v = MAX_DIMEN }
        if (p.leaders) visible = true // (leaders are visible: goto found)
        break
      default: d = 0
    }
    if (visible) {
      if (v < MAX_DIMEN) { v += d; w = v } else return MAX_DIMEN
    } else if (v < MAX_DIMEN) v += d
  }
  return w
}

/** § 1149: the length and indentation of line prev_graf+2, which the display takes. */
export function displayLine(prevGraf: number, hsize: number, hangIndent: number, hangAfter: number, parShape: [number, number][]): { width: number; indent: number } {
  if (parShape.length === 0) {
    if (hangIndent !== 0 && ((hangAfter >= 0 && prevGraf + 2 > hangAfter) || prevGraf + 1 < -hangAfter)) return { width: hsize - Math.abs(hangIndent), indent: hangIndent > 0 ? hangIndent : 0 }
    return { width: hsize, indent: 0 }
  }
  const [indent, width] = parShape[Math.min(prevGraf + 2, parShape.length) - 1]
  return { width, indent }
}

export interface DisplayParams {
  width: number // \displaywidth
  indent: number // \displayindent
  preSize: number // \predisplaysize
  /** math_quad of the text size (family 2) */
  mathQuad: number
  preDisplayPenalty: number; postDisplayPenalty: number
  aboveDisplaySkip: GlueSpec; belowDisplaySkip: GlueSpec; aboveDisplayShortSkip: GlueSpec; belowDisplayShortSkip: GlueSpec
}

/** What a display adds to the vertical list: nodes, and boxes that go through append_to_vlist. */
export type DisplayItem = { node: Node } | { box: BoxNode }

/**
 * §§ 1199–1205 for \eqno (not \leqno): the formula's hlist (from mlist_to_hlist
 * in display style) and the equation number's box, or null.
 */
export function finishDisplay(formula: Node[], eqno: BoxNode | null, p: DisplayParams): DisplayItem[] {
  let b = hpack(formula); b.display = true
  const shrink = [0, 0, 0, 0]
  for (const n of formula) if (n.kind === "glue") shrink[n.shrinkOrder] += n.shrink
  let w = b.width
  const z = p.width, s = p.indent
  let e = 0, q = 0
  if (eqno) { e = eqno.width; q = e + p.mathQuad }
  if (w + q > z) { // § 1201: squeeze
    if (e !== 0 && (w - shrink[NORMAL] + q <= z || shrink[FIL] !== 0 || shrink[FILL] !== 0 || shrink[FILLL] !== 0)) { b = hpack(formula, { exactly: z - q }); b.display = true }
    else { e = 0; if (w > z) { b = hpack(formula, { exactly: z }); b.display = true } }
    w = b.width
  }
  // § 1202: center, unless that leaves less than the number's width between them
  let d = half(z - w)
  if (e > 0 && d < 2 * e) { d = half(z - w - e); if (formula[0]?.kind === "glue") d = 0 }
  const out: DisplayItem[] = [{ node: penalty(p.preDisplayPenalty) }]
  const short = !(d + s <= p.preSize)
  out.push({ node: short ? paramGlue("abovedisplayshortskip", glueOf(p.aboveDisplayShortSkip)) : paramGlue("abovedisplayskip", glueOf(p.aboveDisplaySkip)) })
  let g2: Node | null = short ? paramGlue("belowdisplayshortskip", glueOf(p.belowDisplayShortSkip)) : paramGlue("belowdisplayskip", glueOf(p.belowDisplaySkip))
  // § 1204
  if (e !== 0) b = hpack([b, kern(z - w - e - d), eqno!])
  b.shift = s + d
  out.push({ box: b })
  // § 1205: a number too wide for the line goes below, right-aligned
  if (eqno && e === 0) {
    out.push({ node: penalty(10000) })
    eqno.shift = s + z - eqno.width
    out.push({ box: eqno })
    g2 = null
  }
  out.push({ node: penalty(p.postDisplayPenalty) })
  if (g2) out.push({ node: g2 })
  return out
}

const glueOf = (g: GlueSpec) => mkGlue(g.width, g.stretch, g.stretchOrder, g.shrink, g.shrinkOrder)
