// The shadow outer theme (beamerouterthemeshadow.sty, Warsaw's): the split outer theme, then
// frametitle's parent subsection in head/foot and frametitle right's section in head/foot (the theme
// data has them), the horizontal shading beamer@frametitleshade between their bg's (declared with those
// colours as dependencies: made where it is used), the vertical shading beamer@topshade of pgftransparent
// 8pt high and the fading beamer@topshadowmask made of it, as the theme loads (in the preamble: under dvips
// the fading's box goes to the top of the first page, under pdfTeX it is a form made before the document's
// objects). The headline gets, after the split theme's (\addtobeamertemplate), \vskip0pt, a picture that
// fills the rectangle below it, 4pt high, through the fading, and \vskip-2pt; the frametitle template
// (shadow theme) is an \hbox holding a picture as high as the title's minipage and 2pt more (a shadow at
// its bottom through the fading, then the shading clipped to it) and that minipage over it.

import { printScaled } from "../../layout/arith"
import type { ClassOptionData, SizeCommand } from "../../layout/classdata"
import { parseDimen } from "../../layout/dimen"
import { QUAD, X_HEIGHT } from "../../layout/font"
import { spaceGlue } from "../../layout/hmode"
import { emptyBox, glue, type BoxNode, type Node, type RuleNode } from "../../layout/nodes"
import { hpack, vpack } from "../../layout/pack"
import { pgfDeclareFading, pgfSetFading } from "../../pgf/fadings"
import { pgfSetFillColor } from "../../pgf/graphicstate"
import { pgfPathRectangle, pgfUsePath } from "../../pgf/paths"
import { pgfPoint, pgfPointOrigin } from "../../pgf/points"
import { beginPgfPicture, beginPgfScope, endPgfPicture, endPgfScope } from "../../pgf/scopes"
import { pgfDeclareShading, pgfUseShading } from "../../pgf/shade"
import { pgfText } from "../../pgf/shapes"
import { selectFont } from "../paragraph"
import { Unsupported } from "../unsupported"
import { dimen, VerticalList } from "../vlist"
import { colorPop, colorPush } from "../xcolor"
import { boxParagraph } from "./colorbox"
import { SANS, setParagraph, type FrameCtx } from "./frame"
import type { BeamerPgf } from "./pgf"
import { fontSize, useColor, type ColorState } from "./theme"

const FRAMETITLE_SHADE = "beamer@frametitleshade", TOP_SHADE = "beamer@topshade", TOP_MASK = "beamer@topshadowmask"

const pt = (x: number) => `${printScaled(x)}pt`

/** What the theme declares as it loads (beamerouterthemeshadow.sty 21–31): the two shadings and the fading */
export function declareShadowTheme(pgf: BeamerPgf, k: ClassOptionData) {
  const { s, d, colors } = pgf, { paperwidth, paperheight } = k.dimens
  const left = pgf.nodes(() => {
    pgfDeclareShading(s, d, "horizontal", "frametitle.bg,frametitle right.bg", FRAMETITLE_SHADE, pt(paperheight), `color(0pt)=(frametitle.bg); color(${pt(paperwidth)})=(frametitle right.bg)`, colors)
    pgfDeclareShading(s, d, "vertical", "", TOP_SHADE, pt(2 * paperwidth), "color(0pt)=(pgftransparent!100); color(8pt)=(pgftransparent!0)", colors)
    pgfDeclareFading(s, d, TOP_MASK, () => pgfUseShading(s, d, TOP_SHADE, colors), colors)
  })
  if (left.length) throw new Unsupported("beamer: the shadow outer theme's declarations left material")
}

/**
 * What the theme adds after the headline template (33–43), where the colour `color` is in force: the picture
 * (\begin{pgfpicture} without a bounding box: the rectangle's, \paperwidth wide and 4pt high, its baseline at the
 * bottom), which begins a paragraph
 */
export function headlineShadow(pgf: BeamerPgf, k: ClassOptionData, color: string): Node[] {
  const { s, d } = pgf
  pgf.font(selectFont(k, "normalsize", SANS))
  return pgf.nodes(() => {
    beginPgfPicture(s, d, color)
    pgfPathRectangle(s, () => pgfPoint(s, "0pt", "-4pt"), () => pgfPoint(s, pt(k.dimens.paperwidth), "4pt"))
    pgfSetFading(s, d, TOP_MASK, () => {})
    pgfUsePath(s, d, ["fill"])
    endPgfPicture(s, d)
  })
}

/** \strut: \unhcopy\strutbox at the size, a rule of no width */
const strut = (cx: FrameCtx, size: SizeCommand): RuleNode => ({ kind: "rule", width: 0, ...cx.k.sizes[size].strut })

/**
 * The frametitle template (45–91) in the frame title's list `v`, in frametitle's font (of size `size`) and colors
 * `at`: \nointerlineskip, \vskip-2pt, the \hbox, \vskip-2pt. The \hbox: \hskip-\Gm@lmargin, an \hbox of the picture,
 * the space that ends its line, \hskip-\paperwidth and the title's box, then \hskip-\Gm@rmargin. The title's box is
 * a minipage [b] \paperwidth wide: \vbox{}, \vskip-.75ex, the title between struts in frametitle's fg (\leftskip
 * 0.3cm, \rightskip 0.3cm plus1fil), the subtitle in its font and color before a strut, \nointerlineskip, \vbox{}.
 */
export function shadowFrameTitle(cx: FrameCtx, v: VerticalList, title: string, subtitle: string | undefined, size: SizeCommand, at: ColorState) {
  const { k, theme, pgf } = cx, { s, d, colors } = pgf, dm = k.dimens
  const font = selectFont(k, size, SANS)
  const env = { em: font.params[QUAD], ex: font.params[X_HEIGHT] }
  const bs = k.sizes[size].baselineskip
  const cm = parseDimen("0.3cm", env)
  const set = { hsize: dm.paperwidth, leftskip: dimen(cm), rightskip: { ...dimen(cm), stretch: 65536, stretchOrder: 1 as const } }
  // the minipage
  const m = new VerticalList(k)
  m.nodes = []
  m.prevDepth = null
  m.box(emptyBox("vlist"), bs)
  m.vskip(dimen(-parseDimen(".75ex", env)))
  boxParagraph(m, setParagraph(cx, title, { ...set, size, start: [colorPush(at.fg), strut(cx, size)], end: [strut(cx, size)] }), bs)
  if (subtitle !== undefined) {
    // {\usebeamerfont*{framesubtitle}{\usebeamercolor[fg]{framesubtitle}\insertframesubtitle}\strut\par}: the color
    // set in vertical mode, its group ended in the paragraph
    const sub = fontSize(theme, k, "framesubtitle", size)
    m.nodes.push(colorPush(useColor(theme, "framesubtitle", at).fg))
    boxParagraph(m, setParagraph(cx, subtitle, { ...set, size: sub, end: [colorPop(), strut(cx, sub)] }), k.sizes[sub].baselineskip)
  }
  m.prevDepth = null // \nointerlineskip
  m.box(emptyBox("vlist"), bs)
  m.nodes.push(colorPop())
  const box: BoxNode = hpack([vpack(m.nodes)])
  const height = box.height + 2 * 65536
  // the picture: frametitle's and frametitle right's bg are the shading's colors
  const right = useColor(theme, "frametitle right", at)
  pgf.color("frametitle.bg", at.bg)
  pgf.color("frametitleright.bg", right.bg) // (xcolor takes the spaces out of a color's name: \zap@space)
  const point = (x: string, y: string) => () => pgfPoint(s, x, y)
  const picture = pgf.picture(font, at.fg, ["0pt", "0pt", pt(dm.paperwidth), pt(height)], () => {
    s.space()
    beginPgfScope(s, d)
    s.space()
    pgfSetFillColor(d, colors.spec("beamer@safeblack"), true)
    pgfPathRectangle(s, point("0pt", "-4pt"), point(pt(dm.paperwidth), "8pt"))
    pgfSetFading(s, d, TOP_MASK, () => {})
    pgfUsePath(s, d, ["fill"])
    endPgfScope(s, d)
    s.space()
    beginPgfScope(s, d)
    s.space()
    pgfPathRectangle(s, pgfPointOrigin, point(pt(dm.paperwidth), pt(height)))
    pgfUsePath(s, d, ["clip"])
    pgfText(s, d, { hlist: () => pgf.nodes(() => { s.inPicture = false; pgfUseShading(s, d, FRAMETITLE_SHADE, colors); s.inPicture = true }) }, [["left"], ["base"]], "")
    endPgfScope(s, d)
    s.space()
    return 0
  })
  v.prevDepth = null // \nointerlineskip
  v.vskip(dimen(-2 * 65536))
  v.box(hpack([glue(-dm["Gm@lmargin"]), hpack([...picture, spaceGlue(font, 1000), glue(-dm.paperwidth), box]), glue(-dm["Gm@rmargin"])]), bs)
  v.vskip(dimen(-2 * 65536))
}
