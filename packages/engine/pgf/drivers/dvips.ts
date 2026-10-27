// The dvips driver: pgfsys-dvips.def over pgfsys-common-postscript.def (line numbers cite those files).
// Every literal is a \special{ps:: …} (`ps: ` inside a text box), each protocol flush one special.

import type { BoxNode } from "../../layout/nodes"
import { ProtocolDriver, type ColorModel, type ColorTarget, type PgfDriver } from "./index"

/** the PostScript operator and the extra operand of each colour model (common-postscript 123–134) */
const COLOR_OPS: Record<ColorModel, { op: string; extra: string }> = {
  rgb: { op: "setrgbcolor", extra: "" },
  cmyk: { op: "setcmykcolor", extra: "" },
  cmy: { op: "setcmykcolor", extra: " 0" },
  gray: { op: "setgray", extra: "" },
}

/** dvips.def 169–180: a clip that leaves an opacity mask in place alone */
const smaskClip = (op: string) => `/pgfsmaskinplace dup where {exch get}{pop false} ifelse not {${op}} if`

export class DvipsDriver extends ProtocolDriver implements PgfDriver {
  /** \pgfsys@invoke (dvips.def 17) */
  protected invoke(text: string) { this.state.special(`ps${this.state.sw.psBoxMode ? "" : ":"}: ${text}`) }

  // dvips.def 33–34
  beginPicture() {
    this.state.sw.psBoxMode = false
    this.state.special("ps: ")
    this.state.special("ps::[begin]")
    this.invoke("pgfo")
  }
  endPicture() {
    this.invoke("pgfc")
    this.state.special("ps::[end]")
  }

  // common-postscript 21–26
  moveto(x: number, y: number) { this.bp(x); this.bp(y); this.literal("moveto") }
  lineto(x: number, y: number) { this.bp(x); this.bp(y); this.literal("lineto") }
  curveto(x1: number, y1: number, x2: number, y2: number, x: number, y: number) {
    for (const v of [x1, y1, x2, y2, x, y]) this.bp(v)
    this.literal("curveto")
  }
  rect(x: number, y: number, w: number, h: number) { this.bp(h); this.bp(w); this.bp(x); this.bp(y); this.literal("pgfe") }
  closepath() { this.literal("closepath") }

  // common-postscript 29–82
  stroke() {
    const sw = this.state.sw
    if (sw.clipNext) {
      this.literal(`gsave pgfsc pgfstr grestore ${sw.eoRule ? "eoclip" : "clip"} newpath`)
      sw.clipNext = false
    } else this.literal(sw.strokeColor ? "gsave pgfsc pgfstr grestore newpath" : "pgfstr")
  }
  fill() {
    const sw = this.state.sw
    const fill = sw.eoRule ? "pgfeofill" : "pgffill"
    if (sw.clipNext) {
      this.literal(`gsave pgffc ${fill} grestore ${sw.eoRule ? "eoclip" : "clip"} newpath`)
      sw.clipNext = false
    } else this.literal(sw.fillColor ? `gsave pgffc ${fill} grestore newpath` : fill)
  }
  fillstroke() {
    const sw = this.state.sw
    this.literal(`gsave pgffc ${sw.eoRule ? "pgfeofill" : "pgffill"} grestore gsave pgfsc pgfstr grestore`)
    if (sw.clipNext) {
      this.literal(sw.eoRule ? "eoclip" : "clip")
      sw.clipNext = false
    }
    this.literal("newpath")
  }
  clipnext() { this.state.sw.clipNext = true }
  /** dvips.def 169–180 (in place of common-postscript's) */
  discardpath() {
    const sw = this.state.sw
    if (sw.clipNext) {
      this.literal(smaskClip(sw.eoRule ? "eoclip" : "clip"))
      sw.clipNext = false
    }
    this.literal("newpath")
  }

  // common-postscript 95–98
  transformshift(x: number, y: number) { this.bp(x); this.bp(y); this.literal("translate") }
  transformxyscale(a: string, b: string) { this.literal(`${a} ${b} scale`) }
  transformcm(a: string, b: string, c: string, d: string, x: number, y: number) {
    this.literalBuffered(`[${a} ${b} ${c} ${d}`)
    this.bp(x); this.bp(y)
    this.literal("] concat")
  }

  // common-postscript 101–102
  beginscope() { this.literal("save") }
  endscope() { this.literal("restore") }

  // common-postscript 110–122
  setdash(pattern: number[], phase: number) {
    this.literalBuffered("[")
    for (const p of pattern) this.bp(p)
    this.literalBuffered("]")
    this.bp(phase)
    this.literal("setdash")
  }
  setlinewidth(w: number) { this.bp(w); this.literal("pgfw") }
  setmiterlimit(m: string) { this.literal(`${m} setmiterlimit`) }
  cap(kind: "butt" | "round" | "rect") { this.literal(`${["butt", "round", "rect"].indexOf(kind)} setlinecap`) }
  join(kind: "miter" | "round" | "bevel") { this.literal(`${["miter", "round", "bevel"].indexOf(kind)} setlinejoin`) }

  // common-postscript 123–147
  color(model: ColorModel, target: ColorTarget, values: string[]) {
    const { op, extra } = COLOR_OPS[model]
    const set = `${values.join(" ")}${extra} ${op}`
    if (target === "stroke") { this.literal(`/pgfsc{${set}}def`); this.state.sw.strokeColor = true }
    else if (target === "fill") { this.literal(`/pgffc{${set}}def`); this.state.sw.fillColor = true }
    else { this.colorReset(); this.literal(set) }
  }
  colorReset() {
    const sw = this.state.sw
    if (sw.colorResetInOrder && !sw.strokeColor && !sw.fillColor) return
    this.literal("/pgfsc{}def/pgffc{}def")
    sw.strokeColor = false
    sw.fillColor = false
  }

  /**
   * dvips.def 35–46, the id scope (pgfsys.code.tex 572–613) with no id attached: it opens no graphic scope,
   * and its end begins with a space (the end of line after `\def\pgfsys@end@idscope{`)
   */
  hbox(box: BoxNode | null, register: boolean) {
    this.invoke("pgfs")
    this.state.special("ps::[end]")
    // \wd, \ht, \dp set to 0pt (a void register ignores them)
    this.state.box(box && { ...box, width: 0, height: 0, depth: 0 })
    if (register) this.state.space()
    this.state.special("ps::[begin]")
    this.invoke("pgfr")
    this.state.space()
  }

  // dvips.def 47–55
  beginInvisible() {
    this.state.special("ps::[begin]")
    this.invoke("gsave nulldevice")
    this.state.special("ps::[end]")
  }
  endInvisible() {
    this.state.special("ps::[begin]")
    this.invoke("grestore")
    this.state.special("ps::[end]")
  }

  // common-postscript 105–106
  beginText() { this.state.sw.psBoxMode = true }
  endText() {}
}
