// Boxes in text: a tabular (latex.ltx \@tabular, \@mkpream, \@array with \halign) and a minipage
// (\@iiiminipage, \@parboxrestore, \@iiiparbox) where they stand, and the width registers inside them.

import { type SizeCommand } from "../layout/classdata"
import { QUAD, X_HEIGHT } from "../layout/font"
import { parseDimen, parseGlue } from "../layout/dimen"
import { lineBreak } from "../layout/linebreak"
import { emptyBox, glue, paramGlue, penalty, type BoxNode, type Node, filGlue } from "../layout/nodes"
import { vpack } from "../layout/pack"
import type { Ctx } from "./context"
import { caption } from "./floats"
import { Unsupported } from "./unsupported"
import { IGNORE_DEPTH } from "./vlist"
import { preamble, tabularBox, tabularLines, TabularUnsupported, vtop, type TabCol, type TabLine, type TabularEnv } from "./tabular"
import { hlistInput, appendToVlist, labelWrite, mathEnv, paragraphInput, selectFont, type FontAttrs, type TabularOuter } from "./paragraph"

/** tabular number n where it stands in text (DocState.tabular) */
export function tabularAt(cx: Ctx, n: number, size: SizeCommand, attrs: FontAttrs, sfcodes?: Record<number, number>, outer?: TabularOuter): BoxNode {
  const { tabulars } = cx
  const t = tabulars[n]
  let lines: TabLine[], cols: TabCol[]
  try { lines = tabularLines(t.body); cols = preamble(t.spec) } catch (e) { if (e instanceof TabularUnsupported) throw new Unsupported(e.message); throw e }
  return tabular(cx, lines, cols, size, t.pos, attrs, sfcodes, outer)
}

/**
 * \begin{minipage}[pos]{width} number n where it stands (DocState.minipage): \setbox\@tempboxa\vbox{\hsize width
 * \@parboxrestore (\parindent and \parskip zero, \sloppy, the normal baselines) \@setminipage body \par\unskip},
 * then \@iiiparbox: \vbox{\unvbox\@tempboxa} as $\vcenter{…}\m@th$ for c, a \vtop for t, a \vbox for b
 */
export function minipageAt(cx: Ctx, n: number, size: SizeCommand, attrs: FontAttrs, sfcodes: Record<number, number> | undefined, outer: TabularOuter): Node[] {
  const { amsmath, hyper } = cx.pre
  const { counters, doc, minipages, refs, romanFont, run } = cx
  const m = minipages[n]
  if (m.height !== null) throw new Unsupported("a minipage with a height")
  const font = selectFont(run.k, size, attrs), sz = run.k.sizes[size]
  let hsize: number
  try { hsize = parseDimen(m.width, { em: font.params[QUAD], ex: font.params[X_HEIGHT], internal: widthRegisters(cx, outer.lineWidth) }) } catch { throw new Unsupported(`a minipage {${m.width}}`) }
  let body = m.body.replace(/(^|[^\\])%.*\n[ \t]*/g, "$1")
  // a leading \centering: \leftskip and \rightskip \@flushglue, \parfillskip zero, \finalhyphendemerits zero
  // \centering in vertical mode (first, or after a caption): \leftskip and \rightskip \@flushglue, \parfillskip zero,
  // \finalhyphendemerits zero, from there on
  let centering = false
  const flush = (p: string) => paramGlue(p, filGlue())
  const shape = () => centering ? { leftSkip: flush("leftskip"), rightSkip: flush("rightskip"), parFillSkip: paramGlue("parfillskip", glue(0)), finalHyphenDemerits: 0 } : { finalHyphenDemerits: outer.finalHyph }
  const odd = body.match(/\\(?:footnote|begin|item|raggedright|raggedleft|vspace|noindent|LXlstinline)(?![A-Za-z])|\\\[|\$\$/) ?? (/\\centering(?![A-Za-z])/.test(body) ? body.match(/\\\\/) : null)
  if (odd) throw new Unsupported(`${odd[0]} in a minipage`)
  const list: Node[] = []
  let pd: number | null = IGNORE_DEPTH
  // (in it, \textwidth and \columnwidth are its \hsize, and so is \linewidth after \@parboxrestore)
  const outerWidth = run.minipageWidth
  run.minipageWidth = hsize
  try {
  const lines = (vl: Node[]) => { for (const x of vl) { if (x.kind === "hlist") pd = appendToVlist(list, x, pd, sz.baselineskip, run.k.glue.lineskip, run.k.dimens.lineskiplimit); else list.push(x) } }
  // new_graf in internal vertical mode adds \parskip (zero here) only to a list that is not empty, and so does
  // LaTeX's restart of the paragraph
  const parskips = () => { if (list.length) list.push(paramGlue("parskip", glue(0)), paramGlue("parskip", glue(0))) }
  // \caption (\par first) and a \label right after it, in vertical mode; paragraphs between
  let cap: { number: number; name: string } | null = null
  for (const part of body.split(/(\\caption\s*\{(?:[^{}]|\{[^{}]*\})*\}|\\label\s*\{[^{}]*\})/)) {
    const cm = part.match(/^\\caption\s*\{([^]*)\}$/)
    if (cm) {
      if (!run.captype) throw new Unsupported("\\caption in a minipage outside a float")
      if (size !== "normalsize" || attrs.ser !== "m" || attrs.shape !== "n" || attrs.fam !== "cmr") throw new Unsupported("a minipage caption in another font")
      cap = caption(cx, run.captype, cm[1], hsize, {
        push: (x) => list.push(x),
        box: (x) => { pd = appendToVlist(list, x, pd, run.k.sizes.normalsize.baselineskip, run.k.glue.lineskip, run.k.dimens.lineskiplimit) },
        // \@parboxrestore undoes \centering's skips (not its \finalhyphendemerits)
        paragraph: (start, text) => {
          parskips()
          const p = paragraphInput(text, run.k, "normalsize", doc, { start, hsize, amsmath, tolerance: 9999, emergencyStretch: 3 * romanFont.params[QUAD], clubPenalty: outer.club, widowPenalty: outer.widow, finalHyphenDemerits: centering ? 0 : outer.finalHyph })
          const lb = lineBreak(p.list, p.params)
          outer.notes.push(...p.notes, lb.trace)
          lines(lb.vlist)
        },
      })
      continue
    }
    const lm = part.match(/^\\label\s*\{([A-Za-z0-9:._-]+)\}$/)
    if (lm) {
      if (!cap) throw new Unsupported("a \\label in a minipage")
      list.push(labelWrite(refs, lm[1], counters.the(cap.number), refs.href, hyper ? cap.name : refs.name)) // nameref: the caption
      continue
    }
    if (/^\\label/.test(part)) throw new Unsupported(`${part} in a minipage`)
    if (part.trim()) cap = null // (a \label after text is in a paragraph)
  for (let text of part.split(/\n[ \t]*\n|\\par(?![A-Za-z])/)) {
    if (/^\s*\\centering(?![A-Za-z])/.test(text)) { centering = true; text = text.replace(/^\s*\\centering\s*/, "") }
    if (/\\centering(?![A-Za-z])/.test(text)) throw new Unsupported("\\centering in a minipage's paragraph")
    if (!text.trim()) continue
    parskips()
    let p: ReturnType<typeof paragraphInput>
    try {
      p = paragraphInput(text, run.k, size, doc, { attrs, ...(sfcodes ? { sfcodes } : {}), hsize, start: [emptyBox("hlist", 0)], amsmath, tolerance: 9999, emergencyStretch: 3 * font.params[QUAD], clubPenalty: outer.club, widowPenalty: outer.widow, noteWidowPenalty: outer.widow, ...shape() })
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("paragraph adapter")) throw new Unsupported(`a minipage paragraph "${text.trim().slice(0, 40)}"`)
      throw e
    }
    const lb = lineBreak(p.list, p.params)
    outer.notes.push(...p.notes, lb.trace)
    lines(lb.vlist)
  }
  }
  } finally { run.minipageWidth = outerWidth }
  if (list.at(-1)?.kind === "glue") list.pop() // \unskip
  if (m.pos === "t") return [vtop(list)]
  const box = vpack(list)
  if (m.pos === "b") return [box]
  const delta = box.height + box.depth // \vcenter: make_vcenter (§ 736), about the axis
  box.height = mathEnv(run.k, size, amsmath).fonts[0][2]!.params[22] + (delta % 2 ? Math.trunc((delta + 1) / 2) : delta / 2)
  box.depth = delta - box.height
  return [{ kind: "math", on: true, width: 0 }, box, { kind: "math", on: false, width: 0 }]
}

/** a tabular's \hbox at a size, its entries in the font `attrs` (tabular.ts) */
export function tabular(cx: Ctx, lines: TabLine[], cols: TabCol[], size: SizeCommand, pos: "t" | "b" | "c", attrs: FontAttrs = cx.normalAttrs, sfcodes?: Record<number, number>, outer?: TabularOuter): BoxNode {
  const { amsmath } = cx.pre
  const { booktabs, doc, run } = cx
  const font = selectFont(run.k, size, attrs)
  const sz = run.k.sizes[size]
  const env: TabularEnv = {
    strut: run.k.sizes[size].strut, tabcolsep: run.k.dimens.tabcolsep, arrayrulewidth: run.k.dimens.arrayrulewidth, doublerulesep: run.k.dimens.doublerulesep,
    lineskiplimit: run.k.dimens.lineskiplimit, axis: mathEnv(run.k, size, amsmath).fonts[0][2]!.params[22],
    cell: (text, state) => {
      if (/\\(?:footnote|label)(?![A-Za-z])/.test(text)) throw new Unsupported(`a tabular entry "${text.trim().slice(0, 40)}"`)
      try { return hlistInput(text, run.k, size, doc, attrs, sfcodes ? Object.assign(state, { sfcodes }) : state, amsmath) } catch (e) {
        if (e instanceof Error && e.message.startsWith("paragraph adapter")) throw new Unsupported(`a tabular entry "${text.trim().slice(0, 40)}"`)
        throw e
      }
    },
    skip: (text) => { try { return parseGlue(text, { em: font.params[QUAD], ex: font.params[X_HEIGHT] }).width } catch { throw new Unsupported(`\\\\[${text}] in a tabular`) } },
    // \vtop\bgroup \hsize width \@arrayparboxrestore (\parindent and \parskip zero, \leftskip and \rightskip zero,
    // \parfillskip \@flushglue, the normal \baselineskip, \lineskip and \lineskiplimit, \sloppy) \ignorespaces entry,
    // then \@finalstrut\@arstrutbox (\unskip, then \nobreak in a paragraph and \vskip-\baselineskip out of one, and
    // \vrule depth \dp\@arstrutbox) \par\egroup
    pbox: (text, width, cr) => {
      if (!outer) throw new Unsupported("a p{width} column here")
      if (/\\(?:footnote|label|par|newline|linebreak)(?![A-Za-z])|\n\s*\n/.test(text)) throw new Unsupported(`a p{width} entry "${text.trim().slice(0, 40)}"`)
      let hsize: number
      try { hsize = parseDimen(width, { em: font.params[QUAD], ex: font.params[X_HEIGHT], internal: widthRegisters(cx, outer.lineWidth) }) } catch { throw new Unsupported(`p{${width}}`) }
      const list: Node[] = []
      const strut: Node = { kind: "rule", width: 0, height: 0, depth: sz.strut.depth }
      let end: Node[] = [...cr, penalty(10000), strut]
      // (an empty entry: the \vrule starts a paragraph after the \vskip, and new_graf and LaTeX's restart of it each
      // add \parskip, zero here)
      if (!text.trim() && !cr.length) { list.push(glue(-sz.baselineskip.width), paramGlue("parskip", glue(0)), paramGlue("parskip", glue(0))); end = [strut] }
      let p: ReturnType<typeof paragraphInput>
      try {
        p = paragraphInput(text, run.k, size, doc, { attrs, ...(sfcodes ? { sfcodes } : {}), hsize, start: [emptyBox("hlist", 0)], amsmath, tolerance: 9999, emergencyStretch: 3 * font.params[QUAD], clubPenalty: outer.club, widowPenalty: outer.widow, finalHyphenDemerits: outer.finalHyph, unskip: 1, end })
      } catch (e) {
        if (e instanceof Error && e.message.startsWith("paragraph adapter")) throw new Unsupported(`a p{width} entry "${text.trim().slice(0, 40)}"`)
        throw e
      }
      const lb = lineBreak(p.list, p.params)
      outer.notes.push(...p.notes, lb.trace)
      let pd: number | null = IGNORE_DEPTH
      for (const n of lb.vlist) {
        if (n.kind === "hlist") pd = appendToVlist(list, n, pd, sz.baselineskip, run.k.glue.lineskip, run.k.dimens.lineskiplimit)
        else list.push(n)
      }
      return vtop(list)
    },
    ...(booktabs ? { booktabs } : {}),
  }
  try { return tabularBox(lines, cols, env, pos) } catch (e) { if (e instanceof TabularUnsupported) throw new Unsupported(e.message); throw e }
}

/** \textwidth, \columnwidth and \linewidth in a width (`lineWidth`: \linewidth where it stands) */
export function widthRegisters(cx: Ctx, lineWidth?: number) {
  const { run } = cx
  return (name: string) => {
    const value = name === "textwidth" ? run.minipageWidth ?? run.k.dimens.textwidth : name === "columnwidth" ? run.minipageWidth ?? run.k.dimens.columnwidth : name === "linewidth" ? lineWidth : undefined
    return value === undefined ? undefined : { level: "dimen" as const, value }
  }
}
