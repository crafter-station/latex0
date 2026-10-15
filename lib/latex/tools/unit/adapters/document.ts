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
import { emptyBox, FIL, FILL, glue, kern, paramGlue, penalty, type BoxNode, type CharNode, type GlueNode, type Node } from "../../../layout/nodes"
import { displayLine, finishDisplay, preDisplaySize } from "../../../layout/display"
import { DISPLAY as DISPLAY_STYLE, groupField, mathGlue, mlistToHlist, OPEN as OPEN_NOAD, ORD as ORD_NOAD, TEXT as TEXT_STYLE, type MItem } from "../../../mathlayout/mlist"
import { parseMath } from "../../../mathlayout/parse"
import { hpack, vpack } from "../../../layout/pack"
import { halign } from "../../../layout/align"
import { xnOverD } from "../../../layout/arith"
import { ORACLE_EPOCH } from "../../tex"
import type { ParagraphTrace } from "../../../trace/decisions"
import type { Adapter, AdapterResult } from "./index"
import { geometry, GeometryUnsupported } from "./geometry"
import { expandDocument } from "../../../expand/document"
import { isKnownCommand } from "../../../parser"
import { endDocument, makeColumns, NobreakFloat, OutputUnsupported, type Float, type OutputHook } from "./output"
import { anchor, Bookmarks, documentStart, labelName, pageAnchor, sectionAnchorBox, tocLink, type Bookmark } from "./hyperref"
import { squeeze, appendToVlist, labelWrite, mathData, mathEnv, paragraphInput, selectFont, spec, type DocState, type FontAttrs, type Refs } from "./paragraph"

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
  | { kind: "par"; text: string; noindent: boolean; /** \unskips before its \par: \@trivlist's one when a list follows in it */ unskip?: number }
  | ListBlock
  | { kind: "heading"; level: 0 | 1 | 2 | 3 | 4 | 5; star: boolean; title: string; /** the title's source, when it differs (\tableofcontents) */ source?: string; /** nodes after the title text (its \@mkboth marks) */ end?: Node[] }
  | { kind: "maketitle" }
  | { kind: "float"; env: "figure" | "table"; fps: string | null; body: string; inPar: boolean }
  | { kind: "toc" }
  | { kind: "matter"; which: "front" | "main" | "back" }

/** A line the run before wrote to the .toc file: \contentsline{name}{\numberline{number}title}{page}{} */
interface TocEntry { level: 0 | 1 | 2 | 3 | 4 | 5; number: string | null; title: string; /** \thepage */ page: string; /** with hyperref, the heading's anchor */ anchor: string }

/** The list-like environments: \list ones and \trivlist ones (center, flushleft, flushright), and abstract. */
const ENVS = ["itemize", "enumerate", "description", "quote", "quotation", "verse", "center", "flushleft", "flushright", "abstract"] as const
type EnvName = typeof ENVS[number]
const ENV_ALT = ENVS.join("|")
/** An environment: its items (one, from \item\relax, for all but itemize, enumerate and description). */
interface ListBlock { kind: "list"; env: EnvName; items: Item[]; inPar: boolean; blank: boolean }
/** An item's optional label and its parts: paragraphs (how each starts) and nested environments. */
interface Item { label: string | null; parts: Part[] }
type Part = { kind: "text"; text: string; start: "label" | "doendpe" | "par" | "cr"; /** nodes after the label, before the text */ nodes?: Node[]; /** \unskips before the \par that ends it */ unskip?: number } | ListBlock

/** What an environment inherits: \@listdepth, the itemize and enumerate depths, \@totalleftmargin and
 *  \linewidth, \parskip, \topsep and \partopsep in force, the size, \@rightskip and \finalhyphendemerits */
interface EnvCtx { depth: number; itemDepth: number; enumDepth: number; totalLeft: number; lineWidth: number; parskip: GlueSpec; parsep: GlueSpec; itemsep: GlueSpec; topsep: GlueSpec; partopsep: GlueSpec; labelwidth: number; size: SizeCommand; atRightskip: GlueNode | null; finalHyph: number | undefined; /** the enclosing enumerate counters (\p@enumii …) */ enums: number[] }

/** Where the \end matching an environment's \begin is (environments nest), and where it ends. */
function listEnd(body: string, from: number, env: string): { at: number; next: number } {
  const re = new RegExp(`\\\\(begin|end)\\{(${ENV_ALT})\\}`, "g")
  re.lastIndex = from
  let depth = 1
  for (let m: RegExpExecArray | null; (m = re.exec(body)); ) {
    depth += m[1] === "begin" ? 1 : -1
    if (depth === 0) { if (m[2] !== env) throw new Unsupported(`\\end{${m[2]}} for \\begin{${env}}`); return { at: m.index, next: re.lastIndex } }
  }
  throw new Unsupported(`\\begin{${env}} without its \\end`)
}

/** An environment's body: its items at this level, each split into paragraphs and nested environments. */
function parseList(env: EnvName, inner: string, inPar: boolean, blank: boolean): ListBlock {
  const listy = env === "itemize" || env === "enumerate" || env === "description"
  const crs = env === "center" || env === "flushleft" || env === "flushright" || env === "verse" // \\ is \@centercr
  // \item at this level only
  const cuts: number[] = []
  const re = new RegExp(`\\\\item\\b|\\\\begin\\{(${ENV_ALT})\\}`, "g")
  for (let m: RegExpExecArray | null; (m = re.exec(inner)); ) {
    if (m[1]) { re.lastIndex = listEnd(inner, re.lastIndex, m[1]).next; continue }
    cuts.push(m.index)
  }
  if (!listy && cuts.length) throw new Unsupported(`\\item in ${env}`)
  if (listy && inner.slice(0, cuts[0] ?? inner.length).trim()) throw new Unsupported("text before the first \\item")
  const bodies = listy ? cuts.map((c, i) => inner.slice(c + 5, cuts[i + 1] ?? inner.length)) : [inner]
  const items = bodies.map((x, bi) => {
    const opt = listy ? x.match(/^\s*\[([^\]]*)\]/) : null // \item[label]
    if (opt && /[\\{}$%&#^_~[]/.test(opt[1])) throw new Unsupported(`\\item[${opt[1]}]`)
    if (opt) x = x.slice(opt[0].length)
    const parts: Part[] = []
    // text: paragraphs at blank lines and, where \\ is \@centercr, at \\
    // what ends the last paragraph of a stretch of text: \@item's \unskip\unskip\par, \endtrivlist's and
    // \@trivlist's \unskip\par; a blank line or \@centercr's \par after its \unskip
    const text = (t: string, afterEnv: boolean, endUnskip: number) => {
      const paras = t.split(/\n[ \t]*\n/)
      paras.forEach((para0, pi) => {
        const para = pi < paras.length - 1 ? para0 + " " : para0 // the line end before a blank line is a space
        const lines = para.split(/\\\\/)
        if (lines.length > 1 && !crs) throw new Unsupported(`\\\\ in ${env}`)
        lines.forEach((line, li) => {
          if (/^\s*[*[]/.test(line) && li > 0) throw new Unsupported("\\\\* or \\\\[…]")
          const tx = squeeze(line)
          if (!tx && li > 0 && parts.length) { parts.push({ kind: "text", text: "", start: "cr" }); return } // a \\ ending the text
          if (!tx) return
          const start = !parts.length ? "label" : li > 0 ? "cr" : pi === 0 && afterEnv ? "doendpe" : "par"
          const unskip = li < lines.length - 1 ? 1 : pi < paras.length - 1 ? 0 : endUnskip
          parts.push({ kind: "text", text: tx, start, unskip })
        })
      })
    }
    const nested = new RegExp(`\\\\begin\\{(${ENV_ALT})\\}`, "g")
    let at = 0
    for (let m: RegExpExecArray | null; (m = nested.exec(x)); ) {
      const before = x.slice(at, m.index)
      text(before, at > 0, 1)
      if (!parts.length) throw new Unsupported(`an environment right at the start of ${listy ? "an \\item" : env}`)
      // in a paragraph unless a blank line or a \\ (\@centercr's \par) ended it
      const inP = /\S[ \t]*\n?[ \t]*$/.test(before) && !/\n[ \t]*\n[ \t]*$/.test(before) && before.trim() !== "" && !/\\\\\s*$/.test(before)
      const end = listEnd(x, nested.lastIndex, m[1])
      parts.push(parseList(m[1] as EnvName, x.slice(nested.lastIndex, end.at), inP, /\n[ \t]*\n\s*$/.test(before)))
      at = nested.lastIndex = end.next
    }
    text(x.slice(at), at > 0, listy && bi < bodies.length - 1 ? 2 : 1)
    if (!parts.length) parts.push({ kind: "text", text: "", start: "label" })
    return { label: opt ? opt[1] : null, parts }
  })
  return { kind: "list", env, items, inPar, blank }
}

const HEADINGS = { chapter: 0, section: 1, subsection: 2, subsubsection: 3, paragraph: 4, subparagraph: 5 } as const

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

/** Whether the text before an environment leaves TeX in a paragraph: text right before it, not
 *  only \label commands, which do not start one */
function inParagraph(before: string): boolean {
  const last = before.split(/\n[ \t]*\n/).pop()!
  return /\S[ \t]*\n?[ \t]*$/.test(before) && !/\n[ \t]*\n[ \t]*$/.test(before) && before.trim() !== "" && !/^(?:\s*\\label\{[^{}]*\})+\s*$/.test(last)
}

/** The body as paragraphs, lists and headings. A paragraph that runs into a list ends there (\@trivlist's \par). */
function blocksOf(body: string): Block[] {
  body = body.replace(/(^|[^\\])%.*$/gm, "$1") // comments
  const out: Block[] = []
  const re = /\\(chapter|section|subsection|subsubsection|paragraph|subparagraph)\b(\*?)\s*|\\begin\{(itemize|enumerate|description|quote|quotation|verse|center|flushleft|flushright|abstract)\}()|\\(maketitle)\b\s*|\\begin\{(figure|table)\}\s*(?:\[([^\]]*)\])?([^]*?)\\end\{\6\}|\\(tableofcontents)\b\s*|\\(front|main|back)matter\b\s*/g
  let at = 0, endpe = false
  const text = (s: string) => {
    // blank lines separate paragraphs; text right after a list (no blank line) is not indented (\@doendpe)
    const parts = s.split(/\n[ \t]*\n/)
    parts.forEach((p, i) => {
      const t = squeeze(i < parts.length - 1 ? p + " " : p) // the line end before a blank line is a space
      if (t) out.push({ kind: "par", text: t, noindent: i === 0 && endpe })
    })
  }
  for (let m: RegExpExecArray | null; (m = re.exec(body)); ) {
    const before = body.slice(at, m.index)
    text(before)
    if (m[5]) { out.push({ kind: "maketitle" }); at = re.lastIndex; endpe = false; continue }
    if (m[9]) { out.push({ kind: "toc" }); at = re.lastIndex; endpe = false; continue }
    if (m[10]) { out.push({ kind: "matter", which: m[10] as "front" | "main" | "back" }); at = re.lastIndex; endpe = false; continue }
    if (m[6]) {
      const inPar = inParagraph(before)
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
    const inPar = inParagraph(before)
    const end = listEnd(body, re.lastIndex, m[3])
    const prev = out[out.length - 1]
    if (inPar && prev?.kind === "par") prev.unskip = 1
    out.push(parseList(m[3] as EnvName, body.slice(re.lastIndex, end.at), inPar, /\n[ \t]*\n\s*$/.test(before)))
    re.lastIndex = end.next
    at = end.next
    endpe = true
  }
  text(body.slice(at))
  // text, inline math and footnotes only; other commands are not laid out yet
  const check = (t: string) => { const m = t.replace(/\\[#%&$]/g, "").replace(/\$[^$]*\$/g, "").match(/\\(?!(?:footnote|noindent|textbf|textmd|textit|textsl|textsc|textup|textrm|textsf|texttt|textnormal|emph|setcounter|addtocounter|stepcounter|refstepcounter|arabic|roman|Roman|alph|Alph|value|label|ref|pageref|the[a-zA-Z]+)\b)[a-zA-Z]+(?!\s*=)/); if (m) throw new Unsupported(`${m[0]} in "${t.slice(0, 40)}"`)
    if (/\\(?:label|ref|pageref)\b(?!\{[A-Za-z0-9:._-]+\})/.test(t)) throw new Unsupported(`a \\label or \\ref key in "${t.slice(0, 40)}"`)
    if (/\\footnote\{(?:[^{}]|\{[^{}]*\})*\\label\b/.test(t)) throw new Unsupported("\\label in a footnote")
  }
  for (const b of out) {
    if (b.kind === "par") displaySegments(b.text).filter((_, i) => i % 2 === 0).forEach((t) => check(t as string))
    else if (b.kind === "list") {
      const walk = (l: ListBlock): void => l.items.forEach((it) => it.parts.forEach((p) => {
        if (p.kind === "list") return walk(p)
        if (DISPLAY.test(p.text)) throw new Unsupported(`a display in ${l.env}`)
        if (/^\s*\\label\b/.test(p.text)) throw new Unsupported(`\\label in vertical mode in ${l.env}`)
        check(p.text)
      }))
      walk(b)
    }
    else if (b.kind === "maketitle" || b.kind === "float" || b.kind === "toc" || b.kind === "matter") continue
    else if (/[\\{}%&#^_~]/.test(b.title.replace(/\$[^$\\]*\$/g, "").replace(/\\[#%&]|\\the[a-zA-Z]+\b|\\(?:arabic|roman|Roman|alph|Alph)\s*\{[a-zA-Z]+\}/g, ""))) throw new Unsupported(`heading "${b.title}"`)
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

  /** \lastskip: the last node's glue, or 0pt (a hook stands for an assignment, not a node) */
  get lastSkip(): GlueSpec {
    const n = this.nodes.findLast((x) => !(x.kind === "whatsit" && x.hook))
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
function outputPage(column: BoxNode, page: number, k: ClassOptionData, pagestyle: string, hyper = false, mark: Node[] = [], thepage = String(page)): BoxNode {
  const font = loadFont(dataFont(k.sizes.normalsize.font.name), k.sizes.normalsize.font.at)
  const number = () => { const l: Node[] = []; appendText(l, thepage, font, { spaceFactor: 1000 }, false); return l }
  const hfil = () => glue(0, 65536, FIL)
  const even = k.ints.twoside && page % 2 === 0
  // \ps@plain: \@oddfoot{\hfil\thepage\hfil}; \ps@headings: \@oddhead{{\slshape\rightmark}\hfil\thepage},
  // \@evenhead{\thepage\hfil\slshape\leftmark}
  const headText: Node[] = pagestyle !== "headings" ? [] : even ? [...number(), hfil(), ...mark] : [...mark, hfil(), ...number()]
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
  const shipped = vpack([glue(k.dimens.topmargin), box])
  // hyperref's \AtBeginShipout: the page anchor before the page, with \lineskip between
  if (hyper) return vpack([pageAnchor(thepage, k.dimens.topmargin, page % 2 ? k.dimens.oddsidemargin : k.dimens.evensidemargin), paramGlue("lineskip", glue(0)), shipped])
  return shipped
}

/**
 * Whether a float right after a heading goes here decides \if@nobreak for the text after it,
 * which is laid out before the output routine places the float: the document is laid out again,
 * with the float not placed here, until every such guess holds.
 */
export const document: Adapter = (source) => {
  // the document's own macros expanded first, as the renderer does (expand:doc checks this keeps TeX's output)
  const expanded = expandDocument(source, { known: isKnownCommand })
  if (expanded.errors.length) throw new Unsupported(`macro expansion: ${expanded.errors[0]}`)
  const src = expanded.text
  const run = (aux: Aux | null) => {
    const notHere = new Set<number>()
    for (;;) {
      try { return layout(src, notHere, aux) } catch (e) {
        if (!(e instanceof NobreakFloat) || notHere.has(e.index)) throw e
        notHere.add(e.index)
      }
    }
  }
  // the oracle runs LaTeX twice: the second run reads the .toc and .aux files the first one wrote
  const first = run(null)
  return first.written ? run(first.written).result : first.result
}

/** A running head's mark: what \marks holds, and what \leftmark or \rightmark typesets (\MakeUppercase'd) */
interface MarkValue { print: string; parts: ({ text: string } | { ctrl: true } | { quad: true })[]; upper: boolean }

/** What a run writes for the next one: the .toc file's lines and the .aux file's \newlabel values. */
interface Aux { toc: TocEntry[]; labels: Map<string, { label: string; page: string; href: string }>; /** hyperref's .out file */ bookmarks: Bookmark[] }

/**
 * The document laid out once, as one LaTeX run: `prev` is what the run before wrote (null: none
 * yet). `written` is what this run writes, when the document reads it (a \tableofcontents, a \ref).
 */
function layout(src: string, notHere: Set<number>, prev: Aux | null): { result: AdapterResult; written: Aux | null } {
  const toc = prev ? prev.toc : null
  const { cls, option, extras, unknown } = documentClass(src)
  if (unknown.length) throw new Unsupported(`class option ${unknown.join(",")}`)
  if (!["article", "report", "book"].includes(cls)) throw new Unsupported(`class ${cls}`)
  let k = classData(cls, option, extras)
  // \begin{document} and \end{document} outside comments
  const at = (re: RegExp) => { for (const m of src.matchAll(re)) if (!/(^|[^\\])%/.test(src.slice(src.lastIndexOf("\n", m.index!) + 1, m.index))) return m.index!; return -1 }
  const begin = at(/\\begin\{document\}/g), end = at(/\\end\{document\}/g)
  const pre = src.slice(0, begin).replace(/(^|[^\\])%.*$/gm, "$1")
  let pagestyle = cls === "book" ? "headings" : "plain"
  let amsmath = false
  let mainmatter = true // book's \if@mainmatter
  // \ps@headings defines \chaptermark and \sectionmark (book runs it when loaded); a later \pagestyle
  // keeps them, and only \@mkboth goes back to \@gobbletwo
  let markDefs = cls === "book"
  let hyper = false // hyperref, with the dvips driver
  const title: { title?: string; author?: string; date?: string } = {}
  let t1 = false
  const geometryOptions: string[] = []
  const newCounters: [string, string | null][] = []
  for (const line of pre.split("\n").map((l) => l.trim()).filter(Boolean)) {
    if (/^\\documentclass\b/.test(line)) continue
    if (line === "\\usepackage[utf8]{inputenc}") continue // UTF-8 is LaTeX's default input encoding
    if (line === "{}") continue // a definition the expander took out
    const nc = line.match(/^\\newcounter\{([a-zA-Z]+)\}(?:\[([a-zA-Z]+)\])?$/)
    if (nc) { newCounters.push([nc[1], nc[2] ?? null]); continue }
    if (line === "\\usepackage[T1]{fontenc}") { t1 = true; continue }
    const geo = line.match(/^\\usepackage(?:\[([^\]]*)\])?\{geometry\}$/) ?? line.match(/^\\geometry\{(.*)\}$/)
    if (geo) { geometryOptions.push(geo[1] ?? ""); continue }
    const pk = line.match(/^\\usepackage\{([a-z,\s]+)\}$/)
    if (pk) {
      // packages whose loading alone changes nothing on the page (amssymb and amsfonts only declare
      // fonts, amsthm only environments, graphicx only \includegraphics)
      const names = pk[1].split(",").map((n) => n.trim())
      const unknown = names.filter((n) => !["amsmath", "amssymb", "amsfonts", "amsthm", "graphicx", "hyperref"].includes(n))
      if (names.includes("hyperref")) hyper = true
      if (unknown.length) throw new Unsupported(`preamble: ${line}`)
      if (names.includes("amsmath")) amsmath = true
      continue
    }
    const t = line.match(/^\\(title|author|date)\{(.*)\}$/)
    if (t) { title[t[1] as keyof typeof title] = t[2].trim(); continue }
    const m = line.match(/^\\pagestyle\{(plain|empty|headings)\}$/)
    if (m) { pagestyle = m[1]; if (pagestyle === "headings") markDefs = true; continue }
    throw new Unsupported(`preamble: ${line}`)
  }
  if (t1) k = withT1(k)
  if (geometryOptions.length) {
    const f = loadFont(dataFont(k.sizes.normalsize.font.name), k.sizes.normalsize.font.at)
    try { k = geometry(k, geometryOptions, { em: f.params[QUAD], ex: f.params[X_HEIGHT] }) } catch (e) { if (e instanceof GeometryUnsupported) throw new Unsupported(e.message); throw e }
  }
  const body = src.slice(begin + 16, end)
  const blocks = blocksOf(body)

  const v = new VerticalList(k)
  const refs: Refs = { label: "", href: hyper ? "Doc-Start" : "", name: "", prev: prev ? prev.labels : null, writes: [], hyper }
  /** \Hy@linkcounter (anchors of unnumbered headings) and \Hy@writebookmark's state */
  let linkcounter = 0
  const bookmarks = new Bookmarks()
  /** the main vertical list's last node, as \lastskip and \lastnodetype see it (a hook is no node) */
  const lastNode = () => v.nodes.findLast((x) => !(x.kind === "whatsit" && x.hook))
  if (hyper) {
    // features whose hyperref anchors and links are not modeled yet
    const m = body.replace(/(^|[^\\])%.*$/gm, "$1").match(/\\footnote\b|\\begin\{(?:enumerate|figure|table|equation|align)\}|\\refstepcounter\b/)
    if (m) throw new Unsupported(`${m[0]} with hyperref`)
    // \AtBeginDocument: the outlines, /DOCVIEW, the Catalog; the Doc-Start anchor
    v.nodes.push(...documentStart(prev ? prev.bookmarks : []))
    v.nodes.push(...anchor("Doc-Start", k.sizes.normalsize.baselineskip.width, "v", lastNode()))
  }
  const doc: DocState = { footnote: 0, refs }
  const decisions: ParagraphTrace[] = []
  const outerParskip = k.glue.parskip
  const typeset = (text: string, opts: Parameters<typeof paragraphInput>[4], parskip: GlueSpec, size: SizeCommand = "normalsize") => {
    const { list, params, notes } = paragraphInput(counted(text, true), k, size, doc, { ...opts, amsmath })
    const { vlist, trace } = lineBreak(list, params)
    decisions.push(...notes, trace)
    v.paragraph(vlist, parskip, k.sizes[size].baselineskip)
  }
  const roman = k.sizes.normalsize.font
  // skips in ex are read in the body font (\@startsection evaluates them before the heading's font)
  const romanFont = loadFont(dataFont(roman.name), roman.at)
  const bodyUnits = { em: romanFont.params[QUAD], ex: romanFont.params[X_HEIGHT] }
  /** the \addcontentsline{toc} writes: \thepage is the page each one is shipped out on */
  const tocWrites: { node: Node; entry: Omit<TocEntry, "page"> }[] = []
  const tocWrite = (level: TocEntry["level"], number: string | null, title: string, anchor = ""): Node => {
    const name = ["chapter", "section", "subsection", "subsubsection", "paragraph", "subparagraph"][level]
    const node: Node = { kind: "whatsit", text: `\\write1{\\@writefile{toc}{\\protect \\contentsline {${name}}{${number !== null ? `\\protect \\numberline {${number}}` : ""}${title}}{\\thepage }{${anchor}}\\protected@file@percent }}` }
    tocWrites.push({ node, entry: { level, number, title, anchor } })
    return node
  }
  /**
   * Running heads (\pagestyle{headings}): \markboth and \markright insert \marks of the classes 2e-left (1),
   * 2e-right (2) and, for a value not empty, 2e-right-nonempty (3), each followed by \nobreak in vertical
   * mode while \if@nobreak holds; \__mark_value:nn numbers them
   */
  let markCount = 0
  const markNode = (cls: 1 | 2 | 3, value: MarkValue): Node => ({ kind: "whatsit", text: `\\marks${cls}{\\__mark_value:nn {${++markCount}}{${value.print}}}`, mark: { cls, value } })
  const insertMarks = (marks: [1 | 2 | 3, MarkValue][], nobreak: boolean): Node[] => marks.flatMap(([c, value]) => (nobreak ? [markNode(c, value), penalty(10000)] : [markNode(c, value)]))
  const markboth = (left: MarkValue, right: MarkValue): [1 | 2 | 3, MarkValue][] => [[1, left], [2, right], ...(right.print ? [[3, right] as [3, MarkValue]] : [])]
  const markright = (right: MarkValue): [1 | 2 | 3, MarkValue][] => [[2, right], ...(right.print ? [[3, right] as [3, MarkValue]] : [])]
  const EMPTY_MARK: MarkValue = { print: "", parts: [], upper: false }
  /** a mark's value: the \protected@xdef'd text (\MakeUppercase prints as itself), and what it typesets */
  const markValue = (parts: MarkValue["parts"], upper: boolean): MarkValue => {
    for (const p of parts) if ("text" in p && /[\\{}$^_~%&#]/.test(p.text)) throw new Unsupported(`a running head for "${p.text}"`)
    const text = parts.map((p) => ("text" in p ? p.text : "quad" in p ? "\\hskip 1em\\relax " : "\\ ")).join("")
    return { print: upper ? `\\MakeUppercase    []{${text}}` : text, parts, upper }
  }
  const headings = markDefs, mkboth = pagestyle === "headings"
  /** \sectionmark and \subsectionmark (article: \thesection\quad title; report two-sided: \thesection. \ title) */
  const sectionMarks = (level: number, number: string, title: string, nobreak: boolean): Node[] => {
    if (!headings) return []
    const twoside = !!k.ints.twoside
    if (cls === "article" && level === 1) {
      const v1 = markValue([{ text: number }, { quad: true }, { text: title }], true)
      return insertMarks(twoside ? markboth(v1, EMPTY_MARK) : markright(v1), nobreak)
    }
    if (cls === "article" && level === 2 && twoside) return insertMarks(markright(markValue([{ text: number }, { quad: true }, { text: title }], false)), nobreak)
    if (cls !== "article" && level === 1 && twoside) return insertMarks(markright(markValue([{ text: `${number}. ` }, { ctrl: true }, { text: title }], true)), nobreak)
    return []
  }
  /** hyperref's \addcontentsline: the bookmark line (to the depth of \c@tocdepth), then the toc line; each
   *  \protected@write adds \nobreak while \if@nobreak holds */
  const contentsWrites = (level: TocEntry["level"], number: string | null, title: string, anchorName: string, nobreak: boolean): Node[] => {
    const out: Node[] = []
    if (hyper && level <= (cls === "article" ? 3 : 2)) {
      const bm = bookmarks.add(level, anchorName, title)
      if (!bm) throw new Unsupported(`a bookmark for "${title}"`)
      out.push(bm)
      if (nobreak) out.push(penalty(10000))
    }
    out.push(tocWrite(level, number, title, hyper ? anchorName : ""))
    if (nobreak) out.push(penalty(10000))
    return out
  }
  let floats = 0 // floats so far
  const counters = Object.assign([0, 0, 0, 0], { equation: 0, figure: 0, table: 0 }) // chapter (never stepped yet), section, subsection, subsubsection
  // \@currentHref after \refstepcounter: \theH<counter>, which report and book number within the chapter
  const href = (counter: string, n: number) => (cls === "article" ? `${counter}.${n}` : `${counter}.${counters[0]}.${n}`)
  // \theequation, \thefigure, \thetable: in report and book, prefixed by the chapter once there is one
  const the = (n: number) => (cls !== "article" && counters[0] > 0 ? `${counters[0]}.${n}` : String(n))
  // counters the document makes (\newcounter), with the counter that resets each, and LaTeX's own
  const userCounters = new Map<string, { value: number; within: string | null }>()
  for (const [name, within] of newCounters) userCounters.set(name, { value: 0, within })
  const counterValue = (name: string): number => {
    const u = userCounters.get(name)
    if (u) return u.value
    const i = ["chapter", "section", "subsection", "subsubsection"].indexOf(name)
    if (i >= 0) return counters[i]
    if (name === "equation" || name === "figure" || name === "table") return counters[name]
    if (name === "footnote") return doc.footnote
    throw new Unsupported(`counter ${name}`)
  }
  const setCounter = (name: string, value: number) => {
    const u = userCounters.get(name)
    if (u) { u.value = value; return }
    throw new Unsupported(`\\setcounter of LaTeX's ${name}`)
  }
  const representation = (style: string, n: number) => {
    if (style === "arabic") return String(n)
    if (style === "roman" || style === "Roman") {
      let out = "", x = n
      for (const [v2, r] of [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]] as const) while (x >= v2) { out += r; x -= v2 }
      return style === "Roman" ? out.toUpperCase() : out
    }
    if (n === 0) return "" // \ifcase 0: nothing
    if (n < 0 || n > 26) throw new Unsupported(`\\${style} of ${n}`) // LaTeX: Counter too large
    return String.fromCharCode((style === "alph" ? 96 : 64) + n)
  }
  /** \the<counter>: \arabic (\newcounter{c}[parent] only resets it; \counterwithin would change \the) */
  const theCounter = (name: string): string => {
    const u = userCounters.get(name)
    if (!u) throw new Unsupported(`\\the${name}`)
    return String(u.value)
  }
  const COUNTER_COMMANDS = /\\(?:setcounter|addtocounter|stepcounter|refstepcounter)\s*\{[^{}]*\}(?:\s*\{[^{}]*\})?|\{\}/g
  /** Counter commands in text, in order: \stepcounter and friends act (resetting the counters within), \the… and \arabic… print */
  const counted = (text: string, inText = false): string => text.replace(/\\(setcounter|addtocounter|stepcounter|refstepcounter)\s*\{([^{}]*)\}(?:\s*\{([^{}]*)\})?|\\(arabic|roman|Roman|alph|Alph)\s*\{([^{}]*)\}|\\the([a-zA-Z]+)\b\s*/g, (_m, cmd, name, arg, style, cname, tname) => {
    if (cmd) {
      const val = (x: string | undefined) => { const vm = x?.match(/^\s*\\value\s*\{([^{}]*)\}\s*$/); if (vm) return counterValue(vm[1]); if (x === undefined || !/^\s*-?\d+\s*$/.test(x)) throw new Unsupported(`\\${cmd} value "${x}"`); return Number(x) }
      if (cmd === "setcounter") setCounter(name, val(arg))
      else if (cmd === "addtocounter") setCounter(name, counterValue(name) + val(arg))
      else {
        if (!userCounters.has(name)) throw new Unsupported(`\\${cmd}{${name}}`)
        setCounter(name, counterValue(name) + 1)
        for (const [n2, u] of userCounters) if (u.within === name) u.value = 0
        if (cmd === "refstepcounter") { // \@currentlabel and \@currentHref: in text, where the command stands
          if (inText) return `\\LXcurrentlabel{${theCounter(name)}}{${name}.${theCounter(name)}}{}`
          refs.label = theCounter(name); refs.href = `${name}.${theCounter(name)}`
        }
        if (arg !== undefined) return `{${arg}}`
      }
      return "{}" // no node, but the spaces around it stay apart
    }
    if (style) return representation(style, counterValue(cname))
    if (userCounters.has(tname)) return theCounter(tname)
    return _m
  })
  const topCtx = (): EnvCtx => ({ depth: 0, itemDepth: 0, enumDepth: 0, totalLeft: 0, lineWidth: k.dimens.textwidth, parskip: outerParskip, parsep: k.glue.parsep, itemsep: k.glue.itemsep, topsep: k.glue.topsep, partopsep: k.glue.partopsep, labelwidth: k.dimens.labelwidth, size: "normalsize", atRightskip: null, finalHyph: undefined, enums: [] })
  /** a run-in heading (\paragraph, \subparagraph) waiting for its paragraph: what replaces the indent box */
  let runIn: (() => Node[]) | null = null
  /** a run-in heading followed by another heading: \@startsection's \leavevmode\par makes it a paragraph of its own */
  const runInAlone = () => {
    const start = runIn!()
    runIn = null
    v.par()
    v.club = 10000
    typeset("", { start, clubPenalty: 10000 }, outerParskip)
    v.afterheadingEverypar = true
  }
  blocks.forEach((b, bi) => {
    // a float leaves a run-in heading waiting; a list's \@trivlist starts its paragraph (\if@noskipsec\leavevmode)
    // (inside the list's group, so the heading's \clubpenalty\@M ends with the list)
    if (runIn && b.kind === "list") { const club = v.club; runInAlone(); v.club = club; list({ ...b, inPar: true, blank: false }, topCtx()); v.afterheadingEverypar = false; v.endpePar = true; return }
    if (runIn && !(b.kind === "par" || b.kind === "heading" || b.kind === "float" || b.kind === "toc" || b.kind === "matter")) throw new Unsupported(`a ${b.kind} right after a run-in heading`)
    if (b.kind === "heading") { if (runIn) runInAlone(); if (b.level === 0) chapter(b); else heading(b); return }
    if (b.kind === "maketitle") { maketitle(); return }
    if (b.kind === "toc") { if (runIn) runInAlone(); tableOfContents(); return }
    if (b.kind === "matter") { if (runIn) runInAlone(); matter(b.which); return }
    if (b.kind === "float") { floatBlock(b); return }
    if (b.kind === "par") {
      // \label before the paragraph starts: the \write on the vertical list, and while \if@nobreak holds
      // the \nobreak of \protected@write and of \@esphack
      const lead = b.text.match(/^(?:\s*\\label\{[A-Za-z0-9:._-]+\})+\s*/)
      if (lead) {
        if (runIn) throw new Unsupported("\\label right after a run-in heading")
        for (const m of lead[0].matchAll(/\\label\{([^}]*)\}/g)) {
          v.nodes.push(labelWrite(refs, m[1]))
          if (v.nobreak) v.nodes.push(penalty(10000), penalty(10000))
        }
        b.text = b.text.slice(lead[0].length)
        if (!b.text) return
      }
      // counter commands in vertical mode make no paragraph
      if (!b.text.replace(COUNTER_COMMANDS, "").trim()) { counted(b.text); return }
      // a run-in heading goes in place first: its title sees the counters as the paragraph starts
      const head = runIn ? runIn() : null
      const text = counted(b.text, true)
      if (head) { // \@xsect's \everypar: the indent box gives way to the heading, \clubpenalty\@M
        const start = head
        runIn = null
        v.par()
        if (v.nobreak) throw new Unsupported("a run-in heading right after a heading")
        // a display environment that starts the paragraph starts it in its own group: \clubpenalty\@M ends there
        const segs0 = displaySegments(text)
        const grouped = !(segs0[0] as string).trim() && typeof segs0[1] !== "string" && (segs0[1].kind !== "dollars" && (segs0[1].kind !== "bracket" || amsmath))
        const outer = v.club
        // (the heading's own lines, before the first display, are inside that group)
        paragraphWithDisplays(text, false, grouped ? outer : 10000, grouped ? outer : 10000, start, b.unskip, 10000)
        if (!grouped) { v.club = 10000; v.afterheadingEverypar = true } // the next paragraph's \everypar sets \@clubpenalty
        return
      }
      if (b.noindent) {
        // right after a list: \@doendpe's \everypar drops the indent box; its \par resets \clubpenalty
        // first, so the lines see \@clubpenalty while footnotes read before it see the value in force
        // (a list that follows at once runs that \par inside its own group, so the reset does not last)
        const noteClub = v.club
        const next = blocks[bi + 1]
        if (next?.kind === "list" && next.inPar) paragraphWithDisplays(text, true, noteClub, k.ints.clubpenalty, undefined, b.unskip)
        else { v.par(); paragraphWithDisplays(text, true, noteClub, v.club, undefined, b.unskip) }
        return
      }
      v.par() // the blank line before it
      let noindent = false
      // a display environment (or amsmath's \[, which is \begin{equation*}) that starts the paragraph
      // starts it inside the environment's group: \everypar's assignments there do not last
      const segs = displaySegments(text)
      const grouped = !(segs[0] as string).trim() && typeof segs[1] !== "string" && (segs[1].kind !== "dollars" && (segs[1].kind !== "bracket" || amsmath))
      if (v.afterheadingEverypar) {
        // \@afterheading's \everypar: \clubpenalty\@M and no indentation unless \@afterindent; later, \@clubpenalty
        if (v.nobreak) { v.nobreak = false; noindent = !v.afterindent; if (!grouped) v.club = 10000 }
        else if (!grouped) { v.club = k.ints.clubpenalty; v.afterheadingEverypar = false }
      }
      paragraphWithDisplays(text, noindent, v.club, v.club, undefined, b.unskip)
      return
    }
    if (b.blank) v.par() // a blank line before the list
    list(b, topCtx())
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
  function paragraphWithDisplays(text: string, noindent: boolean, club: number, parClub: number, start?: Node[], unskip = 0, firstClub = club) {
    const segs = displaySegments(text)
    const quad = romanFont.params[QUAD]
    let prevGraf = 0
    segs.forEach((seg, i) => {
      if (typeof seg !== "string") return
      const first = i === 0, last = i === segs.length - 1
      const t = squeeze(seg) // a display ends with \ignorespaces
      const next = segs[i + 1] as Display | undefined
      let justBox: BoxNode | null = null, nlines = 0
      let params: ReturnType<typeof paragraphInput>["params"] | null = null
      const opts = {
        clubPenalty: last ? parClub : first ? firstClub : club, noteClubPenalty: first ? firstClub : club, prevGraf,
        ...(last ? (unskip ? { unskip } : {}) : { widowPenalty: k.ints.displaywidowpenalty }),
        ...(first ? (start ? { start } : {}) : { start: [] as Node[] }),
      }
      if (first && !t) {
        // the display starts the paragraph: $$ (and amsmath's \[) from vertical mode starts it with the
        // indent box; LaTeX's own \[ first sets \nointerlineskip\makebox[.6\linewidth]{}
        if (next!.kind === "bracket" && !amsmath || next!.kind === "displaymath" && !amsmath) {
          v.prevDepth = IGNORE_DEPTH
          const lw = k.dimens.textwidth
          const mb = hpack([hss(), hss()], { exactly: xnOverD(lw, 39322, 65536) })
          const r = typesetList([...(start ?? (noindent ? [] : [emptyBox("hlist", k.dimens.parindent)])), mb], opts, true)
          justBox = r.just; params = r.params; nlines = r.lines
        } else if (!noindent || start) { // a run-in heading takes the indent box's place
          const r = typesetList(start ?? [emptyBox("hlist", k.dimens.parindent)], opts, true)
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
      if (next.kind === "equation") { counters.equation++; refs.href = href("equation", counters.equation) } // \refstepcounter, or amsmath's \incr@eqnum
      const newlabel: Node | null = label ? labelWrite(refs, label[1], the(counters.equation)) : null
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
      refs.href = href("equation", counters.equation)
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
    // \calc@shift@align (tags on the right, not fleqn), last row first; a tag that does not fit beside its
    // row is shifted below it (\saveshift@1)
    const shifted = rows.map(() => false)
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
      if (dimen > z) { shifted[r] = true; continue }
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
      if (r.numbered && shifted[ri]) {
        // \place@tag: \llap{\vtop{\normalbaselines \setbox\@ne\null \dp\@ne\lineht@ \box\@ne \boxz@}}, \lineht@
        // the deepest field of the row (\set@field; \math@cr@@@align resets it after each row)
        // (\measure@'s rows never reset it: the first row starts from the deepest field of them all)
        const lineht = Math.max(0, ...(ri === 0 ? rows.flatMap((x) => x.fields) : r.fields).map((f) => f.depth))
        const nul = hpack([]); nul.depth = lineht
        const list: Node[] = [nul]
        appendToVlist(list, tags[ri], lineht, k.sizes.normalsize.baselineskip, k.glue.normallineskip, k.dimens.normallineskiplimit)
        const vt = vpack(list)
        vt.depth = vt.height + vt.depth; vt.height = 0 // \vtop: the first box's height (§ 1087)
        tagCol.push(kern(-tagshift, true), hpack([hss(), vt], { exactly: 0 }))
      } else if (r.numbered) tagCol.push(kern(-tagshift, true), hpack([hss(), tags[ri]], { exactly: 0 }))
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
    // \black@\totwidth@ after the last row: an align wider than the display shows its width in a
    // \noalign{\nointerlineskip \vskip-\ht\strutbox@ \vskip-\dp\strutbox@ \vbox{\noindent
    // \hbox to\displaywidth{\hbox to\totwidth@{\strut@\hfill}}} \prevdepth restored}
    // (\totwidth@ by then has \minalignsep for each space between column pairs)
    const blackWidth = totwidth + tempcntb * minalignsep
    if (blackWidth > z) {
      const wide = hpack([hpack([strutBox(), glue(0, 65536, FILL)], { exactly: blackWidth })], { exactly: z })
      const par = paragraphInput("", k, "normalsize", doc, { start: [wide], amsmath })
      const lb = lineBreak(par.list, par.params)
      decisions.push(lb.trace)
      v.nodes.push(glue(-strut.height), glue(-strut.depth), vpack(lb.vlist))
    }
    v.nodes.push(penalty(k.ints.postdisplaypenalty), spec("belowdisplayskip", sz.belowdisplayskip))
  }

  /** a paragraph from a ready horizontal list (the display's opening line) */
  /**
   * A list-like environment. \list at a depth (\@listi … \@listvi, the first at the size in force):
   * \@trivlist (\@topsep from \topsep, \partopsep when it starts in vertical mode, and the enclosing
   * \parskip), \parskip\parsep, \parindent\listparindent, \parshape 1 \@totalleftmargin \linewidth, with
   * each environment's settings (description, quote, quotation, verse); \trivlist (center, flushleft,
   * flushright) keeps the enclosing \topsep and margins, with \parsep\parskip and no label. Each \item
   * (\@item) puts \box\@labels — \hskip\itemindent \hskip-\labelwidth \hskip-\labelsep, \makelabel in
   * \labelwidth, \hskip\labelsep — in place of the first paragraph's indentation; later paragraphs are
   * indented by \parindent; a nested environment starts in the item's paragraph (\unskip\par) and the
   * text after it is not indented (\@doendpe); \\ in center, flushleft, flushright and verse is
   * \@centercr (\par\addvspace{-\parskip}). Then \endtrivlist and \@endparenv.
   */
  function list(b: ListBlock, ctx: EnvCtx) {
    if (b.env === "abstract") return abstract(b, ctx)
    const outerLabel = refs.label // \@currentlabel is local to the environment
    const trivial = b.env === "center" || b.env === "flushleft" || b.env === "flushright"
    const sizeFont = loadFont(dataFont(k.sizes[ctx.size].font.name), k.sizes[ctx.size].font.at)
    const ems = (x: string) => new Scanner(x, { em: sizeFont.params[QUAD], ex: sizeFont.params[X_HEIGHT] }).scanDimen().value
    let depth = ctx.depth, leftmargin = 0, labelwidth = 0, itemindent = 0, listparindent = 0, rightmargin = 0
    // \trivlist: \parsep\parskip; \list: \@listi … \@listvi set some parameters, the others stay as they are
    let topsep = ctx.topsep, partopsep = ctx.partopsep, parsep = trivial ? ctx.parskip : ctx.parsep, itemsep = ctx.itemsep
    labelwidth = trivial ? 0 : ctx.labelwidth
    if (!trivial) {
      depth++
      if (depth > 6) throw new Unsupported("lists nested more than six deep") // LaTeX: Too deeply nested
      const L = (p: string) => k.glue[depth === 1 ? `list1${p}@${ctx.size}` : `list${depth}${p}`]
      const D = (p: string) => k.dimens[depth === 1 ? `list1${p}@${ctx.size}` : `list${depth}${p}`]
      leftmargin = D("leftmargin")
      if (depth <= 3) { topsep = L("topsep"); parsep = L("parsep"); itemsep = L("itemsep") }
      if (depth === 3) partopsep = L("partopsep")
      if (depth >= 2) labelwidth = D("labelwidth")
      if (b.env === "description") { labelwidth = 0; itemindent = -leftmargin } // \labelwidth\z@ \itemindent-\leftmargin
      else if (b.env === "quote") rightmargin = leftmargin
      else if (b.env === "quotation") { listparindent = ems("1.5em"); itemindent = listparindent; rightmargin = leftmargin; parsep = { width: 0, stretch: 65536, stretchOrder: 0, shrink: 0, shrinkOrder: 0 } }
      else if (b.env === "verse") { itemsep = dimen(0); itemindent = -ems("1.5em"); listparindent = itemindent; rightmargin = leftmargin; leftmargin += ems("1.5em") }
    }
    const topsepadd = b.inPar ? topsep : addGlue(topsep, partopsep) // \partopsep only from vertical mode
    const topsepAll = addGlue(topsepadd, ctx.parskip) // \advance\@topsep\parskip, the enclosing \parskip
    const totalLeft = ctx.totalLeft + leftmargin, lineWidth = ctx.lineWidth - leftmargin - rightmargin
    const parShape: [number, number][] | undefined = depth > 0 ? [[totalLeft, lineWidth]] : undefined
    // paragraph settings: \@trivlist's \leftskip\z@skip \rightskip\@rightskip \parfillskip\@flushglue, then
    // \centering, \raggedright or \raggedleft (\parindent\z@)
    const flush = (n: string) => paramGlue(n, glue(0, 65536, FIL))
    let atRightskip = ctx.atRightskip, finalHyph = ctx.finalHyph
    let align: { leftSkip?: GlueNode; rightSkip?: GlueNode; parFillSkip?: GlueNode } = atRightskip ? { rightSkip: paramGlue("rightskip", atRightskip) } : {}
    let parindent = listparindent
    if (b.env === "center") { align = { leftSkip: flush("leftskip"), rightSkip: flush("rightskip"), parFillSkip: paramGlue("parfillskip", glue(0)) }; finalHyph = 0; parindent = 0 }
    else if (b.env === "flushleft") { atRightskip = glue(0, 65536, FIL); align = { rightSkip: flush("rightskip") }; finalHyph = 0; parindent = 0 }
    else if (b.env === "flushright") { align = { leftSkip: flush("leftskip"), parFillSkip: paramGlue("parfillskip", glue(0)) }; finalHyph = 0; parindent = 0 }
    const shape = { ...align, ...(parShape ? { parShape } : {}), ...(finalHyph !== undefined ? { finalHyphenDemerits: finalHyph } : {}) }
    const itemDepth = ctx.itemDepth + (b.env === "itemize" ? 1 : 0), enumDepth = ctx.enumDepth + (b.env === "enumerate" ? 1 : 0)
    const level = b.env === "itemize" ? itemDepth : enumDepth
    if (level > 4) throw new Unsupported(`${b.env} nested more than four deep`)
    const font = sizeFont
    const bold = loadFont(dataFont(k.sizes[ctx.size].bold.name), k.sizes[ctx.size].bold.at)
    const companion = loadFont(dataFont(k.sizes[ctx.size].companion.name), k.sizes[ctx.size].companion.at)
    let counter = 0 // \c@enum…: an item with its own label does not step it
    const alph = (n: number) => String.fromCharCode(96 + n)
    const roman = (n: number) => { // \@roman (TeX's \romannumeral)
      let out = ""
      for (const [v, r] of [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]] as const) while (n >= v) { out += r; n -= v }
      return out
    }
    const ls = k.dimens.labelsep
    b.items.forEach(({ label: given, parts }, i) => {
      // \@item: before the first item \@beginparpenalty, \@topsep and -\parskip (right after a heading,
      // \@nbitem: \@outerparskip-\parskip); then \@itempenalty and \itemsep
      let club: number | undefined
      if (i === 0 && v.nobreak) { v.addvspace(addGlue(ctx.parskip, negate(parsep))); v.nobreak = false; club = 10000 }
      else if (i === 0) { v.addpenalty(-LOW_PENALTY); v.addvspace(topsepAll); v.addvspace(negate(parsep)) }
      else { v.addpenalty(-LOW_PENALTY); v.addvspace(itemsep) }
      // \sbox\@tempboxa{\makelabel{label}}
      let content: Node[]
      if (b.env === "itemize" || b.env === "enumerate") {
        const l: Node[] = []
        if (given !== null) appendText(l, given.replace(/\s+/g, " "), font, { spaceFactor: 1000 }, false)
        else if (b.env === "itemize") { // \labelitemi … iv: \textbullet, \bfseries\textendash, \textasteriskcentered, \textperiodcentered
          if (level === 2) l.push(charBox(bold, k.ints.T1 ? 21 : 123)) // \textendash in OT1 and T1
          else l.push(charBox(companion, [TEXTBULLET, 0, 42, 183][level - 1]))
        } else { // \labelenumi … iv: 1. (a) i. A.
          const n = ++counter
          // \refstepcounter{enum…}: \p@enum… \theenum… (1, 1a, 1(a)i, 1(a)iA), and \@currentHref enum….n
          const [v1, v2, v3] = [...ctx.enums, n]
          refs.label = [`${n}`, `${v1}${alph(n)}`, `${v1}(${alph(v2)})${roman(n)}`, `${v1}(${alph(v2)})${roman(v3)}${alph(n).toUpperCase()}`][level - 1]
          refs.href = `enum${["i", "ii", "iii", "iv"][level - 1]}.${n}`
          if ((level === 2 || level === 4) && n > 26) throw new Unsupported("\\alph counter past z") // LaTeX: Counter too large
          appendText(l, level === 1 ? `${n}.` : level === 2 ? `(${alph(n)})` : level === 3 ? `${roman(n)}.` : `${alph(n).toUpperCase()}.`, font, { spaceFactor: 1000 }, false)
        }
        content = [hss(), hpack([hss(), ...l], { exactly: 0 })] // \hss\llap{#1}
      } else if (b.env === "description") { // \descriptionlabel: \hspace\labelsep\normalfont\bfseries #1
        content = [glue(ls)]
        if (given) appendText(content, given.replace(/\s+/g, " "), bold, { spaceFactor: 1000 }, false)
      } else if (trivial) content = given ? (() => { const l: Node[] = []; appendText(l, given, font, { spaceFactor: 1000 }, false); return l })() : [] // \makelabel##1{##1}
      else { content = [glue(0, 65536, FIL)]; if (given) appendText(content, given, font, { spaceFactor: 1000 }, false) } // \@mklab: \hfil #1
      const temp = hpack(content.slice())
      const boxed = temp.width > labelwidth ? temp : hpack(content.slice(), { exactly: labelwidth })
      const labels = hpack([glue(itemindent), glue(-labelwidth), glue(-ls), boxed, glue(ls)])
      // \clubpenalty in the item: \@M from its first paragraph right after a heading, until a later paragraph's
      // \everypar (still \@item's) or \@doendpe's \par sets \@clubpenalty
      let itemClub = club
      parts.forEach((p) => {
        if (p.kind === "list") {
          if (p.blank) v.par()
          return list(p, { depth, itemDepth, enumDepth, totalLeft, lineWidth, parskip: parsep, parsep, itemsep, topsep, partopsep, labelwidth, size: ctx.size, atRightskip, finalHyph, enums: b.env === "enumerate" ? [...ctx.enums, counter] : ctx.enums })
        }
        // \everypar: the indent box gives way to \box\@labels \penalty\z@; after a nested environment, \@doendpe
        // drops it; later paragraphs are indented by \parindent
        const un = p.unskip ? { unskip: p.unskip } : {}
        if (p.start === "label") typeset(p.text, { start: [labels, penalty(0), ...(p.nodes ?? [])], ...shape, ...un, ...(club ? { clubPenalty: club } : {}) }, parsep, ctx.size)
        // the nested list's group is over: its footnotes see the item's \clubpenalty (\@M right after a
        // heading); \@doendpe's \par sets \@clubpenalty for the lines
        else if (p.start === "doendpe") { typeset("\\noindent " + p.text, { ...shape, ...un, noteClubPenalty: itemClub ?? k.ints.clubpenalty }, parsep, ctx.size); itemClub = undefined }
        else {
          // a paragraph's \everypar resets \clubpenalty; after \\ with no text (a list next) none starts
          if (p.text) itemClub = undefined
          if (p.start === "cr") v.addvspace(negate(parsep)) // \@centercr: \par \addvspace{-\parskip}
          if (p.text) typeset(p.text, { start: [emptyBox("hlist", parindent)], ...shape, ...un }, parsep, ctx.size)
        }
      })
    })
    // \endtrivlist: the last item's \par, then \@endparenv
    v.endtrivlist(parsep, ctx.parskip, topsepadd)
    refs.label = outerLabel
  }

  /**
   * article's abstract (one column, no title page): \small, \begin{center}{\bfseries \abstractname
   * \vspace{-.5em}\vspace{\z@}}\end{center}, then the text in a quotation
   */
  function abstract(b: ListBlock, ctx: EnvCtx) {
    if (cls !== "article") throw new Unsupported(`abstract in ${cls}`)
    const small = { ...ctx, size: "small" as SizeCommand }
    const bf = loadFont(dataFont(k.sizes.small.bold.name), k.sizes.small.bold.at)
    const head: Node[] = []
    appendText(head, "Abstract", bf, { spaceFactor: 1000 }, false)
    const em = bf.params[QUAD]
    // \vspace in a paragraph: \vadjust{\vskip#1\vskip\z@skip}
    head.push({ kind: "adjust", list: [glue(-xnOverD(em, 32768, 65536)), glue(0)] }, { kind: "adjust", list: [glue(0), glue(0)] })
    list({ kind: "list", env: "center", items: [{ label: null, parts: [{ kind: "text", text: "", start: "label", nodes: head }] }], inPar: b.inPar, blank: false }, small)
    v.afterheadingEverypar = false
    list({ kind: "list", env: "quotation", items: b.items, inPar: false, blank: false }, small)
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
    /** a paragraph in the float: \parindent is zero (\@parboxrestore), \sloppy (\tolerance 9999, \emergencystretch
     *  3em), and \centering's flush glue when it came before */
    const floatParagraph = (start: Node[], body: string, centering = centered) => {
      const flush = (p: string) => paramGlue(p, glue(0, 65536, FIL))
      // \centering's \finalhyphendemerits=\z@ outlasts \@parboxrestore, which resets only the skips
      const shape = centering ? { leftSkip: flush("leftskip"), rightSkip: flush("rightskip"), parFillSkip: paramGlue("parfillskip", glue(0)), finalHyphenDemerits: 0 } : centered ? { finalHyphenDemerits: 0 } : {}
      // (\clubpenalty is the one in force: \@parboxrestore leaves it, and \@setminipage's \everypar replaces \@afterheading's)
      const par = paragraphInput(body, k, "normalsize", doc, { ...shape, start, amsmath, tolerance: 9999, emergencyStretch: 3 * romanFont.params[QUAD], clubPenalty: v.club })
      const lb = lineBreak(par.list, par.params)
      decisions.push(...par.notes, lb.trace)
      // new_graf in internal vertical mode adds \parskip (zero here) only to a list that is not empty, and
      // so does LaTeX's restart of the paragraph
      if (content.length) content.push(paramGlue("parskip", glue(0)), paramGlue("parskip", glue(0)))
      for (const n of lb.vlist) {
        if (n.kind === "hlist") pd = appendToVlist(content, n, pd, k.sizes.normalsize.baselineskip, k.glue.lineskip, k.dimens.lineskiplimit)
        else content.push(n)
      }
    }
    for (const it of items) {
      if (it === "\\centering") { centered = true; continue }
      // a tabular starts a paragraph (\leavevmode): the \parindent box (zero after \@parboxrestore), then
      // the tabular's box, alone on its line; \centering sets \leftskip and \rightskip to \@flushglue
      const tab = it.match(/^\\begin\{tabular\}\{([^}]*)\}([^]*)\\end\{tabular\}$/)
      if (tab) {
        const { cols, lines } = tabularOf(tab[1], tab[2])
        floatParagraph([hpack([]), tabular(lines, cols, "normalsize", "c")], "")
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
        refs.href = href(b.env, number) // global; \@currentlabel ends with the float's group
        const ext = b.env === "figure" ? "lof" : "lot"
        content.push({ kind: "whatsit", text: `\\write1{\\@writefile{${ext}}{\\protect \\contentsline {${b.env}}{\\protect \\numberline {${the(number)}}{\\ignorespaces ${text}}}{\\thepage }{}\\protected@file@percent }}` })
        content.push(glue(k.dimens.abovecaptionskip))
        // \sbox\@tempboxa{\fnum@figure: text}: \figurename\nobreakspace\thefigure
        const l: Node[] = [], state = { spaceFactor: 1000 }
        appendText(l, b.env === "figure" ? "Figure" : "Table", romanFont, state, false)
        l.push(penalty(10000), glue(romanFont.params[SPACE], romanFont.params[SPACE_STRETCH], 0, romanFont.params[SPACE_SHRINK], 0)) // \nobreak\ 
        appendText(l, `${the(number)}: ${text}`, romanFont, state, false)
        const cap = hpack(l)
        if (cap.width > hsize) { // too wide for a line: #1: #2\par, a paragraph
          const start: Node[] = [hpack([])]
          appendText(start, b.env === "figure" ? "Figure" : "Table", romanFont, { spaceFactor: 1000 }, false)
          start.push(penalty(10000), glue(romanFont.params[SPACE], romanFont.params[SPACE_STRETCH], 0, romanFont.params[SPACE_SHRINK], 0))
          floatParagraph(start, `${the(number)}: ${text}`, false) // \@caption's \@parboxrestore undoes \centering
        } else pd = appendToVlist(content, hpack([glue(0, 65536, FIL), cap, glue(0, 65536, FIL)], { exactly: hsize }), pd, k.sizes.normalsize.baselineskip, k.glue.lineskip, k.dimens.lineskiplimit)
        content.push(glue(k.dimens.belowcaptionskip))
        continue
      }
      // \label after the caption: \protected@write\@auxout{}{\string\newlabel{key}{{n}{\thepage }{}{figure.n}{}}}
      m = it.match(/^\\label\s*\{([A-Za-z0-9:._-]+)\}$/)
      if (m && number) { content.push(labelWrite(refs, m[1], the(number))); continue }
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

  /**
   * \tableofcontents: \section*{\contentsname} (report: \chapter*), then \@starttoc{toc}, which reads
   * the lines the run before wrote (\contentsline → \l@<name>) and ends with \@nobreakfalse
   */
  function tableOfContents() {
    const source = "\\contentsname \\@mkboth{\\MakeUppercase\\contentsname}{\\MakeUppercase\\contentsname}"
    // with running heads, \@mkboth is \markboth: its marks in the title's line, which they leave (§ 655)
    const contents = markValue([{ text: "Contents" }], true)
    const end = mkboth ? insertMarks(markboth(contents, contents), false) : undefined
    if (cls === "article") heading({ kind: "heading", level: 1, star: true, title: "Contents", source, end })
    else chapter({ kind: "heading", level: 0, star: true, title: "Contents", source, end })
    const tocdepth = cls === "article" ? 3 : 2
    for (const e of toc ?? []) if (e.level <= tocdepth) tocLine(e)
    v.nobreak = false
  }

  /**
   * One toc line. The top level (article's \l@section, report's \l@chapter): \addpenalty, the skip,
   * then in a group \parindent\z@ \rightskip\@pnumwidth \parfillskip-\@pnumwidth \leavevmode\bfseries
   * \advance\leftskip\@tempdima \hskip-\leftskip #1\nobreak\hfil\nobreak\hb@xt@\@pnumwidth{\hss #2\kern-\p@\kern\p@}\par.
   * Below it, \@dottedtocline{level}{indent}{numwidth}: \vskip\z@\@plus.2\p@, and in a group \leftskip
   * indent, \rightskip\@tocrmarg, \parfillskip-\rightskip, \parindent indent, \@afterindenttrue,
   * \interlinepenalty\@M, \leavevmode \advance\leftskip numwidth \null\nobreak\hskip-\leftskip {#4}\nobreak
   * \leaders\hbox{$\m@th\mkern\@dotsep mu\hbox{.}\mkern\@dotsep mu$}\hfill\nobreak
   * \hb@xt@\@pnumwidth{\hfil\normalfont\normalcolor #5\kern-\p@\kern\p@}\par
   */
  function tocLine(e: TocEntry) {
    const top = cls === "article" ? 1 : 0
    const dims = (x: string, units = bodyUnits) => new Scanner(x, units).scanDimen().value
    const bold = k.sizes.normalsize.bold
    const font = e.level === top ? bold : roman
    const f = loadFont(dataFont(font.name), font.at)
    const fUnits = { em: f.params[QUAD], ex: f.params[X_HEIGHT] }
    // \numberline{n}: \hb@xt@\@tempdima{n\hfil}
    const numberline = (width: number): Node[] => {
      if (e.number === null) return []
      const l: Node[] = []
      appendText(l, e.number, f, { spaceFactor: 1000 }, false)
      return [hpack([...l, glue(0, 65536, FIL)], { exactly: width })]
    }
    // the page number: \hb@xt@\@pnumwidth (in the line's font) {\hss or \hfil, #2, \kern-\p@\kern\p@}
    const pageBox = (fill: Node): BoxNode => {
      const l: Node[] = [fill]
      appendText(l, String(e.page), f, { spaceFactor: 1000 }, false)
      l.push(kern(-65536, true), kern(65536, true))
      return hpack(l, { exactly: dims("1.55em", fUnits) })
    }
    if (e.level === top) {
      if (cls === "article") { v.addpenalty(-300); v.addvspace({ width: dims("1.0em"), stretch: 65536, stretchOrder: 0, shrink: 0, shrinkOrder: 0 }) }
      else { v.addpenalty(-301); v.vskip({ width: dims("1.0em"), stretch: 65536, stretchOrder: 0, shrink: 0, shrinkOrder: 0 }) } // \@highpenalty
    } else v.vskip({ width: 0, stretch: 13107, stretchOrder: 0, shrink: 0, shrinkOrder: 0 })
    // the paragraph's \everypar: \@afterheading's, which is reset only inside the line's group
    let club = v.club, keepIndent = true
    if (v.afterheadingEverypar) {
      if (v.nobreak) { v.nobreak = false; club = 10000; keepIndent = e.level !== top || v.afterindent }
      else club = k.ints.clubpenalty
    }
    let start: Node[], nl: Node[], tail: Node[], params: Parameters<typeof paragraphInput>[4]
    if (e.level === top) {
      const tempdima = dims("1.5em"), pnum = dims("1.55em")
      start = [...(keepIndent ? [emptyBox("hlist", 0)] : []), glue(-tempdima)]
      nl = numberline(tempdima)
      tail = [penalty(10000), glue(0, 65536, FIL), penalty(10000), pageBox(glue(0, 65536, FIL, 65536, FIL))]
      params = { leftSkip: spec("leftskip", dimen(tempdima)), rightSkip: spec("rightskip", dimen(pnum)), parFillSkip: spec("parfillskip", dimen(-pnum)) }
    } else {
      const [indent, numwidth] = (cls === "article" ? [["", ""], ["", ""], ["1.5em", "2.3em"], ["3.8em", "3.2em"]] : [["", ""], ["1.5em", "2.3em"], ["3.8em", "3.2em"]])[e.level].map((x) => dims(x))
      const rmarg = dims("2.55em")
      // \mkern\@dotsep mu: math_kern (§ 717) in the text size's mu
      const mu = Math.trunc(mathEnv(k, "normalsize", amsmath).fonts[0][2]!.params[6] / 18)
      const mk = mathGlue(dimen(dims("4.5pt")), mu).width
      const dot: Node[] = []
      appendText(dot, ".", f, { spaceFactor: 1000 }, false)
      const leader = hpack([{ kind: "math", on: true, width: 0 }, kern(mk, true), hpack(dot), kern(mk, true), { kind: "math", on: false, width: 0 }])
      start = [emptyBox("hlist", indent), hpack([]), penalty(10000), glue(-(indent + numwidth))]
      nl = numberline(numwidth)
      tail = [penalty(10000), { ...glue(0, 65536, FILL), leaders: { kind: "leaders", box: leader } }, penalty(10000), pageBox(glue(0, 65536, FIL))]
      params = { leftSkip: spec("leftskip", dimen(indent + numwidth)), rightSkip: spec("rightskip", dimen(rmarg)), parFillSkip: spec("parfillskip", dimen(-rmarg)), interLinePenalty: 10000 }
    }
    // hyperref (linktoc=section): the number and the title in a link to the heading's anchor
    let body = e.title
    if (hyper && e.anchor) {
      const title = paragraphInput(e.title, k, "normalsize", doc, { start: [], font, amsmath }).list
      start.push(tocLink([...nl, ...title], e.anchor, k.sizes.normalsize.baselineskip.width))
      body = ""
    } else start.push(...nl)
    const { list, params: ps, notes } = paragraphInput(body, k, "normalsize", doc, { ...params, start, font, clubPenalty: club, amsmath })
    list.push(...tail)
    const lb = lineBreak(list, ps)
    decisions.push(...notes, lb.trace)
    v.paragraph(lb.vlist, outerParskip)
    if (e.level === top && cls !== "article") v.nodes.push(penalty(301)) // \penalty\@highpenalty
  }

  /** article's \maketitle and \@maketitle: \newpage, \null, \vskip 2em, a center environment with
   *  {\LARGE title\par}, \vskip 1.5em, {\large \lineskip .5em author tabulars\par}, \vskip 1em,
   *  {\large date}, then \vskip 1.5em */
  function maketitle() {
    if (!title.title) throw new Unsupported("\\maketitle without \\title")
    const em = (n: string, f: Font) => new Scanner(n, { em: f.params[QUAD], ex: f.params[X_HEIGHT] }).scanDimen().value
    // report: the titlepage environment (\newpage, \thispagestyle{empty}, \setcounter{page}\@ne), then
    // \null\vfil\vskip60\p@; article: \newpage, \global\@topnum\z@ (no float at the top of this page), and
    // \@maketitle's \newpage, \null, \vskip2em
    const titlepage = cls !== "article"
    v.par()
    v.nobreak = false
    const hook = (h: OutputHook): Node => ({ kind: "whatsit", text: "", hook: h })
    if (titlepage) {
      v.nodes.push(glue(0, 65536, FIL), penalty(-10000), hook("empty"), hook("page=1"))
      v.box(hpack([]), k.sizes.normalsize.baselineskip)
      v.vskip({ width: 0, stretch: 65536, stretchOrder: FIL, shrink: 0, shrinkOrder: 0 })
      v.vskip(dimen(60 * 65536))
    } else {
      v.nodes.push(glue(0, 65536, FIL), penalty(-10000), hook("notop"), glue(0, 65536, FIL), penalty(-10000))
      v.box(hpack([]), k.sizes.normalsize.baselineskip) // \null
      v.vskip(dimen(em("2em", romanFont)))
    }
    // \begin{center}: \trivlist (\parsep\parskip, \labelwidth\z@, \leftmargin\z@), \centering, \item\relax
    const topsepadd = addGlue(k.glue.topsep, k.glue.partopsep)
    v.addpenalty(-LOW_PENALTY); v.addvspace(addGlue(topsepadd, outerParskip)); v.addvspace(negate(outerParskip))
    const labelsep = k.dimens.labelsep
    const labels = hpack([glue(0), glue(0), glue(-labelsep), hpack([], { exactly: 0 }), glue(labelsep)])
    const flush = (p: string) => paramGlue(p, glue(0, 65536, FIL))
    const centering = { leftSkip: flush("leftskip"), rightSkip: flush("rightskip"), parFillSkip: paramGlue("parfillskip", glue(0)), finalHyphenDemerits: 0 }
    const check = (t: string, what: string) => { if (/[\\{}%&#^_~$]/.test(t.replace(/\\[#%&$]/g, ""))) throw new Unsupported(`${what} "${t}"`) }
    check(title.title, "\\title")
    typeset(title.title, { ...centering, start: [labels, penalty(0)], clubPenalty: k.ints.clubpenalty }, outerParskip, "LARGE")
    v.vskip(dimen(em(titlepage ? "3em" : "1.5em", romanFont)))
    // {\large \lineskip .5em (report: .75em) \begin{tabular}[t]{c}\@author\end{tabular}\par}, \and between tabulars
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
    v.paragraph(ab.vlist, outerParskip, k.sizes.large.baselineskip, dimen(em(titlepage ? ".75em" : ".5em", large)))
    v.vskip(dimen(em(titlepage ? "1.5em" : "1em", romanFont)))
    // {\large \@date}: its paragraph ends at \end{center}, with the normal size's \baselineskip (report:
    // {\large \@date \par}, with \large's)
    const date = (title.date ?? "\\today").replace(/\\today\b\s*/g, today())
    check(date, "\\date")
    if (date) {
      const dp = paragraphInput("", k, "large", doc, { ...centering, start: [hpack([])], clubPenalty: k.ints.clubpenalty, amsmath })
      appendText(dp.list, date, large, { spaceFactor: 1000 })
      const db = lineBreak(dp.list, dp.params)
      decisions.push(db.trace)
      v.paragraph(db.vlist, outerParskip, titlepage ? k.sizes.large.baselineskip : k.sizes.normalsize.baselineskip)
    }
    v.endtrivlist(outerParskip, outerParskip, topsepadd)
    if (titlepage) {
      // \par\@thanks\vfil\null, \end{titlepage}: \newpage and, one-sided, \setcounter{page}\@ne
      v.vskip({ width: 0, stretch: 65536, stretchOrder: FIL, shrink: 0, shrinkOrder: 0 })
      v.box(hpack([]), k.sizes.normalsize.baselineskip)
      v.nodes.push(glue(0, 65536, FIL), penalty(-10000))
      if (!k.ints.twoside) v.nodes.push(hook("page=1"))
    } else {
      // \endtrivlist; then \par \vskip 1.5em, \thispagestyle{plain}
      v.vskip(dimen(em("1.5em", romanFont)))
      v.nodes.push(hook("plain"))
    }
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
  /** \clearpage: \newpage (which ends \if@nobreak), \write\m@ne{}, \vbox{}, \penalty-\@Mi */
  function clearpage() {
    if (v.nobreak) { v.nobreak = false; v.afterheadingEverypar = false }
    v.nodes.push(glue(0, 65536, FIL), penalty(-10000), { kind: "whatsit", text: "\\write-{}" })
    v.box(emptyBox("vlist"), k.sizes.normalsize.baselineskip)
    v.nodes.push(penalty(-10001))
  }
  /** \cleardoublepage: \clearpage, then, two-sided, \ifodd\c@page\else\hbox{}\newpage\fi (the output decides) */
  function cleardoublepage() {
    clearpage()
    if (!k.ints.twoside) return
    const extra: Node[] = []
    appendToVlist(extra, hpack([]), v.prevDepth, k.sizes.normalsize.baselineskip, k.glue.lineskip, k.dimens.lineskiplimit)
    extra.push(glue(0, 65536, FIL), penalty(-10000))
    v.nodes.push({ kind: "whatsit", text: "", hook: { cleardouble: extra } satisfies OutputHook })
  }
  /** book's \frontmatter (\cleardoublepage, \@mainmatterfalse, \pagenumbering{roman}), \mainmatter, \backmatter */
  function matter(which: "front" | "main" | "back") {
    if (cls !== "book") throw new Unsupported(`\\${which}matter in ${cls}`)
    v.par()
    cleardoublepage() // \backmatter's when openright, as book is
    mainmatter = which === "main"
    if (which !== "back") v.nodes.push({ kind: "whatsit", text: "", hook: which === "front" ? "roman" : "arabic" })
  }

  function chapter(b: Extract<Block, { kind: "heading" }>) {
    if (cls !== "report" && cls !== "book") throw new Unsupported(`\\chapter in ${cls}`)
    v.par()
    if (cls === "book") cleardoublepage() // openright
    else clearpage()
    // \thispagestyle{plain}, \global\@topnum\z@
    v.nodes.push({ kind: "whatsit", text: "", hook: "plain" satisfies OutputHook }, { kind: "whatsit", text: "", hook: "notop" satisfies OutputHook })
    // book's \@chapter numbers only in the main matter
    const numbered = !b.star && (cls !== "book" || mainmatter)
    if (!b.star) {
      if (numbered) {
        counters[0]++
        refs.label = String(counters[0]); refs.href = `chapter.${counters[0]}`
        for (let l = 1; l < counters.length; l++) counters[l] = 0
        counters.equation = 0; counters.figure = 0; counters.table = 0; doc.footnote = 0
      } else if (hyper) refs.href = `chapter*.${++linkcounter}` // hyperref's \@chapter: \Hy@MakeCurrentHrefAuto
      // hyperref: the anchor, then \addcontentsline's bookmark and toc line
      if (hyper) { refs.name = labelName(b.title); v.nodes.push(...anchor(refs.href, k.sizes.normalsize.baselineskip.width, "v", lastNode())) }
      v.nodes.push(...contentsWrites(0, numbered ? String(counters[0]) : null, b.title, refs.href, false))
      // \chaptermark: \MakeUppercase{\@chapapp\ \thechapter. \ title}, to both marks when two-sided
      if (headings) {
        const cv = markValue(numbered ? [{ text: "Chapter" }, { ctrl: true }, { text: `${counters[0]}. ` }, { ctrl: true }, { text: b.title }] : [{ text: b.title }], true)
        v.nodes.push(...insertMarks(k.ints.twoside ? markboth(cv, EMPTY_MARK) : markright(cv), false))
      }
      for (const ext of ["lof", "lot"]) v.nodes.push({ kind: "whatsit", text: `\\write1{\\@writefile{${ext}}{\\protect \\addvspace {10\\p@ }}}` })
    } else if (hyper) { // \@schapter: \Hy@MakeCurrentHrefAuto{chapter*} and its anchor
      refs.href = `chapter*.${++linkcounter}`; refs.name = labelName(b.source ?? b.title)
      v.nodes.push(...anchor(refs.href, k.sizes.normalsize.baselineskip.width, "v", lastNode()))
    }
    // \vspace*{50pt}: \hrule height0pt \nobreak \vskip50pt \vskip\z@skip, keeping \prevdepth
    const pd = v.prevDepth
    const top: Node = { kind: "rule", width: null, height: 0, depth: 0 }
    v.nodes.push(top, penalty(10000), glue(50 * 65536), glue(0))
    v.prevDepth = pd
    // the head's first paragraph runs an \@afterheading \everypar still pending, which sets \@clubpenalty
    // (in the head's group)
    const club = v.afterheadingEverypar ? k.ints.clubpenalty : v.club
    const ragged = () => ({ start: [hpack([])], rightSkip: paramGlue("rightskip", glue(0, 65536, FIL)), finalHyphenDemerits: 0, clubPenalty: club }) // \parindent\z@ \raggedright
    if (numbered) {
      typeset(`Chapter ${counters[0]}`, { ...ragged(), font: k.sizes.huge.bold }, outerParskip, "huge")
      v.nodes.push(penalty(10000))
      v.vskip(dimen(20 * 65536))
    }
    typeset(b.title, { ...ragged(), font: k.sizes.Huge.bold, interLinePenalty: 10000, ...(b.end ? { end: b.end } : {}) }, outerParskip, "Huge")
    v.nodes.push(penalty(10000))
    v.vskip(dimen(40 * 65536))
    v.nobreak = true
    v.afterheadingEverypar = true
    v.afterindent = false
  }

  /**
   * \paragraph and \subparagraph: \@startsection with a negative afterskip (-1em). Before it, \par and
   * \@secpenalty with the beforeskip (3.25ex plus1ex minus.2ex), or \everypar{} right after a heading;
   * the heading waits (\@svsechd) for the next paragraph, whose \everypar puts it in place of the indent
   * box: {\normalfont\normalsize\bfseries\hskip #3 title}, the toc line, \unskip\hskip 1em
   */
  function runInHeading(b: Extract<Block, { kind: "heading" }>) {
    const name = b.level === 4 ? "paragraph" : "subparagraph"
    const before = new Scanner("3.25ex plus1ex minus.2ex", bodyUnits).scanGlue()
    v.par()
    if (runIn) throw new Unsupported("two run-in headings in a row")
    if (v.nobreak) v.afterheadingEverypar = false // \everypar{}
    else { v.addpenalty(-300); v.addvspace(before) }
    v.afterindent = true
    if (!b.star && b.level <= k.ints.secnumdepth) throw new Unsupported(`numbered \\${name}`)
    v.nobreak = false // \@nobreakfalse
    // hyperref: \Hy@MakeCurrentHrefAuto now, its anchor box at the start of the title
    const anchorName = hyper ? `section*.${++linkcounter}` : ""
    if (hyper) { refs.href = anchorName; refs.name = labelName(b.title) }
    // \@svsechd is a \def: its title (and the toc line's) is expanded when the paragraph puts it in place
    runIn = () => {
      const title = counted(b.title)
      const indent = b.level === 5 ? k.dimens.parindent : 0
      const start: Node[] = [glue(indent), ...(hyper ? [sectionAnchorBox(anchorName, indent, k.sizes.normalsize.baselineskip.width)] : [])]
      const head = paragraphInput(title, k, "normalsize", doc, { start, font: k.sizes.normalsize.bold, amsmath }).list
      if (!b.star) head.push(...contentsWrites(b.level, null, title, anchorName, false))
      if (head[head.length - 1]?.kind === "glue") head.pop() // \unskip
      head.push(glue(romanFont.params[QUAD])) // \hskip -\@tempskipa
      return head
    }
  }

  /** \@startsection{name}{level}{\z@}{beforeskip}{afterskip}{\normalfont<size>\bfseries} and its starred form */
  function heading(heading: Extract<Block, { kind: "heading" }>) {
    if (heading.level >= 4) return runInHeading(heading)
    const b = { ...heading, title: counted(heading.title) } // as \protected@edef and the typesetting see it
    const size = (["normalsize", "Large", "large", "normalsize"] as const)[b.level as 0 | 1 | 2 | 3]
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
    if (numbered) { refs.label = number; refs.href = `${["", "section", "subsection", "subsubsection"][b.level]}.${number}` } // \refstepcounter
    // hyperref: \refstepcounter's anchor on the vertical list; an unnumbered heading's (\Hy@MakeCurrentHrefAuto)
    // in an \hbox to 0pt at the start of its title; nameref's \@currentlabelname is the title
    let anchorName = ""
    if (hyper) {
      if (numbered) { anchorName = refs.href; v.nodes.push(...anchor(anchorName, k.sizes.normalsize.baselineskip.width, "v", lastNode())) }
      else { anchorName = `section*.${++linkcounter}`; refs.href = anchorName }
      refs.name = labelName(heading.source ?? heading.title)
    }
    const bold = k.sizes[size].bold
    const bf = loadFont(dataFont(bold.name), bold.at)
    const label: Node[] = [glue(0)] // \hskip #3 (\z@)
    if (numbered) { appendText(label, number, bf, { spaceFactor: 1000 }, false); label.push(glue(bf.params[QUAD])) }
    const box = hpack(label)
    const start = hyper && !numbered ? [box, sectionAnchorBox(anchorName, 0, k.sizes[size].baselineskip.width)] : [box]
    typeset(b.title, { start, font: bold, hangIndent: box.width, interLinePenalty: 10000, clubPenalty: headingClub, ...(heading.end ? { end: heading.end } : {}) }, outerParskip, size)
    // \@sect: \sectionmark, then \addcontentsline{toc}: \protected@write, a \write after the heading's lines,
    // with \nobreak after it while \if@nobreak holds (a heading right after a heading)
    if (numbered) v.nodes.push(...sectionMarks(b.level, number, b.title, afterHeading))
    if (!b.star) v.nodes.push(...contentsWrites(b.level, numbered ? number : null, b.title, anchorName, afterHeading))
    // \@xsect: \par \nobreak \vskip afterskip \@afterheading
    v.nodes.push(penalty(10000))
    v.vskip(after)
    v.nobreak = true
    v.afterheadingEverypar = true
  }

  if (runIn) runInAlone() // \end{document}'s \clearpage: \newpage's \if@noskipsec\leavevmode
  let built: ReturnType<typeof endDocument>
  try { built = endDocument(v.nodes, k, outerParskip) } catch (e) {
    if ((e as Error).message.startsWith("page builder: a float")) throw new Unsupported((e as Error).message.slice(14))
    if (e instanceof OutputUnsupported) throw new Unsupported(e.message)
    throw e
  }
  const { pages, pageTrace } = built
  const columns = makeColumns(pages, k)
  // \leftmark (the last 2e-left mark on the page) and \rightmark (the first 2e-right), from the marks at the
  // top level of the page's material, or the value the pages before left (\topmarks); a page of floats has none
  const carried = new Map<number, MarkValue>()
  const sl = selectFont(k, "normalsize", { enc: k.ints.T1 ? "T1" : "OT1", fam: "cmr", ser: "m", shape: "sl" } as FontAttrs)
  const markText = (m: MarkValue | undefined): Node[] => {
    const out: Node[] = [], state = { spaceFactor: 1000 }
    for (const p of m?.parts ?? []) {
      if ("text" in p) appendText(out, m!.upper ? p.text.toUpperCase() : p.text, sl, state, false)
      else if ("ctrl" in p) out.push(glue(sl.params[SPACE], sl.params[SPACE_STRETCH], 0, sl.params[SPACE_SHRINK], 0)) // \
      else out.push(glue(sl.params[QUAD])) // \hskip 1em
    }
    return out
  }
  const headMarks = pages.map((pg) => {
    const marks = pg.kind === "text" ? pg.page.nodes.flatMap((n) => (n.kind === "whatsit" && n.mark ? [n.mark as { cls: number; value: MarkValue }] : [])) : []
    const first = (c: number) => marks.find((m) => m.cls === c)?.value ?? carried.get(c)
    const last = (c: number) => marks.findLast((m) => m.cls === c)?.value ?? carried.get(c)
    const head = { left: last(1), right: first(2) }
    for (const c of [1, 2, 3]) { const l = last(c); if (l) carried.set(c, l) }
    return head
  })
  const shipped = columns.map((c, i) => {
    const even = k.ints.twoside && pages[i].count % 2 === 0
    return outputPage(c.outputbox, pages[i].count, k, pages[i].special ?? pagestyle, hyper, markText(even ? headMarks[i].left : headMarks[i].right), pages[i].thepage)
  })
  // \thepage in each toc line and \newlabel: the page its \write was shipped out on
  let written: Aux | null = null
  if (blocks.some((b) => b.kind === "toc") || /\\(?:page)?ref\{/.test(body) || hyper) {
    const pageOf = new Map<Node, string>(), order = new Map<Node, number>()
    const walk = (n: Node, page: string) => { pageOf.set(n, page); order.set(n, order.size); if (n.kind === "hlist" || n.kind === "vlist") for (const c of n.list) walk(c, page) }
    shipped.forEach((b, i) => walk(b, pages[i].thepage))
    const page = (node: Node) => {
      const p = pageOf.get(node)
      if (p === undefined) throw new Error("a \\write that was not shipped out")
      return p
    }
    written = {
      toc: tocWrites.slice().sort((x, y) => order.get(x.node)! - order.get(y.node)!).map(({ node, entry }) => ({ ...entry, page: page(node) })),
      // the .aux file has them in the order they were shipped out, and the last \newlabel of a key wins
      labels: new Map(refs.writes.map((w) => ({ ...w, page: page(w.node) })).sort((x, y) => order.get(x.node)! - order.get(y.node)!).map((w) => [w.key, { label: w.label, page: w.page, href: w.href }])),
      bookmarks: bookmarks.written,
    }
  }
  return {
    result: {
      trace: shipOut(shipped, undefined, pages.map((p) => p.count)),
      decisions,
      pages: pageTrace,
      columns: columns.map((c) => c.column && c.column.map(emitBoxes)),
      notes: [`${cls} [${option}], \\pagestyle{${pagestyle}}; ${blocks.length} block(s), ${pages.length} page(s)${toc ? `; ${toc.length} toc line(s)` : ""}`],
    },
    written,
  }
}

/** \today on the oracle's fixed date (SOURCE_DATE_EPOCH): "January 1, 2025" */
function today(): string {
  const d = new Date(ORACLE_EPOCH * 1000)
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}
