// beamer's \section and \subsection between frames (beamerbasesection.sty) and its
// \tableofcontents in a frame (beamerbasetoc.sty, with the default inner theme's
// "section in toc" and "subsection in toc" templates). A section writes, on the main
// vertical list before the next frame: its .toc line, the .nav lines that close the
// section and subsection before it and open it, its bookmark (hyperref's .out line,
// level 2, or 3 for a subsection) and its Outline anchor. \tableofcontents reads the
// .toc the last run wrote: \vspace*{-.5em}, then in a group \pause[0] and each line
// (a section after \vfill in \hbox{\vbox{…}}, a subsection a paragraph indented by
// 1.5em), each title a link to its page, then \vfill.

import type { ClassOptionData } from "../../layout/classdata"
import { parseDimen } from "../../layout/dimen"
import { QUAD, X_HEIGHT } from "../../layout/font"
import { appendText } from "../../layout/hmode"
import { lineBreak } from "../../layout/linebreak"
import { emptyBox, fillGlue, glue, paramGlue, penalty, type Node } from "../../layout/nodes"
import { hpack, vpack } from "../../layout/pack"
import { DvipsDriver } from "../../pgf/drivers/dvips"
import { PgfState } from "../../pgf/state"
import { Bookmarks, dest, HA, HS, linkBox } from "../hyperref"
import { classParams, selectFont, spec } from "../paragraph"
import { Unsupported } from "../unsupported"
import { dimen, plain, type VerticalList } from "../vlist"
import { colorPop, colorPush } from "../xcolor"
import { SANS, type FrameCtx, type SectionSource } from "./frame"
import { fontSize, outerColors, useColor } from "./theme"

/** a .toc line: \beamer@sectionintoc {section}{title}{page}{part}{toc number} or \beamer@subsectionintoc {section}
 *  {subsection}{title}{page}{part}{toc number} */
export interface TocEntry { kind: "section" | "subsection"; section: number; subsection: number; title: string; page: number }

/** The sectioning state: the counters, the pages the section and subsection began on, \lastsubsection, the
 *  \c@subsectionslide the next frame steps, the .toc lines written and the bookmarks */
export class Sections {
  section = 0
  subsection = 0
  /** \beamer@tocsectionnumber */
  tocNumber = 0
  sectionStart = 1
  subsectionStart = 1
  lastSubsection = ""
  subsectionSlide = 0
  readonly toc: TocEntry[] = []
  /** hyperref's .out is \write5 in beamer, with bookmarksopen */
  readonly bookmarks = new Bookmarks(5, "")
}

/** \beamer@hyperlink{Navigation<page>}{text}: hyperref's link with beamer's border (none) and highlight */
export const navigationLink = (text: Node[], color: string, page: number): Node[] =>
  linkBox(text, color, `[/Color [.5 .5 .5]/H /N/Border [0 0 0]BorderArrayPatch/Subtype /Link/Dest (Navigation${page}) cvn H.B /ANN pdfmark`)

/** Text a section title or a .toc line may have: no commands, braces or special characters */
function plainTitle(text: string): string {
  if (/[\\{}$&#^_~%]/.test(text)) throw new Unsupported(`beamer: commands in a section title: ${text}`)
  return text.trim().replace(/\s+/g, " ")
}

const write = (stream: string, text: string): Node => ({ kind: "whatsit", text: `\\write1{\\@writefile{${stream}}{\\protect ${text}}}` })
const nav = (text: string) => write("nav", `\\headcommand {\\protect ${text}}`)

/**
 * \section or \subsection on page `page` (\c@page: the next page shipped), its nodes on the main vertical list:
 * \addtocontents's \write's, \Hy@writebookmark's, then \hyper@anchorstart's H.S, \baselineskip H.A and /DEST
 */
export function sectionNodes(st: Sections, s: SectionSource, page: number, k: ClassOptionData): Node[] {
  const title = plainTitle(s.title), short = plainTitle(s.short)
  if (!title || !short) throw new Unsupported(`beamer: a \\${s.kind} with an empty title`)
  const out: Node[] = []
  let name: string, level: number
  if (s.kind === "section") {
    st.section++; st.subsection = 0; st.tocNumber++; st.subsectionSlide = 0; st.lastSubsection = ""
    st.toc.push({ kind: "section", section: st.section, subsection: 0, title, page })
    out.push(write("toc", `\\beamer@sectionintoc {${st.section}}{${title}}{${page}}{0}{${st.tocNumber}}`),
      nav(`\\beamer@sectionpages {${st.sectionStart}}{${page - 1}}`), nav(`\\beamer@subsectionpages {${st.subsectionStart}}{${page - 1}}`),
      nav(`\\sectionentry {${st.section}}{${short}}{${page}}{${title}}{0}`))
    st.sectionStart = page
    name = `Outline0.${st.section}`; level = 2
  } else {
    st.subsection++; st.subsectionSlide = 0; st.lastSubsection = short
    st.toc.push({ kind: "subsection", section: st.section, subsection: st.subsection, title, page })
    out.push(write("toc", `\\beamer@subsectionintoc {${st.section}}{${st.subsection}}{${title}}{${page}}{0}{${st.tocNumber}}`),
      nav(`\\beamer@subsectionpages {${st.subsectionStart}}{${page - 1}}`),
      nav(`\\beamer@subsectionentry {0}{${st.section}}{${st.subsection}}{${page}}{${short}}`))
    name = `Outline0.${st.section}.${st.subsection}.${page}`; level = 3
  }
  st.subsectionStart = page
  const bookmark = st.bookmarks.add(level, name, title)
  if (!bookmark) throw new Unsupported(`beamer: a bookmark for ${title}`)
  out.push(bookmark, HS(), HA(k.sizes.normalsize.baselineskip.width), dest(name))
  return out
}

/** \pgfsys@begininvisible\pgfsys@endinvisible (dvips) */
function invisiblePair(): Node[] {
  const d = new DvipsDriver(new PgfState())
  d.beginInvisible()
  d.endInvisible()
  return d.state.out
}

/** \beamer@smuggle{\pgfsys@begininvisible\pgfsys@endinvisible} (\beamer@@spacingcover): a \lastskip other than 0.0pt
 *  is taken off before the pair and put back after it (\vskip\lastskip: plain glue) */
export function spacingCover(v: VerticalList) {
  const i = v.nodes.findLastIndex((x) => !(x.kind === "whatsit" && x.hook))
  const last = v.nodes[i]
  if (last?.kind === "glue" && (last.width || last.stretch || last.shrink)) {
    v.nodes.splice(i, 1)
    v.nodes.push(...invisiblePair(), plain(last))
  } else v.nodes.push(...invisiblePair())
}

/**
 * \tableofcontents in the frame's vertical list `v`. \pause[0] (\onslide<0->: visible) puts an invisible pair, another
 * after the group, and makes \beamer@endpause one (at the frame's end).
 */
export function tableOfContents(cx: FrameCtx, v: VerticalList) {
  const { k, theme } = cx
  const font = selectFont(k, "normalsize", SANS)
  const bs = k.sizes.normalsize.baselineskip
  // \vspace*{-.5em}: \hrule height0pt \nobreak \vskip-.5em \vskip\z@skip, then \prevdepth as it was before the rule
  v.nodes.push({ kind: "rule", width: null, height: 0, depth: 0 }, penalty(10000))
  v.vskip(dimen(-parseDimen(".5em", { em: font.params[QUAD], ex: font.params[X_HEIGHT] })))
  v.vskip(dimen(0))
  spacingCover(v)
  cx.endpause = true
  const outer = outerColors(theme)
  // \usebeamertemplate**{… in toc}: normal text's fg and the template's pushed, its font; the title a link to its
  // page, in a paragraph (\parindent zero, beamer's \raggedright), the subsection's \leftskip 1.5em
  const entry = (e: TocEntry, name: string) => {
    if (fontSize(theme, k, name, "normalsize") !== "normalsize") throw new Unsupported(`beamer: a ${name} font with a size`)
    const color = useColor(theme, name, outer).fg
    const text: Node[] = []
    appendText(text, e.title, font, { spaceFactor: 1000 }, false)
    const leftskip = e.kind === "subsection" ? parseDimen("1.5em", { em: font.params[QUAD], ex: font.params[X_HEIGHT] }) : 0
    const { vlist, trace } = lineBreak([emptyBox("hlist", k.dimens.parindent), ...navigationLink(text, color, e.page)], { ...classParams(k), leftSkip: spec("leftskip", dimen(leftskip)) })
    cx.decisions.push(trace)
    return { color, vlist }
  }
  for (const e of cx.toc) {
    if (e.kind === "section") {
      // \vfill, then {\hbox{\vbox{the template}}\par}
      const { color, vlist } = entry(e, "section in toc")
      v.nodes.push(fillGlue())
      const inner: Node[] = [colorPush(outer.fg), colorPush(color), paramGlue("parskip", glue(0)), paramGlue("parskip", glue(0)), ...vlist, colorPop(), colorPop()]
      v.box(hpack([vpack(inner)]), bs)
    } else {
      const { color, vlist } = entry(e, "subsection in toc")
      v.nodes.push(colorPush(outer.fg), colorPush(color))
      v.paragraph(vlist, k.glue.parskip, bs)
      v.nodes.push(colorPop(), colorPop())
    }
  }
  v.nodes.push(fillGlue())
  spacingCover(v)
}
