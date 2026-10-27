// beamer's \section and \subsection between frames (beamerbasesection.sty) and its
// \tableofcontents in a frame (beamerbasetoc.sty, with the default inner theme's
// "section in toc" and "subsection in toc" templates). A section writes, on the main
// vertical list before the next frame: its .toc line, the .nav lines that close the
// section and subsection before it and open it, its bookmark (hyperref's .out line,
// level 2, or 3 for a subsection) and its Outline anchor. \tableofcontents reads the
// .toc the last run wrote: \vspace*{-.5em}, then in a group \pause[0] and each line
// (a section after \vfill in \hbox{\vbox{…}}, a subsection a paragraph indented by
// 1.5em), each title a link to its page, then \vfill; with [currentsection] the other
// sections shaded.

import type { ClassOptionData } from "../../layout/classdata"
import { parseDimen } from "../../layout/dimen"
import { QUAD, X_HEIGHT, type Font } from "../../layout/font"
import { appendText } from "../../layout/hmode"
import { lineBreak } from "../../layout/linebreak"
import { emptyBox, filGlue, fillGlue, glue, kern, paramGlue, penalty, ssGlue, type BoxNode, type Node } from "../../layout/nodes"
import { pgfPathCircle, pgfUsePath } from "../../pgf/paths"
import { pgfPoint } from "../../pgf/points"
import { pgfText } from "../../pgf/shapes"
import { hpack, vpack } from "../../layout/pack"
import { Bookmarks, dest, HA, HS, hyperDriver, linkBox, pdfdest, pdftexLink } from "../hyperref"
import { classParams, selectFont, spec } from "../paragraph"
import { Unsupported } from "../unsupported"
import { dimen, type VerticalList } from "../vlist"
import { colorPop, colorPush, Colors } from "../xcolor"
import { SANS, type FrameCtx, type SectionSource } from "./frame"
import { groupEnd, pause, smuggle } from "./overlays"
import { fontSize, outerColors, useColor, type ColorState, type Theme } from "./theme"

/** a .toc line: \beamer@sectionintoc {section}{title}{page}{part}{toc number} or \beamer@subsectionintoc {section}
 *  {subsection}{title}{page}{part}{toc number} */
export interface TocEntry { kind: "section" | "subsection"; section: number; subsection: number; title: string; page: number }

/** \insertsectionhead's or \insertsubsectionhead's link: its text and page */
export interface Head { short: string; page: number }

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
  /** \insertsectionhead and \insertsubsectionhead: the short title, a link to the page the (sub)section began on */
  sectionHead: Head | null = null
  subsectionHead: Head | null = null
  readonly toc: TocEntry[] = []
  /** hyperref's .out is \write5 in beamer, with bookmarksopen */
  readonly bookmarks = new Bookmarks(5, "")
}

/** \beamer@hyperlink{Navigation<page>}{text}: hyperref's link with beamer's border (none) and highlight */
export const navigationLink = (text: Node[], color: string, page: number): Node[] => hyperDriver.pdftex
  ? pdftexLink(`attr{/Border[0 0 0]/H/N/C[.5 .5 .5]} action goto name{Navigation${page}}`, text)
  : linkBox(text, color, `[/Color [.5 .5 .5]/H /N/Border [0 0 0]BorderArrayPatch/Subtype /Link/Dest (Navigation${page}) cvn H.B /ANN pdfmark`)

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
    st.section++; st.subsection = 0; st.subsectionSlide = 0; st.lastSubsection = ""
    // (\section*: no .toc line, \beamer@tocsectionnumber kept)
    if (!s.star) {
      st.tocNumber++
      st.toc.push({ kind: "section", section: st.section, subsection: 0, title, page })
      out.push(write("toc", `\\beamer@sectionintoc {${st.section}}{${title}}{${page}}{0}{${st.tocNumber}}`))
    }
    out.push(nav(`\\beamer@sectionpages {${st.sectionStart}}{${page - 1}}`), nav(`\\beamer@subsectionpages {${st.subsectionStart}}{${page - 1}}`),
      nav(`\\sectionentry {${st.section}}{${short}}{${page}}{${title}}{0}`))
    st.sectionStart = page
    st.sectionHead = { short, page }; st.subsectionHead = null
    name = `Outline0.${st.section}`; level = 2
  } else {
    st.subsection++; st.subsectionSlide = 0; st.lastSubsection = short
    if (!s.star) {
      st.toc.push({ kind: "subsection", section: st.section, subsection: st.subsection, title, page })
      out.push(write("toc", `\\beamer@subsectionintoc {${st.section}}{${st.subsection}}{${title}}{${page}}{0}{${st.tocNumber}}`))
    }
    out.push(nav(`\\beamer@subsectionpages {${st.subsectionStart}}{${page - 1}}`),
      nav(`\\beamer@subsectionentry {0}{${st.section}}{${st.subsection}}{${page}}{${short}}`))
    st.subsectionHead = { short, page }
    name = `Outline0.${st.section}.${st.subsection}.${page}`; level = 3
  }
  st.subsectionStart = page
  const bookmark = st.bookmarks.add(level, name, title)
  if (!bookmark) throw new Unsupported(`beamer: a bookmark for ${title}`)
  // (\hyper@anchorstart\hyper@anchorend: hpdftex.def's \pdfdest)
  out.push(bookmark, ...(hyperDriver.pdftex ? [pdfdest(name)] : [HS(), HA(k.sizes.normalsize.baselineskip.width), dest(name)]))
  return out
}

/**
 * The rounded inner theme's ball in a .toc line (beamerbaseauxtemplates.sty 305–327), after \leavevmode and a
 * \leftskip of 2.75ex (5ex for a subsection): a section's \llap{\normalsize\begin{pgfpicture}{-1ex}{-0.7ex}{1ex}{1ex}
 * \pgftext{\beamer@usesphere{section number projected}{tocsphere}} \pgftext{\usebeamerfont*{section number projected}
 * \usebeamercolor{section number projected}\color{fg!90!bg}\inserttocsectionnumber} \end{pgfpicture}\kern1.25ex}, a
 * subsection's \llap{\raise0.1ex\beamer@usesphere{subsection number projected}{bigsphere}\kern1ex}; `at` the toc
 * template's colors. (\pgftext skips the spaces after it, and its shifts take off the one before it.)
 */
function tocBall(cx: FrameCtx, e: TocEntry, at: ColorState): BoxNode {
  const { k, theme, pgf } = cx
  const normal = selectFont(k, "normalsize", SANS)
  const ex = (x: string) => parseDimen(x, { em: normal.params[QUAD], ex: normal.params[X_HEIGHT] })
  if (e.kind === "subsection") {
    const sphere = { ...pgf.usesphere(theme, "subsection number projected", "bigsphere", normal, at), shift: -ex("0.1ex") }
    return hpack([ssGlue(), sphere, kern(ex("1ex"), true)], { exactly: 0 })
  }
  const projected = useColor(theme, "section number projected", at)
  const mix = new Colors()
  for (const [n, c] of [["fg", projected.fg], ["bg", projected.bg]]) { const [model, ...x] = c.split(" "); mix.define(n, model, x.join(",")) }
  const numberFont = selectFont(k, fontSize(theme, k, "section number projected", "normalsize"), SANS)
  const number: Node[] = []
  appendText(number, String(e.section), numberFont, { spaceFactor: 1000 }, false)
  const picture = pgf.picture(normal, at.fg, ["-1ex", "-0.7ex", "1ex", "1ex"], () => {
    pgf.s.space()
    pgfText(pgf.s, pgf.d, { hlist: () => [pgf.usesphere(theme, "section number projected", "tocsphere", normal, at)] }, [], "")
    pgfText(pgf.s, pgf.d, { hlist: () => [colorPush(mix.spec("fg!90!bg")), ...number, colorPop()] }, [], "")
    return 0
  })
  return hpack([ssGlue(), ...picture, kern(ex("1.25ex"), true)], { exactly: 0 })
}

/** the toc templates' \leftskip for a section and a subsection, by inner theme */
const TOC_LEFTSKIP: Record<Theme["inner"], [string, string]> = { default: ["0pt", "1.5em"], rounded: ["2.75ex", "5ex"], circles: ["2ex", "2em"], rectangles: ["3ex", "5ex"] }

/**
 * The circles inner theme's section number (beamerbaseauxtemplates.sty 230–242), after \leftskip=2ex: \llap{\usebeamerfont*
 * {section number projected}\usebeamercolor{section number projected}\begin{pgfpicture}{-1ex}{0ex}{1ex}{2ex} \color{bg}
 * \pgfpathcircle{\pgfpoint{0pt}{.75ex}}{1.2ex} \pgfusepath{fill} \pgftext[base]{\color{fg}\inserttocsectionnumber}
 * \end{pgfpicture}\kern1.25ex}
 */
function tocCircle(cx: FrameCtx, e: TocEntry, at: ColorState): BoxNode {
  const { k, theme, pgf } = cx
  const { s, d } = pgf
  const projected = useColor(theme, "section number projected", at)
  const f = selectFont(k, fontSize(theme, k, "section number projected", "normalsize"), SANS)
  const number: Node[] = []
  appendText(number, String(e.section), f, { spaceFactor: 1000 }, false)
  const picture = pgf.picture(f, at.fg, ["-1ex", "0ex", "1ex", "2ex"], () => {
    s.space()
    // (the spaces after \color{bg} and \pgfusepath are skipped)
    s.out.push(colorPush(projected.bg))
    pgfPathCircle(s, () => pgfPoint(s, "0pt", ".75ex"), "1.2ex")
    s.space()
    pgfUsePath(s, d, ["fill"])
    pgfText(s, d, { hlist: () => [colorPush(projected.fg), ...number, colorPop()] }, [["base"]], "")
    return 1
  })
  return hpack([ssGlue(), ...picture, kern(parseDimen("1.25ex", { em: f.params[QUAD], ex: f.params[X_HEIGHT] }), true)], { exactly: 0 })
}

/**
 * The rectangles inner theme's numbers (257–270): a section's \llap{\usebeamerfont*{section number projected}
 * \usebeamercolor[bg]{section number projected}\vrule width2.25ex height1.85ex depth.4ex\hskip-2.25ex\hbox to2.25ex{\hfil
 * \color{fg}\inserttocsectionnumber\hfil}\kern1.25ex} after \leftskip=3ex, a subsection's \llap{\usebeamercolor[bg]
 * {subsection number projected}\vrule width1ex height1ex\kern1ex} after \leftskip=5ex (in the toc's font `font`). Each \color's
 * pop comes after the box it is in.
 */
function tocSquare(cx: FrameCtx, e: TocEntry, at: ColorState, font: Font): Node[] {
  const { k, theme } = cx
  if (e.kind === "subsection") {
    const ex = font.params[X_HEIGHT]
    return [hpack([ssGlue(), colorPush(useColor(theme, "subsection number projected", at).bg), { kind: "rule", width: ex, height: ex, depth: null }, kern(ex, true)], { exactly: 0 }), colorPop()]
  }
  const projected = useColor(theme, "section number projected", at)
  const f = selectFont(k, fontSize(theme, k, "section number projected", "normalsize"), SANS)
  const ex = (x: string) => parseDimen(x, { em: f.params[QUAD], ex: f.params[X_HEIGHT] })
  const number: Node[] = [filGlue(), colorPush(projected.fg)]
  appendText(number, String(e.section), f, { spaceFactor: 1000 }, false)
  number.push(filGlue())
  return [hpack([ssGlue(), colorPush(projected.bg), { kind: "rule", width: ex("2.25ex"), height: ex("1.85ex"), depth: ex(".4ex") }, glue(-ex("2.25ex")),
    hpack(number, { exactly: ex("2.25ex") }), colorPop(), kern(ex("1.25ex"), true)], { exactly: 0 }), colorPop()]
}

/**
 * \tableofcontents in the frame's vertical list `v`. \pause[0] (\onslide<0->: shown) in its group (overlays.ts).
 * `current` ([currentsection]): the sections other than the frame's, and their subsections, shaded (the "… in toc
 * shaded" templates: the template in \begin{colormixin}{20!parent.bg}, each color mixed 20% with normal text's bg).
 */
export function tableOfContents(cx: FrameCtx, v: VerticalList, current = false) {
  const { k, theme } = cx
  const font = selectFont(k, "normalsize", SANS)
  const bs = k.sizes.normalsize.baselineskip
  // \vspace*{-.5em}: \hrule height0pt \nobreak \vskip-.5em \vskip\z@skip, then \prevdepth as it was before the rule
  v.nodes.push({ kind: "rule", width: null, height: 0, depth: 0 }, penalty(10000))
  v.vskip(dimen(-parseDimen(".5em", { em: font.params[QUAD], ex: font.params[X_HEIGHT] })))
  v.vskip(dimen(0))
  const o = cx.overlay, outerQueue = o.queue
  o.queue = 0
  pause(o, v, 0)
  const outer = outerColors(theme)
  // \usebeamertemplate**{… in toc}: normal text's fg and the template's pushed, its font; the title a link to its
  // page, in a paragraph (\parindent zero, beamer's \raggedright), the subsection's \leftskip 1.5em
  const entry = (e: TocEntry, kind: string) => {
    const shaded = current && e.section !== cx.section
    const name = `${kind} in toc${shaded ? " shaded" : ""}`
    if (fontSize(theme, k, name, "normalsize") !== "normalsize") throw new Unsupported(`beamer: a ${name} font with a size`)
    const at = useColor(theme, name, outer)
    let color = at.fg
    const pushes = [colorPush(outer.fg), colorPush(color)]
    if (shaded && theme.inner !== "default") throw new Unsupported(`beamer: the ${theme.inner} inner theme's shaded table of contents`)
    if (shaded) {
      const mix = new Colors(), def = (n: string, c: string) => { const [model, ...x] = c.split(" "); mix.define(n, model, x.join(",")) }
      def("current", color); def("parentbg", outer.bg)
      color = mix.spec("current!20!parentbg")
      pushes.push(colorPush(color))
    }
    const text: Node[] = []
    appendText(text, e.title, font, { spaceFactor: 1000 }, false)
    const env = { em: font.params[QUAD], ex: font.params[X_HEIGHT] }
    const sub = e.kind === "subsection"
    const leftskip = parseDimen(TOC_LEFTSKIP[theme.inner][sub ? 1 : 0], env)
    const llap = theme.inner === "rounded" ? [tocBall(cx, e, at)] : theme.inner === "circles" && !sub ? [tocCircle(cx, e, at)]
      : theme.inner === "rectangles" ? tocSquare(cx, e, at, font) : []
    const { vlist, trace } = lineBreak([emptyBox("hlist", k.dimens.parindent), ...llap, ...navigationLink(text, color, e.page)], { ...classParams(k), leftSkip: spec("leftskip", dimen(leftskip)) })
    cx.decisions.push(trace)
    return { pushes, vlist, pops: pushes.map(() => colorPop()) }
  }
  for (const e of cx.toc) {
    if (e.kind === "section") {
      // \vfill, then {\hbox{\vbox{the template}}\par}
      const { pushes, vlist, pops } = entry(e, "section")
      v.nodes.push(fillGlue())
      v.box(hpack([vpack([...pushes, paramGlue("parskip", glue(0)), paramGlue("parskip", glue(0)), ...vlist, ...pops])]), bs)
    } else {
      const { pushes, vlist, pops } = entry(e, "subsection")
      v.nodes.push(...pushes)
      v.paragraph(vlist, k.glue.parskip, bs)
      v.nodes.push(...pops)
    }
  }
  v.nodes.push(fillGlue())
  smuggle(v, groupEnd(o, false))
  o.queue = outerQueue
}
