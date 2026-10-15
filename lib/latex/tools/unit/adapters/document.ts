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
import { parseGlue, Scanner } from "../../../layout/dimen"
import { appendText } from "../../../layout/hmode"
import { lineBreak } from "../../../layout/linebreak"
import { emptyBox, FIL, glue, kern, paramGlue, penalty, type BoxNode, type CharNode, type GlueNode, type Node } from "../../../layout/nodes"
import { displayLine, finishDisplay, preDisplaySize } from "../../../layout/display"
import { DISPLAY as DISPLAY_STYLE, groupField, mlistToHlist, OPEN as OPEN_NOAD, ORD as ORD_NOAD, TEXT as TEXT_STYLE, type MItem } from "../../../mathlayout/mlist"
import { parseMath } from "../../../mathlayout/parse"
import { hpack, vpack } from "../../../layout/pack"
import { halign } from "../../../layout/align"
import { xnOverD } from "../../../layout/arith"
import { ORACLE_EPOCH } from "../../tex"
import type { ParagraphTrace } from "../../../trace/decisions"
import type { Adapter, AdapterResult } from "./index"
import { endDocument, makeColumns, NobreakFloat, OutputUnsupported, type Float, type OutputHook } from "./output"
import { appendToVlist, mathData, mathEnv, paragraphInput, spec, type DocState } from "./paragraph"

/** A construct the adapter does not lay out yet: the fixture is reported pending, not failed. */
type TabularLine = { cells: string[] } | { rule: true }

/** The class with \usepackage[T1]{fontenc}: every size's roman and bold are the EC fonts (math is unchanged). */
function withT1(k: ClassOptionData): ClassOptionData {
  const sizes = Object.fromEntries(Object.entries(k.sizes).map(([n, s]) => [n, { ...s, font: s.t1.font, bold: s.t1.bold }])) as ClassOptionData["sizes"]
  return { ...k, sizes, ints: { ...k.ints, T1: 1 } }
}

/** How many groups are open at the end of `src` (braces not escaped). */
const depthOf = (src: string) => { let d = 0; for (const m of src.matchAll(/\\.|[{}]/g)) d += m[0] === "{" ? 1 : m[0] === "}" ? -1 : 0; return d }

export class Unsupported extends Error {}

const LOW_PENALTY = 51 // \@lowpenalty: \@beginparpenalty, \@itempenalty and \@endparpenalty are its negation
const TEXTBULLET = 136 // \textbullet in TS1
const IGNORE_DEPTH = null // \prevdepth = -1000pt

/** What a float marker carries to the output routine: the float's box, its placement bits, and \if@nobreak. */

type Block =
  | { kind: "par"; text: string; noindent: boolean }
  | ListBlock
  | { kind: "heading"; level: 0 | 1 | 2 | 3; star: boolean; title: string }
  | { kind: "maketitle" }
  | { kind: "float"; env: "figure" | "table"; fps: string | null; body: string; inPar: boolean }

/** An itemize or enumerate list: each item's optional label, then its text and the lists nested in it. */
interface ListBlock { kind: "list"; env: "itemize" | "enumerate"; items: Item[]; inPar: boolean; blank: boolean }
interface Item { label: string | null; parts: ({ kind: "text"; text: string } | ListBlock)[] }

/** Where the \end matching a list's \begin is (lists nest), and where it ends. */
function listEnd(body: string, from: number, env: string): { at: number; next: number } {
  const re = /\\(begin|end)\{(itemize|enumerate)\}/g
  re.lastIndex = from
  let depth = 1
  for (let m: RegExpExecArray | null; (m = re.exec(body)); ) {
    depth += m[1] === "begin" ? 1 : -1
    if (depth === 0) { if (m[2] !== env) throw new Unsupported(`\\end{${m[2]}} for \\begin{${env}}`); return { at: m.index, next: re.lastIndex } }
  }
  throw new Unsupported(`\\begin{${env}} without its \\end`)
}

/** A list's body: its items at this level, each split at the lists nested in it. */
function parseList(env: "itemize" | "enumerate", inner: string, inPar: boolean, blank: boolean): ListBlock {
  // \item at this level only
  const cuts: number[] = []
  const re = /\\item\b|\\begin\{(itemize|enumerate)\}/g
  for (let m: RegExpExecArray | null; (m = re.exec(inner)); ) {
    if (m[1]) { re.lastIndex = listEnd(inner, re.lastIndex, m[1]).next; continue }
    cuts.push(m.index)
  }
  if (inner.slice(0, cuts[0] ?? inner.length).trim()) throw new Unsupported("text before the first \\item")
  const items = cuts.map((c, i) => {
    let x = inner.slice(c + 5, cuts[i + 1] ?? inner.length)
    const opt = x.match(/^\s*\[([^\]]*)\]/) // \item[label]
    if (opt && /[\\{}$%&#^_~[]/.test(opt[1])) throw new Unsupported(`\\item[${opt[1]}]`)
    if (opt) x = x.slice(opt[0].length)
    const parts: Item["parts"] = []
    const nested = /\\begin\{(itemize|enumerate)\}/g
    let at = 0
    for (let m: RegExpExecArray | null; (m = nested.exec(x)); ) {
      const before = x.slice(at, m.index)
      if (/\n[ \t]*\n/.test(before.trim())) throw new Unsupported("an item with several paragraphs")
      if (before.trim()) parts.push({ kind: "text", text: before.replace(/\s+/g, " ").trim() })
      else if (!parts.length) throw new Unsupported("a list right after \\item")
      else throw new Unsupported("two lists in a row in an item")
      const end = listEnd(x, nested.lastIndex, m[1])
      parts.push(parseList(m[1] as ListBlock["env"], x.slice(nested.lastIndex, end.at), true, false))
      at = nested.lastIndex = end.next
    }
    const rest = x.slice(at)
    if (/\n[ \t]*\n/.test(rest.trim())) throw new Unsupported("an item with several paragraphs")
    if (rest.trim() || !parts.length) parts.push({ kind: "text", text: rest.replace(/\s+/g, " ").trim() })
    return { label: opt ? opt[1] : null, parts }
  })
  return { kind: "list", env, items, inPar, blank }
}

const HEADINGS = { chapter: 0, section: 1, subsection: 2, subsubsection: 3 } as const

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
  const re = /\\(chapter|section|subsection|subsubsection)\b(\*?)\s*|\\begin\{(itemize|enumerate)\}()|\\(maketitle)\b\s*|\\begin\{(figure|table)\}\s*(?:\[([^\]]*)\])?([^]*?)\\end\{\6\}/g
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
    const end = listEnd(body, re.lastIndex, m[3])
    out.push(parseList(m[3] as ListBlock["env"], body.slice(re.lastIndex, end.at), inPar, /\n[ \t]*\n\s*$/.test(before)))
    re.lastIndex = end.next
    at = end.next
    endpe = true
  }
  text(body.slice(at))
  // text, inline math and footnotes only; other commands are not laid out yet
  const check = (t: string) => { const m = t.replace(/\$[^$]*\$/g, "").match(/\\(?!(?:footnote|noindent|textbf|textmd|textit|textsl|textsc|textup|textrm|textsf|texttt|textnormal|emph)\b)[a-zA-Z]+(?!\s*=)/); if (m) throw new Unsupported(`${m[0]} in "${t.slice(0, 40)}"`) }
  for (const b of out) {
    if (b.kind === "par") displaySegments(b.text).filter((_, i) => i % 2 === 0).forEach((t) => check(t as string))
    else if (b.kind === "list") {
      const walk = (l: ListBlock): void => l.items.forEach((it) => it.parts.forEach((p) => {
        if (p.kind === "list") return walk(p)
        if (DISPLAY.test(p.text)) throw new Unsupported("a display in a list item")
        check(p.text)
      }))
      walk(b)
    }
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
function labelBox(label: Node[], k: ClassOptionData, lw = k.dimens.labelwidth): BoxNode {
  const llap = hpack([hss(), ...label], { exactly: 0 }) // \makelabel = \hss\llap{#1}
  const tempbox = hpack([hss(), llap])
  const ls = k.dimens.labelsep
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

/**
 * Whether a float right after a heading goes here decides \if@nobreak for the text after it,
 * which is laid out before the output routine places the float: the document is laid out again,
 * with the float not placed here, until every such guess holds.
 */
export const document: Adapter = (src) => {
  const notHere = new Set<number>()
  for (;;) {
    try { return layout(src, notHere) } catch (e) {
      if (!(e instanceof NobreakFloat) || notHere.has(e.index)) throw e
      notHere.add(e.index)
    }
  }
}

function layout(src: string, notHere: Set<number>): AdapterResult {
  const { cls, option } = documentClass(src)
  if (!["article", "report", "book"].includes(cls)) throw new Unsupported(`class ${cls}`)
  let k = classData(cls, option)
  // \begin{document} and \end{document} outside comments
  const at = (re: RegExp) => { for (const m of src.matchAll(re)) if (!/(^|[^\\])%/.test(src.slice(src.lastIndexOf("\n", m.index!) + 1, m.index))) return m.index!; return -1 }
  const begin = at(/\\begin\{document\}/g), end = at(/\\end\{document\}/g)
  const pre = src.slice(0, begin).replace(/(^|[^\\])%.*$/gm, "$1")
  let pagestyle = cls === "book" ? "headings" : "plain"
  let amsmath = false
  const title: { title?: string; author?: string; date?: string } = {}
  let t1 = false
  for (const line of pre.split("\n").map((l) => l.trim()).filter(Boolean)) {
    if (/^\\documentclass\b/.test(line)) continue
    if (line === "\\usepackage[utf8]{inputenc}") continue // UTF-8 is LaTeX's default input encoding
    if (line === "\\usepackage[T1]{fontenc}") { t1 = true; continue }
    const pk = line.match(/^\\usepackage\{([a-z,\s]+)\}$/)
    if (pk) {
      // packages whose loading alone changes nothing on the page (amssymb and amsfonts only declare
      // fonts, amsthm only environments, graphicx only \includegraphics)
      const names = pk[1].split(",").map((n) => n.trim())
      const unknown = names.filter((n) => !["amsmath", "amssymb", "amsfonts", "amsthm", "graphicx"].includes(n))
      if (unknown.length) throw new Unsupported(`preamble: ${line}`)
      if (names.includes("amsmath")) amsmath = true
      continue
    }
    const t = line.match(/^\\(title|author|date)\{(.*)\}$/)
    if (t) { title[t[1] as keyof typeof title] = t[2].trim(); continue }
    const m = line.match(/^\\pagestyle\{(plain|empty|headings)\}$/)
    if (m) { pagestyle = m[1]; continue }
    throw new Unsupported(`preamble: ${line}`)
  }
  if (t1) k = withT1(k)
  const body = src.slice(begin + 16, end)
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
  const titleBoxes: Node[] = [] // nodes whose page gets \thispagestyle{plain}
  let floats = 0 // floats so far
  const counters = Object.assign([0, 0, 0, 0], { equation: 0, figure: 0, table: 0 }) // chapter (never stepped yet), section, subsection, subsubsection
  // \@currentHref after \refstepcounter: \theH<counter>, which report and book number within the chapter
  const href = (counter: string, n: number) => (cls === "article" ? `${counter}.${n}` : `${counter}.${counters[0]}.${n}`)
  // \theequation, \thefigure, \thetable: in report and book, prefixed by the chapter once there is one
  const the = (n: number) => (cls !== "article" && counters[0] > 0 ? `${counters[0]}.${n}` : String(n))
  blocks.forEach((b, bi) => {
    if (b.kind === "heading") { if (b.level === 0) chapter(b); else heading(b); return }
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
    list(b, { depth: 1, itemDepth: 0, enumDepth: 0, totalLeft: 0, lineWidth: k.dimens.textwidth, parskip: outerParskip })
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
      // \label{key}: \protected@write\@auxout{}{\string\newlabel{key}{{\@currentlabel}{\thepage }{}{\@currentHref}{}}}.
      // amsmath keeps it for after the tag (\label@in@display); LaTeX writes it where it stands
      const labels = [...next.src.matchAll(/\\label\s*\{([^{}]*)\}/g)]
      if (labels.length && next.kind !== "equation") throw new Unsupported(`\\label in ${next.kind}`)
      if (labels.length > 1) throw new Unsupported("several \\label in an equation")
      const label = labels[0]
      if (label && !/^[A-Za-z0-9:._-]+$/.test(label[1])) throw new Unsupported(`\\label{${label[1]}}`)
      const parse = (f: string) => { try { return parseMath(f.replace(/\s+/g, " "), mathData()) } catch (e) { throw new Unsupported((e as Error).message) } }
      if (next.kind === "equation") counters.equation++ // \refstepcounter, or amsmath's \incr@eqnum
      const newlabel: Node | null = label ? { kind: "whatsit", text: `\\write1{\\newlabel{${label[1]}}{{${the(counters.equation)}}{\\thepage }{}{${href("equation", counters.equation)}}{}}}` } : null
      let mlist: MItem[]
      if (!label) mlist = parse(next.src)
      else {
        const before = next.src.slice(0, label.index), after = next.src.slice(label.index! + label[0].length)
        if (amsmath) mlist = parse(before + after)
        else if (depthOf(before) !== 0) throw new Unsupported("\\label inside a group in an equation")
        else mlist = [...parse(before), newlabel!, ...parse(after)]
      }
      const env = mathEnv(k, "normalsize", amsmath)
      if (next.kind === "equation*" && !amsmath) throw new Unsupported("equation* without amsmath")
      let eqno: BoxNode | null = null
      if (next.kind === "equation" && amsmath) { // \mathopen{} after \incr@eqnum, and \veqno \tagform@\theequation: \hbox{\normalfont (1\/)}, then the \label
        mlist.unshift({ noad: OPEN_NOAD, nucleus: groupField([]), sup: null, sub: null })
        const l: Node[] = []
        appendText(l, `(${the(counters.equation)}`, romanFont, { spaceFactor: 1000 }, false)
        l.push(kern(romanFont.chars.get((l[l.length - 1] as CharNode).char)!.italic, true)) // \@@italiccorr
        appendText(l, ")", romanFont, { spaceFactor: 1000 }, false)
        eqno = hpack(newlabel ? [hpack(l), newlabel] : [hpack(l)]); eqno.display = true
      } else if (next.kind === "equation") { // \eqno \hbox{\@eqnnum}: {\normalfont (\theequation)}
        const l: Node[] = []
        appendText(l, `(${the(counters.equation)})`, romanFont, { spaceFactor: 1000 }, false)
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
      appendText(l, `(${the(counters.equation)}`, romanFont, { spaceFactor: 1000 }, false)
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
  /**
   * \list at a depth (\@listi … \@listvi): \@trivlist (\@topsep from \topsep, \partopsep when it
   * starts in vertical mode, and the enclosing \parskip), \parskip\parsep, \parshape 1
   * \@totalleftmargin \linewidth; each \item (\@item) with its label in \labelwidth; a list nested
   * in an item starts in its paragraph (\unskip\par) and the item's text after it is not indented
   * (\@doendpe); \endtrivlist and \@endparenv.
   */
  function list(b: ListBlock, ctx: { depth: number; itemDepth: number; enumDepth: number; totalLeft: number; lineWidth: number; parskip: GlueSpec }) {
    if (ctx.depth > 6) throw new Unsupported("lists nested more than six deep") // LaTeX: Too deeply nested
    const L = (p: string) => k.glue[`list${ctx.depth}${p}`]
    const leftmargin = k.dimens[`list${ctx.depth}leftmargin`], labelwidth = k.dimens[`list${ctx.depth}labelwidth`]
    const topsepadd = b.inPar ? L("topsep") : addGlue(L("topsep"), L("partopsep")) // \partopsep only from vertical mode
    const topsep = addGlue(topsepadd, ctx.parskip) // \advance\@topsep\parskip, the enclosing \parskip
    const parsep = L("parsep")
    const totalLeft = ctx.totalLeft + leftmargin, lineWidth = ctx.lineWidth - leftmargin
    const parShape: [number, number][] = [[totalLeft, lineWidth]]
    const itemDepth = ctx.itemDepth + (b.env === "itemize" ? 1 : 0), enumDepth = ctx.enumDepth + (b.env === "enumerate" ? 1 : 0)
    const level = b.env === "itemize" ? itemDepth : enumDepth
    if (level > 4) throw new Unsupported(`${b.env} nested more than four deep`)
    const font = loadFont(dataFont(k.sizes.normalsize.font.name), k.sizes.normalsize.font.at)
    const bold = loadFont(dataFont(k.sizes.normalsize.bold.name), k.sizes.normalsize.bold.at)
    const companion = loadFont(dataFont(k.sizes.normalsize.companion.name), k.sizes.normalsize.companion.at)
    let counter = 0 // \c@enum…: an item with its own label does not step it
    const alph = (n: number) => String.fromCharCode(96 + n)
    const roman = (n: number) => { // \@roman (TeX's \romannumeral)
      let out = ""
      for (const [v, r] of [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]] as const) while (n >= v) { out += r; n -= v }
      return out
    }
    b.items.forEach(({ label: given, parts }, i) => {
      // \@item: before the first item \@beginparpenalty, \@topsep and -\parskip (right after a heading,
      // \@nbitem: \@outerparskip-\parskip); then \@itempenalty and \itemsep
      let club: number | undefined
      if (i === 0 && v.nobreak) { v.addvspace(addGlue(ctx.parskip, negate(parsep))); v.nobreak = false; club = 10000 }
      else if (i === 0) { v.addpenalty(-LOW_PENALTY); v.addvspace(topsep); v.addvspace(negate(parsep)) }
      else { v.addpenalty(-LOW_PENALTY); v.addvspace(L("itemsep")) }
      const label: Node[] = []
      if (given !== null) appendText(label, given.replace(/\s+/g, " "), font, { spaceFactor: 1000 }, false) // \makelabel{label}
      else if (b.env === "itemize") { // \labelitemi … iv: \textbullet, \bfseries\textendash, \textasteriskcentered, \textperiodcentered
        if (level === 2) label.push(charBox(bold, k.ints.T1 ? 21 : 123)) // \textendash in OT1 and T1
        else label.push(charBox(companion, [TEXTBULLET, 0, 42, 183][level - 1]))
      } else { // \labelenumi … iv: 1. (a) i. A.
        const n = ++counter
        if ((level === 2 || level === 4) && n > 26) throw new Unsupported("\\alph counter past z") // LaTeX: Counter too large
        appendText(label, level === 1 ? `${n}.` : level === 2 ? `(${alph(n)})` : level === 3 ? `${roman(n)}.` : `${alph(n).toUpperCase()}.`, font, { spaceFactor: 1000 }, false)
      }
      parts.forEach((p, j) => {
        if (p.kind === "list") return list(p, { depth: ctx.depth + 1, itemDepth, enumDepth, totalLeft, lineWidth, parskip: parsep })
        // \everypar: the indent box gives way to \box\@labels \penalty\z@; after a nested list, \@doendpe drops it
        if (j === 0) typeset(p.text, { start: [labelBox(label, k, labelwidth), penalty(0)], parShape, ...(club ? { clubPenalty: club } : {}) }, parsep)
        // the nested list's group is over: its footnotes see the item's \clubpenalty (\@M right after a
        // heading); \@doendpe's \par sets \@clubpenalty for the lines
        else if (p.text) typeset("\\noindent " + p.text, { parShape, noteClubPenalty: club ?? k.ints.clubpenalty }, parsep)
      })
    })
    // \endtrivlist: the last item's \par, then \@endparenv
    v.endtrivlist(parsep, ctx.parskip, topsepadd)
  }

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
    const items = b.body.trim().match(/\\centering\b|\\caption\s*\{(?:[^{}]|\{[^{}]*\})*\}|\\(?:label|vspace)\s*\{[^}]*\}|\\begin\{tabular\}\{[^}]*\}[^]*?\\end\{tabular\}|\S+/g) ?? []
    let centered = false
    for (const it of items) {
      if (it === "\\centering") { centered = true; continue }
      // a tabular starts a paragraph (\leavevmode): the \parindent box (zero after \@parboxrestore), then
      // the tabular's box, alone on its line; \centering sets \leftskip and \rightskip to \@flushglue
      const tab = it.match(/^\\begin\{tabular\}\{([^}]*)\}([^]*)\\end\{tabular\}$/)
      if (tab) {
        const { cols, lines } = tabularOf(tab[1], tab[2])
        const box = tabular(lines, cols, "normalsize", "c")
        const flush = (p: string) => paramGlue(p, glue(0, 65536, FIL))
        const shape = centered ? { leftSkip: flush("leftskip"), rightSkip: flush("rightskip"), parFillSkip: paramGlue("parfillskip", glue(0)), finalHyphenDemerits: 0 } : {}
        // \@parboxrestore's \sloppy: \tolerance 9999, \emergencystretch 3em
        const par = paragraphInput("", k, "normalsize", doc, { ...shape, start: [hpack([]), box], amsmath, tolerance: 9999, emergencyStretch: 3 * romanFont.params[QUAD] })
        const lb = lineBreak(par.list, par.params)
        decisions.push(lb.trace)
        // new_graf in internal vertical mode adds \parskip (zero here) only to a list that is not empty, and
        // so does LaTeX's restart of the paragraph
        if (content.length) content.push(paramGlue("parskip", glue(0)), paramGlue("parskip", glue(0)))
        for (const n of lb.vlist) {
          if (n.kind === "hlist") pd = appendToVlist(content, n, pd, k.sizes.normalsize.baselineskip, k.glue.lineskip, k.dimens.lineskiplimit)
          else content.push(n)
        }
        continue
      }
      // \vspace{skip} in vertical mode: \vskip skip \vskip\z@skip
      let m = it.match(/^\\vspace\s*\{([^}]*)\}$/)
      if (m) {
        let g: GlueSpec
        try { g = parseGlue(m[1], { em: romanFont.params[QUAD], ex: romanFont.params[X_HEIGHT] }) } catch { throw new Unsupported(`\\vspace{${m[1]}}`) }
        content.push(plain(g), glue(0))
        continue
      }
      m = it.match(/^\\caption\s*\{([^]*)\}$/)
      if (m) {
        const text = m[1].replace(/\s+/g, " ").trim()
        if (/[\\{}$%&#^_~]/.test(text)) throw new Unsupported(`caption "${text}"`)
        number = ++counters[b.env]
        const ext = b.env === "figure" ? "lof" : "lot"
        content.push({ kind: "whatsit", text: `\\write1{\\@writefile{${ext}}{\\protect \\contentsline {${b.env}}{\\protect \\numberline {${the(number)}}{\\ignorespaces ${text}}}{\\thepage }{}\\protected@file@percent }}` })
        content.push(glue(k.dimens.abovecaptionskip))
        // \sbox\@tempboxa{\fnum@figure: text}: \figurename\nobreakspace\thefigure
        const l: Node[] = [], state = { spaceFactor: 1000 }
        appendText(l, b.env === "figure" ? "Figure" : "Table", romanFont, state, false)
        l.push(penalty(10000), glue(romanFont.params[SPACE], romanFont.params[SPACE_STRETCH], 0, romanFont.params[SPACE_SHRINK], 0)) // \nobreak\ 
        appendText(l, `${the(number)}: ${text}`, romanFont, state, false)
        const cap = hpack(l)
        if (cap.width > hsize) throw new Unsupported("a caption longer than a line")
        pd = appendToVlist(content, hpack([glue(0, 65536, FIL), cap, glue(0, 65536, FIL)], { exactly: hsize }), pd, k.sizes.normalsize.baselineskip, k.glue.lineskip, k.dimens.lineskiplimit)
        content.push(glue(k.dimens.belowcaptionskip))
        continue
      }
      // \label after the caption: \protected@write\@auxout{}{\string\newlabel{key}{{n}{\thepage }{}{figure.n}{}}}
      m = it.match(/^\\label\s*\{([A-Za-z0-9:._-]+)\}$/)
      if (m && number) { content.push({ kind: "whatsit", text: `\\write1{\\newlabel{${m[1]}}{{${the(number)}}{\\thepage }{}{${href(b.env, number)}}{}}}` }); continue }
      if (/^\\label\b/.test(it)) throw new Unsupported(m ? "\\label before the caption" : `${it} in a ${b.env}`)
      throw new Unsupported(`${it} in a ${b.env}`)
    }
    content.push(glue(0)) // \@endfloatbox: \par\vskip\z@skip
    const box = vpack([vpack(content)]) // \color@vbox\normalcolor\vbox{…}
    if (box.height > k.dimens.textheight) box.height = k.dimens.textheight // \@largefloatcheck
    const index = floats++
    v.nodes.push({ kind: "whatsit", text: "", float: { box, count: fps + 32 * (b.env === "figure" ? 1 : 2), nobreak: v.nobreak, index, here: !notHere.has(index) } satisfies Float }) // \ftype@figure 1, \ftype@table 2
    // placed here, the float ends \if@nobreak (\@addtocurcol's \nobreak\@nobreakfalse\everypar{});
    // elsewhere \nobreak alone, and the text after it is still right after the heading
    if (!notHere.has(index)) v.nobreak = false
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
    // \newpage, \global\@topnum\z@ (no float at the top of this page), and \@maketitle's \newpage
    v.nodes.push(glue(0, 65536, FIL), penalty(-10000), { kind: "whatsit", text: "", hook: "notop" satisfies OutputHook }, glue(0, 65536, FIL), penalty(-10000))
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
      start.push(tabular(rows.map((r) => ({ cells: [r] })), ["c"], "large"))
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
  /**
   * \begin{tabular}[pos]{cols} (latex.ltx \@tabular, \@array): \hbox{$\vtop or \vcenter{\halign…}$}, each
   * row starting with \@arstrut, each cell \hskip\tabcolsep, the entry (\hfil around it as the column
   * says), \hskip\tabcolsep; \hline is \noalign{\hrule height\arrayrulewidth}, and a second one right
   * after it adds \vskip\doublerulesep \vskip-\arrayrulewidth. A cell is text or \textbf{text}.
   */
  function tabular(lines: TabularLine[], cols: ("l" | "c" | "r")[], size: SizeCommand, pos: "t" | "c" = "t"): BoxNode {
    const f = k.sizes[size].font, font = loadFont(dataFont(f.name), f.at)
    const bf = loadFont(dataFont(k.sizes[size].bold.name), k.sizes[size].bold.at)
    const strut = k.sizes[size].strut
    const sep = k.dimens.tabcolsep
    const rows = lines.filter((l): l is { cells: string[] } => "cells" in l)
    const cells = rows.map((row) => row.cells.map((text, j) => {
      const l: Node[] = j === 0 ? [{ kind: "rule", width: 0, height: strut.height, depth: strut.depth }] : [] // \@arstrut
      l.push(glue(sep)) // \@acol: \hskip\tabcolsep
      const hfil = () => glue(0, 65536, FIL)
      const body: Node[] = []
      const t = text.replace(/\s+/g, " ").trim()
      const bold = t.match(/^\\textbf\s*\{([^{}\\]*)\}$/)
      if (/[\\{}$%&#^_~]/.test(bold ? bold[1] : t)) throw new Unsupported(`tabular cell "${t}"`)
      appendText(body, (bold ? bold[1] : t).trim(), bold ? bf : font, { spaceFactor: 1000 }, false) // \ignorespaces # \unskip
      // \textbf's \check@icr: an italic correction after it (the outer font is upright, and what follows is no , or .)
      const lastChar = body[body.length - 1]
      if (bold && lastChar?.kind === "char") body.push(kern(bf.chars.get(lastChar.char)!.italic, true))
      const c = cols[j]
      if (c === "c") l.push(hfil(), glue(1), ...body, hfil())
      else if (c === "l") l.push(glue(1), ...body, hfil())
      else l.push(hfil(), glue(1), ...body)
      l.push(glue(sep))
      return l
    }))
    const tabskip = Array.from({ length: cols.length + 1 }, () => paramGlue("tabskip", glue(0)))
    const rowBoxes = halign(cells, tabskip, { additional: 0 })
    // the alignment's list: rows with interline glue (\baselineskip and \lineskip are zero in \@array), rules
    const list: Node[] = []
    let pd: number | null = null, r = 0
    lines.forEach((l, i) => {
      if ("cells" in l) { pd = appendToVlist(list, rowBoxes[r++], pd, dimen(0), dimen(0), k.dimens.lineskiplimit); return }
      if (i > 0 && "rule" in lines[i - 1]) list.push(glue(k.dimens.doublerulesep), glue(-k.dimens.arrayrulewidth))
      list.push({ kind: "rule", width: rowBoxes[0]?.width ?? 0, height: k.dimens.arrayrulewidth, depth: 0 }) // fin_align sets a running width (§ 805)
      pd = null // a rule leaves \prevdepth at -1000pt
    })
    const box = vpack(list)
    const first = list[0]
    if (pos === "t") { // \vtop (§ 1087)
      const h = first && (first.kind === "hlist" || first.kind === "vlist" || first.kind === "rule") ? first.height ?? 0 : 0
      box.depth = box.depth - h + box.height; box.height = h
    } else { // \vcenter: make_vcenter (§ 736), about the axis of the text size
      const delta = box.height + box.depth
      box.height = mathEnv(k, size, amsmath).fonts[0][2]!.params[22] + (delta % 2 ? Math.trunc((delta + 1) / 2) : delta / 2)
      box.depth = delta - box.height
    }
    return hpack([{ kind: "math", on: true, width: 0 }, box, { kind: "math", on: false, width: 0 }])
  }

  /** \begin{tabular}{cols}…\end{tabular}: its lines, or Unsupported */
  function tabularOf(spec: string, body: string): { cols: ("l" | "c" | "r")[]; lines: TabularLine[] } {
    if (!/^[lcr]+$/.test(spec)) throw new Unsupported(`tabular columns {${spec}}`)
    const cols = [...spec] as ("l" | "c" | "r")[]
    const lines: TabularLine[] = []
    let rest = body.trim()
    for (;;) {
      while (/^\\hline\b/.test(rest)) { lines.push({ rule: true }); rest = rest.replace(/^\\hline\s*/, "") }
      if (!rest) break
      const end = rest.indexOf("\\\\")
      const row = end < 0 ? rest : rest.slice(0, end)
      rest = end < 0 ? "" : rest.slice(end + 2).trim()
      if (/\\hline/.test(row)) throw new Unsupported("\\hline inside a row")
      const cells = row.split("&")
      if (cells.length > cols.length) throw new Unsupported("more cells than columns")
      lines.push({ cells })
    }
    return { cols, lines }
  }

  /**
   * report's \chapter: \clearpage, \thispagestyle{plain}, \global\@topnum\z@, \@afterindentfalse; then
   * \@chapter (\refstepcounter, which resets the sections, equations, figures, tables and footnotes; the
   * toc line; \addvspace{10pt} in the lof and lot) or \@schapter, and \@makechapterhead: \vspace*{50pt},
   * {\parindent\z@ \raggedright \normalfont \huge\bfseries \@chapapp\space\thechapter \par\nobreak \vskip20pt
   * \interlinepenalty\@M \Huge\bfseries title\par\nobreak \vskip40pt}, then \@afterheading
   */
  function chapter(b: Extract<Block, { kind: "heading" }>) {
    if (cls !== "report") throw new Unsupported(`\\chapter in ${cls}`)
    v.par()
    // \clearpage: \newpage (which ends \if@nobreak), \write\m@ne{}, \vbox{}, \penalty-\@Mi
    if (v.nobreak) { v.nobreak = false; v.afterheadingEverypar = false }
    v.nodes.push(glue(0, 65536, FIL), penalty(-10000), { kind: "whatsit", text: "\\write-{}" })
    v.box(emptyBox("vlist"), k.sizes.normalsize.baselineskip)
    v.nodes.push(penalty(-10001), { kind: "whatsit", text: "", hook: "notop" satisfies OutputHook })
    if (!b.star) {
      counters[0]++
      for (let l = 1; l < counters.length; l++) counters[l] = 0
      counters.equation = 0; counters.figure = 0; counters.table = 0; doc.footnote = 0
      v.nodes.push({ kind: "whatsit", text: `\\write1{\\@writefile{toc}{\\protect \\contentsline {chapter}{\\protect \\numberline {${counters[0]}}${b.title}}{\\thepage }{}\\protected@file@percent }}` })
      for (const ext of ["lof", "lot"]) v.nodes.push({ kind: "whatsit", text: `\\write1{\\@writefile{${ext}}{\\protect \\addvspace {10\\p@ }}}` })
    }
    // \vspace*{50pt}: \hrule height0pt \nobreak \vskip50pt \vskip\z@skip, keeping \prevdepth
    const pd = v.prevDepth
    const top: Node = { kind: "rule", width: null, height: 0, depth: 0 }
    titleBoxes.push(top)
    v.nodes.push(top, penalty(10000), glue(50 * 65536), glue(0))
    v.prevDepth = pd
    // the head's first paragraph runs an \@afterheading \everypar still pending, which sets \@clubpenalty
    // (in the head's group)
    const club = v.afterheadingEverypar ? k.ints.clubpenalty : v.club
    const ragged = () => ({ start: [hpack([])], rightSkip: paramGlue("rightskip", glue(0, 65536, FIL)), finalHyphenDemerits: 0, clubPenalty: club }) // \parindent\z@ \raggedright
    if (!b.star) {
      typeset(`Chapter ${counters[0]}`, { ...ragged(), font: k.sizes.huge.bold }, outerParskip, "huge")
      v.nodes.push(penalty(10000))
      v.vskip(dimen(20 * 65536))
    }
    typeset(b.title, { ...ragged(), font: k.sizes.Huge.bold, interLinePenalty: 10000 }, outerParskip, "Huge")
    v.nodes.push(penalty(10000))
    v.vskip(dimen(40 * 65536))
    v.nobreak = true
    v.afterheadingEverypar = true
    v.afterindent = false
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
  try { built = endDocument(v.nodes, k, outerParskip) } catch (e) {
    if ((e as Error).message.startsWith("page builder: a float")) throw new Unsupported((e as Error).message.slice(14))
    if (e instanceof OutputUnsupported) throw new Unsupported(e.message)
    throw e
  }
  const { pages, pageTrace } = built
  const columns = makeColumns(pages, k)
  const special = new Set(pages.flatMap((pg, i) => (pg.kind === "text" && pg.page.nodes.some((n) => titleBoxes.includes(n)) ? [i] : [])))
  const shipped = columns.map((c, i) => outputPage(c.outputbox, i + 1, k, special.has(i) ? "plain" : pagestyle))
  return {
    trace: shipOut(shipped),
    decisions,
    pages: pageTrace,
    columns: columns.map((c) => c.column && c.column.map(emitBoxes)),
    notes: [`${cls} [${option}], \\pagestyle{${pagestyle}}; ${blocks.length} block(s), ${pages.length} page(s)`],
  }
}

/** \today on the oracle's fixed date (SOURCE_DATE_EPOCH): "January 1, 2025" */
function today(): string {
  const d = new Date(ORACLE_EPOCH * 1000)
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}
