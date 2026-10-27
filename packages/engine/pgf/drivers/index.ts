// pgf's system layer: the \pgfsys@ commands every driver defines (pgfsys.code.tex), as one interface, and
// the protocol they write through (pgfsysprotocol.code.tex). Dimensions come as the registers the basic
// layer hands over (sp); numbers that pgf passes on as typed (a transformation's matrix, a miter limit,
// colour values) as strings.

import type { BoxNode } from "../../layout/nodes"
import { sysBp } from "../fixed"
import type { PgfState } from "../state"

export type ColorModel = "rgb" | "cmyk" | "cmy" | "gray"
/** \pgfsys@color@<model>@stroke, …@fill, or \pgfsys@color@<model> for both */
export type ColorTarget = "stroke" | "fill" | "both"

export interface PgfDriver {
  readonly state: PgfState
  /** \pgfsys@beginpicture, \pgfsys@endpicture */
  beginPicture(): void
  endPicture(): void
  /** path construction: \pgfsys@moveto, \pgfsys@lineto, \pgfsys@curveto, \pgfsys@rect, \pgfsys@closepath */
  moveto(x: number, y: number): void
  lineto(x: number, y: number): void
  curveto(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void
  rect(x: number, y: number, w: number, h: number): void
  closepath(): void
  /** path usage: \pgfsys@stroke, \pgfsys@fill, \pgfsys@fillstroke, \pgfsys@clipnext, \pgfsys@discardpath */
  stroke(): void
  fill(): void
  fillstroke(): void
  clipnext(): void
  discardpath(): void
  /** \pgfsys@transformcm{a}{b}{c}{d}{x}{y}, \pgfsys@transformshift{x}{y}, \pgfsys@transformxyscale{a}{b} */
  transformcm(a: string, b: string, c: string, d: string, x: number, y: number): void
  transformshift(x: number, y: number): void
  transformxyscale(a: string, b: string): void
  /** \pgfsys@beginscope, \pgfsys@endscope: the graphic state saved and restored */
  beginscope(): void
  endscope(): void
  /** graphic state: \pgfsys@setlinewidth, \pgfsys@setdash{pattern}{phase}, \pgfsys@setmiterlimit */
  setlinewidth(w: number): void
  setdash(pattern: number[], phase: number): void
  setmiterlimit(m: string): void
  /** \pgfsys@buttcap, \pgfsys@roundcap, \pgfsys@rectcap */
  cap(kind: "butt" | "round" | "rect"): void
  /** \pgfsys@miterjoin, \pgfsys@roundjoin, \pgfsys@beveljoin */
  join(kind: "miter" | "round" | "bevel"): void
  /** \pgfsys@color@<model>[@stroke|@fill]{v1}…: the values as xcolor keeps them */
  color(model: ColorModel, target: ColorTarget, values: string[]): void
  /** \pgfsys@color@reset */
  colorReset(): void
  /**
   * \pgfsys@hbox#1: a TeX box placed in the picture at the origin, of size 0. `register`: #1 is a box register's
   * name (\pgfnodeparttextbox), after which `\box#1`'s end of line is a space; digits end there instead.
   */
  hbox(box: BoxNode | null, register: boolean): void
  /**
   * \pgfsys@hboxsynced#1: the box placed under the current transformation, which `synccm` (the basic
   * layer's \pgflowlevelsynccm) hands to the driver
   */
  hboxsynced(box: BoxNode | null, register: boolean, synccm: () => void): void
  /** \pgfsys@begininvisible, \pgfsys@endinvisible: what lies between draws nothing */
  beginInvisible(): void
  endInvisible(): void
  /** \pgfsys@begin@text, \pgfsys@end@text: around a text box's colour commands */
  beginText(): void
  endText(): void
  /** \pgfsysprotocol@flushcurrentprotocol: the literals buffered so far invoked at once */
  flush(): void
}

/** pgfsysprotocol.code.tex, with \pgf@sys@bp (pgfsys.code.tex 36–45) */
export abstract class ProtocolDriver {
  constructor(readonly state: PgfState) {}

  /** \pgfsys@invoke: the driver's literal */
  protected abstract invoke(text: string): void

  /** \pgfsysprotocol@literalbuffered (32–35): `{#1\space}` added to the protocol */
  protected literalBuffered(text: string) { this.state.protocol += `${text} ` }

  /** \pgfsysprotocol@literal (38–44) */
  protected literal(text: string) {
    this.literalBuffered(text)
    if (!this.state.sw.buffered) this.flush()
  }

  /** \pgfsysprotocol@flushcurrentprotocol (64–67): an empty protocol invokes nothing */
  flush() {
    if (this.state.protocol !== "") this.invoke(this.state.protocol)
    this.state.protocol = ""
  }

  /** \pgf@sys@bp: the dimension in big points and a space, added to the protocol */
  protected bp(x: number) { this.state.protocol += `${sysBp(x)} ` }
}
