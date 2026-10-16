// Trace emitter: walk a shipped-out box exactly as TeX's ship_out does
// (§§ 619–640, hlist_out / vlist_out) and record every glyph and rule position.
// Glue is rounded with TeX's cumulative scheme (§ 625) so positions are
// bit-identical to the DVI TeX would write.

import { texRound, vetGlue } from "../layout/arith"
import { SHRINKING, STRETCHING, type BoxNode } from "../layout/nodes"
import type { Trace, TracePage } from "../trace/schema"

interface Cursor { h: number; v: number }

function hlistOut(box: BoxNode, cur: Cursor, page: TracePage) {
  let curG = 0, curGlue = 0
  const baseLine = cur.v, leftEdge = cur.h
  for (const p of box.list) {
    switch (p.kind) {
      case "char":
        page.glyphs.push({ font: p.font, size: p.size, char: p.char, h: cur.h, v: cur.v, width: p.width })
        cur.h += p.width
        break
      case "hlist": case "vlist": {
        if (p.list.length === 0) { cur.h += p.width; break }
        const saveH = cur.h
        cur.v = baseLine + p.shift
        if (p.kind === "vlist") vlistOut(p, cur, page); else hlistOut(p, cur, page)
        cur.h = saveH + p.width
        cur.v = baseLine
        break
      }
      case "rule": {
        const ht = p.height ?? box.height, dp = p.depth ?? box.depth, wd = p.width ?? 0
        if (ht + dp > 0 && wd > 0) page.rules.push({ h: cur.h, v: baseLine + dp, width: wd, height: ht + dp })
        cur.h += wd
        break
      }
      case "glue": {
        let ruleWd = p.width - curG
        if (box.glueSign !== 0) {
          if (box.glueSign === STRETCHING) {
            if (p.stretchOrder === box.glueOrder) { curGlue += p.stretch; curG = texRound(vetGlue(box.glueSet * curGlue)) }
          } else if (p.shrinkOrder === box.glueOrder) { curGlue -= p.shrink; curG = texRound(vetGlue(box.glueSet * curGlue)) }
        }
        ruleWd += curG
        const lb = p.leaders?.box
        if (lb?.kind === "rule") { // § 626: rule leaders are a rule of the glue's width
          const ht = lb.height ?? box.height, dp = lb.depth ?? box.depth
          if (ht + dp > 0 && ruleWd > 0) page.rules.push({ h: cur.h, v: baseLine + dp, width: ruleWd, height: ht + dp })
          cur.h += ruleWd
          break
        }
        if (lb && lb.width > 0 && ruleWd > 0) { // § 626: the box as often as it fits, at multiples of its width from the left edge
          ruleWd += 10 // compensate for floating-point rounding
          const edge = cur.h + ruleWd
          let lx = 0
          if (p.leaders!.kind === "leaders") {
            const saveH = cur.h
            cur.h = leftEdge + lb.width * Math.trunc((cur.h - leftEdge) / lb.width)
            if (cur.h < saveH) cur.h += lb.width
          } else {
            const lq = Math.trunc(ruleWd / lb.width), lr = ruleWd % lb.width
            if (p.leaders!.kind === "cleaders") cur.h += Math.trunc(lr / 2)
            else { lx = Math.trunc(lr / (lq + 1)); cur.h += Math.trunc((lr - (lq - 1) * lx) / 2) }
          }
          while (cur.h + lb.width <= edge) {
            const saveH = cur.h
            cur.v = baseLine + lb.shift
            if (lb.kind === "vlist") vlistOut(lb, cur, page); else hlistOut(lb, cur, page)
            cur.v = baseLine
            cur.h = saveH + lb.width + lx
          }
          cur.h = edge - 10
          break
        }
        cur.h += ruleWd
        break
      }
      case "kern": case "math": cur.h += p.width; break
      case "penalty": case "disc": case "whatsit": case "ins": case "adjust": break
    }
  }
}

function vlistOut(box: BoxNode, cur: Cursor, page: TracePage) {
  let curG = 0, curGlue = 0
  const leftEdge = cur.h
  cur.v -= box.height
  for (const p of box.list) {
    switch (p.kind) {
      case "char": throw new Error("vlist_out: character in vertical list")
      case "hlist": case "vlist": {
        if (p.list.length === 0) { cur.v += p.height + p.depth; break }
        cur.v += p.height
        const saveV = cur.v
        cur.h = leftEdge + p.shift
        if (p.kind === "vlist") vlistOut(p, cur, page); else hlistOut(p, cur, page)
        cur.v = saveV + p.depth
        cur.h = leftEdge
        break
      }
      case "rule": {
        const ht = p.height ?? 0, dp = p.depth ?? 0, wd = p.width ?? box.width
        const total = ht + dp
        cur.v += total
        if (total > 0 && wd > 0) page.rules.push({ h: cur.h, v: cur.v, width: wd, height: total })
        break
      }
      case "glue": {
        let ruleHt = p.width - curG
        if (box.glueSign !== 0) {
          if (box.glueSign === STRETCHING) {
            if (p.stretchOrder === box.glueOrder) { curGlue += p.stretch; curG = texRound(vetGlue(box.glueSet * curGlue)) }
          } else if (p.shrinkOrder === box.glueOrder) { curGlue -= p.shrink; curG = texRound(vetGlue(box.glueSet * curGlue)) }
        }
        ruleHt += curG
        cur.v += ruleHt
        break
      }
      case "kern": cur.v += p.width; break
      case "penalty": case "whatsit": case "ins": case "adjust": break
      case "math": throw new Error("math node in a vertical list")
      case "disc": throw new Error("vlist_out: discretionary in vertical list")
    }
  }
}

/** ship_out (§ 640): `origin` is the DVI position of the box's top-left corner. */
export function shipOut(pages: BoxNode[], origin = { h: 0, v: 0 }, count0: number[] = pages.map((_, i) => i + 1)): Trace {
  const trace: Trace = { unit: "sp", mag: 1000, pages: [] }
  pages.forEach((box, i) => {
    const page: TracePage = { counts: [count0[i], 0, 0, 0, 0, 0, 0, 0, 0, 0], glyphs: [], rules: [], specials: [] }
    const cur = { h: origin.h, v: origin.v + box.height }
    if (box.kind === "vlist") vlistOut(box, cur, page); else hlistOut(box, cur, page)
    trace.pages.push(page)
  })
  return trace
}
