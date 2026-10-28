// beamer's frames (beamerbaseframe.sty, beamerbaseframesize.sty): the frame
// environment and the \frame command, each one slide here (no overlays). The
// slide's material is a \vbox (\beamer@framebox) that the frame then puts in
// \vbox to\textheight with \nobreak's, the frame title's box (frametitle.ts), the top skip
// of its placement ([c] or [t]) and, after it, the bottom skip
// (\beamer@autobreakframebox). What the frame holds is read by the handlers in
// FRAME_CONTENT, one per construct; a construct none reads throws Unsupported.

import { SIZE_COMMANDS, type ClassOptionData, type SizeCommand } from "../../layout/classdata"
import { parseDimen, parseGlue, type GlueSpec } from "../../layout/dimen"
import { QUAD, X_HEIGHT } from "../../layout/font"
import { lineBreak } from "../../layout/linebreak"
import { emptyBox, FILL, filGlue, fillGlue, glue, penalty, type BoxNode, type Node } from "../../layout/nodes"
import { hpack, vpack } from "../../layout/pack"
import { times } from "../setspace"
import type { ParagraphTrace } from "../../trace/decisions"
import { centering, flushglue, sloppy, zeroskip } from "../kernel"
import { verbatimLines, verbNodes } from "../verbatim"
import { pdfObjects } from "../../pgf/pdfforms"
import type { Ctx } from "../context"
import { DISPLAY } from "../blocks"
import { graphicAt, type BoundingBox } from "../graphics"
import { minipageAt, tabularAt } from "../boxes"
import { hrefAt, urlAt } from "../url"
import type { Booktabs } from "../tabular"
import type { Image } from "../images"
import type { DocumentSource } from "../source"
import { listParagraphWithDisplays } from "../displays"
import { classParams, hlistInput, paragraphInput, selectFont, spec, type DocState, type FontAttrs, type ParagraphOptions, type TabularOuter } from "../paragraph"
import { Unsupported } from "../unsupported"
import { addGlue, dimen, LOW_PENALTY, negate, plain, VerticalList } from "../vlist"
import { colorPop, colorPush } from "../xcolor"
import { alerts, BLOCK_BEGIN, BLOCK_NAMES, blockInParagraph, frameBlock } from "./blocks"
import { frameColumns } from "./columns"
import { footnoteArea, readFootnotes } from "./footnotes"
import { beamercolorbox, boxParagraph, colorboxOptions, lengthEnv } from "./colorbox"
import { frameTitle } from "./frametitle"
import { envEnd, frameList, LIST_BEGIN, listSource, type ListKind } from "./lists"
import type { TitleInfo } from "./preamble"
import { fontSize, outerColors, useColor, type Theme } from "./theme"
import { groupEnd, overlayCommand, overlayText, pause, smuggle, type Overlay } from "./overlays"
import { tableOfContents, type TocEntry } from "./sections"
import { titlePage } from "./titlepage"
import type { BeamerPgf } from "./pgf"

/** a frame as written: its options and what it holds */
export interface FrameSource { kind: "frame"; options: string; body: string
  /** the \frame command (not the environment, whose lines a fragile frame reads) */
  command?: true }
/** \section[short]{title} or \subsection[short]{title} between frames (the short title is the title without one) */
export interface SectionSource { kind: "section" | "subsection"; short: string; title: string
  /** \section*{title} (\beamer@section[{title}]{}): no .toc line */
  star?: boolean }
export type BodyItem = FrameSource | SectionSource

/** What the document body holds: frames (\begin{frame}[options]…\end{frame} and \frame[options]{…}) and \section's and
 *  \subsection's between them, nothing else. */
export function bodyOf(body: string): BodyItem[] {
  const src = body.replace(/(^|[^\\])%.*$/gm, "$1")
  const frames: BodyItem[] = []
  let i = 0
  const options = () => {
    if (src[i] === "<") throw new Unsupported("a frame's overlay specification")
    if (src[i] !== "[") return ""
    const j = src.indexOf("]", i)
    if (j < 0) throw new Unsupported("a frame's options")
    const o = src.slice(i + 1, j)
    i = j + 1
    return o
  }
  for (;;) {
    while (i < src.length && /\s/.test(src[i])) i++
    if (i >= src.length) return frames
    if (src.startsWith("\\begin{frame}", i)) {
      i += 13
      const o = options()
      const end = src.indexOf("\\end{frame}", i)
      if (end < 0) throw new Unsupported("a frame environment not ended")
      frames.push({ kind: "frame", options: o, body: src.slice(i, end) })
      i = end + 11
    } else if (/^\\frame(?![A-Za-z])/.test(src.slice(i))) {
      i += 6
      while (/\s/.test(src[i] ?? "")) i++
      const o = options()
      while (/\s/.test(src[i] ?? "")) i++
      if (src[i] !== "{") throw new Unsupported("\\frame without a braced argument")
      let depth = 0, j = i
      for (; j < src.length; j++) {
        if (src[j] === "\\") { j++; continue }
        if (src[j] === "{") depth++
        else if (src[j] === "}" && --depth === 0) break
      }
      if (j >= src.length) throw new Unsupported("\\frame's argument not closed")
      frames.push({ kind: "frame", options: o, body: src.slice(i + 1, j), command: true })
      i = j + 1
    } else if (/^\\(?:sub)?section(?![A-Za-z])/.test(src.slice(i))) {
      const kind = src.startsWith("\\subsection", i) ? "subsection" : "section"
      i += kind.length + 1
      while (/\s/.test(src[i] ?? "")) i++
      if (src[i] === "<") throw new Unsupported(`\\${kind}${src[i]}`)
      // (\@ifnextchar[ first, then *)
      const star = src[i] === "*"
      if (star) { i++; while (/\s/.test(src[i] ?? "")) i++; if (src[i] === "[") throw new Unsupported(`\\${kind}*[`) }
      let short: string | undefined
      if (src[i] === "[") { const j = src.indexOf("]", i); if (j < 0) throw new Unsupported(`\\${kind}'s short title`); short = src.slice(i + 1, j); i = j + 1 }
      const a = bracedArg(src, i)
      if (!a) throw new Unsupported(`\\${kind} without a braced argument`)
      frames.push({ kind, short: short ?? a.arg, title: a.arg, ...(star ? { star } : {}) })
      i = a.end
    } else throw new Unsupported(`beamer: material outside frames: ${src.slice(i, i + 40)}`)
  }
}

/** What reading a frame's material needs: the class, the theme, the paragraphs' traces in the order TeX breaks them,
 *  and the frame's title and subtitle as \frametitle and \framesubtitle last set them */
export interface FrameCtx { k: ClassOptionData; /** what the source took out, the graphics files and the driver */ media: FrameMedia; theme: Theme; info: TitleInfo; /** the date \today prints, in seconds since 1970 */ epoch: number
  decisions: ParagraphTrace[]; title?: string; subtitle?: string
  /** a list ended (\@endpetrue) and no \par came since: the next paragraph loses its indentation box */
  endpe?: boolean
  /** the paragraph read last ran into a list's \begin, which ended it */
  listInParagraph?: boolean
  /** the .toc lines the last run wrote (\tableofcontents reads them), and \c@section where the frame is */
  toc: TocEntry[]; section: number
  /** the slide being typeset and its overlay state */
  overlay: Overlay
  /** the nodes each \LXsmuggle{n} in the frame's text stands for (overlay specials) */
  smuggled: Node[][]
  /** a block began in the paragraph read last (blocks.ts): whether it is shown */
  blockBegun?: boolean
  /** \ifbeamer@centered: the frame's placement is c */
  centered?: boolean
  /** \c@equation */
  equations: { n: number }
  /** \c@footnote, and the slide's \beamer@footins (footnotes.ts) */
  footnotes: { n: number }; footins: Node[]
  /** in a column's minipage (columns.ts), where \footnote is the minipage's */
  inMinipage?: boolean
  /** \centering is in force (the frame's, or the center environment's): paragraphs centered, \\ is \@centercr */
  align?: "centering"
  /** a size declared between paragraphs (\Large …), for the paragraphs after it */
  size?: SizeCommand
  /** an item's labels (\box\@labels \penalty\z@) that \everypar puts in place of the next paragraph's indentation box */
  itemStart?: Node[]
  /** the frame is fragile: verbatim material may be in it */
  fragile?: boolean
  /** in a figure or a table (\@captype) */
  captype?: "figure" | "table"
  /** pgf in the document (the inner themes' pictures and shadings) */
  pgf: BeamerPgf }

/** What source.ts took out of the document's source (\LXgraphic{n} …), the graphics files' sizes and the driver */
export interface FrameMedia { prepared: DocumentSource; images: Map<string, BoundingBox | Image>; driver: "dvips" | "pdftex"
  /** pdfTeX: the images the run has \pdfximage'd (pdftex.def's global \csname <file> image<attributes>\endcsname), each one
   *  object */
  ximages?: Set<string>
  /** and whether one of them is an image pdfTeX writes more objects for when a page ships (a PDF's, a PNG's palette
   *  …), which the engine does not count */
  ximageObjects?: boolean
  /** booktabs's dimensions (null: not loaded), and whether multirow is */
  booktabs?: Booktabs | null; multirow?: boolean }

/** What the article's layout of the material source.ts took out reads of its context, for a frame: the source's
 *  pieces, the images and the driver, the class (\textwidth, the frame's or the column's) */
function mediaCtx(cx: FrameCtx, doc: DocState): Ctx {
  // (one per frame context: a minipage's width, in its run, is \textwidth for what is laid out in it)
  let partial = mediaCtxs.get(cx)
  if (!partial) {
    const { prepared, images, driver, booktabs, multirow } = cx.media
    partial = { graphics: prepared.graphics, tabulars: prepared.tabulars, minipages: prepared.minipages, urls: prepared.urls, images, driver, booktabs, normalAttrs: SANS, counters: {}, refs: {},
      run: { k: cx.k, floatCaption: { number: null, pending: false, sub: 0, top: null, subAbove: false, keys: null } },
      // (beamer loads hyperref and url; a minipage's material sets no anchors, hyperref's implicit=false)
      pre: { amsmath: true, hyper: true, usesUrl: true, columnTypes: {}, usesMultirow: !!multirow } }
    mediaCtxs.set(cx, partial)
  }
  partial.doc = doc
  return partial as unknown as Ctx
}
const mediaCtxs = new WeakMap<FrameCtx, { doc?: DocState } & Record<string, unknown>>()

/** \includegraphics number n (graphics.ts); with pdfTeX, a file not read before (by its name, page and box) is
 *  \pdfximage'd: an object */
function graphic(cx: FrameCtx, doc: DocState, n: number, lineWidth: number, units: { em: number; ex: number }): Node[] {
  const out = graphicAt(mediaCtx(cx, doc), n, lineWidth, units)
  const seen = cx.media.ximages
  if (cx.media.driver !== "pdftex" || !seen) return out
  const name = (function find(nodes: Node[]): string | undefined {
    for (const x of nodes) if (x.kind === "hlist" || x.kind === "vlist") { const f = x.image ?? find(x.list); if (f) return f }
  })(out)!
  const options = cx.media.prepared.graphics[n].options.match(/\b(?:page|pagebox)\s*=[^,]*/g) ?? []
  const key = [name, ...options.map((o) => o.replace(/\s/g, ""))].join(":")
  if (!seen.has(key)) { seen.add(key); pdfObjects(cx.pgf.s) }
  const image = cx.media.images.get(name)
  if (image && "kind" in image && (image.kind === "pdf" || image.objects)) cx.media.ximageObjects = true
  return out
}

/** minipage number n (boxes.ts): its paragraphs, \centering and friends, \\ and what source.ts took out (beamer's
 *  \caption, a minipage's footnotes, lists and blocks are not read there) */
function minipage(cx: FrameCtx, doc: DocState, n: number, size: SizeCommand, attrs: FontAttrs, sfcodes: Record<number, number> | undefined, outer: TabularOuter): Node[] {
  const m = cx.media.prepared.minipages[n]
  if (m.sub) throw new Unsupported(`beamer: a sub${m.sub}`)
  if (/\\(?:caption|captionof|captionsetup|label)(?![A-Za-z])/.test(m.body)) throw new Unsupported("beamer: a caption or \\label in a minipage")
  plainText(m.body.replace(/\\(?:centering|raggedright|raggedleft)(?![A-Za-z])|\\\\|\\par(?![A-Za-z])/g, ""))
  return minipageAt(mediaCtx(cx, doc), n, size, attrs, sfcodes, outer)
}

/** the frame's \vbox (\beamer@framebox) as it is being built: its list, with \prevdepth */
type FrameList = VerticalList

/** A handler for one construct in a frame: it reads `text` (from the construct on) and returns what it did not read. */
type FrameHandler = (cx: FrameCtx, v: FrameList, text: string) => string

/** The text font: beamer's \familydefault is \sfdefault (OT1 cmss) */
export const SANS: FontAttrs = { enc: "OT1", fam: "cmss", ser: "m", shape: "n" }
/** \verbatim@font: \normalfont\ttfamily */
const TT: FontAttrs = { enc: "OT1", fam: "cmtt", ser: "m", shape: "n" }
/** the commands a frame's paragraph may hold (each with one argument of text) */
const TEXT_COMMANDS = ["textbf", "textmd", "textit", "textsl", "textsc", "textup", "textrm", "textsf", "texttt", "emph", "alert", "structure",
  // (and the placeholders of what source.ts took out, which \leavevmode)
  "LXgraphic", "LXtabular", "LXminipage", "LXurl", "LXhref", "LXverb"]

/** How a paragraph is set where it differs from the frame's: the size, \hsize, \leftskip and \rightskip, \sloppy (the em
 *  of the font where it was set, for its \emergencystretch 3em), and what follows the indentation box and comes before \par */
export interface ParagraphSetting { size?: SizeCommand; /** the font's attributes, when not the frame's (a theorem's \itshape) */ attrs?: FontAttrs; hsize?: number; parShape?: [number, number][]; leftskip?: GlueSpec; rightskip?: GlueSpec; sloppy?: number; start?: Node[]; end?: Node[]
  /** false: no indentation box (\@doendpe's \everypar takes it off, \@item's puts the labels in its place) */
  indent?: boolean
  /** the text ended in a space that stays (something other than \par follows it) */
  trailingSpace?: boolean
  /** \centering: \leftskip and \rightskip \@flushglue, \parfillskip zero, \finalhyphendemerits zero */
  align?: "centering" }

/** Paragraph text broken into lines in the sans serif text font (ragged right, \textwidth wide, unless `s` says
 *  otherwise); its trace goes to cx.decisions. */
export function setParagraph(cx: FrameCtx, text: string, s: ParagraphSetting = {}): Node[] {
  return breakParagraph(cx, paragraphSetup(cx, text, s), s)
}

/** The paragraph as paragraphSetup reads it, broken into lines */
function breakParagraph(cx: FrameCtx, { t, doc, opts }: ReturnType<typeof paragraphSetup>, s: ParagraphSetting): Node[] {
  if (DISPLAY.test(t)) throw new Unsupported("beamer: a display here")
  const { list, params, notes } = adapted(() => paragraphInput(t, cx.k, s.size ?? "normalsize", doc, opts))
  const { vlist, trace } = lineBreak(list, params)
  cx.decisions.push(...notes, trace)
  return vlist
}

/** A paragraph appended to `v` after \parskip (its lines \baselineskip apart, by default the size's), as setParagraph
 *  breaks it; one with displays (\[ \], equation, align …) as LaTeX's displays.ts sets them, amsmath's, with
 *  hyperref's implicit=false (no anchors) */
export function addParagraph(cx: FrameCtx, v: VerticalList, text: string, s: ParagraphSetting, parskip: GlueSpec, baselineskip?: GlueSpec) {
  const size = s.size ?? "normalsize"
  // (its footnotes read: here a paragraph may have them)
  const setup = paragraphSetup(cx, readFootnotes(cx, text, size), s)
  const { t, doc, opts } = setup
  if (!DISPLAY.test(t)) { v.paragraph(breakParagraph(cx, setup, s), parskip, baselineskip ?? cx.k.sizes[size].baselineskip); return }
  if (baselineskip && baselineskip !== cx.k.sizes[size].baselineskip) throw new Unsupported("beamer: a display in a paragraph another size ends")
  adapted(() => listParagraphWithDisplays(displayCtx(cx, v, doc), t, opts, parskip, size))
}

/** What displays.ts reads of the document's state, for a frame: amsmath without hyperref's anchors, the equation
 *  counter (\resetcounteronoverlays: each slide of a frame starts it where the frame does), the normal font */
function displayCtx(cx: FrameCtx, v: VerticalList, doc: DocState): Ctx {
  const eq = cx.equations
  const counters = { get equation() { return eq.n }, set equation(n: number) { eq.n = n }, the: (n: number) => String(n), href: () => "", crefPrefix: () => "" }
  const partial = { pre: { amsmath: true, hyper: false }, run: { k: cx.k, tagFlag: false, hyperItem: false, items: 0 }, v, doc, decisions: cx.decisions,
    counters, refs: { href: "" }, romanFont: selectFont(cx.k, "normalsize", SANS), counted: (t: string) => t }
  return partial as unknown as Ctx
}

/** The paragraph adapter's own errors, for what it does not read, as Unsupported */
function adapted<T>(f: () => T): T {
  try { return f() } catch (e) {
    if (e instanceof Error && e.message.startsWith("paragraph adapter")) throw new Unsupported(`beamer: ${e.message}`)
    throw e
  }
}

/** The text as the paragraph reads it, the document state it reads it with, and its options */
function paragraphSetup(cx: FrameCtx, text: string, s: ParagraphSetting): { t: string; doc: DocState; opts: ParagraphOptions } {
  plainText(text)
  // (\alert and \structure: \textcolor with the driver's spec)
  const doc: DocState = { footnote: 0, xcolor: true, smuggle: (n) => cx.smuggled[n], color: (spec, model) => { if (model !== "LXdriver") throw new Unsupported("beamer: \\textcolor"); return spec },
    graphic: (n, lineWidth, units) => graphic(cx, doc, n, lineWidth, units), tabular: (n, size, attrs, sfcodes, outer) => tabularAt(mediaCtx(cx, doc), n, size, attrs, sfcodes, outer),
    minipage: (n, size, attrs, sfcodes, outer) => minipage(cx, doc, n, size, attrs, sfcodes, outer),
    verb: (n, size, _attrs, state) => {
      if (!cx.fragile) throw new Unsupported("beamer: \\verb in a frame that is not fragile")
      const v = cx.media.prepared.verbatims[n]
      return verbNodes(v.lines[0], v.star, selectFont(cx.k, size, TT), state)
    },
    url: (n, size, attrs, penalties, color) => urlAt(mediaCtx(cx, doc), n, size, attrs, penalties, color), href: (n, text, color) => hrefAt(mediaCtx(cx, doc), n, text, color) }
  // beamerbaseoverlay.sty's \emph: {\itshape #1}, no italic correction
  let t = alerts(cx, text), prev = ""
  while (t !== prev) { prev = t; t = t.replace(/\\emph\s*\{([^{}]*)\}/g, "{\\itshape $1}") }
  // (an empty group after the space keeps it from being the paragraph's last glue)
  if (s.trailingSpace) t = `${t.trimEnd()} {}`
  const opts: ParagraphOptions = { attrs: s.attrs ?? SANS, groups: true, amsmath: true }
  if (s.hsize !== undefined) opts.hsize = s.hsize
  if (s.parShape) opts.parShape = s.parShape
  if (s.leftskip) opts.leftSkip = spec("leftskip", s.leftskip)
  if (s.rightskip) opts.rightSkip = spec("rightskip", s.rightskip)
  if (s.sloppy !== undefined) Object.assign(opts, sloppy(s.sloppy))
  if (s.align === "centering") Object.assign(opts, centering())
  if (s.start || s.indent === false) opts.start = [...(s.indent === false ? [] : [emptyBox("hlist", cx.k.dimens.parindent)]), ...(s.start ?? [])]
  if (s.end) opts.end = s.end
  return { t, doc, opts }
}

/** The text up to a blank line, and what follows */
const upToBlankLine = (text: string): [string, string] => {
  const end = text.search(/\n[ \t]*\n/)
  return end < 0 ? [text, ""] : [text.slice(0, end), text.slice(end)]
}

/** the lists a paragraph's text may run into */

/** A paragraph of text up to a blank line, a list or a block: broken into lines in the frame's \hsize (\textwidth),
 *  ragged right. A list's \begin pushes the list's body color in the paragraph, then \@trivlist ends it (\unskip\par:
 *  the push is last, so a space before it stays). After a list, \@doendpe's \everypar takes the indentation box off.
 *  A block's \begin ends it too (blocks.ts): its overlay specials smuggled past the last space, which \par takes. */
const paragraph: FrameHandler = (cx, v, text) => {
  let [par, rest] = upToBlankLine(text)
  // (\caption's \par ends it, and \vfill's and \vspace's in horizontal mode, which put their skips after the paragraph)
  const cap = par.search(/\\(?:caption|vfill|vspace)(?![A-Za-z])/)
  if (cap > 0) {
    if (/^\\vspace/.test(par.slice(cap))) throw new Unsupported("beamer: \\vspace in a paragraph")
    rest = par.slice(cap) + rest; par = par.slice(0, cap)
  }
  const at = par.search(LIST_BEGIN), block = par.search(BLOCK_BEGIN), center = par.search(/\\begin\{(?:center|figure|table)\}|\\LXverbatim\{/)
  const s: ParagraphSetting = {}
  if (cx.align && (at >= 0 || block >= 0)) throw new Unsupported("beamer: a list or a block after \\centering")
  if (cx.align && /\\footnote(?![A-Za-z])/.test(par)) throw new Unsupported("beamer: \\footnote after \\centering")
  // (\@trivlist in horizontal mode: \unskip\par; figure's and table's \par first)
  if (center >= 0 && (at < 0 || center < at) && (block < 0 || center < block)) { rest = par.slice(center) + rest; par = par.slice(0, center).trimEnd() }
  else if (block >= 0 && (at < 0 || block < at)) {
    rest = par.slice(block) + rest
    s.end = blockInParagraph(cx, rest)
    par = par.slice(0, block).trimEnd()
  } else if (at >= 0) {
    rest = par.slice(at) + rest
    par = par.slice(0, at)
    s.end = [colorPush(useColor(cx.theme, par.startsWith("\\begin{description}", at) ? "description body" : "itemize/enumerate body", outerColors(cx.theme)).fg)]
    if (/\s$/.test(par)) s.trailingSpace = true
    cx.listInParagraph = true
  }
  // (\@doendpe's \everypar would run in the tabular's group)
  if (cx.endpe && /^\s*\\LX(?:tabular|minipage)\{/.test(par)) throw new Unsupported("beamer: a tabular or minipage right after a list")
  if (cx.endpe) { s.indent = false; cx.endpe = false }
  if (cx.itemStart) { s.indent = false; s.start = cx.itemStart; cx.itemStart = undefined }
  if (cx.size) s.size = cx.size
  if (!cx.align) { addParagraph(cx, v, overlayText(cx.overlay, par, cx.smuggled), s, cx.k.glue.parskip); return rest }
  // \\ under \centering (\@centercr): \unskip\par, \addvspace{-\parskip}; the next paragraph begins with \everypar's
  // indentation box
  const lines = centercrLines(par)
  lines.forEach((line, i) => {
    const last = i === lines.length - 1
    // (nothing after the last \\: no paragraph)
    if (last && i && !line.trim()) return
    addParagraph(cx, v, overlayText(cx.overlay, line, cx.smuggled), { ...(i ? {} : s), align: cx.align }, cx.k.glue.parskip)
    if (!last) v.addvspace(negate(cx.k.glue.parskip))
  })
  return rest
}

/** The text's lines as \\ (outside braces and math) ends them */
function centercrLines(text: string): string[] {
  const out: string[] = []
  let at = 0
  for (let i = 0; i < text.length; ) {
    if (text[i] === "{") { const a = bracedArg(text, i); i = a!.end; continue }
    if (text[i] === "$") { const j = text.indexOf("$", i + 1); if (j < 0) throw new Unsupported("an unbalanced $"); i = j + 1; continue }
    if (text.startsWith("\\\\", i)) {
      if (/^\\\\\s*[*[]/.test(text.slice(i))) throw new Unsupported("beamer: \\\\* or \\\\[skip] after \\centering")
      out.push(text.slice(at, i)); i += 2; at = i; continue
    }
    i += text[i] === "\\" ? 2 : 1
  }
  out.push(text.slice(at))
  return out
}

/** An overlay command in vertical mode (overlays.ts): the specials it begins with go on the frame's list (smuggled past
 *  a skip that ends it); what takes its place is read next */
const overlay: FrameHandler = (cx, v, text) => {
  const c = overlayCommand(cx.overlay, text, cx.smuggled)
  if (c.begin) smuggle(v, c.begin)
  return c.text + text.slice(c.end)
}

/** the specials an overlay command's \LXsmuggle{n} stands for, reached in vertical mode */
const smuggled: FrameHandler = (cx, v, text) => {
  const m = text.match(/^\\LXsmuggle\{(\d+)\}/)!
  smuggle(v, cx.smuggled[Number(m[1])])
  return text.slice(m[0].length)
}

/** itemize, enumerate and description (lists.ts); a paragraph right after one comes with \@endpetrue */
const list: FrameHandler = (cx, v, text) => {
  const kind = text.match(/^\\begin\{(itemize|enumerate|description)\}/)![1] as ListKind
  // [<spec>]: the items' default overlay specification (\beamerdefaultoverlayspecification, <*> giving none)
  const { body, spec, widest, rest } = listSource(kind, text.slice(kind.length + 8))
  frameList(cx, v, kind, body, cx.listInParagraph === true, spec, undefined, widest)
  cx.listInParagraph = false
  cx.endpe = !/^[ \t]*\n[ \t]*\n/.test(rest)
  return rest
}

/** Text with only TEXT_COMMANDS in it (and their arguments' text) and \quad: anything else throws Unsupported. */
function plainText(text: string) {
  // (math is read by the math parser, which throws on what it does not know; beamer's \mathrm is cmr, which it has no
  // family for)
  if (/\\mathrm(?![A-Za-z])/.test(text)) throw new Unsupported("beamer: \\mathrm")
  // (\href's text: an argument, as a text command's)
  let t = text.replace(new RegExp(DISPLAY.source, "g"), "").replace(/\$[^$]*\$/g, "").replace(/\\LXhref\{\d+\}/g, "\\textrm"), prev = ""
  const arg = new RegExp(`\\\\(?:${TEXT_COMMANDS.join("|")})\\s*\\{([^{}]*)\\}`, "g")
  while (t !== prev) { prev = t; t = t.replace(arg, "$1") }
  // (and the empty groups and placeholders overlay commands leave)
  const bad = t.replace(/\\quad(?![A-Za-z])|\\ |\\,|\\%|\{\}|\\hfill(?![A-Za-z])|\\LX(?:smuggle|graphic|tabular|minipage|url|verb)\{\d+\}/g, "").match(/\\[A-Za-z]+|\\.|[{}$&#^_]/)
  if (bad) throw new Unsupported(`beamer: ${bad[0]} in a frame`)
}

/** \raggedright between paragraphs: what beamer.cls set already (\rightskip\@flushglue, \leftskip and \parindent zero) */
const raggedright: FrameHandler = (cx, _v, text) => {
  // (after \centering, \parfillskip and \finalhyphendemerits stay zero)
  if (cx.align) throw new Unsupported("beamer: \\raggedright after \\centering")
  return text.replace(/^\\raggedright(?![A-Za-z])/, "")
}

/**
 * A verbatim environment (verbatim.ts) in a fragile frame: \@trivlist's \@topsep and the item's \addpenalty
 * \@beginparpenalty \addvspace\@topsep (as center's), \vskip\parskip, then each line a paragraph (\parskip zero) in
 * the \textwidth, \leftskip and \rightskip zero, the first one with the item's labels, each followed by
 * \penalty\interlinepenalty; then \endtrivlist, and the text after it comes with \@endpetrue
 */
const verbatim: FrameHandler = (cx, v, text) => {
  const m = text.match(/^\\LXverbatim\{(\d+)\}/)!
  if (!cx.fragile) throw new Unsupported("beamer: verbatim in a frame that is not fragile")
  // (\@doendpe's \everypar and \par give way to \@item's and \@verbatim's in its group, then to its own \@doendpe's)
  cx.endpe = false
  if (cx.align || cx.size) throw new Unsupported("beamer: verbatim after \\centering or a size declaration")
  const { k } = cx, g = k.glue, d = k.dimens
  if (g.partopsep.width || g.partopsep.stretch || g.partopsep.shrink) throw new Unsupported("beamer: verbatim with \\partopsep")
  const src = cx.media.prepared.verbatims[Number(m[1])]
  v.addpenalty(-LOW_PENALTY)
  v.addvspace(addGlue(g.topsep, g.parskip))
  v.vskip(g.parskip)
  const labels = hpack([glue(0), glue(-0), glue(-d.labelsep), hpack([colorPush(outerColors(cx.theme).fg), colorPop()], { exactly: 0 }), glue(d.labelsep)])
  verbatimLines(src.lines, src.star, selectFont(k, "normalsize", TT)).forEach((nodes, i) => {
    const { vlist, trace } = lineBreak([i ? emptyBox("hlist", d.parindent) : labels, ...nodes], { ...classParams(k), leftSkip: zeroskip("leftskip"), rightSkip: zeroskip("rightskip"), parFillSkip: flushglue("parfillskip") })
    cx.decisions.push(trace)
    v.paragraph(vlist, dimen(0))
    v.nodes.push(penalty(k.ints.interlinepenalty))
  })
  v.endtrivlist(g.parskip, g.parskip, g.topsep)
  const rest = text.slice(m[0].length)
  cx.endpe = !/^[ \t]*\n[ \t]*\n/.test(rest)
  return rest
}

/** \vfill between paragraphs: \vskip\z@\@plus1fill */
const vfill: FrameHandler = (_cx, v, text) => {
  v.nodes.push(fillGlue())
  return text.replace(/^\\vfill(?![A-Za-z])/, "")
}

/** \vspace{skip} between paragraphs (latex.ltx's \@vspace in vertical mode): \vskip skip \vskip\z@skip */
const vspace: FrameHandler = (cx, v, text) => {
  const m = text.match(/^\\vspace(?![A-Za-z])\s*/)!
  if (text[m[0].length] === "*") throw new Unsupported("beamer: \\vspace*")
  const a = bracedArg(text, m[0].length)
  if (!a) throw new Unsupported("\\vspace without a braced argument")
  const font = selectFont(cx.k, cx.size ?? "normalsize", SANS)
  let g: GlueSpec
  try { g = parseGlue(a.arg, { em: font.params[QUAD], ex: font.params[X_HEIGHT] }) } catch { throw new Unsupported(`beamer: \\vspace{${a.arg}}`) }
  v.vskip(g)
  v.vskip(dimen(0))
  return text.slice(a.end)
}

/** \tiny … \Huge between paragraphs: for the paragraphs after it, to the end of the frame */
const sizeHandler: FrameHandler = (cx, _v, text) => {
  const m = text.match(/^\\([A-Za-z]+)/)!
  cx.size = m[1] as SizeCommand
  return text.slice(m[0].length)
}

/** \centering between paragraphs: for the paragraphs after it, to the end of the frame */
const centeringHandler: FrameHandler = (cx, _v, text) => {
  cx.align = "centering"
  return text.replace(/^\\centering(?![A-Za-z])/, "")
}

/**
 * center (latex.ltx's \center: \trivlist\centering\item\relax, LaTeX's own \item): \@trivlist's \@topsep (\topsep, with
 * \partopsep in vertical mode, plus \parskip; \parsep is \parskip), the item's \addpenalty\@beginparpenalty
 * \addvspace\@topsep \addvspace{-\parskip}, then its paragraphs centered (the first with \box\@labels: the empty
 * label in \sbox, the color in force pushed, in \hbox to\labelwidth, zero, between \hskip-\labelsep and
 * \hskip\labelsep; and \penalty\z@, its indentation box taken off); then \endtrivlist and \@endparenv, and the text
 * after it comes with \@endpetrue
 */
const center: FrameHandler = (cx, v, text) => {
  const begin = "\\begin{center}".length, end = envEnd(text, "center", begin)
  if (end < 0) throw new Unsupported("beamer: center not ended")
  centerEnv(cx, v, text.slice(begin, end), false)
  const rest = text.slice(end + "\\end{center}".length)
  cx.endpe = !/^[ \t]*\n[ \t]*\n/.test(rest)
  return rest
}

/** center's list (`nobreaks`: with \nobreak after its \begin and before its \end, as beamer's figure and table have it) */
function centerEnv(cx: FrameCtx, v: VerticalList, text: string, nobreaks: boolean) {
  // (\@doendpe's \everypar, with \@item's after it)
  if (cx.endpe) throw new Unsupported("beamer: center right after a list")
  const { k } = cx, g = k.glue, d = k.dimens
  if (g.partopsep.width || g.partopsep.stretch || g.partopsep.shrink) throw new Unsupported("beamer: center with \\partopsep")
  const topsepadd = g.topsep, parsep = g.parskip
  const align = cx.align, size = cx.size
  v.addpenalty(-LOW_PENALTY)
  // (\addvspace{-\parskip} adds nothing: beamer's \parskip is zero)
  v.addvspace(addGlue(topsepadd, g.parskip))
  // (\trivlist: \labelwidth, \leftmargin and \itemindent zero)
  const labels = hpack([glue(0), glue(-0), glue(-d.labelsep), hpack([colorPush(outerColors(cx.theme).fg), colorPop()], { exactly: 0 }), glue(d.labelsep)])
  if (nobreaks) v.nodes.push(penalty(10000))
  cx.align = "centering"
  // (the first paragraph: \everypar's labels in place of the indentation box)
  cx.itemStart = [labels, penalty(0)]
  frameContent(cx, v, text)
  // (\endtrivlist's \leavevmode for an item with no paragraph)
  if (cx.itemStart) throw new Unsupported("beamer: a center with no text")
  cx.align = align; cx.size = size
  if (nobreaks) v.nodes.push(penalty(10000))
  v.endtrivlist(parsep, g.parskip, topsepadd)
}

/** figure and table (beamerbaselocalstructure.sty): not floats, \par\nobreak\begin{center}\nobreak, the material, then
 *  \par\nobreak\end{center} (and table's \nobreak); \caption numbers them. Their [placement] is read, unused. The text
 *  after them comes with \@endpetrue (\end{center}'s \@doendpe in their group sets it again). */
const float: FrameHandler = (cx, v, text) => {
  const kind = text.match(/^\\begin\{(figure|table)\}/)![1] as "figure" | "table"
  let i = kind.length + 8
  const o = text.slice(i).match(/^\s*\[[^\]]*\]/)
  if (o) i += o[0].length
  const end = envEnd(text, kind, i)
  if (end < 0) throw new Unsupported(`beamer: ${kind} not ended`)
  if (cx.captype) throw new Unsupported(`beamer: a ${kind} in a ${cx.captype}`)
  v.nodes.push(penalty(10000))
  cx.captype = kind
  centerEnv(cx, v, text.slice(i, end), true)
  cx.captype = undefined
  if (kind === "table") v.nodes.push(penalty(10000))
  const rest = text.slice(end + kind.length + 6)
  cx.endpe = !/^[ \t]*\n[ \t]*\n/.test(rest)
  return rest
}

/**
 * \caption[short]{text} in a figure or table (beamerbaselocalstructure.sty, its short form ignored): \refstepcounter
 * (hyperref's implicit=false: no anchor), then \@caption's \par\nobreak, \@parboxrestore and \beamer@makecaption:
 * \nobreak\vskip\abovecaptionskip\nobreak, the caption template (beamerinnerthemedefault.sty's: {the caption name's
 * color and font, \insertcaptionname, the label separator :\ }\insertcaption) as \usebeamertemplate** has it (in the
 * caption's font and, after normal text's, color) in \sbox (the color in force pushed), \hb@xt@\hsize{\hfil the box
 * \hfil} when it is not wider than \hsize, \nobreak\vskip\belowcaptionskip\nobreak; then \par\nobreak
 */
const caption: FrameHandler = (cx, v, text) => {
  const m = text.match(/^\\caption(?![A-Za-z])\s*/)!
  if (!cx.captype) throw new Unsupported("beamer: \\caption outside figure or table")
  let i = m[0].length
  if (text[i] === "[") { const j = text.indexOf("]", i); if (j < 0) throw new Unsupported("\\caption's short form"); i = j + 1 }
  const a = bracedArg(text, i)
  if (!a) throw new Unsupported("\\caption without a braced argument")
  if (/^\s*\\label(?![A-Za-z])/.test(text.slice(a.end))) throw new Unsupported("beamer: \\label")
  const { k, theme } = cx
  // (\c@figure and \c@table, which the default template does not print, are not kept)
  const normal = outerColors(theme), at = useColor(theme, "caption", normal), nameColors = useColor(theme, "caption name", at)
  const size = fontSize(theme, k, "caption", "normalsize"), nameSize = fontSize(theme, k, "caption name", size)
  const doc: DocState = { footnote: 0 }, state = { spaceFactor: 1000 }
  const name = cx.captype === "figure" ? "Figure" : "Table"
  plainText(a.arg)
  const box = hpack([colorPush(normal.fg), colorPush(normal.fg), colorPush(at.fg), colorPush(nameColors.fg), ...hlistInput(`${name}:`, k, nameSize, doc, SANS, state, true), colorPop(),
    ...hlistInput(`\\ ${a.arg.trim()}`, k, size, doc, SANS, state, true), colorPop(), colorPop(), colorPop()])
  const hsize = k.dimens.textwidth
  const skip = dimen(7 * 65536) // \abovecaptionskip and \belowcaptionskip
  v.nodes.push(penalty(10000), penalty(10000))
  v.vskip(skip)
  v.nodes.push(penalty(10000))
  if (box.width <= hsize) v.box(hpack([filGlue(), box, filGlue()], { exactly: hsize }), k.sizes.normalsize.baselineskip)
  else {
    // wider: the template in vertical mode, then \par: the colors' pushes there, the paragraph (\@parboxrestore's
    // \parskip and \leftskip zero and \sloppy, the template's \raggedright) from \insertcaptionname on, in the caption's
    // size, the pops after it
    v.nodes.push(colorPush(normal.fg), colorPush(at.fg), colorPush(nameColors.fg))
    const name0 = hlistInput(`${name}:`, k, nameSize, doc, SANS, { spaceFactor: 1000 }, true)
    addParagraph(cx, v, `\\ ${a.arg.trim()}`, { size, start: [...name0, colorPop()], leftskip: dimen(0), rightskip: k.glue.rightskip, sloppy: selectFont(k, "normalsize", SANS).params[QUAD] }, dimen(0))
    v.nodes.push(colorPop(), colorPop())
  }
  v.nodes.push(penalty(10000))
  v.vskip(skip)
  v.nodes.push(penalty(10000), penalty(10000))
  return text.slice(a.end)
}

/** A braced argument at text[i] (after spaces): its text and where it ends, or null when no { is there */
export function bracedArg(text: string, i: number): { arg: string; end: number } | null {
  while (/\s/.test(text[i] ?? "")) i++
  if (text[i] !== "{") return null
  let depth = 0
  for (let j = i; j < text.length; j++) {
    if (text[j] === "\\") { j++; continue }
    if (text[j] === "{") depth++
    else if (text[j] === "}" && --depth === 0) return { arg: text.slice(i + 1, j), end: j + 1 }
  }
  throw new Unsupported("an argument not closed")
}

/** \frametitle[short]{title} and \framesubtitle{subtitle} (beamerbaselocalstructure.sty): they keep the text (an empty
 *  one changes nothing) for the title box the frame builds at its end; in vertical mode they add nothing. */
const frametitle: FrameHandler = (cx, _v, text) => {
  const m = text.match(/^\\(frametitle|framesubtitle)(?![A-Za-z])\s*/)!
  let i = m[0].length
  if (m[1] === "frametitle" && text[i] === "[") { const j = text.indexOf("]", i); if (j < 0) throw new Unsupported("\\frametitle's short title"); i = j + 1 }
  const a = bracedArg(text, i)
  if (!a) throw new Unsupported(`\\${m[1]} without a braced argument`)
  if (a.arg.trim()) cx[m[1] === "frametitle" ? "title" : "subtitle"] = a.arg
  return text.slice(a.end)
}

/** A beamercolorbox in vertical mode: the box after interline glue */
const colorbox: FrameHandler = (cx, v, text) => {
  let i = "\\begin{beamercolorbox}".length, options = ""
  if (text[i] === "[") { const j = text.indexOf("]", i); if (j < 0) throw new Unsupported("beamercolorbox's options"); options = text.slice(i + 1, j); i = j + 1 }
  const name = bracedArg(text, i)
  if (!name) throw new Unsupported("beamercolorbox without its color")
  const end = text.indexOf("\\end{beamercolorbox}", name.end)
  if (end < 0) throw new Unsupported("a beamercolorbox not ended")
  const body = text.slice(name.end, end)
  if (body.includes("\\begin{beamercolorbox}")) throw new Unsupported("a beamercolorbox in a beamercolorbox")
  // (\@doendpe's \everypar would take the indentation box off the box's first paragraph)
  if (cx.endpe) throw new Unsupported("beamer: a beamercolorbox right after a list")
  const { k, theme } = cx
  const font = selectFont(k, "normalsize", SANS)
  const o = colorboxOptions(options, k, lengthEnv(k, font.params[QUAD], font.params[X_HEIGHT]))
  const bs = k.sizes.normalsize.baselineskip
  const box = beamercolorbox(k, theme, name.arg.trim(), o, outerColors(theme), (b) => {
    // \@arrayparboxrestore's \sloppy, then \leavevmode\ignorespaces: the body's paragraphs (the first one begun already)
    const pars = body.split(/\n[ \t]*\n/).map((p) => p.trim()).filter(Boolean)
    if (!pars.length) pars.push("")
    for (const par of pars) boxParagraph(b.v, setParagraph(cx, par, { hsize: b.hsize, leftskip: b.leftskip, rightskip: b.rightskip, sloppy: font.params[QUAD] }), bs)
  }, cx)
  v.box(box, bs)
  return text.slice(end + "\\end{beamercolorbox}".length)
}

/** block, alertblock, exampleblock, the theorems and proof (blocks.ts) */
const blocks: FrameHandler = (cx, v, text) => frameBlock(cx, v, text)

/** \titlepage, and \maketitle (\titlepage in a frame) */
const titlepage: FrameHandler = (cx, v, text) => {
  if (cx.endpe) throw new Unsupported("beamer: a title page right after a list")
  titlePage(cx, v)
  return text.replace(/^\\(?:titlepage|maketitle)(?![A-Za-z])/, "")
}

/** \tableofcontents (sections.ts), and \tableofcontents[currentsection] */
const toc: FrameHandler = (cx, v, text) => {
  if (cx.endpe) throw new Unsupported("beamer: a table of contents right after a list")
  // [currentsection] alone
  const m = text.match(/^\\tableofcontents(?![A-Za-z])(?:\s*\[([^\]]*)\])?/)!
  if (m[1] !== undefined && m[1].trim() !== "currentsection") throw new Unsupported(`beamer: \\tableofcontents[${m[1]}]`)
  tableOfContents(cx, v, m[1] !== undefined)
  return text.slice(m[0].length)
}

/** \pause and \pause[n] between paragraphs (overlays.ts) */
const pauseHandler: FrameHandler = (cx, v, text) => {
  const m = text.match(/^\\pause(?![A-Za-z])\s*(?:\[\s*(\d+)\s*\])?/)!
  pause(cx.overlay, v, m[1] === undefined ? undefined : Number(m[1]))
  return text.slice(m[0].length)
}

/** The constructs a frame holds, by what starts them ("" for text, read as a paragraph). */
const FRAME_CONTENT: Record<string, FrameHandler> = { "": paragraph, LXverbatim: verbatim, vfill, vspace, ...Object.fromEntries(SIZE_COMMANDS.map((n) => [n, sizeHandler])), raggedright, centering: centeringHandler, center, figure: float, table: float, caption, frametitle, framesubtitle: frametitle, beamercolorbox: colorbox, itemize: list, enumerate: list, description: list, titlepage, maketitle: titlepage, tableofcontents: toc, pause: pauseHandler,
  ...Object.fromEntries(BLOCK_NAMES.map((n) => [n, blocks])), columns: (cx, v, text) => frameColumns(cx, v, text),
  only: overlay, alt: overlay, temporal: overlay, uncover: overlay, visible: overlay, invisible: overlay, onslide: overlay, LXsmuggle: smuggled }

/** the constructs read under \centering */
const ALIGNED = ["", "caption", "vfill", "vspace", ...SIZE_COMMANDS, "raggedright", "centering", "center", "frametitle", "framesubtitle", "pause", "only", "alt", "temporal", "uncover", "visible", "invisible", "onslide", "LXsmuggle"]

/** The constructs in `text`, each read by its handler into `v` */
export function frameContent(cx: FrameCtx, v: FrameList, text: string) {
  for (text = text.trim(); text; text = text.trim()) {
    const m = text.match(/^\\(?:begin\{)?([A-Za-z]+)/)
    const name = m && !TEXT_COMMANDS.includes(m[1]) ? m[1] : ""
    const handler = FRAME_CONTENT[name]
    if (!handler) throw new Unsupported(`beamer: \\${m![1]} in a frame`)
    // (what \centering's \leftskip, \rightskip, \parfillskip and \finalhyphendemerits do to other constructs is not modeled)
    if (cx.align && !ALIGNED.includes(name)) throw new Unsupported(`beamer: \\${name} after \\centering`)
    // (what a size declaration does to other constructs is not modeled)
    if (cx.size && !["", "vfill", "vspace", "centering", ...SIZE_COMMANDS].includes(name)) throw new Unsupported(`beamer: \\${name} after a size declaration`)
    // (an item's labels go in the next paragraph)
    if (cx.itemStart && !["", "centering", "caption", "vfill", "vspace", ...SIZE_COMMANDS].includes(name)) throw new Unsupported(`beamer: \\${name} first in a center`)
    text = handler(cx, v, text)
  }
}

/** A paragraph begun already (\leavevmode) where `text` starts: the paragraph handler reads up to its end (text, or
 *  nothing before a list or a block), unless something else comes first */
export function begunParagraph(cx: FrameCtx, v: FrameList, text: string): string {
  const t = text.trim()
  const m = t.match(/^\\(?:begin\{)?([A-Za-z]+)/)
  const name = m && !TEXT_COMMANDS.includes(m[1]) ? m[1] : ""
  if (name && !["itemize", "enumerate", "description", ...BLOCK_NAMES].includes(name)) throw new Unsupported(`beamer: \\${name} where a paragraph has begun`)
  return paragraph(cx, v, t)
}

/** The frame's material, as \beamer@frameslide's \vbox reads it: \vskip-\parskip\vbox{}, then each construct. */
function frameMaterial(cx: FrameCtx, body: string): Node[] {
  // \beamer@checkframetitle: a { right after \begin{frame} is the frame title, a second one the subtitle
  const title = /^[ \t]*\n?[ \t]*\{/.test(body) ? bracedArg(body, 0) : null
  if (title) {
    body = body.slice(title.end)
    if (title.arg.trim()) cx.title = title.arg
    const sub = /^[ \t]*\n?[ \t]*\{/.test(body) ? bracedArg(body, 0) : null
    if (sub) { body = body.slice(sub.end); if (sub.arg.trim()) cx.subtitle = sub.arg }
  }
  const v: FrameList = new VerticalList(cx.k)
  v.nodes = []
  v.prevDepth = null // a \vbox begins with \prevdepth -1000pt
  v.vskip(negate(cx.k.glue.parskip))
  v.box(emptyBox("vlist"), cx.k.sizes.normalsize.baselineskip)
  frameContent(cx, v, body)
  // \end{beamer@framepauses}: \beamer@endpause, then what waits for the group's end
  smuggle(v, groupEnd(cx.overlay, true))
  return v.nodes
}

/** \beamer@frametopskip and \beamer@framebottomskip for the frame's placement (beamerbaseframe.sty's c and t keys) */
function placement(k: ClassOptionData, centered: boolean): { top: GlueSpec; bottom: GlueSpec } {
  const fill = (n: number): GlueSpec => ({ width: 0, stretch: n, stretchOrder: FILL, shrink: 0, shrinkOrder: 0 })
  if (centered) return { top: fill(65536), bottom: fill(98304) } // 0pt plus 1fill, 0pt plus 1.5fill
  // .2cm plus .5\paperheight, 0pt plus 1fill
  return { top: { width: parseDimen(".2cm", { em: 0, ex: 0 }), stretch: times(".5", k.dimens.paperheight), stretchOrder: 0, shrink: 0, shrinkOrder: 0 }, bottom: fill(65536) }
}

/**
 * The frame's box: \vbox to\textheight{\nobreak\vbox{}\nobreak\par\nobreak (entry code)\nobreak\nointerlineskip
 * (title)\nobreak\vskip\beamer@frametopskip\nobreak\nointerlineskip (zoom)\nointerlineskip\nobreak, the material,
 * \vskip\beamer@framebottomskip}. `centered` is the class's c or t, which the frame's own options override.
 */
export function frameBox(cx: FrameCtx, f: FrameSource, centered: boolean): BoxNode {
  for (const o of f.options.split(",").map((s) => s.trim()).filter(Boolean)) {
    if (o === "c" || o === "t") centered = o === "c"
    // fragile (\beamer@doexternalframe): the environment's lines, up to \end{frame}, written to the .vrb file (the first
    // line without a space it begins with, a frame title after \begin{frame} as \frametitle{…}) and read back by
    // \frame{\begingroup\input{….vrb}\endgroup}: what TeX reads is the same text, now with verbatim material in it
    else if (/^fragile(?:\s*=\s*(?:true|false))?$/.test(o)) { if (!o.endsWith("false")) cx.fragile = true }
    else throw new Unsupported(`a frame's option ${o}`)
  }
  if (cx.fragile && f.command) throw new Unsupported("beamer: \\frame[fragile]")
  // (what \beamer@doexternalframe's \@gobble and first line make of text on \begin{frame}'s line, but a title, is not
  // modeled)
  if (cx.fragile && !/^[ \t]*(?:\{|\n|$)/.test(f.body)) throw new Unsupported("beamer: text after \\begin{frame}[fragile] on its line")
  const { top, bottom } = placement(cx.k, centered)
  cx.centered = centered
  // the material first, then the title's box (\setbox\beamer@frametitlebox after the frame's \vbox is read)
  const material = frameMaterial(cx, f.body)
  const list: Node[] = [penalty(10000), emptyBox("vlist"), penalty(10000), penalty(10000), penalty(10000)]
  if (cx.title !== undefined) list.push(...frameTitle(cx, cx.title, cx.subtitle))
  list.push(penalty(10000), plain(top), penalty(10000), penalty(10000), ...material, plain(bottom), ...footnoteArea(cx))
  return vpack(list, { exactly: cx.k.dimens.textheight })
}
