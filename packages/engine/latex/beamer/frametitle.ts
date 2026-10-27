// The frame title in the default outer theme (beamerouterthemedefault.sty's frametitle
// template), as beamerbaseframe.sty builds \beamer@frametitlebox once the frame's
// material is read: \vbox{\vbox{}{\parskip0pt\usebeamertemplate***{frametitle}
// \vskip0.25em}}, unboxed into the frame. The template is a beamercolorbox
// [sep=0.3cm,left,wd=\textwidth+the margins]{frametitle} in \usebeamerfont{frametitle}:
// an empty paragraph (\vbox{}), \vskip-1ex, the title between struts, the subtitle in
// its font and color, \vskip-1ex, and \vskip-.3cm where frametitle has no bg.

import type { SizeCommand } from "../../layout/classdata"
import { parseDimen } from "../../layout/dimen"
import { QUAD, X_HEIGHT } from "../../layout/font"
import { lineBreak } from "../../layout/linebreak"
import { emptyBox, type Node, type RuleNode } from "../../layout/nodes"
import { classParams, selectFont, spec } from "../paragraph"
import { Unsupported } from "../unsupported"
import { dimen, VerticalList } from "../vlist"
import { colorPop, colorPush } from "../xcolor"
import { beamercolorbox, boxParagraph } from "./colorbox"
import { SANS, setParagraph, type FrameCtx } from "./frame"
import { emptyBackground, fontSize, outerColors, useColor } from "./theme"

/** \strut: \unhcopy\strutbox at the size, a rule of no width */
const strut = (cx: FrameCtx, size: SizeCommand): RuleNode => ({ kind: "rule", width: 0, ...cx.k.sizes[size].strut })

/** The title box's list, unboxed into the frame's */
export function frameTitle(cx: FrameCtx, title: string, subtitle: string | undefined): Node[] {
  const { k, theme } = cx
  if (!emptyBackground(theme, "frametitle")) throw new Unsupported("a frame title with a background")
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
  const d = k.dimens
  const o = { wd: d.textwidth + d["beamer@leftmargin"] + d["beamer@rightmargin"], leftskip: dimen(0), rightskip: { width: 0, stretch: 65536, stretchOrder: 2 as const, shrink: 0, shrinkOrder: 0 as const }, sep: parseDimen("0.3cm", env), colsep: 0, colseps: 0 }
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
    b.v.vskip(dimen(-o.sep)) // \vskip-.3cm: frametitle has no bg
  })
  v.box(box, bs)
  v.nodes.push(colorPop(), colorPop())
  const normal = selectFont(k, "normalsize", SANS)
  v.vskip(dimen(parseDimen("0.25em", { em: normal.params[QUAD], ex: normal.params[X_HEIGHT] })))
  return v.nodes
}
