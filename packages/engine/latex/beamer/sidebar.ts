// The sidebar outer theme's sidebar (beamerouterthemesidebar.sty), on the left: in the sidebar's
// \vbox to\sidebarheight, \vskip1.5em, the short title (a link, as \insertshorttitle's) and the
// short author, each \hskip3pt and a [t] minipage the sidebar's width less 6pt wide, centred, then
// \vskip1.25em; \insertverticalnavigation{the sidebar's width} (beamerbasenavigation.sty): the
// sections of the last run's .nav, each a link in \hbox to the width holding \vbox{\vskip1ex the
// section's beamercolorbox}, and the subsections, each a link in an \hbox holding its box (shaded but
// the current section, when in no subsection, and the current subsection); then \vfill. The right
// sidebar has only the navigation symbols.

import type { ClassOptionData, SizeCommand } from "../../layout/classdata"
import { parseDimen } from "../../layout/dimen"
import { QUAD, X_HEIGHT, type Font } from "../../layout/font"
import { appendText, spaceGlue } from "../../layout/hmode"
import { lineBreak } from "../../layout/linebreak"
import { emptyBox, fillGlue, glue, paramGlue, ssGlue, type BoxNode, type Node } from "../../layout/nodes"
import { hpack, vpack } from "../../layout/pack"
import type { ParagraphTrace } from "../../trace/decisions"
import { sloppy } from "../kernel"
import { appendToVlist, classParams, selectFont, spec } from "../paragraph"
import { dimen } from "../vlist"
import { colorPop, colorPush } from "../xcolor"
import { beamercolorbox, boxParagraph, colorboxOptions, lengthEnv, resetColor } from "./colorbox"
import { headFootBox, plain, type FootlineAt } from "./footline"
import { SANS } from "./frame"
import type { TitleInfo } from "./preamble"
import { navigationLink } from "./sections"
import { outerColors, sizedFont, useColor, type ColorState, type SizedFont, type Theme } from "./theme"

const ZERO = { width: 0, stretch: 0, stretchOrder: 0, shrink: 0, shrinkOrder: 0 } as const
const FIL = { width: 0, stretch: 65536, stretchOrder: 1 as const, shrink: 0, shrinkOrder: 0 as const }

/** \usebeamertemplate***'s colors at the outer level: normal text's fg, then the template's */
const templateColors = (t: Theme, name: string): string[] => [outerColors(t).fg, useColor(t, name, outerColors(t)).fg]

/**
 * \insertshort…[width=w,center,respectlinebreaks]: \begin{minipage}[t]{w}\raggedright\centering the text\end{minipage}:
 * a \vtop of the lines broken \centering (\leftskip and \rightskip 0pt plus1fil, \parfillskip zero), no indentation
 */
function minipage(k: ClassOptionData, text: string, { font: f, baselineskip }: SizedFont, width: number, traces: ParagraphTrace[]): BoxNode {
  const list: Node[] = [emptyBox("hlist", 0)]
  appendText(list, plain(text), f, { spaceFactor: 1000 }, false)
  const { vlist, trace } = lineBreak(list, { ...classParams(k), hsize: width, leftSkip: spec("leftskip", FIL), rightSkip: spec("rightskip", FIL), parFillSkip: spec("parfillskip", ZERO) })
  traces.push(trace)
  const lines: Node[] = []
  let prevDepth: number | null = null
  for (const n of vlist) if (n.kind === "hlist") prevDepth = appendToVlist(lines, n, prevDepth, baselineskip, k.glue.lineskip, k.dimens.lineskiplimit); else lines.push(n)
  const box = vpack(lines)
  // (\vtop: the height its first box's)
  const first = lines.find((n) => n.kind === "hlist") as BoxNode
  box.depth = box.height + box.depth - first.height
  box.height = first.height
  return box
}

/**
 * A group of the sidebar template: \usebeamerfont, \vskip (`before`), \hskip3pt (a paragraph), the color pushed, the
 * minipage (`content`), \par, \vskip1.25em; the color's pop at the group's end, before that skip
 */
function shortParagraph(k: ClassOptionData, list: Node[], prevDepth: { d: number | null }, color: string, content: Node[], { font: f, baselineskip }: SizedFont, traces: ParagraphTrace[]) {
  const em = (x: string) => parseDimen(x, { em: f.params[QUAD], ex: f.params[X_HEIGHT] })
  // (\@outputpage's \@parboxrestore: no \rightskip, no indentation)
  const { vlist, trace } = lineBreak([emptyBox("hlist", 0), glue(em("3pt")), colorPush(color), ...content], { ...classParams(k), rightSkip: spec("rightskip", ZERO) })
  traces.push(trace)
  if (list.length) list.push(paramGlue("parskip", glue(0)), paramGlue("parskip", glue(0)))
  for (const n of vlist) if (n.kind === "hlist") prevDepth.d = appendToVlist(list, n, prevDepth.d, baselineskip, ZERO, 0); else list.push(n)
  list.push(glue(em("1.25em")))
  resetColor(list)
}

/**
 * \beamer@sidebarformat{leftskip}{name}{text}: beamercolorbox[wd=the sidebar's width,leftskip=…,rightskip=1ex plus1fil,
 * vmode]{name}: \vbox{}, the text (a paragraph), \vbox{}, \vskip-1.5ex; in the font of size `size`
 */
function sidebarFormat(k: ClassOptionData, t: Theme, name: string, leftskip: string, text: string, { font: f, baselineskip: bs }: SizedFont, at: ColorState, width: number, traces: ParagraphTrace[]): BoxNode {
  const env = lengthEnv(k, f.params[QUAD], f.params[X_HEIGHT])
  return beamercolorbox(k, t, name, colorboxOptions(`wd=${width}sp,leftskip=${leftskip},rightskip=1ex plus1fil`, k, env), at, (b) => {
    b.v.box(vpack([]), bs)
    const list: Node[] = [emptyBox("hlist", 0)]
    appendText(list, plain(text), f, { spaceFactor: 1000 }, false)
    const { vlist, trace } = lineBreak(list, { ...classParams(k), hsize: b.hsize, leftSkip: spec("leftskip", b.leftskip), rightSkip: spec("rightskip", b.rightskip), ...sloppy(f.params[QUAD]) })
    traces.push(trace)
    boxParagraph(b.v, vlist, bs)
    b.v.box(vpack([]), bs)
    b.v.vskip(dimen(-parseDimen("1.5ex", env)))
  })
}

/** \insertverticalnavigation{width}, where `c` is in force (the sidebar template's colors) */
function verticalNavigation(k: ClassOptionData, t: Theme, at: FootlineAt, c: ColorState, size: SizedFont["size"], width: number, traces: ParagraphTrace[]): BoxNode {
  const now = at.heads.counters
  const boxes: BoxNode[] = []
  for (const h of at.nav) {
    if (h.kind === "section") {
      // {\usebeamerfont{section in sidebar}\usebeamercolor[fg]{section in sidebar}\hyperlink{…}{{template}}}: the
      // section's template where it is current and in no subsection
      const s = sizedFont(t, k, "section in sidebar", size), outer = useColor(t, "section in sidebar", c)
      const name = h.section === now.section && now.subsection === 0 ? "section in sidebar" : "section in sidebar shaded"
      const f = s.font
      const box = vpack([glue(parseDimen("1ex", { em: f.params[QUAD], ex: f.params[X_HEIGHT] })), sidebarFormat(k, t, name, "3pt", h.short, s, outer, width, traces)])
      boxes.push(hpack([colorPush(outer.fg), ...navigationLink([box], outer.fg, h.page), colorPop()], { exactly: width }))
    } else if (h.kind === "subsection") {
      const s = sizedFont(t, k, "subsection in sidebar", size), outer = useColor(t, "subsection in sidebar", c)
      const name = h.section === now.section && h.subsection === now.subsection ? "subsection in sidebar" : "subsection in sidebar shaded"
      // (the space after \end{beamercolorbox}, in horizontal mode there)
      const content = [sidebarFormat(k, t, name, "5pt", h.short, s, outer, width, traces), spaceGlue(s.font, 1000)]
      boxes.push(hpack([colorPush(outer.fg), ...navigationLink(content, outer.fg, h.page), colorPop()]))
    }
  }
  const list: Node[] = []
  let prevDepth: number | null = null
  // (\@outputpage's zero \baselineskip, \lineskip and \lineskiplimit)
  for (const b of boxes) prevDepth = appendToVlist(list, b, prevDepth, ZERO, ZERO, 0)
  return vpack(list)
}

/** The sidebar theme's left sidebar template's list (\usebeamertemplate***{sidebar left}), in the \vbox before its \vfil */
export function sidebarTemplate(k: ClassOptionData, t: Theme, info: TitleInfo, at: FootlineAt, traces: ParagraphTrace[]): Node[] {
  const size = sizedFont(t, k, "sidebar left", "normalsize").size, at0 = useColor(t, "sidebar left", outerColors(t))
  const width = k.dimens["beamer@leftsidebar"], inner = width - 6 * 65536
  const list: Node[] = templateColors(t, "sidebar left").map((c) => colorPush(c))
  const prevDepth: { d: number | null } = { d: null }
  // the short title: \hyperlinkpresentationend on the first page, …start on the others
  const ts = sizedFont(t, k, "title in sidebar", size), tf = ts.font
  const titleColor = useColor(t, "title in sidebar", at0).fg
  list.push(glue(parseDimen("1.5em", { em: tf.params[QUAD], ex: tf.params[X_HEIGHT] })))
  shortParagraph(k, list, prevDepth, titleColor, navigationLink([minipage(k, info.short.title, ts, inner, traces)], titleColor, at.page === 1 ? at.lastPage : 1), ts, traces)
  const as = sizedFont(t, k, "author in sidebar", size)
  shortParagraph(k, list, prevDepth, useColor(t, "author in sidebar", at0).fg, [minipage(k, info.short.author.replace(/\s*\\and(?![A-Za-z])\s*/g, ", "), as, inner, traces)], as, traces)
  appendToVlist(list, verticalNavigation(k, t, at, at0, size, width, traces), prevDepth.d, ZERO, ZERO, 0)
  // \vfill, then the template's pops (beamer's \reset@color: each before the skip that ends the list)
  list.push(fillGlue())
  resetColor(list)
  resetColor(list)
  return list
}

/** The sidebar theme's right sidebar (with the sidebar on the left): \vfill, \llap{the navigation symbols template
 *  \hskip0.1cm}, \vskip2pt; `symbols`: navigation.ts's */
export function sidebarRightTemplate(t: Theme, symbols: Node[]): Node[] {
  const llap = hpack([ssGlue(), ...templateColors(t, "navigation symbols").map((c) => colorPush(c)), ...symbols, colorPop(), colorPop(), glue(parseDimen("0.1cm", { em: 0, ex: 0 }))], { exactly: 0 })
  const list: Node[] = [...templateColors(t, "sidebar right").map((c) => colorPush(c)), fillGlue(), llap, glue(parseDimen("2pt", { em: 0, ex: 0 }))]
  resetColor(list)
  resetColor(list)
  return list
}

/**
 * The sidebar theme's headline (with a head): beamercolorbox[wd=\\paperwidth]{frametitle} holding, with the sidebar on
 * the left, \\usebeamercolor[bg]{logo}\\vrule width the sidebar's width height\\beamer@headheight, \\hskip back, \\hbox to
 * the sidebar's width{\\hss\\vbox to\\beamer@headheight{\\vss\\hbox{\\color{fg}\\insertlogo}\\vss}\\hss} (no logo: its
 * template's color only); without a sidebar \\vrule width0pt height\\beamer@headheight
 */
export function sidebarHeadline(k: ClassOptionData, t: Theme, colors: ColorState, list: Node[], decisions: ParagraphTrace[]) {
  const size = sizedFont(t, k, "headline", "normalsize")
  const ft = sizedFont(t, k, "frametitle", "normalsize").baselineskip.width
  const height = 2 * ft + Math.floor(ft / 2), width = t.sidebar ? k.dimens["beamer@leftsidebar"] : 0
  list.push(headFootBox(k, t, size.size as SizeCommand, size.size as SizeCommand, colors, decisions, "wd=\\paperwidth", "frametitle", (_f, inner) => {
    if (!t.sidebar) return { list: [{ kind: "rule", width: 0, height, depth: null }] }
    const logo = useColor(t, "logo", inner)
    const box = hpack([colorPush(logo.fg), colorPush(useColor(t, "logo", logo).fg), colorPop()])
    const v = vpack([ssGlue(), box, colorPop(), ssGlue()], { exactly: height })
    return { list: [colorPush(logo.bg), { kind: "rule", width, height, depth: null }, glue(-width), hpack([ssGlue(), v, ssGlue()], { exactly: width })], after: [colorPop()] }
  }))
}
