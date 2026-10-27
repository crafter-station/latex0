// beamer's frames (beamerbaseframe.sty, beamerbaseframesize.sty): the frame
// environment and the \frame command, each one slide here (no overlays). The
// slide's material is a \vbox (\beamer@framebox) that the frame then puts in
// \vbox to\textheight with \nobreak's, the frame title (none yet), the top skip
// of its placement ([c] or [t]) and, after it, the bottom skip
// (\beamer@autobreakframebox). What the frame holds is read by the handlers in
// FRAME_CONTENT, one per construct; a construct none reads throws Unsupported.

import type { ClassOptionData } from "../../layout/classdata"
import { parseDimen, type GlueSpec } from "../../layout/dimen"
import { lineBreak } from "../../layout/linebreak"
import { emptyBox, FILL, glue, penalty, type BoxNode, type Node } from "../../layout/nodes"
import { vpack } from "../../layout/pack"
import { times } from "../setspace"
import type { ParagraphTrace } from "../../trace/decisions"
import { paragraphInput, type DocState, type FontAttrs } from "../paragraph"
import { Unsupported } from "../unsupported"
import { negate, plain, VerticalList } from "../vlist"

/** a frame as written: its options and what it holds */
export interface FrameSource { options: string; body: string }

/** The frames of the document body: \begin{frame}[options]…\end{frame} and \frame[options]{…}, nothing else. */
export function framesOf(body: string): FrameSource[] {
  const src = body.replace(/(^|[^\\])%.*$/gm, "$1")
  const frames: FrameSource[] = []
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
      frames.push({ options: o, body: src.slice(i, end) })
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
      frames.push({ options: o, body: src.slice(i + 1, j) })
      i = j + 1
    } else throw new Unsupported(`beamer: material outside frames: ${src.slice(i, i + 40)}`)
  }
}

/** What reading a frame's material needs: the class, the paragraphs' traces in the order TeX breaks them. */
export interface FrameCtx { k: ClassOptionData; decisions: ParagraphTrace[] }

/** the frame's \vbox (\beamer@framebox) as it is being built: its list, with \prevdepth */
type FrameList = VerticalList

/** A handler for one construct in a frame: it reads `text` (from the construct on) and returns what it did not read. */
type FrameHandler = (cx: FrameCtx, v: FrameList, text: string) => string

/** The text font: beamer's \familydefault is \sfdefault (OT1 cmss) */
const SANS: FontAttrs = { enc: "OT1", fam: "cmss", ser: "m", shape: "n" }
/** the commands a frame's paragraph may hold (each with one argument of text) */
const TEXT_COMMANDS = ["textbf", "textmd", "textit", "textsl", "textsc", "textup", "textrm", "textsf", "texttt", "emph"]

/** A paragraph of text up to a blank line: broken into lines in the frame's \hsize (\textwidth), ragged right. */
const paragraph: FrameHandler = (cx, v, text) => {
  const end = text.search(/\n[ \t]*\n/)
  const par = end < 0 ? text : text.slice(0, end)
  plainText(par)
  const doc: DocState = { footnote: 0, xcolor: true }
  // beamerbaseoverlay.sty's \emph: {\itshape #1}, no italic correction
  let t = par, prev = ""
  while (t !== prev) { prev = t; t = t.replace(/\\emph\s*\{([^{}]*)\}/g, "{\\itshape $1}") }
  const { list, params, notes } = paragraphInput(t, cx.k, "normalsize", doc, { attrs: SANS, groups: true })
  const { vlist, trace } = lineBreak(list, params)
  cx.decisions.push(...notes, trace)
  v.paragraph(vlist, cx.k.glue.parskip)
  return end < 0 ? "" : text.slice(end)
}

/** Text with only TEXT_COMMANDS in it (and their arguments' text): anything else throws Unsupported. */
function plainText(text: string) {
  let t = text, prev = ""
  const arg = new RegExp(`\\\\(?:${TEXT_COMMANDS.join("|")})\\s*\\{([^{}]*)\\}`, "g")
  while (t !== prev) { prev = t; t = t.replace(arg, "$1") }
  const bad = t.match(/\\[A-Za-z]+|\\.|[{}$&#^_]/)
  if (bad) throw new Unsupported(`beamer: ${bad[0]} in a frame`)
}

/** \raggedright between paragraphs: what beamer.cls set already (\rightskip\@flushglue, \leftskip and \parindent zero) */
const raggedright: FrameHandler = (_cx, _v, text) => text.replace(/^\\raggedright(?![A-Za-z])/, "")

/** The constructs a frame holds, by what starts them ("" for text, read as a paragraph). */
const FRAME_CONTENT: Record<string, FrameHandler> = { "": paragraph, raggedright }

/** The frame's material, as \beamer@frameslide's \vbox reads it: \vskip-\parskip\vbox{}, then each construct. */
function frameMaterial(cx: FrameCtx, body: string): Node[] {
  // \beamer@checkframetitle: a { right after \begin{frame} opens the frame title
  if (/^\s*\{/.test(body)) throw new Unsupported("a frame title")
  const v: FrameList = new VerticalList(cx.k)
  v.nodes = []
  v.prevDepth = null // a \vbox begins with \prevdepth -1000pt
  v.vskip(negate(cx.k.glue.parskip))
  v.box(emptyBox("vlist"), cx.k.sizes.normalsize.baselineskip)
  for (let text = body.trim(); text; text = text.trim()) {
    const m = text.match(/^\\(?:begin\{)?([A-Za-z]+)/)
    const handler = FRAME_CONTENT[m && !TEXT_COMMANDS.includes(m[1]) ? m[1] : ""]
    if (!handler) throw new Unsupported(`beamer: \\${m![1]} in a frame`)
    text = handler(cx, v, text)
  }
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
  const list: Node[] = [penalty(10000), emptyBox("vlist"), penalty(10000), penalty(10000), penalty(10000), penalty(10000), plain(top), penalty(10000), penalty(10000)]
  list.push(...frameMaterial(cx, f.body), plain(bottom))
  return vpack(list, { exactly: cx.k.dimens.textheight })
}
