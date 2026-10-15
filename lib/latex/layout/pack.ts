// Box packaging: hpack (§§ 649–667) and vpack (§§ 668–679). Glue ratios are
// doubles, as in web2c TeX (glueratio is double), so results match pdfTeX.

import { emptyBox, FIL, FILL, FILLL, NORMAL, SHRINKING, SIGN_NORMAL, STRETCHING, type BoxNode, type GlueOrder, type Node } from "./nodes"

export type PackSpec = { exactly: number } | { additional: number }
export const NATURAL: PackSpec = { additional: 0 }
export const MAX_DIMEN = 0o7777777777

function highestOrder(t: number[]): GlueOrder {
  return t[FILLL] !== 0 ? FILLL : t[FILL] !== 0 ? FILL : t[FIL] !== 0 ? FIL : NORMAL
}

function setGlue(box: BoxNode, x: number, stretch: number[], shrink: number[]) {
  // x = desired size minus natural size (§ 657–658, 664)
  if (x === 0) { box.glueSign = SIGN_NORMAL; box.glueOrder = NORMAL; box.glueSet = 0; return }
  if (x > 0) {
    const o = highestOrder(stretch)
    box.glueOrder = o; box.glueSign = STRETCHING
    if (stretch[o] !== 0) box.glueSet = x / stretch[o]
    else { box.glueSign = SIGN_NORMAL; box.glueSet = 0 }
    return
  }
  const o = highestOrder(shrink)
  box.glueOrder = o; box.glueSign = SHRINKING
  if (shrink[o] !== 0) box.glueSet = -x / shrink[o]
  else { box.glueSign = SIGN_NORMAL; box.glueSet = 0 }
  // Overfull: never shrink more than the shrinkability (§ 664).
  if (shrink[o] < -x && o === NORMAL && box.list.length > 0) box.glueSet = 1.0
}

export function hpack(list: Node[], spec: PackSpec = NATURAL): BoxNode {
  const box = emptyBox("hlist"); box.list = list
  let h = 0, d = 0, x = 0
  const stretch = [0, 0, 0, 0], shrink = [0, 0, 0, 0]
  for (const p of list) {
    switch (p.kind) {
      case "char": x += p.width; if (p.height > h) h = p.height; if (p.depth > d) d = p.depth; break
      case "hlist": case "vlist": case "rule": {
        const w = p.width ?? 0, ht = p.height ?? 0, dp = p.depth ?? 0
        const s = p.kind === "rule" ? 0 : p.shift
        x += w
        if (ht - s > h) h = ht - s
        if (dp + s > d) d = dp + s
        break
      }
      case "glue": x += p.width; stretch[p.stretchOrder] += p.stretch; shrink[p.shrinkOrder] += p.shrink; break
      case "kern": case "math": x += p.width; break
      case "penalty": case "disc": case "whatsit": case "ins": case "adjust": break // a discretionary's no-break text is already in the list; insertions migrate (post_line_break)
    }
  }
  box.height = h; box.depth = d
  const w = "exactly" in spec ? spec.exactly : x + spec.additional
  box.width = w
  setGlue(box, w - x, stretch, shrink)
  return box
}

export function vpack(list: Node[], spec: PackSpec = NATURAL, maxDepth = MAX_DIMEN): BoxNode {
  const box = emptyBox("vlist"); box.list = list
  let w = 0, d = 0, x = 0
  const stretch = [0, 0, 0, 0], shrink = [0, 0, 0, 0]
  for (const p of list) {
    switch (p.kind) {
      case "char": throw new Error("vpack: character in vertical list")
      case "hlist": case "vlist": case "rule": {
        x += d + (p.height ?? 0); d = p.depth ?? 0
        const s = p.kind === "rule" ? 0 : p.shift
        if (p.width !== null && p.width + s > w) w = p.width + s
        break
      }
      case "glue": x += d; d = 0; stretch[p.stretchOrder] += p.stretch; shrink[p.shrinkOrder] += p.shrink; x += p.width; break
      case "kern": x += d + p.width; d = 0; break
      case "penalty": case "whatsit": case "ins": break
      case "math": throw new Error("vpack: math node in vertical list")
      case "disc": throw new Error("vpack: discretionary in vertical list")
    }
  }
  box.width = w
  if (d > maxDepth) { x += d - maxDepth; box.depth = maxDepth } else box.depth = d
  const h = "exactly" in spec ? spec.exactly : x + spec.additional
  box.height = h
  setGlue(box, h - x, stretch, shrink)
  return box
}
