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
import { loadFont, QUAD, SPACE, SPACE_SHRINK, SPACE_STRETCH, X_HEIGHT, type Font } from "../../../layout/font"
import { Scanner } from "../../../layout/dimen"
import { appendText } from "../../../layout/hmode"
import { lineBreak } from "../../../layout/linebreak"
import { emptyBox, FIL, glue, kern, paramGlue, penalty, type BoxNode, type CharNode, type GlueNode, type Node } from "../../../layout/nodes"
import { displayLine, finishDisplay, preDisplaySize } from "../../../layout/display"
import { DISPLAY as DISPLAY_STYLE, groupField, mlistToHlist, ORD as ORD_NOAD, TEXT as TEXT_STYLE, type MItem } from "../../../mathlayout/mlist"
import { parseMath } from "../../../mathlayout/parse"
import { hpack, vpack } from "../../../layout/pack"
import { halign } from "../../../layout/align"
import { xnOverD } from "../../../layout/arith"
import { ORACLE_EPOCH } from "../../tex"
import type { ParagraphTrace } from "../../../trace/decisions"
import type { Adapter } from "./index"
import { appendToVlist, endDocument, makeColumns, mathData, mathEnv, paragraphInput, spec, type DocState } from "./paragraph"

/** A construct the adapter does not lay out yet: the fixture is reported pending, not failed. */
export class Unsupported extends Error {}

const LOW_PENALTY = 51 // \@lowpenalty: \@beginparpenalty, \@itempenalty and \@endparpenalty are its negation
const TEXTBULLET = 136 // \textbullet in TS1
const IGNORE_DEPTH = null // \prevdepth = -1000pt

/** What a float marker carries to the output routine: the float's box, its placement bits, and \if@nobreak. */
interface FloatMarker { box: BoxNode; fps: number; nobreak: boolean }

type Block =
  | { kind: "par"; text: string; noindent: boolean }
  | { kind: "list"; env: "itemize" | "enumerate"; items: string[]; inPar: boolean; blank: boolean }
  | { kind: "heading"; level: 1 | 2 | 3; star: boolean; title: string }
  | { kind: "maketitle" }
  | { kind: "float"; env: "figure" | "table"; fps: string | null; body: string; inPar: boolean }

const HEADINGS = { section: 1, subsection: 2, subsubsection: 3 } as const

/** A displayed formula in a paragraph: \[…\], $$…$$, or an equation, equation* or displaymath environment. */
interface Display { kind: "bracket" | "dollars" | "equation" | "equation*" | "displaymath" | "align" | "align*"; src: string }
const DISPLAY = /\\\[([^]*?)\\\]|\$\$([^]*?)\$\$|\\begin\{(equation\*?|displaymath|align\*?)\}([^]*?)\\end\{\3\}/
/** A paragraph's text split at its displays: text, display, text, …, text. */
function displaySegments(text: string): (string | Display)[] {
  const out: (string | Display)[] = []
  const re = new RegExp(DISPLAY.source, "g")
  let at = 0
  for (let m: RegExpExecArray | null; (m = re.exec(text)); ) {
    out.push(text.slice(at, m.index))
    out.push(m[1] !== undefined ? { kind: "bracket", src: m[1] } : m[2] !== undefined ? { kind: "dollars", src: m[2] } : { kind: m[3] as Display["kind"], src: m[4] })
    at = m.index + m[0].length
  }
  out.push(text.slice(at))
  return out
}

/** The body as paragraphs, lists and headings. A paragraph that runs into a list ends there (\@trivlist's \par). */
function blocksOf(body: string): Block[] {
  body = body.replace(/(^|[^\\])%.*$/gm, "$1") // comments
  const out: Block[] = []
  const re = /\\(section|subsection|subsubsection)\b(\*?)\s*|\\begin\{(itemize|enumerate)\}([^]*?)\\end\{\3\}|\\(maketitle)\b\s*|\\begin\{(figure|table)\}\s*(?:\[([^\]]*)\])?([^]*?)\\end\{\6\}/g
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
    if (m[5]) { out.push({ kind: "maketitle" }); at = re.lastIndex; endpe = false; continue }
    if (m[6]) {
      const inPar = /\S[ \t]*\n?[ \t]*$/.test(before) && !/\n[ \t]*\n[ \t]*$/.test(before) && before.trim() !== ""
      out.push({ kind: "float", env: m[6] as "figure" | "table", fps: m[7] ?? null, body: m[8], inPar })
      at = re.lastIndex; endpe = false; continue
    }
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
    if (b.kind === "par") displaySegments(b.text).filter((_, i) => i % 2 === 0).forEach((t) => check(t as string))
    else if (b.kind === "list") b.items.forEach((t) => { if (DISPLAY.test(t)) throw new Unsupported("a display in a list item"); check(t) })
    else if (b.kind === "maketitle" || b.kind === "float") continue
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
  /** \prevdepth is 0pt when the document begins (the first line's interline glue goes at the top of the page) */
  prevDepth: number | null = 0
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
  /** \endtrivlist in vertical mode: a skip at the end is redone with the list's \parskip taken out,
   *  then \@endparenv: \addpenalty\@endparpenalty \addvspace\@topsepadd */
  endtrivlist(parskip: GlueSpec, outerParskip: GlueSpec, topsepadd: GlueSpec) {
    const last = this.lastSkip
    if (last.width > 0) { this.vskip(negate(last)); this.vskip(addGlue(addGlue(last, parskip), negate(outerParskip))) }
    this.addpenalty(-LOW_PENALTY)
    this.addvspace(topsepadd)
  }
  /** a box appended in vertical mode, after interline glue */
  box(b: BoxNode, baselineskip: GlueSpec) { this.prevDepth = appendToVlist(this.nodes, b, this.prevDepth, baselineskip, this.k.glue.lineskip, this.k.dimens.lineskiplimit) }

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
  paragraph(vlist: Node[], parskip: GlueSpec, baselineskip = this.k.sizes.normalsize.baselineskip, lineskip = this.k.glue.lineskip) {
    this.nodes.push(spec("parskip", parskip), paramGlue("parskip", glue(0))) // new_graf, then LaTeX's zero \parskip
    this.lines(vlist, baselineskip, lineskip)
  }
  /** lines of a paragraph (no \parskip: the part after a display) */
  lines(vlist: Node[], baselineskip = this.k.sizes.normalsize.baselineskip, lineskip = this.k.glue.lineskip) {
    for (const n of vlist) {
      if (n.kind === "hlist") this.prevDepth = appendToVlist(this.nodes, n, this.prevDepth, baselineskip, lineskip, this.k.dimens.lineskiplimit)
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
  let amsmath = false
  const title: { title?: string; author?: string; date?: string } = {}
  for (const line of pre.split("\n").map((l) => l.trim()).filter(Boolean)) {
    if (/^\\documentclass\b/.test(line)) continue
    if (line === "\\usepackage{amsmath}") { amsmath = true; continue }
    if (line === "\\usepackage{graphicx}") continue // nothing to lay out until \includegraphics
    const t = line.match(/^\\(title|author|date)\{(.*)\}$/)
    if (t) { title[t[1] as keyof typeof title] = t[2].trim(); continue }
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
    const { list, params, notes } = paragraphInput(text, k, size, doc, { ...opts, amsmath })
    const { vlist, trace } = lineBreak(list, params)
    decisions.push(...notes, trace)
    v.paragraph(vlist, parskip, k.sizes[size].baselineskip)
  }
  const roman = k.sizes.normalsize.font
  // skips in ex are read in the body font (\@startsection evaluates them before the heading's font)
  const romanFont = loadFont(dataFont(roman.name), roman.at)
  const bodyUnits = { em: romanFont.params[QUAD], ex: romanFont.params[X_HEIGHT] }
  const titleBoxes: BoxNode[] = []
  const counters = Object.assign([0, 0, 0, 0], { equation: 0, figure: 0, table: 0 }) // chapter (never stepped yet), section, subsection, subsubsection
  blocks.forEach((b, bi) => {
    if (b.kind === "heading") { heading(b); return }
    if (b.kind === "maketitle") { maketitle(); return }
    if (b.kind === "float") { floatBlock(b); return }
    if (b.kind === "par") {
      if (b.noindent) {
        // right after a list: \@doendpe's \everypar drops the indent box; its \par resets \clubpenalty
        // first, so the lines see \@clubpenalty while footnotes read before it see the value in force
        // (a list that follows at once runs that \par inside its own group, so the reset does not last)
        const noteClub = v.club
        const next = blocks[bi + 1]
        if (next?.kind === "list" && next.inPar) paragraphWithDisplays(b.text, true, noteClub, k.ints.clubpenalty)
        else { v.par(); paragraphWithDisplays(b.text, true, noteClub, v.club) }
        return
      }
      v.par() // the blank line before it
      let noindent = false
      // a display environment (or amsmath's \[, which is \begin{equation*}) that starts the paragraph
      // starts it inside the environment's group: \everypar's assignments there do not last
      const segs = displaySegments(b.text)
      const grouped = !(segs[0] as string).trim() && typeof segs[1] !== "string" && (segs[1].kind !== "dollars" && (segs[1].kind !== "bracket" || amsmath))
      if (v.afterheadingEverypar) {
        // \@afterheading's \everypar: \clubpenalty\@M and no indentation unless \@afterindent; later, \@clubpenalty
        if (v.nobreak) { v.nobreak = false; noindent = !v.afterindent; if (!grouped) v.club = 10000 }
        else if (!grouped) { v.club = k.ints.clubpenalty; v.afterheadingEverypar = false }
      }
      paragraphWithDisplays(b.text, noindent, v.club, v.club)
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
    // \endtrivlist: the last item's \par, then \@endparenv
    v.endtrivlist(parsep, outerParskip, topsepadd)
    // the list's group ends (its \clubpenalty and \everypar settings with it); \end then runs \@doendpe
    v.afterheadingEverypar = false
    v.endpePar = true
  })

  /**
   * A paragraph that may hold displays (§§ 1145–1206). The text before each display is broken
   * with \displaywidowpenalty; the display goes on the vertical list; the paragraph resumes after
   * it with prev_graf+3, no indentation and no \parskip. `club` is \clubpenalty while the
   * paragraph is read and `parClub` the one its final \par sees.
   */
  function paragraphWithDisplays(text: string, noindent: boolean, club: number, parClub: number) {
    const segs = displaySegments(text)
    const quad = romanFont.params[QUAD]
    let prevGraf = 0
    segs.forEach((seg, i) => {
      if (typeof seg !== "string") return
      const first = i === 0, last = i === segs.length - 1
      const t = first ? seg.trim() : seg.replace(/^\s+/, "").trimEnd() // a display ends with \ignorespaces
      const next = segs[i + 1] as Display | undefined
      let justBox: BoxNode | null = null, nlines = 0
      let params: ReturnType<typeof paragraphInput>["params"] | null = null
      const opts = {
        clubPenalty: last ? parClub : club, noteClubPenalty: club, prevGraf,
        ...(last ? {} : { widowPenalty: k.ints.displaywidowpenalty }),
        ...(first ? {} : { start: [] as Node[] }),
      }
      if (first && !t) {
        // the display starts the paragraph: $$ (and amsmath's \[) from vertical mode starts it with the
        // indent box; LaTeX's own \[ first sets \nointerlineskip\makebox[.6\linewidth]{}
        if (next!.kind === "bracket" && !amsmath || next!.kind === "displaymath" && !amsmath) {
          v.prevDepth = IGNORE_DEPTH
          const lw = k.dimens.textwidth
          const mb = hpack([hss(), hss()], { exactly: xnOverD(lw, 39322, 65536) })
          const r = typesetList([...(noindent ? [] : [emptyBox("hlist", k.dimens.parindent)]), mb], opts, true)
          justBox = r.just; params = r.params; nlines = r.lines
        } else if (!noindent) {
          const r = typesetList([emptyBox("hlist", k.dimens.parindent)], opts, true)
          justBox = r.just; params = r.params; nlines = r.lines
        } else v.nodes.push(spec("parskip", outerParskip), paramGlue("parskip", glue(0))) // \noindent$$: an empty paragraph
      } else if (t || !last) {
        const { list, params: ps, notes } = paragraphInput((first && noindent ? "\\noindent " : "") + t, k, "normalsize", doc, { ...opts, amsmath })
        if (list.length || first) {
          const lb = lineBreak(list, ps)
          decisions.push(...notes, lb.trace)
          if (first) v.paragraph(lb.vlist, outerParskip); else v.lines(lb.vlist)
          justBox = lb.lines[lb.lines.length - 1] ?? null
          params = ps; nlines = lb.lines.length
        }
      }
      prevGraf += nlines
      if (!next) return
      // the display
      const ps = params ?? paragraphInput("", k, "normalsize", doc, { amsmath }).params
      const line = displayLine(prevGraf, ps.hsize, ps.hangIndent, ps.hangAfter, ps.parShape)
      if (next.kind === "align" || next.kind === "align*") {
        if (!amsmath) throw new Unsupported(`${next.kind} without amsmath`)
        alignDisplay(next, line, ps)
        prevGraf += 3
        return
      }
      let mlist
      try { mlist = parseMath(next.src.replace(/\s+/g, " "), mathData()) } catch (e) { throw new Unsupported((e as Error).message) }
      const env = mathEnv(k, "normalsize", amsmath)
      if (next.kind === "equation" && amsmath) throw new Unsupported("amsmath's numbered equation (it differs between TeX Live releases)")
      if (next.kind === "equation*" && !amsmath) throw new Unsupported("equation* without amsmath")
      let eqno: BoxNode | null = null
      if (next.kind === "equation") { // \eqno \hbox{\@eqnnum}: {\normalfont (\theequation)}
        counters.equation++
        const l: Node[] = []
        appendText(l, `(${counters.equation})`, romanFont, { spaceFactor: 1000 }, false)
        eqno = hpack([hpack(l)]); eqno.display = true
      }
      const sz = k.sizes.normalsize
      const items = finishDisplay(mlistToHlist(mlist, env, DISPLAY_STYLE, false), eqno, {
        width: line.width, indent: line.indent, preSize: preDisplaySize(justBox, quad), mathQuad: env.fonts[0][2]!.params[QUAD],
        preDisplayPenalty: k.ints.predisplaypenalty, postDisplayPenalty: k.ints.postdisplaypenalty,
        aboveDisplaySkip: sz.abovedisplayskip, belowDisplaySkip: sz.belowdisplayskip, aboveDisplayShortSkip: sz.abovedisplayshortskip, belowDisplayShortSkip: sz.belowdisplayshortskip,
      })
      for (const it of items) { if ("box" in it) v.box(it.box, sz.baselineskip); else v.nodes.push(it.node) }
      prevGraf += 3
    })
  }
  /**
   * amsmath's align and align* (\start@align\@ne, \align@, \measure@, \calc@shift@align,
   * \math@cr@@@align, \place@tag): fields alternate right- and left-aligned, the whole is centred
   * by \eqnshift@ with \alignsep@ between column pairs, and each row's number is set off at the
   * right edge. TeX finishes it as an alignment in a display (§ 1206).
   */
  function alignDisplay(d: Display, line: { width: number; indent: number }, _ps: unknown) {
    const starred = d.kind === "align*"
    let src = d.src.trim()
    if (/\\\\\s*$/.test(src)) throw new Unsupported("align ending with \\\\")
    if (/\\(label|tag|intertext|shortintertext)\b/.test(src)) throw new Unsupported("\\label, \\tag or \\intertext in align")
    const env = mathEnv(k, "normalsize", true)
    const mathBox = (items: MItem[]) => hpack([{ kind: "math", on: true, width: 0 }, ...mlistToHlist([{ kind: "style", style: DISPLAY_STYLE }, ...items], env, TEXT_STYLE, false), { kind: "math", on: false, width: 0 }])
    const parse = (f: string) => { try { return parseMath(f.replace(/\s+/g, " "), mathData()) } catch (e) { throw new Unsupported((e as Error).message) } }
    const rows = src.split(/\\\\/).map((r) => {
      const numbered = !starred && !/\\(nonumber|notag)\b/.test(r)
      const fields = r.replace(/\\(nonumber|notag)\b/g, "").split("&").map((f, j) => {
        const items = parse(f)
        // \setboxz@h{\@lign$\m@th\displaystyle{##}$} and {{}##} for the left-aligned fields
        return mathBox([{ noad: ORD_NOAD, nucleus: groupField(j % 2 ? [{ noad: ORD_NOAD, nucleus: { kind: "mlist", list: [] }, sup: null, sub: null }, ...items] : items), sup: null, sub: null }])
      })
      return { fields, numbered }
    })
    const z = line.width
    const sz = k.sizes.normalsize, strut = sz.strut
    const strutBox = () => hpack([vpack([kern(-k.dimens.normallineskiplimit, true), hpack([{ kind: "rule", width: 0, height: strut.height, depth: strut.depth }])])]) // \strut@
    // tags: \strut@ and (n) in \maketag@@@, numbered in row order
    const tags = rows.map((r) => {
      if (!r.numbered) return hpack([strutBox()])
      counters.equation++
      const l: Node[] = []
      appendText(l, `(${counters.equation}`, romanFont, { spaceFactor: 1000 }, false)
      const last = l[l.length - 1] as CharNode
      l.push(kern(romanFont.chars.get(last.char)!.italic, true)) // \@@italiccorr
      appendText(l, ")", romanFont, { spaceFactor: 1000 }, false)
      return hpack([strutBox(), hpack(l)])
    })
    // \measure@
    let maxfields = Math.max(...rows.map((r) => r.fields.length))
    if (maxfields % 2) maxfields++
    const colW = Array.from({ length: maxfields }, (_, j) => Math.max(0, ...rows.map((r) => r.fields[j]?.width ?? 0)))
    const totwidth = colW.reduce((a, b) => a + b, 0)
    const div = (a: number, b: number) => Math.trunc(a / b)
    const minalignsep = 655360
    const mintagsep = xnOverD(env.fonts[0][2]!.params[QUAD], 32768, 65536)
    let tempcntb = maxfields / 2, tempcnta = tempcntb
    tempcntb -= 1; tempcnta += 1
    let eqnshift = div(z - totwidth, tempcnta), alignsep = eqnshift
    if (alignsep < minalignsep) { alignsep = minalignsep; if (eqnshift > 0) eqnshift = div(z - totwidth - tempcntb * alignsep, 2) }
    if (eqnshift < 0) eqnshift = 0
    // \calc@shift@align (tags on the right, not fleqn), last row first
    for (let r = rows.length - 1; r >= 0; r--) {
      const tw = tags[r].width
      if (!(tw > 0)) continue
      let dimb = 0, dimc = 0
      rows[r].fields.forEach((f, i) => { // \x@rcalc@width
        const col = i + 1, a = f.width
        if (a > 0) { dimc += dimb; if (col % 2) { dimc += colW[i]; dimb = 0 } else { dimc += a; dimb = colW[i] - a } }
        else dimb += colW[i]
      })
      let cnta = tempcnta, cntb = tempcntb
      const column = div(rows[r].fields.length - 1, 2)
      if (cntb > column) { cnta -= cntb; cnta += column; cntb = column }
      const dima = dimc + tw
      let dimen = minalignsep * cntb + mintagsep + mintagsep + dima
      if (dimen > z) throw new Unsupported("an align tag moved to its own line")
      dimen = eqnshift + dima + cntb * alignsep + tw
      if (dimen > z) {
        dimen = div(z - dima, cnta)
        if (dimen < minalignsep) { alignsep = minalignsep; eqnshift = div(z - dima - cntb * alignsep, 2) }
        else {
          if (dimen < eqnshift) eqnshift = dimen < 0 ? 0 : dimen
          if (dimen < alignsep) alignsep = dimen
        }
      }
    }
    const tagshift = totwidth + tempcntb * alignsep + eqnshift - z
    // the main \halign: cells, then the \omit column with \kern-\alignsep@ and \place@tag
    const hfil = () => glue(0, 65536, FIL)
    const cells = rows.map((r, ri) => {
      const row: Node[][] = []
      for (let j = 0; j < maxfields; j++) {
        const f = r.fields[j]
        if (!f) { row.push(j % 2 ? [hfil()] : [hfil(), strutBox()]); continue } // \add@amps: empty fields
        row.push(j % 2 ? [f, hfil()] : [hfil(), strutBox(), f])
      }
      const tagCol: Node[] = [kern(-alignsep, true)]
      if (r.numbered) tagCol.push(kern(-tagshift, true), hpack([hss(), tags[ri]], { exactly: 0 }))
      row.push(tagCol)
      return row
    })
    const tabskip = [paramGlue("tabskip", glue(eqnshift))]
    for (let j = 0; j <= maxfields; j++) tabskip.push(paramGlue("tabskip", glue(j % 2 ? alignsep : 0)))
    const rowBoxes = halign(cells.map((r) => r.map((c) => c)), tabskip, { additional: 0 })
    // § 1206, with \openup\jot and amsmath's \everycr
    v.nodes.push(penalty(k.ints.predisplaypenalty), spec("abovedisplayskip", sz.abovedisplayskip))
    const jot = 196608
    v.nodes.push(glue(-(k.dimens.lineskiplimit + jot)), glue(k.dimens.normallineskiplimit))
    const bs = addGlue(sz.baselineskip, dimen(jot)), ls = addGlue(k.glue.lineskip, dimen(jot))
    for (const rb of rowBoxes) {
      rb.display = true; rb.shift = line.indent
      v.prevDepth = appendToVlist(v.nodes, rb, v.prevDepth, bs, ls, k.dimens.lineskiplimit + jot)
      v.nodes.push(penalty(10000), glue(0)) // \interdisplaylinepenalty is \@M in amsmath; \\ adds \vskip\z@
    }
    v.nodes.push(penalty(k.ints.postdisplaypenalty), spec("belowdisplayskip", sz.belowdisplayskip))
  }

  /** a paragraph from a ready horizontal list (the display's opening line) */
  function typesetList(list: Node[], opts: Parameters<typeof paragraphInput>[4], withParskip: boolean) {
    const { params } = paragraphInput("", k, "normalsize", doc, { ...opts, amsmath })
    const lb = lineBreak(list, params)
    decisions.push(lb.trace)
    if (withParskip) v.paragraph(lb.vlist, outerParskip); else v.lines(lb.vlist)
    return { just: lb.lines[lb.lines.length - 1] ?? null, params, lines: lb.lines.length }
  }

  /**
   * A float (latex.ltx \@float, \@xfloat, \@caption, the class's \@makecaption, \end@float) from
   * vertical mode: its box is built now, and a marker stands for \penalty-\@Miv\vbox{}\penalty-\@Miii,
   * where the output routine will place it.
   */
  function floatBlock(b: Extract<Block, { kind: "float" }>) {
    if (b.inPar) throw new Unsupported("a float inside a paragraph")
    // the placement specifier as \@xfloat counts it: h, t (2), b (4), p (8), and 16 unless !
    let fps = 16
    for (const c of b.fps ?? "tbp") { // \fps@figure and \fps@table are tbp
      if (c === "h") { if (fps % 2 === 0) fps++ }
      else if (c === "t" || c === "b" || c === "p") { const bit = c === "t" ? 2 : c === "b" ? 4 : 8; if (Math.floor(fps / bit) % 2 === 0) fps += bit }
      else if (c === "!") { if (fps > 15) fps -= 16 }
      else throw new Unsupported(`float option ${c}`)
    }
    const content: Node[] = []
    let pd: number | null = IGNORE_DEPTH, number = 0
    const hsize = k.dimens.columnwidth
    const items = b.body.trim().match(/\\centering\b|\\caption\s*\{(?:[^{}]|\{[^{}]*\})*\}|\\label\s*\{[^}]*\}|\S+/g) ?? []
    for (const it of items) {
      if (it === "\\centering") continue
      let m = it.match(/^\\caption\s*\{([^]*)\}$/)
      if (m) {
        const text = m[1].replace(/\s+/g, " ").trim()
        if (/[\\{}$%&#^_~]/.test(text)) throw new Unsupported(`caption "${text}"`)
        number = ++counters[b.env]
        const ext = b.env === "figure" ? "lof" : "lot"
        content.push({ kind: "whatsit", text: `\\write1{\\@writefile{${ext}}{\\protect \\contentsline {${b.env}}{\\protect \\numberline {${number}}{\\ignorespaces ${text}}}{\\thepage }{}\\protected@file@percent }}` })
        content.push(glue(k.dimens.abovecaptionskip))
        // \sbox\@tempboxa{\fnum@figure: text}: \figurename\nobreakspace\thefigure
        const l: Node[] = [], state = { spaceFactor: 1000 }
        appendText(l, b.env === "figure" ? "Figure" : "Table", romanFont, state, false)
        l.push(penalty(10000), glue(romanFont.params[SPACE], romanFont.params[SPACE_STRETCH], 0, romanFont.params[SPACE_SHRINK], 0)) // \nobreak\ 
        appendText(l, `${number}: ${text}`, romanFont, state, false)
        const cap = hpack(l)
        if (cap.width > hsize) throw new Unsupported("a caption longer than a line")
        pd = appendToVlist(content, hpack([glue(0, 65536, FIL), cap, glue(0, 65536, FIL)], { exactly: hsize }), pd, k.sizes.normalsize.baselineskip, k.glue.lineskip, k.dimens.lineskiplimit)
        content.push(glue(k.dimens.belowcaptionskip))
        continue
      }
      // \label writes \newlabel{…}{{n}{\thepage }{}{<link target>}{}}, and the link target is empty in
      // TeX Live 2023 but figure.n in 2025: left out until the oracle's TeX Live is pinned
      if (/^\\label\b/.test(it)) throw new Unsupported("\\label in a float (its \\newlabel differs between TeX Live releases)")
      throw new Unsupported(`${it} in a ${b.env}`)
    }
    content.push(glue(0)) // \@endfloatbox: \par\vskip\z@skip
    const box = vpack([vpack(content)]) // \color@vbox\normalcolor\vbox{…}
    v.nodes.push({ kind: "whatsit", text: "", float: { box, fps, nobreak: v.nobreak } as FloatMarker })
    v.nobreak = false // placed here, the float ends \if@nobreak (\@addtocurcol's \nobreak\@nobreakfalse)
  }

  /**
   * \@specialoutput and \@addtocurcol for the float at the marker, given the page so far
   * (\@holdpg): "here" placement — \vskip\intextsep \box \penalty\interlinepenalty \vskip\intextsep
   * \vskip-\parskip — when it is allowed and the column has room.
   */
  function placeFloat(page: Node[], marker: { float?: unknown }, column: { colnum: number; textFloatsHeight: number }, boxes: Record<number, Node[]>): Node[] {
    const f = marker.float as FloatMarker
    const held = vpack(page.slice())
    let pageht = held.height + held.depth // \advance\@pageht\@pagedp
    const foot = boxes[k.ints.footins]
    if (foot?.length) { const fb = vpack(foot.slice()); pageht += fb.height + k.glue.footinsskip.width + fb.depth } // \ifvoid\footins\else
    const colht = k.dimens.textheight, colroom = colht
    const fpstype = f.fps % 32
    if (fpstype === 8 || fpstype === 24) throw new Unsupported("a float allowed only on a float page")
    let textmin = fpstype < 16 ? 0 : xnOverD(colht, 13107, 65536) // \textfraction (.2) \@colht
    textmin += column.textFloatsHeight
    let req = Math.max(pageht, textmin) + f.box.height
    if (!(colroom > req)) throw new Unsupported("a float that does not fit on its page")
    if (fpstype < 16 && column.colnum === 0) column.colnum = 1
    if (column.colnum <= 0) throw new Unsupported("more floats than \\totalnumber on a page")
    if (f.box.depth !== 0) throw new Unsupported("a float of the wrong width")
    if (fpstype % 2 === 0) throw new Unsupported("a float placed at the top or bottom")
    const intextsep = k.glue.intextsep
    req += intextsep.width
    if (!(colroom > req)) throw new Unsupported("a float placed at the top or bottom")
    column.colnum--
    column.textFloatsHeight += f.box.height + 2 * intextsep.width
    const out = page.slice()
    // \@reinserts: \insert\footins{\unvbox\footins}, with the output routine's \splittopskip (10pt),
    // \splitmaxdepth (\maxdimen) and \floatingpenalty (0)
    if (foot?.length) {
      const fb = vpack(foot.slice())
      out.push({ kind: "ins", n: k.ints.footins, height: fb.height + fb.depth, depth: 0o7777777777, splitTopSkip: glue(655360), floatCost: 0, list: foot.slice() })
      delete boxes[k.ints.footins]
    }
    if (f.nobreak) out.push(penalty(10000))
    else { // \addpenalty\interlinepenalty after \unvbox\@holdpg, where \prevdepth is -1000pt
      const last = out[out.length - 1]
      const p = k.ints.interlinepenalty
      if (last?.kind === "glue" && last.width !== 0) out.push(plain(negate(last)), penalty(p), plain(last))
      else out.push(penalty(p))
    }
    out.push(plain(intextsep), f.box, penalty(k.ints.interlinepenalty), plain(intextsep), plain(negate(outerParskip)))
    return out
  }

  /** article's \maketitle and \@maketitle: \newpage, \null, \vskip 2em, a center environment with
   *  {\LARGE title\par}, \vskip 1.5em, {\large \lineskip .5em author tabulars\par}, \vskip 1em,
   *  {\large date}, then \vskip 1.5em */
  function maketitle() {
    if (cls !== "article") throw new Unsupported(`\\maketitle in ${cls}`)
    if (!title.title) throw new Unsupported("\\maketitle without \\title")
    const em = (n: string, f: Font) => new Scanner(n, { em: f.params[QUAD], ex: f.params[X_HEIGHT] }).scanDimen().value
    v.par()
    v.nobreak = false
    for (let i = 0; i < 2; i++) v.nodes.push(glue(0, 65536, FIL), penalty(-10000)) // \newpage in \maketitle and \@maketitle
    const nul = hpack([])
    titleBoxes.push(nul) // \thispagestyle{plain}: the page this lands on gets the plain style
    v.box(nul, k.sizes.normalsize.baselineskip) // \null
    v.vskip(dimen(em("2em", romanFont)))
    // \begin{center}: \trivlist (\parsep\parskip, \labelwidth\z@, \leftmargin\z@), \centering, \item\relax
    const topsepadd = addGlue(k.glue.topsep, k.glue.partopsep)
    v.addpenalty(-LOW_PENALTY); v.addvspace(addGlue(topsepadd, outerParskip)); v.addvspace(negate(outerParskip))
    const labelsep = k.dimens.labelsep
    const labels = hpack([glue(0), glue(0), glue(-labelsep), hpack([], { exactly: 0 }), glue(labelsep)])
    const flush = (p: string) => paramGlue(p, glue(0, 65536, FIL))
    const centering = { leftSkip: flush("leftskip"), rightSkip: flush("rightskip"), parFillSkip: paramGlue("parfillskip", glue(0)), finalHyphenDemerits: 0 }
    const check = (t: string, what: string) => { if (/[\\{}%&#^_~$]/.test(t)) throw new Unsupported(`${what} "${t}"`) }
    check(title.title, "\\title")
    typeset(title.title, { ...centering, start: [labels, penalty(0)], clubPenalty: k.ints.clubpenalty }, outerParskip, "LARGE")
    v.vskip(dimen(em("1.5em", romanFont)))
    // {\large \lineskip .5em \begin{tabular}[t]{c}\@author\end{tabular}\par}, \and between tabulars
    const large = loadFont(dataFont(k.sizes.large.font.name), k.sizes.large.font.at)
    const authors = (title.author ?? "").split(/\\and\b/).map((a) => a.split(/\\\\/).map((r) => r.trim()))
    authors.flat().forEach((r) => check(r, "\\author"))
    const start: Node[] = [hpack([])] // \parindent is zero in center
    authors.forEach((rows, i) => {
      if (i) start.push(glue(em("1em", large), xnOverD(65536, 11141, 65536), FIL)) // \hskip 1em \@plus.17fil
      start.push(tabular(rows.map((r) => [r]), ["c"], "large"))
    })
    const authorPar = paragraphInput("", k, "large", doc, { ...centering, start, clubPenalty: k.ints.clubpenalty, amsmath })
    const ab = lineBreak(authorPar.list, authorPar.params)
    decisions.push(ab.trace)
    v.paragraph(ab.vlist, outerParskip, k.sizes.large.baselineskip, dimen(em(".5em", large)))
    v.vskip(dimen(em("1em", romanFont)))
    // {\large \@date}: its paragraph ends at \end{center}, with the normal size's \baselineskip
    const date = (title.date ?? "\\today").replace(/\\today\b\s*/g, today())
    check(date, "\\date")
    if (date) {
      const dp = paragraphInput("", k, "large", doc, { ...centering, start: [hpack([])], clubPenalty: k.ints.clubpenalty, amsmath })
      appendText(dp.list, date, large, { spaceFactor: 1000 })
      const db = lineBreak(dp.list, dp.params)
      decisions.push(db.trace)
      v.paragraph(db.vlist, outerParskip)
    }
    // \endtrivlist; then \par \vskip 1.5em
    v.endtrivlist(outerParskip, outerParskip, topsepadd)
    v.vskip(dimen(em("1.5em", romanFont)))
    doc.footnote = 0 // \setcounter{footnote}{0}
  }

  /** \begin{tabular}[t]{cols}: \leavevmode\hbox{$\vtop{\ialign{\@arstrut ...\cr ...}}$} (latex.ltx \@tabular, \@array) */
  function tabular(rows: string[][], cols: ("l" | "c" | "r")[], size: SizeCommand): BoxNode {
    const f = k.sizes[size].font, font = loadFont(dataFont(f.name), f.at)
    const strut = k.sizes[size].strut
    const sep = k.dimens.tabcolsep
    const cells = rows.map((row) => row.map((text, j) => {
      const l: Node[] = j === 0 ? [{ kind: "rule", width: 0, height: strut.height, depth: strut.depth }] : [] // \@arstrut
      l.push(glue(sep)) // \@acol: \hskip\tabcolsep
      const hfil = () => glue(0, 65536, FIL)
      const body: Node[] = []
      appendText(body, text.replace(/\s+/g, " ").trim(), font, { spaceFactor: 1000 }, false) // \ignorespaces # \unskip
      const c = cols[j]
      if (c === "c") l.push(hfil(), glue(1), ...body, hfil())
      else if (c === "l") l.push(glue(1), ...body, hfil())
      else l.push(hfil(), glue(1), ...body)
      l.push(glue(sep))
      return l
    }))
    const tabskip = Array.from({ length: cols.length + 1 }, () => paramGlue("tabskip", glue(0)))
    const rowBoxes = halign(cells, tabskip, { additional: 0 })
    // the \vtop's list: rows with interline glue (\baselineskip and \lineskip are zero in \@array)
    const list: Node[] = []
    let pd: number | null = null
    for (const r of rowBoxes) pd = appendToVlist(list, r, pd, dimen(0), dimen(0), k.dimens.lineskiplimit)
    const vtop = vpack(list)
    const first = list[0]
    const h = first && (first.kind === "hlist" || first.kind === "vlist" || first.kind === "rule") ? first.height ?? 0 : 0
    vtop.depth = vtop.depth - h + vtop.height; vtop.height = h // § 1087
    return hpack([{ kind: "math", on: true, width: 0 }, vtop, { kind: "math", on: false, width: 0 }])
  }

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
  let built: ReturnType<typeof endDocument>
  try { built = endDocument(v.nodes, k, placeFloat) } catch (e) {
    if ((e as Error).message.startsWith("page builder: a float")) throw new Unsupported((e as Error).message.slice(14))
    throw e
  }
  const { pages, pageTrace } = built
  const columns = makeColumns(pages, k)
  const special = new Set(pages.flatMap((pg, i) => (pg.nodes.some((n) => titleBoxes.includes(n as BoxNode)) ? [i] : [])))
  const shipped = columns.map((c, i) => outputPage(c.outputbox, i + 1, k, special.has(i) ? "plain" : pagestyle))
  return {
    trace: shipOut(shipped),
    decisions,
    pages: pageTrace,
    columns: columns.map((c) => c.column.map(emitBoxes)),
    notes: [`${cls} [${option}], \\pagestyle{${pagestyle}}; ${blocks.length} block(s), ${pages.length} page(s)`],
  }
}

/** \today on the oracle's fixed date (SOURCE_DATE_EPOCH): "January 1, 2025" */
function today(): string {
  const d = new Date(ORACLE_EPOCH * 1000)
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}
