// The pdfTeX driver: pgfsys-pdftex.def over pgfsys-common-pdf.def (line numbers cite those files), with
// pgfsys.code.tex's defaults where neither defines a command. Every literal is a \pdfliteral, each protocol
// flush one; a picture's begin and end write nothing.

import { glue, ssGlue, type BoxNode } from "../../layout/nodes"
import { hpack } from "../../layout/pack"
import { TexArith } from "../fixed"
import { ProtocolDriver, type ColorModel, type ColorTarget, type PgfDriver } from "./index"

/** the operators of each colour model, stroke and fill, and the extra operand (common-pdf 54–61) */
const COLOR_OPS: Record<ColorModel, { stroke: string; fill: string; extra: string }> = {
  rgb: { stroke: "RG", fill: "rg", extra: "" },
  cmyk: { stroke: "K", fill: "k", extra: "" },
  cmy: { stroke: "K", fill: "k", extra: " 0" },
  gray: { stroke: "G", fill: "g", extra: "" },
}

/** 2000bp, the shift that moves invisible material off the page */
const OFF_PAGE = new TexArith({ em: 0, ex: 0 }).dimen("2000bp")

export class PdftexDriver extends ProtocolDriver implements PgfDriver {
  /** \pgfsys@invoke (pdftex.def 24) */
  protected invoke(text: string) { this.state.out.push({ kind: "whatsit", text: `\\pdfliteral{${text}}` }) }

  // pgfsys.code.tex 1564–1567: nothing
  beginPicture() {}
  endPicture() {}

  // common-pdf 17–22
  moveto(x: number, y: number) { this.bp(x); this.bp(y); this.literal("m") }
  lineto(x: number, y: number) { this.bp(x); this.bp(y); this.literal("l") }
  curveto(x1: number, y1: number, x2: number, y2: number, x: number, y: number) {
    for (const v of [x1, y1, x2, y2, x, y]) this.bp(v)
    this.literal("c")
  }
  rect(x: number, y: number, w: number, h: number) { this.bp(x); this.bp(y); this.bp(w); this.bp(h); this.literal("re") }
  closepath() { this.literal("h") }

  // common-pdf 25–30: clipping is an operator of its own, written at once
  stroke() { this.literal("S") }
  fill() { this.literal(this.state.sw.eoRule ? "f*" : "f") }
  fillstroke() { this.literal(this.state.sw.eoRule ? "B*" : "B") }
  clipnext() { this.literal(this.state.sw.eoRule ? "W*" : "W") }
  discardpath() { this.literal("n") }

  // common-pdf 33–34; pgfsys.code.tex 488 and 492: a shift and a scale are matrices
  transformcm(a: string, b: string, c: string, d: string, x: number, y: number) {
    this.literalBuffered(`${a} ${b} ${c} ${d}`)
    this.bp(x); this.bp(y)
    this.literal("cm")
  }
  transformshift(x: number, y: number) { this.transformcm("1", "0", "0", "1", x, y) }
  transformxyscale(a: string, b: string) { this.transformcm(a, "0", "0", b, 0, 0) }

  // common-pdf 37–38
  beginscope() { this.literal("q") }
  endscope() { this.literal("Q") }

  // common-pdf 41–53
  setdash(pattern: number[], phase: number) {
    this.literalBuffered("[")
    for (const p of pattern) this.bp(p)
    this.literalBuffered("]")
    this.bp(phase)
    this.literal("d")
  }
  setlinewidth(w: number) { this.bp(w); this.literal("w") }
  setmiterlimit(m: string) { this.literal(`${m} M`) }
  cap(kind: "butt" | "round" | "rect") { this.literal(`${["butt", "round", "rect"].indexOf(kind)} J`) }
  join(kind: "miter" | "round" | "bevel") { this.literal(`${["miter", "round", "bevel"].indexOf(kind)} j`) }

  // common-pdf 54–61; both at once: pgfsys.code.tex 408–443, stroke then fill
  color(model: ColorModel, target: ColorTarget, values: string[]) {
    const ops = COLOR_OPS[model]
    const set = (op: string) => this.literal(`${values.join(" ")}${ops.extra} ${op}`)
    if (target !== "fill") set(ops.stroke)
    if (target !== "stroke") set(ops.fill)
  }
  // pgfsys.code.tex 457: nothing
  colorReset() {}

  /**
   * pgfsys.code.tex 1524–1534: the box in a box of size 0, in a graphic scope; the id scope as for dvips
   * (its end's space). A void register gives an empty box.
   */
  hbox(box: BoxNode | null, _register: boolean) {
    this.beginscope()
    this.state.box({ ...hpack(box ? [box] : []), width: 0, height: 0, depth: 0 })
    this.endscope()
    this.state.space()
  }

  /**
   * pdftex.def 27–47: in a group and a graphic scope, the translation as TeX's (\hskip, \raise), the rest
   * of the transformation synced inside, the box (of size 0) and the id scope's end space
   */
  hboxsynced(box: BoxNode | null, register: boolean, synccm: () => void) {
    const s = this.state
    s.begingroup()
    this.beginscope()
    const outer = s.out
    const { x, y } = s.local.transform
    s.out = []
    s.begingroup()
    s.setLocal({ transform: { ...s.local.transform, x: 0, y: 0 } })
    synccm()
    this.hbox(box, register)
    const inner = hpack(s.out)
    s.endgroup()
    s.out = outer
    s.box({ ...hpack([glue(x), { ...inner, shift: -y }, ssGlue()]), width: 0, height: 0, depth: 0 })
    this.endscope()
    s.space()
    s.endgroup()
  }

  // pgfsys.code.tex 1696–1702: everything moved 2000bp away
  beginInvisible() { this.transformcm("1", "0", "0", "1", OFF_PAGE, OFF_PAGE) }
  endInvisible() { this.transformcm("1", "0", "0", "1", -OFF_PAGE, -OFF_PAGE) }

  // pgfsys.code.tex 621, 631: nothing
  beginText() {}
  endText() {}
}
