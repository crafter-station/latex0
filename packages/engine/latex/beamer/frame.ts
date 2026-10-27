// beamer's frames (beamerbaseframe.sty, beamerbaseframesize.sty): the frame
// environment and the \frame command, each one slide here (no overlays). The
// slide's material is a \vbox (\beamer@framebox) that the frame then puts in
// \vbox to\textheight with \nobreak's, the frame title's box (frametitle.ts), the top skip
// of its placement ([c] or [t]) and, after it, the bottom skip
// (\beamer@autobreakframebox). What the frame holds is read by the handlers in
// FRAME_CONTENT, one per construct; a construct none reads throws Unsupported.

import type { ClassOptionData, SizeCommand } from "../../layout/classdata"
import { parseDimen, type GlueSpec } from "../../layout/dimen"
import { QUAD, X_HEIGHT } from "../../layout/font"
import { lineBreak } from "../../layout/linebreak"
import { emptyBox, FILL, glue, penalty, type BoxNode, type Node } from "../../layout/nodes"
import { vpack } from "../../layout/pack"
import { times } from "../setspace"
import type { ParagraphTrace } from "../../trace/decisions"
import { sloppy } from "../kernel"
import type { Ctx } from "../context"
import { DISPLAY } from "../blocks"
import { listParagraphWithDisplays } from "../displays"
import { paragraphInput, selectFont, spec, type DocState, type FontAttrs, type ParagraphOptions } from "../paragraph"
import { Unsupported } from "../unsupported"
import { negate, plain, VerticalList } from "../vlist"
import { colorPush } from "../xcolor"
import { alerts, BLOCK_BEGIN, BLOCK_NAMES, blockInParagraph, frameBlock } from "./blocks"
import { frameColumns } from "./columns"
import { beamercolorbox, boxParagraph, colorboxOptions, lengthEnv } from "./colorbox"
import { frameTitle } from "./frametitle"
import { frameList, LIST_BEGIN, listSource, type ListKind } from "./lists"
import type { TitleInfo } from "./preamble"
import { outerColors, useColor, type Theme } from "./theme"
import { groupEnd, overlayCommand, overlayText, pause, smuggle, type Overlay } from "./overlays"
import { tableOfContents, type TocEntry } from "./sections"
import { titlePage } from "./titlepage"

/** a frame as written: its options and what it holds */
export interface FrameSource { kind: "frame"; options: string; body: string }
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
      frames.push({ kind: "frame", options: o, body: src.slice(i + 1, j) })
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
export interface FrameCtx { k: ClassOptionData; theme: Theme; info: TitleInfo; /** the date \today prints, in seconds since 1970 */ epoch: number
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
  equations: { n: number } }

/** the frame's \vbox (\beamer@framebox) as it is being built: its list, with \prevdepth */
type FrameList = VerticalList

/** A handler for one construct in a frame: it reads `text` (from the construct on) and returns what it did not read. */
type FrameHandler = (cx: FrameCtx, v: FrameList, text: string) => string

/** The text font: beamer's \familydefault is \sfdefault (OT1 cmss) */
export const SANS: FontAttrs = { enc: "OT1", fam: "cmss", ser: "m", shape: "n" }
/** the commands a frame's paragraph may hold (each with one argument of text) */
const TEXT_COMMANDS = ["textbf", "textmd", "textit", "textsl", "textsc", "textup", "textrm", "textsf", "texttt", "emph", "alert", "structure"]

/** How a paragraph is set where it differs from the frame's: the size, \hsize, \leftskip and \rightskip, \sloppy (the em
 *  of the font where it was set, for its \emergencystretch 3em), and what follows the indentation box and comes before \par */
export interface ParagraphSetting { size?: SizeCommand; /** the font's attributes, when not the frame's (a theorem's \itshape) */ attrs?: FontAttrs; hsize?: number; parShape?: [number, number][]; leftskip?: GlueSpec; rightskip?: GlueSpec; sloppy?: number; start?: Node[]; end?: Node[]
  /** false: no indentation box (\@doendpe's \everypar takes it off, \@item's puts the labels in its place) */
  indent?: boolean
  /** the text ended in a space that stays (something other than \par follows it) */
  trailingSpace?: boolean }

/** Paragraph text broken into lines in the sans serif text font (ragged right, \textwidth wide, unless `s` says
 *  otherwise); its trace goes to cx.decisions. */
export function setParagraph(cx: FrameCtx, text: string, s: ParagraphSetting = {}): Node[] {
  const { t, doc, opts } = paragraphSetup(cx, text, s)
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
  const { t, doc, opts } = paragraphSetup(cx, text, s)
  const size = s.size ?? "normalsize"
  if (!DISPLAY.test(t)) { v.paragraph(setParagraph(cx, text, s), parskip, baselineskip ?? cx.k.sizes[size].baselineskip); return }
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
  const doc: DocState = { footnote: 0, xcolor: true, smuggle: (n) => cx.smuggled[n], color: (spec, model) => { if (model !== "LXdriver") throw new Unsupported("beamer: \\textcolor"); return spec } }
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
  const at = par.search(LIST_BEGIN), block = par.search(BLOCK_BEGIN)
  const s: ParagraphSetting = {}
  if (block >= 0 && (at < 0 || block < at)) {
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
  if (cx.endpe) { s.indent = false; cx.endpe = false }
  addParagraph(cx, v, overlayText(cx.overlay, par, cx.smuggled), s, cx.k.glue.parskip)
  return rest
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
  let t = text.replace(new RegExp(DISPLAY.source, "g"), "").replace(/\$[^$]*\$/g, ""), prev = ""
  const arg = new RegExp(`\\\\(?:${TEXT_COMMANDS.join("|")})\\s*\\{([^{}]*)\\}`, "g")
  while (t !== prev) { prev = t; t = t.replace(arg, "$1") }
  // (and the empty groups and placeholders overlay commands leave)
  const bad = t.replace(/\\quad(?![A-Za-z])|\\ |\\,|\{\}|\\LXsmuggle\{\d+\}/g, "").match(/\\[A-Za-z]+|\\.|[{}$&#^_]/)
  if (bad) throw new Unsupported(`beamer: ${bad[0]} in a frame`)
}

/** \raggedright between paragraphs: what beamer.cls set already (\rightskip\@flushglue, \leftskip and \parindent zero) */
const raggedright: FrameHandler = (_cx, _v, text) => text.replace(/^\\raggedright(?![A-Za-z])/, "")

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
  })
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
const FRAME_CONTENT: Record<string, FrameHandler> = { "": paragraph, raggedright, frametitle, framesubtitle: frametitle, beamercolorbox: colorbox, itemize: list, enumerate: list, description: list, titlepage, maketitle: titlepage, tableofcontents: toc, pause: pauseHandler,
  ...Object.fromEntries(BLOCK_NAMES.map((n) => [n, blocks])), columns: (cx, v, text) => frameColumns(cx, v, text),
  only: overlay, alt: overlay, temporal: overlay, uncover: overlay, visible: overlay, invisible: overlay, onslide: overlay, LXsmuggle: smuggled }

/** The constructs in `text`, each read by its handler into `v` */
export function frameContent(cx: FrameCtx, v: FrameList, text: string) {
  for (text = text.trim(); text; text = text.trim()) {
    const m = text.match(/^\\(?:begin\{)?([A-Za-z]+)/)
    const handler = FRAME_CONTENT[m && !TEXT_COMMANDS.includes(m[1]) ? m[1] : ""]
    if (!handler) throw new Unsupported(`beamer: \\${m![1]} in a frame`)
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
    else throw new Unsupported(`a frame's option ${o}`)
  }
  const { top, bottom } = placement(cx.k, centered)
  cx.centered = centered
  // the material first, then the title's box (\setbox\beamer@frametitlebox after the frame's \vbox is read)
  const material = frameMaterial(cx, f.body)
  const list: Node[] = [penalty(10000), emptyBox("vlist"), penalty(10000), penalty(10000), penalty(10000)]
  if (cx.title !== undefined) list.push(...frameTitle(cx, cx.title, cx.subtitle))
  list.push(penalty(10000), plain(top), penalty(10000), penalty(10000), ...material, plain(bottom))
  return vpack(list, { exactly: cx.k.dimens.textheight })
}
