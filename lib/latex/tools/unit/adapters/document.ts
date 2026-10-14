// Adapter "document": whole documents in a growing subset of LaTeX, laid out
// end to end. Today: a standard class at 10pt, 11pt or 12pt; \pagestyle plain,
// empty or headings (the class's default; with no sectioning yet the marks are
// empty, so a running head is the page number at the outer edge); paragraphs of text, inline math and footnotes (as
// the paragraph adapter reads them); and itemize and enumerate lists, one level
// deep. Anything else throws Unsupported and the fixture stays pending.
//
// The main vertical list is built as LaTeX builds it: \par's \parskip pair,
// interline glue (§ 679), and LaTeX's list kernel (latex.ltx \list, \@trivlist,
// \@item, \endtrivlist, \@endparenv) with \addvspace and \addpenalty, which look
// at \lastskip and \prevdepth. Pages come from the engine's page builder and go
// through \@makecol and \@outputpage: the head box, \headsep, the text, and the
// foot at \footskip with the page number.

import { classData, documentClass } from "../../classes"
import { dataFont } from "../../fonts"
import { emitBoxes } from "../../../emit/boxes"
import { shipOut } from "../../../emit/trace"
import type { ClassOptionData } from "../../../layout/classdata"
import type { GlueSpec } from "../../../layout/dimen"
import { loadFont, type Font } from "../../../layout/font"
import { appendText } from "../../../layout/hmode"
import { lineBreak } from "../../../layout/linebreak"
import { FIL, glue, paramGlue, penalty, type BoxNode, type CharNode, type GlueNode, type Node } from "../../../layout/nodes"
import { hpack, vpack } from "../../../layout/pack"
import type { ParagraphTrace } from "../../../trace/decisions"
import type { Adapter } from "./index"
import { appendToVlist, endDocument, makeColumns, paragraphInput, spec, type DocState } from "./paragraph"

/** A construct the adapter does not lay out yet: the fixture is reported pending, not failed. */
export class Unsupported extends Error {}

const LOW_PENALTY = 51 // \@lowpenalty: \@beginparpenalty, \@itempenalty and \@endparpenalty are its negation
const TEXTBULLET = 136 // \textbullet in TS1
const IGNORE_DEPTH = null // \prevdepth = -1000pt

type Block = { kind: "par"; text: string; noindent: boolean } | { kind: "list"; env: "itemize" | "enumerate"; items: string[]; inPar: boolean }

/** The body as paragraphs and lists. A paragraph that runs into a list ends there (\@trivlist's \par). */
function blocksOf(body: string): Block[] {
  body = body.replace(/(^|[^\\])%.*$/gm, "$1") // comments
  const out: Block[] = []
  const re = /\\begin\{(itemize|enumerate)\}([^]*?)\\end\{\1\}/g
  let at = 0, endpe = false
  const text = (s: string) => {
    // blank lines separate paragraphs; text right after a list (no blank line) is not indented (\@doendpe)
    const parts = s.split(/\n[ \t]*\n/)
    parts.forEach((p, i) => {
      const t = p.replace(/\s+/g, " ").trim()
      if (t) out.push({ kind: "par", text: t, noindent: i === 0 && endpe })
    })
  }
  for (let m: RegExpExecArray | null; (m = re.exec(body)); ) {
    const before = body.slice(at, m.index)
    text(before)
    const inPar = /\S[ \t]*\n?[ \t]*$/.test(before) && !/\n[ \t]*\n[ \t]*$/.test(before) && before.trim() !== ""
    if (/\\begin\{(itemize|enumerate)\}/.test(m[2])) throw new Unsupported("nested lists")
    const items = m[2].split(/\\item\b/)
    if (items[0].trim()) throw new Unsupported("text before the first \\item")
    if (items.slice(1).some((x) => /^\s*\[/.test(x))) throw new Unsupported("\\item[label]")
    if (items.slice(1).some((x) => /\n[ \t]*\n/.test(x.trim()))) throw new Unsupported("an item with several paragraphs")
    out.push({ kind: "list", env: m[1] as "itemize" | "enumerate", items: items.slice(1).map((x) => x.replace(/\s+/g, " ").trim()), inPar })
    at = m.index + m[0].length
    endpe = true
  }
  text(body.slice(at))
  // text, inline math and footnotes only; other commands are not laid out yet
  const check = (t: string) => { const m = t.replace(/\$[^$]*\$/g, "").match(/\\(?!footnote\b|noindent\b)[a-zA-Z]+(?!\s*=)/); if (m) throw new Unsupported(`${m[0]} in "${t.slice(0, 40)}"`) }
  for (const b of out) { if (b.kind === "par") check(b.text); else b.items.forEach(check) }
  return out
}

/** Glue arithmetic as \advance does it, for finite glue (§ 1239). */
const addGlue = (a: GlueSpec, b: GlueSpec): GlueSpec => {
  if (a.stretchOrder || b.stretchOrder || a.shrinkOrder || b.shrinkOrder) throw new Unsupported("infinite glue in \\addvspace")
  return { width: a.width + b.width, stretch: a.stretch + b.stretch, stretchOrder: 0, shrink: a.shrink + b.shrink, shrinkOrder: 0 }
}
const negate = (g: GlueSpec): GlueSpec => ({ ...g, width: -g.width, stretch: -g.stretch, shrink: -g.shrink })
const plain = (g: GlueSpec): GlueNode => glue(g.width, g.stretch, g.stretchOrder, g.shrink, g.shrinkOrder)
const dimen = (w: number): GlueSpec => ({ width: w, stretch: 0, stretchOrder: 0, shrink: 0, shrinkOrder: 0 })

/** The main vertical list, with what LaTeX's vertical-mode macros look at. */
class VerticalList {
  nodes: Node[] = [{ kind: "whatsit", text: "\\write-{}" }] // \begin{document}'s \write
  prevDepth: number | null = IGNORE_DEPTH
  constructor(private k: ClassOptionData) {}

  /** \lastskip: the last node's glue, or 0pt */
  get lastSkip(): GlueSpec {
    const n = this.nodes[this.nodes.length - 1]
    return n?.kind === "glue" ? n : dimen(0)
  }
  vskip(g: GlueSpec) { this.nodes.push(plain(g)) }

  /** \addvspace (latex.ltx): the larger of the skip and the one already there */
  addvspace(g: GlueSpec) {
    const last = this.lastSkip
    if (last.width === 0) { this.vskip(g); return }
    if (last.width < g.width) { this.vskip(negate(last)); this.vskip(g); return } // \@xaddvskip
    if (g.width < 0 && last.width >= 0) { const b = addGlue(g, last); this.vskip(negate(last)); this.vskip(b) }
  }

  /** \addpenalty (latex.ltx): a penalty placed before the skip that ends the list */
  addpenalty(p: number) {
    const last = this.lastSkip
    if (last.width === 0) { this.nodes.push(penalty(p)); return }
    const a = last
    const pd = this.prevDepth === IGNORE_DEPTH ? 0 : this.prevDepth > this.k.dimens.maxdepth ? this.k.dimens.maxdepth : this.prevDepth
    const b = addGlue(a, dimen(pd))
    this.vskip(negate(b))
    this.nodes.push(penalty(p))
    if (a.width !== b.width) this.vskip(addGlue(b, negate(a)))
    this.vskip(a)
  }

  /** A paragraph's lines (and what follows them: penalties, insertions) after \parskip. */
  paragraph(vlist: Node[], parskip: GlueSpec) {
    this.nodes.push(spec("parskip", parskip), paramGlue("parskip", glue(0))) // new_graf, then LaTeX's zero \parskip
    const baselineskip = this.k.sizes.normalsize.baselineskip
    for (const n of vlist) {
      if (n.kind === "hlist") this.prevDepth = appendToVlist(this.nodes, n, this.prevDepth, baselineskip, this.k.glue.lineskip, this.k.dimens.lineskiplimit)
      else this.nodes.push(n)
    }
  }
}

function charBox(f: Font, c: number): CharNode {
  const m = f.chars.get(c)
  if (!m) throw new Error(`${f.name} has no character ${c}`)
  return { kind: "char", font: f.name, size: f.size, char: c, width: m.width, height: m.height, depth: m.depth, text: String.fromCharCode(c) }
}
const hss = () => glue(0, 65536, FIL, 65536, FIL)

/** \@item's \@labels box: \hskip\itemindent \hskip-\labelwidth \hskip-\labelsep \hbox to\labelwidth{\makelabel{label}} \hskip\labelsep */
function labelBox(label: Node[], k: ClassOptionData): BoxNode {
  const llap = hpack([hss(), ...label], { exactly: 0 }) // \makelabel = \hss\llap{#1}
  const tempbox = hpack([hss(), llap])
  const lw = k.dimens.labelwidth, ls = k.dimens.labelsep
  const boxed = tempbox.width > lw ? tempbox : hpack(tempbox.list, { exactly: lw })
  return hpack([glue(0), glue(-lw), glue(-ls), boxed, glue(ls)])
}

/** \@outputpage: \vskip\topmargin, then moved right by \@themargin: the head box, \headsep, the text, the foot at \footskip. */
function outputPage(column: BoxNode, page: number, k: ClassOptionData, pagestyle: string): BoxNode {
  const font = loadFont(dataFont(k.sizes.normalsize.font.name), k.sizes.normalsize.font.at)
  const number = () => { const l: Node[] = []; appendText(l, String(page), font, { spaceFactor: 1000 }, false); return l }
  const hfil = () => glue(0, 65536, FIL)
  const even = k.ints.twoside && page % 2 === 0
  // \ps@plain: \@oddfoot{\hfil\thepage\hfil}; \ps@headings: \@oddhead{{\slshape\rightmark}\hfil\thepage},
  // \@evenhead{\thepage\hfil\slshape\leftmark}
  const headText: Node[] = pagestyle !== "headings" ? [] : even ? [...number(), hfil()] : [hfil(), ...number()]
  const footText: Node[] = pagestyle === "plain" ? [hfil(), ...number(), hfil()] : []
  const head = vpack([hfil(), hpack([hpack(headText, { exactly: k.dimens.textwidth })])], { exactly: k.dimens.headheight }) // \vfil, \hb@xt@\textwidth{\@thehead}
  head.depth = 0
  const foot = hpack([hpack(footText, { exactly: k.dimens.textwidth })])
  // \baselineskip\z@skip \lineskip\z@skip \lineskiplimit\z@ until \baselineskip\footskip before the foot
  const inner: Node[] = [head, glue(k.dimens.headsep), glue(0), column]
  const d = k.dimens.footskip - column.depth - foot.height
  inner.push(d < 0 ? glue(0) : glue(d), foot)
  const box = vpack(inner)
  box.shift = k.ints.twoside && page % 2 === 0 ? k.dimens.evensidemargin : k.dimens.oddsidemargin
  return vpack([glue(k.dimens.topmargin), box])
}

export const document: Adapter = (src) => {
  const { cls, option } = documentClass(src)
  if (!["article", "report", "book"].includes(cls)) throw new Unsupported(`class ${cls}`)
  const k = classData(cls, option)
  const pre = src.slice(0, src.indexOf("\\begin{document}")).replace(/(^|[^\\])%.*$/gm, "$1")
  let pagestyle = cls === "book" ? "headings" : "plain"
  for (const line of pre.split("\n").map((l) => l.trim()).filter(Boolean)) {
    if (/^\\documentclass\b/.test(line)) continue
    const m = line.match(/^\\pagestyle\{(plain|empty|headings)\}$/)
    if (m) { pagestyle = m[1]; continue }
    throw new Unsupported(`preamble: ${line}`)
  }
  const body = src.slice(src.indexOf("\\begin{document}") + 16, src.indexOf("\\end{document}"))
  const blocks = blocksOf(body)

  const v = new VerticalList(k)
  const doc: DocState = { footnote: 0 }
  const decisions: ParagraphTrace[] = []
  const outerParskip = k.glue.parskip
  const typeset = (text: string, opts: Parameters<typeof paragraphInput>[4], parskip: GlueSpec) => {
    const { list, params, notes } = paragraphInput(text, k, "normalsize", doc, opts)
    const { vlist, trace } = lineBreak(list, params)
    decisions.push(...notes, trace)
    v.paragraph(vlist, parskip)
  }
  for (const b of blocks) {
    if (b.kind === "par") { typeset((b.noindent ? "\\noindent " : "") + b.text, {}, outerParskip); continue }
    // \list (with \@listi): \@trivlist, \parskip\parsep, \parshape 1 \leftmargin \linewidth
    const leftmargin = k.dimens.leftmargini
    const topsepadd = b.inPar ? k.glue.topsep : addGlue(k.glue.topsep, k.glue.partopsep) // \partopsep only from vertical mode
    const topsep = addGlue(topsepadd, outerParskip) // \advance\@topsep\parskip, the outer \parskip
    const parsep = k.glue.parsep
    const parShape: [number, number][] = [[leftmargin, k.dimens.textwidth - leftmargin]]
    const font = loadFont(dataFont(k.sizes.normalsize.font.name), k.sizes.normalsize.font.at)
    const companion = loadFont(dataFont(k.sizes.normalsize.companion.name), k.sizes.normalsize.companion.at)
    b.items.forEach((text, i) => {
      // \@item: before the first item \@beginparpenalty, \@topsep and -\parskip; then \@itempenalty and \itemsep
      if (i === 0) { v.addpenalty(-LOW_PENALTY); v.addvspace(topsep); v.addvspace(negate(parsep)) }
      else { v.addpenalty(-LOW_PENALTY); v.addvspace(k.glue.itemsep) }
      const label: Node[] = []
      if (b.env === "itemize") label.push(charBox(companion, TEXTBULLET))
      else appendText(label, `${i + 1}.`, font, { spaceFactor: 1000 }, false) // \labelenumi = \theenumi.
      // \everypar: the indent box gives way to \box\@labels \penalty\z@
      typeset(text, { start: [labelBox(label, k), penalty(0)], parShape }, parsep)
    })
    // \endtrivlist: the last item's \par, then \@endparenv: \@endparpenalty and \@topsepadd
    if (v.lastSkip.width > 0) throw new Unsupported("a list ending in vertical space")
    v.addpenalty(-LOW_PENALTY)
    v.addvspace(topsepadd)
  }

  const { pages, pageTrace } = endDocument(v.nodes, v.prevDepth, k)
  const columns = makeColumns(pages, k)
  const shipped = columns.map((c, i) => outputPage(c.outputbox, i + 1, k, pagestyle))
  return {
    trace: shipOut(shipped),
    decisions,
    pages: pageTrace,
    columns: columns.map((c) => c.column.map(emitBoxes)),
    notes: [`${cls} [${option}], \\pagestyle{${pagestyle}}; ${blocks.length} block(s), ${pages.length} page(s)`],
  }
}
