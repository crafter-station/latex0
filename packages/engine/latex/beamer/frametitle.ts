// The frame title in the default outer theme (beamerouterthemedefault.sty's frametitle
// template), as beamerbaseframe.sty builds \beamer@frametitlebox once the frame's
// material is read: \vbox{\vbox{}{\parskip0pt\usebeamertemplate***{frametitle}
// \vskip0.25em}}, unboxed into the frame. The template is a beamercolorbox
// [sep=0.3cm,left (or right),wd=\textwidth+the margins]{frametitle} in \usebeamerfont{frametitle}:
// an empty paragraph (\vbox{}), \vskip-1ex, the title between struts, the subtitle in
// its font and color, \vskip-1ex, and \vskip-.3cm where frametitle has no bg (with
// one, the box comes after \nointerlineskip, in its bg).

import type { SizeCommand } from "../../layout/classdata"
import { parseDimen } from "../../layout/dimen"
import { QUAD, X_HEIGHT } from "../../layout/font"
import { lineBreak } from "../../layout/linebreak"
import { emptyBox, filGlue, type Node, type RuleNode } from "../../layout/nodes"
import { vpack } from "../../layout/pack"
import { classParams, selectFont, spec } from "../paragraph"
import { dimen, VerticalList } from "../vlist"
import { colorPop, colorPush } from "../xcolor"
import { beamercolorbox, boxParagraph, resetColor } from "./colorbox"
import { SANS, setParagraph, type FrameCtx } from "./frame"
import { emptyBackground, fontSize, outerColors, useColor, type ColorState } from "./theme"

/** \strut: \unhcopy\strutbox at the size, a rule of no width */
const strut = (cx: FrameCtx, size: SizeCommand): RuleNode => ({ kind: "rule", width: 0, ...cx.k.sizes[size].strut })

/**
 * The sidebar theme's frame title (beamerouterthemesidebar.sty, with a head), in the head: \nointerlineskip,
 * \vskip-\beamer@headheight, \vbox to\beamer@headheight{\vfil, \leftskip and \rightskip -the margins+0.3cm (the right
 * one plus1fil), the title and the subtitle each in its color and font after \strut (a paragraph), \vbox{}, \vskip-1em,
 * \vfil}, \vskip-0.2em; \beamer@headheight is 2.5\baselineskip in frametitle's font
 */
function sidebarTitle(cx: FrameCtx, v: VerticalList, title: string, subtitle: string | undefined, size: SizeCommand, at: ColorState) {
  const { k, theme } = cx, d = k.dimens
  const font = selectFont(k, size, SANS), em = (x: string) => parseDimen(x, { em: font.params[QUAD], ex: font.params[X_HEIGHT] })
  const bs = k.sizes[size].baselineskip
  // (2.5\baselineskip: twice it and the half TeX's \xn_over_d gives)
  const height = 2 * bs.width + Math.floor(bs.width / 2)
  v.prevDepth = null
  v.vskip(dimen(-height))
  const cm = parseDimen("0.3cm", { em: 0, ex: 0 })
  const set = { hsize: d.textwidth, leftskip: dimen(cm - d["beamer@leftmargin"]), rightskip: { ...dimen(cm - d["beamer@rightmargin"]), stretch: 65536, stretchOrder: 1 as const } }
  const inner = new VerticalList(k)
  inner.nodes = [filGlue(), colorPush(at.fg)]
  inner.prevDepth = null
  boxParagraph(inner, setParagraph(cx, title, { ...set, size, start: [strut(cx, size)] }), bs)
  inner.nodes.push(colorPop())
  if (subtitle !== undefined) {
    const sub = fontSize(theme, k, "framesubtitle", size)
    inner.nodes.push(colorPush(useColor(theme, "framesubtitle", at).fg))
    boxParagraph(inner, setParagraph(cx, subtitle, { ...set, size: sub, start: [strut(cx, sub)] }), k.sizes[sub].baselineskip)
    inner.nodes.push(colorPop())
  }
  inner.box(emptyBox("vlist"), bs)
  inner.vskip(dimen(-em("1em")))
  inner.nodes.push(filGlue())
  v.box(vpack(inner.nodes, { exactly: height }), bs)
  v.vskip(dimen(-em("0.2em")))
}

/** The title box's list, unboxed into the frame's */
export function frameTitle(cx: FrameCtx, title: string, subtitle: string | undefined): Node[] {
  const { k, theme } = cx
  const bg = !emptyBackground(theme, "frametitle")
  const size = fontSize(theme, k, "frametitle", "normalsize")
  const font = selectFont(k, size, SANS)
  const env = { em: font.params[QUAD], ex: font.params[X_HEIGHT] }
  const bs = k.sizes[size].baselineskip
  // \usebeamertemplate***{frametitle}: \usebeamercolor*[fg]{frametitle} pushes normal text's fg, then frametitle's
  const outer = outerColors(theme), at = useColor(theme, "frametitle", outer)
  const v = new VerticalList(k)
  v.nodes = []
  v.prevDepth = null
  v.box(emptyBox("vlist"), k.sizes.normalsize.baselineskip)
  v.nodes.push(colorPush(outer.fg), colorPush(at.fg))
  if (theme.sidebarHead) {
    sidebarTitle(cx, v, title, subtitle, size, at)
    // (the template's pops before its last skip, beamer's \reset@color)
    resetColor(v.nodes); resetColor(v.nodes)
    const normal = selectFont(k, "normalsize", SANS)
    v.vskip(dimen(parseDimen("0.25em", { em: normal.params[QUAD], ex: normal.params[X_HEIGHT] })))
    return v.nodes
  }
  if (bg) v.prevDepth = null // \nointerlineskip
  const d = k.dimens
  // (the template's option: left, or right: \leftskip and \rightskip 0pt plus1fill, 0pt; or the other way round)
  const fill = { width: 0, stretch: 65536, stretchOrder: 2 as const, shrink: 0, shrinkOrder: 0 as const }, right = theme.frametitle === "right"
  const o = { wd: d.textwidth + d["beamer@leftmargin"] + d["beamer@rightmargin"], leftskip: right ? fill : dimen(0), rightskip: right ? dimen(0) : fill, sep: parseDimen("0.3cm", env), colsep: 0, colseps: 0 }
  const box = beamercolorbox(k, theme, "frametitle", o, at, (b) => {
    // (\sloppy is in force, but with \rightskip's fill every line has badness 0: its tolerance decides nothing)
    const set = { hsize: b.hsize, leftskip: b.leftskip, rightskip: b.rightskip }
    // the paragraph \leavevmode began, holding \vbox{}; \vskip-1ex ends it
    const params = { ...classParams(k), hsize: b.hsize, leftSkip: spec("leftskip", b.leftskip), rightSkip: spec("rightskip", b.rightskip) }
    const empty = lineBreak([emptyBox("hlist", d.parindent), emptyBox("vlist")], params)
    cx.decisions.push(empty.trace)
    boxParagraph(b.v, empty.vlist, bs)
    b.v.vskip(dimen(-env.ex))
    boxParagraph(b.v, setParagraph(cx, title, { ...set, size, start: [strut(cx, size)], end: [strut(cx, size)] }), bs)
    if (subtitle !== undefined) {
      // {\usebeamerfont{framesubtitle}\usebeamercolor[fg]{framesubtitle}\strut\insertframesubtitle\strut\par}
      const sub = fontSize(theme, k, "framesubtitle", size)
      b.v.nodes.push(colorPush(useColor(theme, "framesubtitle", at).fg))
      boxParagraph(b.v, setParagraph(cx, subtitle, { ...set, size: sub, start: [strut(cx, sub)], end: [strut(cx, sub)] }), k.sizes[sub].baselineskip)
      b.v.nodes.push(colorPop())
    }
    b.v.vskip(dimen(-env.ex))
    if (!bg) b.v.vskip(dimen(-o.sep)) // \vskip-.3cm where frametitle has no bg
  })
  v.box(box, bs)
  v.nodes.push(colorPop(), colorPop())
  const normal = selectFont(k, "normalsize", SANS)
  v.vskip(dimen(parseDimen("0.25em", { em: normal.params[QUAD], ex: normal.params[X_HEIGHT] })))
  return v.nodes
}
