// Adapter "document": whole documents in a growing subset of LaTeX, laid out
// end to end. Today: a standard class at 10pt, 11pt or 12pt; \pagestyle plain,
// empty or headings (the class's default; with no sectioning yet the marks are
// empty, so a running head is the page number at the outer edge); paragraphs of text, inline math and footnotes (as
// the paragraph adapter reads them); and itemize and enumerate lists, one level
// deep; \section, \subsection and \subsubsection, starred or numbered (latex.ltx
// \@startsection, \@sect, \@xsect, \@afterheading). Anything else throws
// Unsupported and the fixture stays pending.
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
import type { ClassOptionData, SizeCommand } from "../../../layout/classdata"
import type { GlueSpec } from "../../../layout/dimen"
import { loadFont, QUAD, X_HEIGHT, type Font } from "../../../layout/font"
import { Scanner } from "../../../layout/dimen"
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

type Block =
  | { kind: "par"; text: string; noindent: boolean }
  | { kind: "list"; env: "itemize" | "enumerate"; items: string[]; inPar: boolean; blank: boolean }
  | { kind: "heading"; level: 1 | 2 | 3; star: boolean; title: string }

const HEADINGS = { section: 1, subsection: 2, subsubsection: 3 } as const

/** The body as paragraphs, lists and headings. A paragraph that runs into a list ends there (\@trivlist's \par). */
function blocksOf(body: string): Block[] {
  body = body.replace(/(^|[^\\])%.*$/gm, "$1") // comments
  const out: Block[] = []
  const re = /\\(section|subsection|subsubsection)\b(\*?)\s*|\\begin\{(itemize|enumerate)\}([^]*?)\\end\{\3\}/g
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
    if (m[1]) { // a heading: its argument in braces
      if (body[re.lastIndex] !== "{") throw new Unsupported(`\\${m[1]} without a {title}${body[re.lastIndex] === "[" ? " (or with a short title)" : ""}`)
      let depth = 0, j = re.lastIndex
      for (; j < body.length; j++) { if (body[j] === "{") depth++; else if (body[j] === "}" && --depth === 0) break }
      const title = body.slice(re.lastIndex + 1, j).replace(/\s+/g, " ").trim()
      out.push({ kind: "heading", level: HEADINGS[m[1] as keyof typeof HEADINGS], star: m[2] === "*", title })
      re.lastIndex = j + 1
      at = j + 1
      endpe = false
      continue
    }
    const inPar = /\S[ \t]*\n?[ \t]*$/.test(before) && !/\n[ \t]*\n[ \t]*$/.test(before) && before.trim() !== ""
    if (/\\begin\{(itemize|enumerate)\}/.test(m[4])) throw new Unsupported("nested lists")
    const items = m[4].split(/\\item\b/)
    if (items[0].trim()) throw new Unsupported("text before the first \\item")
    if (items.slice(1).some((x) => /^\s*\[/.test(x))) throw new Unsupported("\\item[label]")
    if (items.slice(1).some((x) => /\n[ \t]*\n/.test(x.trim()))) throw new Unsupported("an item with several paragraphs")
    out.push({ kind: "list", env: m[3] as "itemize" | "enumerate", items: items.slice(1).map((x) => x.replace(/\s+/g, " ").trim()), inPar, blank: /\n[ \t]*\n\s*$/.test(before) })
    at = m.index + m[0].length
    endpe = true
  }
  text(body.slice(at))
  // text, inline math and footnotes only; other commands are not laid out yet
  const check = (t: string) => { const m = t.replace(/\$[^$]*\$/g, "").match(/\\(?!footnote\b|noindent\b)[a-zA-Z]+(?!\s*=)/); if (m) throw new Unsupported(`${m[0]} in "${t.slice(0, 40)}"`) }
  for (const b of out) {
    if (b.kind === "par") check(b.text)
    else if (b.kind === "list") b.items.forEach(check)
    else if (/[\\{}%&#^_~]/.test(b.title.replace(/\$[^$\\]*\$/g, ""))) throw new Unsupported(`heading "${b.title}"`)
  }
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
  /** \if@nobreak: right after a heading (\@afterheading), until the next paragraph starts */
  nobreak = false
  /** \if@afterindent: whether that paragraph keeps its indentation */
  afterindent = true
  /** \clubpenalty at the outer level: \@afterheading's \everypar sets \@M, which lasts until a later paragraph resets it */
  club = 150
  /** \@afterheading's \everypar is still in force (it clears itself in the first paragraph after the one it set up) */
  afterheadingEverypar = false
  /** \@doendpe has redefined \par: the next \par resets \clubpenalty */
  endpePar = false
  /** a \par at the outer level */
  par() { if (this.endpePar) { this.club = this.k.ints.clubpenalty; this.endpePar = false; this.afterheadingEverypar = false } }
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
    if (this.nobreak) return
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
  paragraph(vlist: Node[], parskip: GlueSpec, baselineskip = this.k.sizes.normalsize.baselineskip) {
    this.nodes.push(spec("parskip", parskip), paramGlue("parskip", glue(0))) // new_graf, then LaTeX's zero \parskip
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
  const typeset = (text: string, opts: Parameters<typeof paragraphInput>[4], parskip: GlueSpec, size: SizeCommand = "normalsize") => {
    const { list, params, notes } = paragraphInput(text, k, size, doc, opts)
    const { vlist, trace } = lineBreak(list, params)
    decisions.push(...notes, trace)
    v.paragraph(vlist, parskip, k.sizes[size].baselineskip)
  }
  const roman = k.sizes.normalsize.font
  // skips in ex are read in the body font (\@startsection evaluates them before the heading's font)
  const romanFont = loadFont(dataFont(roman.name), roman.at)
  const bodyUnits = { em: romanFont.params[QUAD], ex: romanFont.params[X_HEIGHT] }
  const counters = [0, 0, 0, 0] // chapter (never stepped yet), section, subsection, subsubsection
  blocks.forEach((b, bi) => {
    if (b.kind === "heading") { heading(b); return }
    if (b.kind === "par") {
      if (b.noindent) {
        // right after a list: \@doendpe's \everypar drops the indent box; its \par resets \clubpenalty
        // first, so the lines see \@clubpenalty while footnotes read before it see the value in force
        // (a list that follows at once runs that \par inside its own group, so the reset does not last)
        const noteClub = v.club
        const next = blocks[bi + 1]
        if (next?.kind === "list" && next.inPar) typeset("\\noindent " + b.text, { clubPenalty: k.ints.clubpenalty, noteClubPenalty: noteClub }, outerParskip)
        else { v.par(); typeset("\\noindent " + b.text, { clubPenalty: v.club, noteClubPenalty: noteClub }, outerParskip) }
        return
      }
      v.par() // the blank line before it
      let noindent = false
      if (v.afterheadingEverypar) {
        // \@afterheading's \everypar: \clubpenalty\@M and no indentation unless \@afterindent; later, \@clubpenalty
        if (v.nobreak) { v.nobreak = false; v.club = 10000; noindent = !v.afterindent }
        else { v.club = k.ints.clubpenalty; v.afterheadingEverypar = false }
      }
      typeset((noindent ? "\\noindent " : "") + b.text, { clubPenalty: v.club }, outerParskip)
      return
    }
    if (b.blank) v.par() // a blank line before the list
    // \list (with \@listi): \@trivlist, \parskip\parsep, \parshape 1 \leftmargin \linewidth
    const leftmargin = k.dimens.leftmargini
    const topsepadd = b.inPar ? k.glue.topsep : addGlue(k.glue.topsep, k.glue.partopsep) // \partopsep only from vertical mode
    const topsep = addGlue(topsepadd, outerParskip) // \advance\@topsep\parskip, the outer \parskip
    const parsep = k.glue.parsep
    const parShape: [number, number][] = [[leftmargin, k.dimens.textwidth - leftmargin]]
    const font = loadFont(dataFont(k.sizes.normalsize.font.name), k.sizes.normalsize.font.at)
    const companion = loadFont(dataFont(k.sizes.normalsize.companion.name), k.sizes.normalsize.companion.at)
    b.items.forEach((text, i) => {
      // \@item: before the first item \@beginparpenalty, \@topsep and -\parskip (right after a heading,
      // \@nbitem: \@outerparskip-\parskip); then \@itempenalty and \itemsep
      let club: number | undefined
      if (i === 0 && v.nobreak) { v.addvspace(addGlue(outerParskip, negate(parsep))); v.nobreak = false; club = 10000 }
      else if (i === 0) { v.addpenalty(-LOW_PENALTY); v.addvspace(topsep); v.addvspace(negate(parsep)) }
      else { v.addpenalty(-LOW_PENALTY); v.addvspace(k.glue.itemsep) }
      const label: Node[] = []
      if (b.env === "itemize") label.push(charBox(companion, TEXTBULLET))
      else appendText(label, `${i + 1}.`, font, { spaceFactor: 1000 }, false) // \labelenumi = \theenumi.
      // \everypar: the indent box gives way to \box\@labels \penalty\z@
      typeset(text, { start: [labelBox(label, k), penalty(0)], parShape, ...(club ? { clubPenalty: club } : {}) }, parsep)
    })
    // \endtrivlist: the last item's \par, then \@endparenv: \@endparpenalty and \@topsepadd
    if (v.lastSkip.width > 0) throw new Unsupported("a list ending in vertical space")
    v.addpenalty(-LOW_PENALTY)
    v.addvspace(topsepadd)
    // the list's group ends (its \clubpenalty and \everypar settings with it); \end then runs \@doendpe
    v.afterheadingEverypar = false
    v.endpePar = true
  })

  /** \@startsection{name}{level}{\z@}{beforeskip}{afterskip}{\normalfont<size>\bfseries} and its starred form */
  function heading(b: Extract<Block, { kind: "heading" }>) {
    const name = (["", "section", "subsection", "subsubsection"] as const)[b.level]
    const size: SizeCommand = (["normalsize", "Large", "large", "normalsize"] as const)[b.level]
    const glueOf = (x: string) => new Scanner(x, bodyUnits).scanGlue()
    let before = glueOf(b.level === 1 ? "-3.5ex plus -1ex minus -.2ex" : "-3.25ex plus -1ex minus -.2ex")
    const after = glueOf(b.level === 1 ? "2.3ex plus .2ex" : "1.5ex plus .2ex")
    v.par() // \@startsection's \par
    const afterHeading = v.nobreak
    if (afterHeading) v.afterheadingEverypar = false // \if@nobreak \everypar{}
    // the heading's \noindent starts its paragraph in the heading's group: an \@afterheading \everypar
    // still in force sets \@clubpenalty there (locally); otherwise the \clubpenalty in force holds
    const headingClub = v.afterheadingEverypar ? k.ints.clubpenalty : v.club
    v.afterindent = true
    if (before.width < 0) { before = negate(before); v.afterindent = false }
    if (!v.nobreak) { v.addpenalty(-300); v.addvspace(before) } // \@secpenalty
    // \@sect: the number and the space after it (\@seccntformat: \the<name>\quad) in a box the title hangs from
    const numbered = !b.star && b.level <= k.ints.secnumdepth
    let number = ""
    if (!b.star) {
      counters[b.level]++
      for (let l = b.level + 1; l < counters.length; l++) counters[l] = 0
      number = (cls === "article" ? counters.slice(1, b.level + 1) : counters.slice(0, b.level + 1)).join(".")
    }
    const bold = k.sizes[size].bold
    const bf = loadFont(dataFont(bold.name), bold.at)
    const label: Node[] = [glue(0)] // \hskip #3 (\z@)
    if (numbered) { appendText(label, number, bf, { spaceFactor: 1000 }, false); label.push(glue(bf.params[QUAD])) }
    const box = hpack(label)
    typeset(b.title, { start: [box], font: bold, hangIndent: box.width, interLinePenalty: 10000, clubPenalty: headingClub }, outerParskip, size)
    // \addcontentsline{toc}: \protected@write, a \write after the heading's lines, with \nobreak after it
    // while \if@nobreak holds (a heading right after a heading)
    if (!b.star) v.nodes.push({ kind: "whatsit", text: `\\write1{\\@writefile{toc}{\\protect \\contentsline {${name}}{${numbered ? `\\protect \\numberline {${number}}` : ""}${b.title}}{\\thepage }{}\\protected@file@percent }}` })
    if (!b.star && afterHeading) v.nodes.push(penalty(10000))
    // \@xsect: \par \nobreak \vskip afterskip \@afterheading
    v.nodes.push(penalty(10000))
    v.vskip(after)
    v.nobreak = true
    v.afterheadingEverypar = true
  }

  if (pagestyle === "headings" && blocks.some((b) => b.kind === "heading")) throw new Unsupported("running heads with section marks")
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
