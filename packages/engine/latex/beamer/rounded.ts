// beamer's rounded boxes (beamerbaseboxes.sty's beamerboxesrounded, without shadow or bgopacity), which the
// rounded inner theme's blocks and a beamercolorbox with rounded=true are: in a \vbox, \vskip4bp, the head
// (a [b] minipage of the box's width, in the upper color's fg) after a pgfpicture that fills the head's
// rounded top in upper.bg (lower.bg when the head is empty, a box of height 1.5pt), then, below a head,
// a picture with the vertical shading bmb@transition from lower.bg to upper.bg clipped to the box's width,
// then the body (a [b] minipage after \vskip2pt, in the lower color's fg) after a picture that fills its
// rounded bottom in lower.bg, and \vskip2bp. The pictures use the old syntax's bounding box (each of size
// zero but the transition's); the spaces between their commands are \glue 0.0 there, as the .sty's lines
// end. Line numbers cite beamerbaseboxes.sty.

import { printScaled } from "../../layout/arith"
import { parseDimen } from "../../layout/dimen"
import type { Font } from "../../layout/font"
import { glue, type BoxNode, type Node } from "../../layout/nodes"
import { hpack, vpack } from "../../layout/pack"
import { pgfSetColor } from "../../pgf/graphicstate"
import { pgfPathCurveTo, pgfPathLineTo, pgfPathRectangle, pgfUsePath } from "../../pgf/paths"
import { pgfPoint } from "../../pgf/points"
import { pgfPathQCurveTo, pgfPathQMoveTo } from "../../pgf/quick"
import { pgfText } from "../../pgf/shapes"
import { pgfTransformShift } from "../../pgf/transformations"
import { pgfUseShading } from "../../pgf/shade"
import { Unsupported } from "../unsupported"
import { VerticalList } from "../vlist"
import { colorPop, colorPush } from "../xcolor"
import type { FrameCtx } from "./frame"
import { useColor, type ColorState } from "./theme"

/** What a rounded box is made of: its upper and lower beamer colors, its width, and what its head and body minipages
 *  hold (`head` null: \beamerboxesrounded{}'s empty head) */
export interface RoundedBox { upper: string; lower: string; width: number; head: ((v: VerticalList) => void) | null; body: (v: VerticalList) => void }

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
  // 222–249: \hbox{the picture\box\bmb@box}; \bmb@colorbox's \pgfsetcolor{lower.bg} under \pgfpicturetrue
  const bottom = pgf.picture(f, at.fg, ["0bp", "0bp", "0bp", "0bp"], () => {
    s.space()
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
  out.push(hpack([...bottom, body]), glue(bp("2bp")))
  return vpack(out)
}

/** shadow=true (the shadow's fading) is not modeled */
export function noShadow(value: string | undefined) {
  if (value !== undefined && value !== "false") throw new Unsupported(`beamer: a rounded box's shadow=${value}`)
}
