// pgf in a beamer document's pages: one PgfState for the run, as TeX keeps pgf's globals for the whole
// document (the shadings made and \pgf@shadingcount, \pgf@objectcount, pdfTeX's forms), on the document's
// driver. What pgf reads of LaTeX is set where pgf is used: the colours beamer defines with \colorlet (bg,
// parent.bg, lower.bg …: Colors, from the driver's text of each) and pgfmath's em and ex (the font in
// force). The shadings beamer declares as it loads, each with colour dependencies (made when used, once
// per combination of their colours): beamerbaseboxes.sty's bmb@transition, then beamerbaseauxtemplates.sty's
// tocsphere, bigsphere and smallsphere. A picture's nodes or a shading's box come back as nodes for the
// list they are in.

import { QUAD, X_HEIGHT, type Font } from "../../layout/font"
import type { BoxNode, Node } from "../../layout/nodes"
import type { PgfDriver } from "../../pgf/drivers"
import { pgfPoint } from "../../pgf/points"
import { beginPgfPicture, endPgfPicture } from "../../pgf/scopes"
import { pgfDeclareShading, pgfUseShading } from "../../pgf/shade"
import type { PgfState } from "../../pgf/state"
import { Unsupported } from "../unsupported"
import { colorPop, Colors } from "../xcolor"

/** the spheres beamerbaseauxtemplates.sty declares (radial, [bg,parent.bg]): centre and colour stops */
const SPHERES: [name: string, x: string, y: string, stops: string][] = [
  ["tocsphere", "-0.5ex", "0.6ex", "color(0cm)=(bg!35!white); color(0.44ex)=(bg!75!white); color(0.88ex)=(bg!70!black!90!parent.bg); color(1.2ex)=(bg!50!black!90!parent.bg); color(1.3ex)=(parent.bg)"],
  ["bigsphere", "-0.1849315ex", ".2260273ex", "color(0cm)=(bg!15); color(0.1643835ex)=(bg!75); color(0.3287671ex)=(bg!70!black); color(0.4520547ex)=(bg!50!black); color(0.53ex)=(parent.bg)"],
  ["smallsphere", "-0.1479452ex", "0.18287671ex", "color(0cm)=(bg!15); color(0.1315068ex)=(bg!75); color(0.2630136ex)=(bg!70!black); color(0.36164383ex)=(bg!50!black); color(0.427ex)=(parent.bg)"],
]

export class BeamerPgf {
  /** xcolor's colours as pgf reads them */
  readonly colors = new Colors()

  /** the run's state and driver (navigation.ts's navigationPgf: the class's objects defined) */
  constructor(readonly s: PgfState, readonly d: PgfDriver) {
    const colors = this.colors
    // beamerbaseboxes.sty 257–258
    pgfDeclareShading(s, d, "vertical", "lower.bg,upper.bg", "bmb@transition", "200cm", "color(0pt)=(lower.bg); color(2pt)=(lower.bg); color(4pt)=(upper.bg)", colors)
    // beamerbaseauxtemplates.sty 27–49
    for (const [name, x, y, stops] of SPHERES) pgfDeclareShading(s, d, "radial", "bg,parent.bg", name, () => pgfPoint(s, x, y), stops, colors)
  }

  /** the font in force: pgfmath's em and ex */
  font(f: Font) { this.s.units = { em: f.params[QUAD], ex: f.params[X_HEIGHT] } }

  /** \colorlet{name}{…}: the colour whose driver text is `spec` (`rgb 0.2 0.2 0.7`) */
  color(name: string, spec: string) {
    const [model, ...values] = spec.split(" ")
    this.colors.define(name, model, values.join(","))
  }

  /** what `f` appends to the list it is in (outside pictures) */
  nodes(f: () => void): Node[] {
    const outer = this.s.out
    this.s.out = []
    try { f(); return this.s.out } finally { this.s.out = outer }
  }

  /** \pgfuseshading{name} outside a picture, with bg and parent.bg as given and the font `f`: the shading's box */
  shading(name: string, f: Font, bg: string, parentBg: string): BoxNode {
    const { units, inPicture } = this.s
    this.font(f)
    this.color("bg", bg)
    this.color("parent.bg", parentBg)
    // (in a picture, \pgftext's \pgfinterruptpicture)
    this.s.inPicture = false
    const out = this.nodes(() => pgfUseShading(this.s, this.d, name, this.colors))
    this.s.units = units
    this.s.inPicture = inPicture
    if (out.length !== 1 || out[0].kind !== "hlist") throw new Unsupported(`pgf: the shading ${name} is not one box`)
    return out[0]
  }

  /**
   * \begin{pgfpicture}{minx}{miny}{maxx}{maxy} … \end{pgfpicture} (the old syntax's bounding box) in the font `f`,
   * where the colour `color` (the driver's text) is in force: `body` runs in the picture, its `pops` the color pops
   * that its \color's groups end with (\aftergroup\reset@color, before the main layer's \hss)
   */
  picture(f: Font, color: string, bbox: [string, string, string, string], body: () => number): Node[] {
    this.font(f)
    return this.nodes(() => {
      beginPgfPicture(this.s, this.d, color, bbox)
      const pops = body()
      for (let i = 0; i < pops; i++) this.s.out.push(colorPop())
      endPgfPicture(this.s, this.d)
    })
  }
}
