// \titlepage (beamerbasetitle.sty) with the default inner theme's templates
// (beamerinnerthemedefault.sty): \usebeamertemplate*{title page}, which is \vbox{}
// \vfill, then in a group \centering, the title (and subtitle), \vskip1em, the author,
// the institute and the date, each in a beamercolorbox [sep=8pt,center] in its own
// font and color, \vskip0.5em, the (empty) title graphic, and \vfill.

import type { SizeCommand } from "../../layout/classdata"
import { parseDimen } from "../../layout/dimen"
import { QUAD, X_HEIGHT } from "../../layout/font"
import { emptyBox, fillGlue } from "../../layout/nodes"
import { today } from "../frontmatter"
import { selectFont } from "../paragraph"
import { Unsupported } from "../unsupported"
import { dimen, type VerticalList } from "../vlist"
import { colorPush } from "../xcolor"
import { beamercolorbox, boxParagraph, colorboxOptions, lengthEnv, resetColor, type ColorboxBody } from "./colorbox"
import { SANS, setParagraph, type FrameCtx } from "./frame"
import { fontSize, outerColors, useColor, type ColorState } from "./theme"

/** \titlepage in the frame's vertical list `v` */
export function titlePage(cx: FrameCtx, v: VerticalList) {
  const { k, theme, info } = cx
  if (theme.inner === "circles") throw new Unsupported("beamer: the circles inner theme's title page")
  const normal = selectFont(k, "normalsize", SANS)
  const env = { em: normal.params[QUAD], ex: normal.params[X_HEIGHT] }
  const bs = k.sizes.normalsize.baselineskip
  // \usebeamertemplate*{title page}: {{\usebeamerfont{title page}\usebeamercolor[fg]{title page} …}}
  const at = useColor(theme, "title page", outerColors(theme))
  const size = fontSize(theme, k, "title page", "normalsize")
  if (size !== "normalsize") throw new Unsupported("beamer: a title page font with a size")
  v.nodes.push(colorPush(at.fg))
  v.box(emptyBox("vlist"), bs)
  v.vskip(fillGlue())
  // (the rounded inner theme's title page: [colsep=-4bp,rounded=true,shadow=false] too)
  const o = colorboxOptions(`sep=8pt,center${theme.inner === "rounded" ? ",colsep=-4bp,rounded=true,shadow=false" : ""}`, k, lengthEnv(k, env.em, env.ex))
  // each template: \begin{beamercolorbox}[sep=8pt,center]{name}\usebeamerfont{name}text…\end{beamercolorbox}
  // (\sloppy is in force, but with the skips' fill every line has badness 0: its tolerance decides nothing)
  const text = (cx: FrameCtx, b: ColorboxBody, s: SizeCommand, t: string) =>
    boxParagraph(b.v, setParagraph(cx, t, { size: s, hsize: b.hsize, leftskip: b.leftskip, rightskip: b.rightskip }), k.sizes[s].baselineskip)
  const box = (name: string, fill: (b: ColorboxBody, s: SizeCommand, inner: ColorState) => void) => {
    const s = fontSize(theme, k, name, "normalsize")
    v.box(beamercolorbox(k, theme, name, o, at, (b) => fill(b, s, useColor(theme, name, at)), cx), bs)
  }
  box("title", (b, s, inner) => {
    text(cx, b, s, info.title)
    if (info.subtitle) {
      // \vskip0.25em{\usebeamerfont{subtitle}\usebeamercolor[fg]{subtitle}\insertsubtitle\par}
      const f = selectFont(k, s, SANS)
      b.v.vskip(dimen(parseDimen("0.25em", { em: f.params[QUAD], ex: f.params[X_HEIGHT] })))
      b.v.nodes.push(colorPush(useColor(theme, "subtitle", inner).fg))
      text(cx, b, fontSize(theme, k, "subtitle", s), info.subtitle)
      resetColor(b.v.nodes)
    }
  })
  v.vskip(dimen(parseDimen("1em", env)))
  // \insertauthor: \and is \quad there
  box("author", (b, s) => text(cx, b, s, info.author.replace(/\\and(?![A-Za-z])/g, "\\quad")))
  box("institute", (b, s) => text(cx, b, s, info.institute))
  box("date", (b, s) => text(cx, b, s, info.date.replace(/\\today(?![A-Za-z])\s*/g, today(cx.epoch))))
  v.vskip(dimen(parseDimen("0.5em", env)))
  // {\usebeamercolor[fg]{titlegraphic}\inserttitlegraphic\par} (no \titlegraphic: nothing between)
  v.nodes.push(colorPush(useColor(theme, "titlegraphic", at).fg))
  resetColor(v.nodes)
  v.vskip(fillGlue())
  resetColor(v.nodes)
}
