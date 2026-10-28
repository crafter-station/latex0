// multicol.sty (v2.0b, 2025/10/21): \begin{multicols}{n} as a block of its own, on one page. \enough@room (\premulticols,
// 50pt, left on the page or \newpage), \addvspace\multicolsep, a \kern that puts the first baseline where \topskip would;
// then \prepare@multicols: \nointerlineskip{\topskip\z@\null}, an \eject whose output routine keeps the page so far in
// \partial@page (less the \null), \@colroom less its height and \vsize n columns' worth (\set@mult@vsize); the body is
// set \hsize = (\linewidth + \columnsep)/n - \columnsep wide, \tolerance 9999, \pretolerance -1, \emergencystretch
// n×4pt. A \columnbreak (\penalty-\@Mv) makes the output routine keep the material so far in \colbreak@box, \vsize less
// \pagetotal. \end{multicols}: \penalty\z@\penalty-\@Mvi, whose output routine balances the columns
// (\balance@columns: \vsplit the material to a first guess of the column height, a point more until no column is too
// bad, every column but the last at least as tall as its material) and puts back \partial@page and \page@sofar's row of
// columns; then \enough@room\postmulticols (20pt), \addvspace\multicolsep, \prevdepth\z@. Floats and footnotes in the
// environment are not laid out yet; a page break inside it is \multi@column@out, multicols* never balances.

import type { GlueSpec } from "../layout/dimen"
import { badness } from "../layout/linebreak"
import { emptyBox, filGlue, glue, kern, paramGlue, penalty, ssGlue, type BoxNode, type Node } from "../layout/nodes"
import { hpack, vpack } from "../layout/pack"
import { prunePageTop, vertBreak, type Page, type PageState } from "../layout/pagebuilder"
import type { Block } from "./blocks"
import { processBlock } from "./body"
import type { Ctx } from "./context"
import { OutputUnsupported, type LatexOutput, type OutputHook } from "./output"
import { Unsupported } from "./unsupported"
import { plain } from "./vlist"
import { colorPop, colorPush, xcolor } from "./xcolor"

const PT = 65536
/** \multicolsep: 12pt plus 4pt minus 3pt */
const MULTICOLSEP: GlueSpec = { width: 12 * PT, stretch: 4 * PT, stretchOrder: 0, shrink: 3 * PT, shrinkOrder: 0 }
const hook = (f: (o: LatexOutput, page: PageState) => Node[]): Node => ({ kind: "whatsit", text: "", hook: { state: f } satisfies OutputHook })
const isBox = (n: Node | undefined) => !!n && (n.kind === "hlist" || n.kind === "vlist")

/** \columnbreak[n] in vertical mode: \penalty -\@m, -3333, -6666, -9999 or -\@Mv */
export function columnbreak(cx: Ctx, n: number) {
  if (!cx.run.multicols) throw new Unsupported("\\columnbreak outside multicols")
  cx.v.nodes.push(penalty(-[1000, 3333, 6666, 9999, 10005][n]))
}

/** \remove@discardable@items: penalties and glue off the end (a zero skip ends it unless a nonzero one is before it,
 *  which stays after a \penalty\@M) */
function removeDiscardable(list: Node[]): Node[] {
  const l = list.slice()
  const zero = (n: Node) => n.kind === "glue" && !n.width && !n.stretch && !n.shrink
  for (;;) {
    if (l.at(-1)?.kind === "penalty") l.pop() // \unpenalty
    const a = l.at(-1)
    if (a?.kind === "glue") l.pop()
    if (a?.kind === "glue" && !zero(a)) continue
    const b = l.at(-1)
    if (b?.kind !== "glue" || zero(b)) return l
    l.pop()
    const p = l.at(-1)
    if (p?.kind === "penalty" && p.penalty === 10000) { l.push(b, glue(0)); return l }
  }
}

/** \vbox to h{list} (\boxmaxdepth md) and the \badness it sets (§§ 672–678) */
function vboxTo(list: Node[], h: number, md: number): { box: BoxNode; badness: number } {
  const nat = vpack(list.slice(), { additional: 0 }, md)
  const box = vpack(list.slice(), { exactly: h }, md)
  const x = h - nat.height
  if (x === 0 || !list.length) return { box, badness: 0 }
  const stretch = [0, 0, 0, 0], shrink = [0, 0, 0, 0]
  for (const n of list) if (n.kind === "glue") { stretch[n.stretchOrder] += n.stretch; shrink[n.shrinkOrder] += n.shrink }
  if (x > 0) return { box, badness: stretch[1] || stretch[2] || stretch[3] ? 0 : badness(x, stretch[0]) }
  if (shrink[1] || shrink[2] || shrink[3]) return { box, badness: 0 }
  return { box, badness: shrink[0] < -x ? 1000000 : badness(-x, shrink[0]) }
}

/** \vsplit of a list to h: what goes (up to vert_break's best break) and what stays, pruned (§ 977; null: void) */
function vsplit(list: Node[], h: number, md: number, splitTop: GlueSpec): { part: Node[]; rest: Node[] | null } {
  const { at } = vertBreak(list, h, md)
  if (at === null) return { part: list, rest: null }
  const rest = prunePageTop(list.slice(at), paramGlue("splittopskip", glue(splitTop.width, splitTop.stretch, splitTop.stretchOrder, splitTop.shrink, splitTop.shrinkOrder)))
  return { part: list.slice(0, at), rest: rest.length ? rest : null }
}

/** multicols number b where it stands (a block) */
export function multicols(cx: Ctx, b: Extract<Block, { kind: "multicols" }>) {
  const { pre, run, v } = cx
  const k = run.k
  if (!pre.multicol) throw new Unsupported("multicols without \\usepackage{multicol}")
  if (run.runIn || run.noskipsec) throw new Unsupported("multicols right after a run-in heading")
  if (run.multicols) throw new Unsupported("multicols in multicols")
  if (k.ints.twocolumn) throw new Unsupported("multicols in two columns")
  const bad = b.blocks.find((x) => x.kind !== "par" && x.kind !== "list" && x.kind !== "heading" && x.kind !== "columnbreak")
  if (bad) throw new Unsupported(`a ${bad.kind} in multicols`)
  if (/\\(?:footnote|textwidth|raggedcolumns|flushcolumns|marginpar)(?![A-Za-z])/.test(JSON.stringify(b.blocks))) throw new Unsupported("\\footnote, \\textwidth or \\raggedcolumns in multicols")
  const n = Math.min(20, Math.max(2, b.n))
  const md = k.dimens.maxdepth, topskip = k.glue.topskip.width, bs = k.sizes.normalsize.baselineskip.width
  const sep = k.dimens.columnsep, linewidth = k.dimens.textwidth
  const hsize = Math.trunc((linewidth + sep - n * sep) / n)

  // \enough@room\premulticols: \@nobreakfalse (global), \addpenalty\z@, then \newpage when less than 50pt is left
  v.par()
  v.nobreak = false; v.addpenalty(0)
  v.nodes.push(hook((o, page) => (page.goal - page.total >= 50 * PT ? [] : [filGlue(), penalty(-10000)])))
  v.addvspace(MULTICOLSEP)
  // the first baseline \topskip below where the column starts: \kern-(\prevdepth - (\prevdepth/\baselineskip + 1)\baselineskip + \topskip)
  if (v.prevDepth !== null) v.nodes.push(kern(-(v.prevDepth - (Math.trunc(v.prevDepth / bs) + 1) * bs + topskip), true))

  // \prepare@multicols: \nointerlineskip {\topskip\z@\null}, \output{…}\eject keeps the page so far in \partial@page
  let partial: Node[] | null = null, partialHeight = 0
  let colbreak: Node[] | null = null
  let colroom: number | null = null // (\@colroom before the environment's local \advance; null once set globally)
  const save = (o: LatexOutput) => (page: Page): Node[] => {
    if (partial) throw new OutputUnsupported("multicols starting on a page too full (error saving partial page)")
    if (Object.values(page.inserts).some((l) => l.length)) throw new OutputUnsupported("footnotes on the page before multicols")
    partial = page.nodes.slice()
    if (isBox(partial.at(-1))) partial.pop() // (\global\setbox\last@line\lastbox: the \null)
    partialHeight = vpack(partial.slice()).height
    o.custom = null
    return []
  }
  // \multi@column@out: a \columnbreak's \penalty-\@Mv, or \end{multicols}'s \penalty-\@Mvi (\balance@columns@out)
  const collect = (o: LatexOutput) => (page: Page): Node[] => {
    if (Object.values(page.inserts).some((l) => l.length)) throw new OutputUnsupported("footnotes in multicols")
    if (page.outputPenalty >= -10000) return columnOut(o, page, page.nodes, page.outputPenalty)
    if (page.outputPenalty === -10005) {
      // \global\advance\vsize-\pagetotal; \colbreak@box gets the material without what ends it, \kern-its depth
      o.vsizeNow -= page.total ?? 0
      const l = removeDiscardable(page.nodes)
      colbreak = [...(colbreak ? [...colbreak, penalty(-10005)] : []), ...l, kern(-vpack(l.slice(), { additional: 0 }, md).depth, true)]
      return []
    }
    if (page.outputPenalty !== -10006) throw new OutputUnsupported("a float in multicols")
    // (\outputpenalty\@M; multicols*: \multi@column@out\penalty-\@Mvi)
    if (b.star) return [...columnOut(o, page, page.nodes, 10000), penalty(-10006)]
    const all = removeDiscardable([...(colbreak ? [...colbreak, penalty(-10005)] : []), ...page.nodes])
    colbreak = null
    const material = balance(o, all)
    // (balancing failed: \vbox{\vskip\topskip\vskip-\splittopskip, the material, \penalty-\@Mvi} cut as a page)
    if (!material.ok) return columnOut(o, page, [plain(k.glue.topskip), glue(-topskip, -2 * PT), ...material.all, penalty(-10006)], 10000)
    o.vsizeNow = o.colroom + partialHeight
    return [...partial!, ...material.nodes, penalty(0)]
  }
  /**
   * \multi@column@out at a page break: the material (after \colbreak@box's) \vsplit into n columns to \@colroom
   * (\splittopskip \topskip), what is left back on the list (and the break's penalty), then \partial@page and
   * \page@sofar's row as the page; \@colroom\@colht and \vsize n columns' worth again
   */
  const columnOut = (o: LatexOutput, page: Page, nodes: Node[], outputPenalty: number): Node[] => {
    let rest: Node[] | null = colbreak ? [...colbreak, penalty(-10005), ...nodes] : nodes
    colbreak = null
    const h = o.colroom, splitTop: GlueSpec = { width: topskip, stretch: 0, stretchOrder: 0, shrink: 0, shrinkOrder: 0 }
    const boxes: BoxNode[] = []
    for (let c = 0; c < n; c++) {
      const s: { part: Node[]; rest: Node[] | null } = rest ? vsplit(rest, h, md, splitTop) : { part: [], rest: null }
      boxes.push(vpack(s.part.slice(), { exactly: h }, md))
      rest = s.rest
    }
    o.multicolPage(page, [...partial!, ...pageSofar(boxes)])
    partial = []; partialHeight = 0; colroom = null // (\unvbox\partial@page; \global\@colroom\@colht)
    o.vsizeNow = multVsize(o.colroom)
    return rest ? [...rest, ...(outputPenalty !== 10000 ? [penalty(outputPenalty)] : [])] : []
  }
  /** \set@mult@vsize: n columns of \@colroom less \topskip, plus a \baselineskip each */
  const multVsize = (room: number) => n * (room + bs - topskip) - (bs - topskip) + n * bs
  /** \balance@columns and \page@sofar */
  const balance = (o: LatexOutput, list: Node[]): { ok: true; nodes: Node[] } | { ok: false; all: Node[] } => {
    const splitTop: GlueSpec = { width: topskip, stretch: 2 * PT, stretchOrder: 0, shrink: 0, shrinkOrder: 0 } // \topskip plus\multicolundershoot
    // \vsplit\mult@box to\z@ after \penalty-\@M: the material pruned, \splittopskip on top
    const all = prunePageTop(list, paramGlue("splittopskip", glue(splitTop.width, splitTop.stretch, 0, 0, 0)))
    const whole = vpack(all.slice(), { additional: 0 }, md)
    const t = Math.trunc((whole.height + whole.depth) / n)
    let h = Math.trunc(t / bs) * bs + topskip
    if (h > t) h -= bs
    if (h < topskip) h = topskip // (\c@minrows 1; \c@unbalance 0)
    let lastTry = -PT
    let cols: Node[][] = []
    let leftover = false
    for (;;) {
      let tooBad = false
      leftover = false
      let rest: Node[] | null = all
      cols = []
      for (let c = 1; c < n; c++) {
        const s: { part: Node[]; rest: Node[] | null } = rest ? vsplit(rest, h, md, splitTop) : { part: [], rest: null }
        if (vboxTo(s.part, h, md).badness > 10000) tooBad = true // (\c@columnbadness)
        cols.push(s.part)
        rest = s.rest
      }
      let last = rest ?? []
      const natFirst = vpack(cols[0].slice(), { additional: 0 }, md).height
      if (vpack(last.slice(), { additional: 0 }, md).height > h) tooBad = true
      else if (vsplit(last, MAX_DIMEN, md, splitTop).rest === null) {
        if (vboxTo(last, h, md).badness > 9999) last = [...last, filGlue()] // (\c@finalcolumnbadness: \vfil)
      } else if (h < o.colroom + 12 * PT) tooBad = true // (a forced break left over, \maxbalancingoverflow)
      else leftover = true
      cols.push(last)
      if (natFirst < h && natFirst > lastTry) { tooBad = true; h = natFirst; lastTry = h; h -= PT }
      if (!tooBad) break
      h += PT
    }
    if (leftover) return { ok: false, all }
    if (h > o.colroom) h = o.colroom
    const boxes = cols.map((l) => {
      const list = [glue(0, -2 * PT), ...l] // \vskip\z@\@plus-\multicolundershoot
      const r = vboxTo(list, h, md)
      return { box: r.box, bad: r.badness > 10000 && vboxTo([glue(-12 * PT), ...l], h, md).badness > 10000 }
    })
    if (boxes.some((x) => x.bad)) return { ok: false, all }
    return { ok: true, nodes: pageSofar(boxes.map((x) => x.box)) }
  }
  /** \page@sofar: \hbox to\full@width{each column \hsize wide, \hss{\columnseprulecolor\vrule\@width\columnseprule}\hss
   *  between, \rlap{\phantom p}}, then \prevdepth\z@\kern-(the deepest column, at least p's depth) */
  const pageSofar = (boxes: BoxNode[]): Node[] => {
    for (const bx of boxes) bx.width = hsize // (\wd\count@\hsize)
    const p = cx.romanFont.chars.get(112)!
    let dp = p.depth
    const row: Node[] = []
    boxes.forEach((bx, i) => {
      dp = Math.max(dp, bx.depth)
      row.push(bx)
      if (i < n - 1) { const rule: Node = { kind: "rule", width: k.dimens.columnseprule, height: null, depth: null }; row.push(ssGlue(), ...(xcolor.on ? [colorPush(), rule, colorPop()] : [rule]), ssGlue()) }
    })
    const ph = emptyBox("hlist", p.width); ph.height = p.height; ph.depth = p.depth
    row.push(hpack([ph, ssGlue()], { exactly: 0 }))
    return [hpack(row, { exactly: linewidth }), kern(-dp, true)]
  }
  v.prevDepth = null // (\nointerlineskip)
  v.nodes.push(hook((o) => { o.topSkipNow = paramGlue("topskip", glue(0)); o.custom = save(o); return [] }), emptyBox("hlist"), hook((o) => { o.topSkipNow = null; return [] }), penalty(-10000), hook((o) => {
    // \advance\@colroom-\ht\partial@page, \set@mult@vsize, \output{\multi@column@out} (all local to the environment)
    colroom = o.colroom
    o.colroom -= partialHeight
    o.vsizeNow = multVsize(o.colroom)
    o.custom = collect(o)
    return []
  }))
  v.prevDepth = 0

  // the body, \hsize the column's width (\linewidth and \columnwidth too), \tolerance 9999, \pretolerance -1
  const outer = run.k
  run.k = { ...k, dimens: { ...k.dimens, textwidth: hsize, columnwidth: hsize, emergencystretch: 4 * PT * n }, ints: { ...k.ints, tolerance: 9999, pretolerance: -1 } }
  run.multicols = n; cx.doc.columns = true
  try { b.blocks.forEach((x, i, all) => processBlock(cx, x, i, all)) } finally { run.k = outer; run.multicols = null; cx.doc.columns = false }

  // \end{multicols}: \par; on an empty page the \columnbreak's material back; \penalty\z@\penalty-\@Mvi; then (the page
  // started again) \enough@room\postmulticols, or \vsize\@colroom; \addvspace\multicolsep\prevdepth\z@
  v.par()
  if (b.star) { // \endmulticols*: the last skip and the last line's depth taken back, \vfil
    const last = v.lastSkip
    if (last.width > 0) v.nodes.push(glue(-last.width, -last.stretch, last.stretchOrder, -last.shrink, last.shrinkOrder))
    if (v.prevDepth !== null && v.prevDepth > 0) v.nodes.push(glue(-v.prevDepth))
    v.nodes.push(filGlue())
  }
  v.nodes.push(hook((_o, page) => { if (!page.empty || !colbreak) return []; const l = colbreak; colbreak = null; return l }), penalty(0), penalty(-10006), hook((o, page) => {
    o.custom = null; if (colroom !== null) o.colroom = colroom // (\endgroup, unless \@colroom was set globally since)
    if (page.empty) { o.vsizeNow = o.colroom; return [] }
    return [penalty(0), hook((_o2, pg) => (pg.goal - pg.total < 20 * PT ? [filGlue(), penalty(-10000)] : []))]
  }))
  v.addvspace(MULTICOLSEP)
  v.prevDepth = 0
}

const MAX_DIMEN = 0o7777777777
