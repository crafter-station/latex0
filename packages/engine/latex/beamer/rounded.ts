// beamer's rounded boxes (beamerbaseboxes.sty's beamerboxesrounded, without bgopacity), which the
// rounded inner theme's blocks and a beamercolorbox with rounded=true are: in a \vbox, \vskip4bp, the head
// (a [b] minipage of the box's width, in the upper color's fg) after a pgfpicture that fills the head's
// rounded top in upper.bg (lower.bg when the head is empty, a box of height 1.5pt), then, below a head,
// a picture with the vertical shading bmb@transition from lower.bg to upper.bg clipped to the box's width,
// then the body (a [b] minipage after \vskip2pt, in the lower color's fg) after a picture that fills its
// rounded bottom in lower.bg, and \vskip2bp. The pictures use the old syntax's bounding box (each of size
// zero but the transition's); the spaces between their commands are \glue 0.0 there, as the .sty's lines
// end. With shadow=true (the rounded inner theme's option, Madrid's default) the box's end first declares
// the shadow's shadings, the ones named after the box's size again each time, and a fading of the box's
// size (pgf/fadings.ts: under dvips at the top of the page, under pdfTeX a form and, at its first use, the
// mask /pgfsmask<N>); the bottom's picture then fills, in a scope, the shadow's rectangle through that
// fading before the bottom, and \vskip4bp minus 2bp ends the box. Line numbers cite beamerbaseboxes.sty.

import { printScaled } from "../../layout/arith"
import { parseDimen } from "../../layout/dimen"
import type { Font } from "../../layout/font"
import { glue, type BoxNode, type Node } from "../../layout/nodes"
import { hpack, vpack } from "../../layout/pack"
import { toNumber } from "../../pgf/fixed"
import { pgfDeclareFading, pgfSetFading } from "../../pgf/fadings"
import { pgfSetColor, pgfSetFillColor } from "../../pgf/graphicstate"
import { pgfPathCurveTo, pgfPathLineTo, pgfPathRectangle, pgfUsePath } from "../../pgf/paths"
import { pgfPoint, pgfPointOrigin } from "../../pgf/points"
import { pgfPathQCurveTo, pgfPathQMoveTo } from "../../pgf/quick"
import { beginPgfPicture, beginPgfScope, endPgfPicture, endPgfScope } from "../../pgf/scopes"
import { pgfText, type PgfTextOption } from "../../pgf/shapes"
import { pgfTransformShift } from "../../pgf/transformations"
import { pgfDeclareShading, pgfUseShading } from "../../pgf/shade"
import { Unsupported } from "../unsupported"
import { VerticalList } from "../vlist"
import { colorPop, colorPush } from "../xcolor"
import type { FrameCtx } from "./frame"
import { useColor, type ColorState } from "./theme"

/** What a rounded box is made of: its upper and lower beamer colors, its width, whether it has a shadow, and what its
 *  head and body minipages hold (`head` null: \beamerboxesrounded{}'s empty head) */
export interface RoundedBox { upper: string; lower: string; width: number; shadow: boolean; head: ((v: VerticalList) => void) | null; body: (v: VerticalList) => void }

const pt = (x: number) => `${printScaled(x)}pt`
const bp = (x: string) => parseDimen(x, { em: 0, ex: 0 })

/** \begin{minipage}[b]{width}: a \vbox (as wide as what it holds) begun with \prevdepth -1000pt, its last skip taken off
 *  (\endminipage's \unskip); `fill` gets the list */
function minipage(cx: FrameCtx, fill: (v: VerticalList) => void): BoxNode {
  const v = new VerticalList(cx.k)
  v.nodes = []
  v.prevDepth = null
  fill(v)
  if (v.nodes.at(-1)?.kind === "glue") v.nodes.pop()
  return vpack(v.nodes)
}

/**
 * The box (36–259) where `at` is in force, in the font `f` (the pictures' em and ex, which their lengths do not use):
 * its \vbox
 */
export function roundedBox(cx: FrameCtx, at: ColorState, f: Font, b: RoundedBox): BoxNode {
  const { theme, pgf } = cx
  const { s, d } = pgf
  const upper = useColor(theme, b.upper, at), lower = useColor(theme, b.lower, at)
  pgf.color("lower.bg", lower.bg)
  pgf.color("upper.bg", upper.bg)
  const w = b.width, dima = w + bp("2.2bp"), dimb = w + bp("4bp")
  const point = (x: string, y: string) => () => pgfPoint(s, x, y)
  // the head (55–75): \hbox{\begin{minipage}[b]{width}\usebeamercolor[fg]{upper}#2\end{minipage}}
  let head = hpack([minipage(cx, (v) => { v.nodes.push(colorPush(upper.fg)); b.head?.(v); v.nodes.push(colorPop()) })])
  const empty = head.width === 0
  if (empty) {
    head = { ...hpack([]), height: bp("1.5pt") }
  } else {
    const raise = Math.max(head.depth, bp("1.5pt"))
    // \hbox{\raise…\hbox{\box\bmb@box}}, \bmb@box's width set first
    head = { ...hpack([{ ...hpack([{ ...head, width: w }]), shift: -raise }]), depth: 0 }
  }
  // 79–107: \hbox{the picture\copy\bmb@box}
  const top = pgf.picture(f, at.fg, ["0bp", `+-${pt(head.height)}`, "0bp", `+-${pt(head.height)}`], () => {
    s.space()
    s.out.push(colorPush(empty ? lower.bg : upper.bg))
    pgfPathQMoveTo(s, "-4bp", "-1bp")
    s.space()
    pgfPathQCurveTo(s, "-4bp", "1.2bp", "-2.2bp", "3bp", "0bp", "3bp")
    s.space()
    pgfPathLineTo(s, point(pt(w), "3bp"))
    s.space()
    pgfPathCurveTo(s, point(pt(dima), "3bp"), point(pt(dimb), "1.2bp"), point(pt(dimb), "-1bp"))
    const bottom = -head.height - bp("2pt")
    pgfPathLineTo(s, point(pt(dimb), pt(bottom)))
    s.space()
    pgfPathLineTo(s, point("-4bp", pt(bottom)))
    s.space()
    pgfUsePath(s, d, ["fill"])
    return 1
  })
  const out: Node[] = [glue(bp("4bp")), hpack([...top, head]), glue(-bp("1pt"))]
  // 110–124: below a head, the transition
  if (!empty) {
    const transition = pgf.picture(f, at.fg, ["0pt", "0pt", pt(w), "6pt"], () => {
      s.space()
      pgfPathRectangle(s, point("-4bp", "-1bp"), point(pt(w + bp("8bp")), "8bp"))
      s.space()
      pgfUsePath(s, d, ["clip"])
      s.begingroup()
      pgfTransformShift(s, point("-4bp", "0bp"))
      pgfText(s, d, { hlist: () => pgf.nodes(() => { const p = s.inPicture; s.inPicture = false; pgfUseShading(s, d, "bmb@transition", pgf.colors); s.inPicture = p }) }, [["left"], ["base"]], "")
      s.endgroup()
      return 0
    })
    out.push(hpack(transition), glue(-bp("0.5pt")))
  }
  // 125–133, 138–143: the body, raised by its depth and .5pt
  const mini = hpack([minipage(cx, (v) => { v.nodes.push(glue(bp("2pt")), colorPush(lower.fg)); b.body(v); v.nodes.push(colorPop()) })])
  const body = { ...hpack([{ ...hpack([mini]), shift: -(mini.depth + bp(".5pt")) }]), depth: 0 }
  // 144–147: \bmb@boxheight
  const height = body.height + bp("4bp") + (empty ? -bp("4.5pt") : head.height)
  const mask = b.shadow ? shadowFading(cx, f, w, height) : ""
  // 210–242: \hbox{the picture\box\bmb@box}; \bmb@colorbox's \pgfsetcolor{lower.bg} under \pgfpicturetrue
  const bottom = pgf.picture(f, at.fg, ["0bp", "0bp", "0bp", "0bp"], () => {
    s.space()
    if (b.shadow) {
      // 212–221: the shadow, black through the fading
      beginPgfScope(s, d)
      s.space()
      pgfSetFillColor(d, pgf.colors.spec("beamer@safeblack"), true)
      pgfPathRectangle(s, point("0bp", "-7bp"), point(`${pt(w)}+8bp`, `${pt(height)}+6bp`))
      s.space()
      pgfSetFading(s, d, mask, () => pgfTransformShift(s, point(`0.5*${pt(w)}+6bp`, `0.5*${pt(height)}-4bp`)))
      s.space()
      pgfUsePath(s, d, ["fill"])
      endPgfScope(s, d)
      s.space()
    }
    pgfSetColor(d, lower.bg, false)
    pgfPathQMoveTo(s, "-4bp", "1bp")
    s.space()
    pgfPathQCurveTo(s, "-4bp", "-1.2bp", "-2.2bp", "-3bp", "0bp", "-3bp")
    s.space()
    pgfPathLineTo(s, point(pt(w), "-3bp"))
    s.space()
    pgfPathCurveTo(s, point(pt(dima), "-3bp"), point(pt(dimb), "-1.2bp"), point(pt(dimb), "1bp"))
    s.begingroup()
    s.space()
    pgfPathLineTo(s, point(pt(dimb), pt(body.height)))
    s.space()
    pgfPathLineTo(s, point("-4bp", pt(body.height)))
    s.space()
    pgfUsePath(s, d, ["fill"])
    s.endgroup()
    s.space()
    return 0
  })
  // 243–247
  out.push(hpack([...bottom, body]), b.shadow ? glue(bp("4bp"), 0, 0, bp("2bp")) : glue(bp("2bp")))
  return vpack(out)
}

/** the shadow's shadings' stops (151–170) */
const BALL = "color(0bp)=(pgftransparent!50); color(4bp)=(pgftransparent!100) "
const LARGE = "color(0bp)=(pgftransparent!0); color(8bp)=(pgftransparent!100) "
const VERT = "color(0bp)=(pgftransparent!100); color(8bp)=(pgftransparent!0) "

/**
 * The shadow of a box `w` wide and `height` high (\bmb@boxwidth, \bmb@boxheight) in the font `f` (148–206): its
 * shadings declared, then in \selectcolormodel{gray} the fading bmb@shadowmask<w><height> (a picture of the shadings
 * at the corners and along the edges, the box's inside black, then \hskip4bp); its name. The spaces at the ends of
 * the lines are in vertical mode there (none) or in the fading's pictures (\glue 0.0).
 */
function shadowFading(cx: FrameCtx, f: Font, w: number, height: number): string {
  const { pgf } = cx
  const { s, d, colors } = pgf
  const W = pt(w), H = pt(height)
  const point = (x: string, y: string) => () => pgfPoint(s, x, y)
  pgf.font(f)
  const declared = pgf.nodes(() => {
    pgfDeclareShading(s, d, "radial", "", "bmb@shadowball", pgfPointOrigin, BALL, colors)
    pgfDeclareShading(s, d, "radial", "", "bmb@shadowballlarge", pgfPointOrigin, LARGE, colors)
    pgfDeclareShading(s, d, "horizontal", "", `bmb@shadowhorz${H}`, `${H}-5.5bp`, LARGE, colors)
    pgfDeclareShading(s, d, "vertical", "", `bmb@shadowvert${W}`, `${W}-4bp`, VERT, colors)
  })
  if (declared.length) throw new Unsupported("beamer: a shadow's shadings left material")
  // \pgftext[options]{\pgfuseshading{name}}, the shading outside the picture (\pgfinterruptpicture)
  const shading = (options: PgfTextOption[], name: string) => pgfText(s, d, { hlist: () => pgf.nodes(() => {
    s.inPicture = false
    pgfUseShading(s, d, name, colors)
    s.inPicture = true
  }) }, options, "")
  const mask = `bmb@shadowmask${toNumber(w)}pt${toNumber(height)}pt`
  // (\selectcolormodel{gray}: the fading's colours, white, black and pgftransparent's, are gray already)
  pgfDeclareFading(s, d, mask, (white) => {
    beginPgfPicture(s, d, white)
    shading([["at", point("4bp", "4bp")]], "bmb@shadowball")
    if (height > bp("9.5bp")) {
      shading([["at", point(W, "8bp")]], "bmb@shadowballlarge")
      shading([["at", point(`${W}+4bp`, `${H}+2bp`)]], "bmb@shadowball")
      shading([["base"], ["at", point(`${W}+4bp`, "7.5bp")]], `bmb@shadowhorz${H}`)
    } else shading([["at", point(W, "4bp")]], "bmb@shadowball")
    shading([["left"], ["at", point("4bp", "4bp")]], `bmb@shadowvert${W}`)
    // the inside, clipped away from the shadow (187–201)
    beginPgfScope(s, d)
    s.space()
    pgfSetColor(d, colors.spec("beamer@safeblack"), true)
    s.space()
    pgfPathRectangle(s, point("4bp", "8.1bp"), point(W, `${H}-2bp`))
    s.space()
    pgfUsePath(s, d, ["fill"])
    endPgfScope(s, d)
    s.space()
    endPgfPicture(s, d)
    s.out.push(glue(bp("4bp")))
  }, colors)
  return mask
}

/** a rounded box's shadow= value: true or false (and nothing else) */
export function shadowValue(value: string): boolean {
  if (value !== "true" && value !== "false") throw new Unsupported(`beamer: a rounded box's shadow=${value}`)
  return value === "true"
}
