// Positions from TeX's box dumps: the trace a page's \tracingoutput display implies, for a TeX that writes no
// DVI (pdfTeX making a PDF). The display prints glue ratios rounded (§ 186), so each box's is worked out again
// from its contents as hpack and vpack set it (§§ 656–659, 671–676): the width or height TeX gave the box against
// its natural size, with character widths from the font files the display names (\pdftracingfonts). The boxes
// are then shipped out as ship_out does (emit/trace.ts). Checked against the DVI for every fixture (tools/unit).

import { scaled } from "../../layout/arith"
import { SHRINKING, STRETCHING, type BoxNode as Box, type GlueNode, type Node } from "../../layout/nodes"
import { shipOut } from "../../emit/trace"
import type { BoxNode, Trace } from "../../trace/schema"
import { loadTfm } from "./oracle"
import { parseScaled } from "./tracing"

const ORDER: Record<string, number> = { "": 0, fil: 1, fill: 2, filll: 3 }

/** The trace of pages shipped out as their box dumps show them. */
export function boxTrace(pages: BoxNode[]): Trace {
  return shipOut(pages.map((p) => { const b = node(p); if (b.kind !== "hlist" && b.kind !== "vlist") throw new Error("a page that is not a box"); return b }))
}

/** a box dump node as the engine's node, glue ratios worked out again */
export function node(n: BoxNode): Node {
  switch (n.type) {
    case "hbox": case "vbox": {
      const list = n.children.map(node)
      const box: Box = { kind: n.type === "hbox" ? "hlist" : "vlist", width: n.width, height: n.height, depth: n.depth, shift: n.shift, list, glueSign: n.glueSign, glueOrder: n.glueOrder, glueSet: 0, ...(n.display ? { display: true } : {}) }
      box.glueSet = glueSet(box)
      // a vbox's depth cut by \boxmaxdepth went into its height (§ 669); one set afterwards (\dp=0) did not: the dump
      // shows only the final depth, and the ratio TeX printed tells which
      const matches = (r: number) => Math.abs(n.glueSet) >= 20000 || Math.round(65536 * r) === Math.round(65536 * n.glueSet)
      if (box.kind === "vlist" && n.glueSign && !matches(box.glueSet) && matches(glueSet(box, 0, false))) box.glueSet = glueSet(box, 0, false)
      if (box.kind === "hlist") spans(box, n)
      // an alignment's row has the prototype row's glue set (§ 808), which its own contents give only when it has all
      // the columns: a shorter row takes it from a sibling of the same width and printed setting that has them
      else list.forEach((c, i) => {
        const printed = n.children[i]
        if (c.kind !== "hlist" || printed.type !== "hbox" || !printed.glueSign || Math.abs(printed.glueSet) >= 20000) return
        const same = (r: number, g: number) => Math.round(65536 * r) === Math.round(65536 * g)
        if (same(c.glueSet, printed.glueSet)) return
        const full = list.find((d, j) => {
          const q = n.children[j]
          return d.kind === "hlist" && q.type === "hbox" && d.width === c.width && q.glueSign === printed.glueSign && q.glueOrder === printed.glueOrder && q.glueSet === printed.glueSet && same(d.glueSet, q.glueSet)
        })
        if (full?.kind === "hlist") { c.glueSet = full.glueSet; spans(c, printed) }
      })
      return box
    }
    case "char": {
      if (!n.tfm) throw new Error(`box dump: no font file for ${n.font} (\\pdftracingfonts)`)
      const tfm = loadTfm(n.tfm)
      const size = n.at ?? Math.trunc(tfm.designSize / 16) // a fix_word in sixteenths of sp
      const m = tfm.chars.get(n.char)
      return { kind: "char", font: n.tfm, size, char: n.char, width: m ? scaled(m.width, size) : 0, height: 0, depth: 0, text: "" }
    }
    case "glue": return { kind: "glue", width: n.width, stretch: n.stretch, stretchOrder: n.stretchOrder as GlueNode["stretchOrder"], shrink: n.shrink, shrinkOrder: n.shrinkOrder as GlueNode["shrinkOrder"] }
    case "kern": return { kind: "kern", width: n.width }
    case "rule": return { kind: "rule", width: n.width, height: n.height, depth: n.depth }
    case "penalty": return { kind: "penalty", penalty: n.penalty }
    case "disc": return { kind: "disc", pre: [], post: [], replaceCount: n.replaceCount } // (what it replaces follows it)
    case "other": return other(n.text, n.children)
  }
}

/** The lines the schema keeps as text: math nodes, leaders, accent kerns, images; anything else draws nothing */
function other(text: string, children: BoxNode[] | undefined): Node {
  let m: RegExpMatchArray | null
  if ((m = text.match(/^\\math(on|off)(?:, surrounded (-?[\d.]+))?$/))) return { kind: "math", on: m[1] === "on", width: m[2] ? parseScaled(m[2]) : 0 }
  if ((m = text.match(/^\\kern ?(-?[\d.]+) \(for accent\)$/))) return { kind: "kern", width: parseScaled(m[1]) }
  if ((m = text.match(/^\\(leaders|cleaders|xleaders) (-?[\d.]+)(?: plus (-?[\d.]+)(fil{1,3})?)?(?: minus (-?[\d.]+)(fil{1,3})?)?$/))) {
    const inner = children?.[0] && node(children[0])
    if (!inner || (inner.kind !== "hlist" && inner.kind !== "vlist" && inner.kind !== "rule")) throw new Error(`box dump: ${text} without a box or rule`)
    return {
      kind: "glue", width: parseScaled(m[2]), stretch: m[3] ? parseScaled(m[3]) : 0, stretchOrder: ORDER[m[4] ?? ""] as GlueNode["stretchOrder"],
      shrink: m[5] ? parseScaled(m[5]) : 0, shrinkOrder: ORDER[m[6] ?? ""] as GlueNode["shrinkOrder"], leaders: { kind: m[1] as "leaders", box: inner },
    }
  }
  // pdfTeX's images and forms take their size as a box does (§ pdf_ship_out)
  if ((m = text.match(/^\\pdfref(?:ximage|xform)\((-?[\d.]+)\+(-?[\d.]+)\)x(-?[\d.]+)/))) return { kind: "hlist", width: parseScaled(m[3]), height: parseScaled(m[1]), depth: parseScaled(m[2]), shift: 0, list: [], glueSign: 0, glueOrder: 0, glueSet: 0 }
  return { kind: "whatsit", text }
}

/**
 * a spanned alignment cell (§ 810) has the first column's width, its glue set against the whole span: the width, then
 * the tabskip glue (as the row sets it) and the empty box of each column it spans, which follow it in the row
 */
function spans(box: Box, n: BoxNode & { type: "hbox" | "vbox" }) {
  const list = box.list
  const setWidth = (g: GlueNode) => g.width + (box.glueSign === STRETCHING && g.stretchOrder === box.glueOrder ? Math.round(box.glueSet * g.stretch)
    : box.glueSign === SHRINKING && g.shrinkOrder === box.glueOrder ? -Math.round(box.glueSet * g.shrink) : 0)
  list.forEach((c, i) => {
    const printed = n.children[i]
    if ((c.kind !== "hlist" && c.kind !== "vlist") || (printed.type !== "hbox" && printed.type !== "vbox") || !printed.glueSign) return
    const shown = (r: number) => Math.round(65536 * r) === Math.round(65536 * printed.glueSet)
    if (Math.abs(printed.glueSet) >= 20000 || shown(c.glueSet)) return
    let extra = 0
    for (let j = i + 1; list[j]?.kind === "glue" && list[j + 1]?.kind === "hlist" && (list[j + 1] as Box).list.length === 0; j += 2) {
      extra += setWidth(list[j] as GlueNode) + (list[j + 1] as Box).width
      const r = glueSet(c, extra)
      if (shown(r)) { c.glueSet = r; return }
    }
  })
}

/** hpack's and vpack's glue ratio (§§ 658, 664, 676) for the size TeX gave the box (and `extra` width, for a span; a
 *  vbox's depth less than its last item's taken as cut by \boxmaxdepth, or not) */
function glueSet(box: Box, extra = 0, depthMoved = true): number {
  if (box.glueSign === 0) return 0
  const stretch = [0, 0, 0, 0], shrink = [0, 0, 0, 0]
  let x = 0
  const glue = (g: GlueNode) => { stretch[g.stretchOrder] += g.stretch; shrink[g.shrinkOrder] += g.shrink }
  if (box.kind === "hlist") {
    for (const p of box.list) {
      if (p.kind === "char" || p.kind === "hlist" || p.kind === "vlist" || p.kind === "kern" || p.kind === "math") x += p.width
      else if (p.kind === "rule") x += p.width ?? 0
      else if (p.kind === "glue") { x += p.width; glue(p) }
    }
    x = box.width + extra - x
  } else {
    let d = 0
    for (const p of box.list) {
      if (p.kind === "hlist" || p.kind === "vlist") { x += d + p.height; d = p.depth }
      else if (p.kind === "rule") { x += d + (p.height ?? 0); d = p.depth ?? 0 }
      else if (p.kind === "glue") { x += d + p.width; d = 0; glue(p) }
      else if (p.kind === "kern") { x += d + p.width; d = 0 }
    }
    if (depthMoved) x += d - box.depth // (\boxmaxdepth moved what it cut from the depth into the height, § 669)
    x = box.height - x
  }
  const o = box.glueOrder
  if (box.glueSign === STRETCHING) return stretch[o] !== 0 ? x / stretch[o] : 0
  if (box.glueSign === SHRINKING) {
    if (shrink[o] < -x && o === 0 && box.list.length > 0) return 1.0
    return shrink[o] !== 0 ? -x / shrink[o] : 0
  }
  return 0
}
