// graphicx's \includegraphics (graphics.sty, graphicx.sty) with the dvips driver (dvips.def) or pdfTeX's
// (pdftex.def). The file's bounding box gives the natural size (\Gin@setfile: ury−lly by urx−llx, in bp): an EPS
// file's %%BoundingBox under dvips; under pdfTeX the image box of a PNG, a JPEG or a PDF file's page (page= and
// pagebox=), whose width and height \Gread@pdftex takes as .99626 of their pt (\Gin@defaultbp). width=, height=, keepaspectratio and scale= ask
// for another size (\Gin@esetsize, \Gscale@div); the result is an \hbox of that size, depth zero, holding
// dvips's PSfile special (\Ginclude@eps) or pdfTeX's image scaled by \Gscale@box (\Ginclude@@pdftex), and
// scale= puts it in an \mbox (\Gscale@@box with no size).

import { printScaled } from "../layout/arith"
import { MAX_DIMEN, parseDimen, type Internal } from "../layout/dimen"
import { hpack } from "../layout/pack"
import { kern, ssGlue, type BoxNode, type Node } from "../layout/nodes"
import { widthRegisters } from "./boxes"
import type { Ctx } from "./context"
import type { Bitmap } from "./images"
import type { Pdf, PdfPage } from "./pdf"
import { Unsupported } from "./unsupported"

/** An EPS file's %%BoundingBox, its numbers as written (dvips's special prints them back) */
export interface BoundingBox { llx: string; lly: string; urx: string; ury: string }

/** The %%BoundingBox line of an EPS file's contents (\Gread@eps), or null */
export function boundingBox(eps: string): BoundingBox | null {
  const m = eps.match(/^%%BoundingBox:\s*(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s*$/m)
  if (!m || m.slice(1).some((x) => !/^-?\d*\.?\d+$/.test(x))) return null // (atend, or a value with a unit)
  return { llx: m[1], lly: m[2], urx: m[3], ury: m[4] }
}

/** \includegraphics number n where it stands; `lineWidth`: \linewidth there; em and ex of the current font */
export function graphicAt(cx: Ctx, n: number, lineWidth: number, units: { em: number; ex: number }): Node[] {
  const { file, options } = cx.graphics[n]
  const pdftex = cx.driver === "pdftex"
  // \Gin@extensions: a name without one is tried with each, in order
  const exts = pdftex ? [".pdf", ".png", ".jpg", ".mps", ".jpeg", ".jbig2", ".jb2", ".PDF", ".PNG", ".JPG", ".JPEG", ".JBIG2", ".JB2"] : [".eps", ".ps"]
  const name = /\.[A-Za-z0-9]+$/.test(file) ? file : exts.map((e) => file + e).find((f) => cx.images.has(f)) ?? file + exts[0]
  if (!(pdftex ? /\.(png|jpe?g|pdf)$/i : /\.e?ps$/i).test(name)) throw new Unsupported(`a graphic of type ${name.replace(/^.*\./, "")} with the ${cx.driver} driver`)
  const info = cx.images.get(name)
  if (!info || ("kind" in info) !== pdftex) throw new Unsupported(`a graphic whose size is not known: ${name}`)
  const keys = keyval(options)
  for (const k of keys.keys()) if (!["width", "height", "keepaspectratio", "scale", "page", "pagebox"].includes(k)) throw new Unsupported(`\\includegraphics option ${k}`)
  // pdfTeX's image box, and \Gread@pdftex's bounding box: 0 0 and .99626 of its width and height
  const image = !("kind" in info) ? null : info.kind === "pdf" ? pdfSize(info, keys.get("page"), keys.get("pagebox")) : bitmapSize(info)
  const bb: BoundingBox = image ? { llx: "0", lly: "0", urx: stripPt(times(".99626", image.width)), ury: stripPt(times(".99626", image.height)) } : info as BoundingBox
  if (keys.has("scale") && (keys.has("width") || keys.has("height"))) throw new Unsupported("\\includegraphics with scale and a size")

  const bp = (x: string) => parseDimen(`${x}bp`, { em: 0, ex: 0 })
  const natH = bp(bb.ury) - bp(bb.lly), natW = bp(bb.urx) - bp(bb.llx)
  const registers = widthRegisters(cx, lineWidth)
  const length = (x: string) => {
    try { return parseDimen(x, { ...units, internal: registers }) } catch { throw new Unsupported(`\\includegraphics size ${x}`) }
  }
  // \Gin@scalex and \Gin@scaley: a factor, or ! (not printed in the special)
  let scalex: string | null = "1", scaley: string | null = null, reqW = natW, reqH = natH
  const iso = keys.has("keepaspectratio") && keys.get("keepaspectratio") !== "false"
  const w = keys.get("width"), h = keys.get("height"), scale = keys.get("scale")
  if (scale !== undefined) {
    scalex = scale.trim(); scaley = null
    reqH = times(scalex, natH); reqW = times(scalex, natW)
  } else if (w !== undefined && h === undefined) {
    const ew = length(w)
    scalex = gscaleDiv(ew, natW); scaley = null
    reqW = ew; reqH = times(scalex, natH)
  } else if (h !== undefined && w === undefined) {
    const eh = length(h)
    scaley = gscaleDiv(eh, natH); scalex = null
    reqH = eh; reqW = times(scaley, natW)
  } else if (w !== undefined && h !== undefined) {
    scalex = gscaleDiv(length(w), natW); scaley = gscaleDiv(length(h), natH)
    if (iso) { if (factor(scaley) > factor(scalex)) scaley = scalex; else scalex = scaley }
    reqW = times(scalex, natW); reqH = times(scaley, natH)
  }
  if (image) return pdftexBox(name, image, scalex, scaley, reqW, reqH, scale !== undefined)
  // \Ginclude@eps: the requested size in tenths of a bp, for the factors that are not !
  const tenth = parseDimen(".1bp", { em: 0, ex: 0 })
  const special = `PSfile="${name}" llx=${bb.llx} lly=${bb.lly} urx=${bb.urx} ury=${bb.ury} ${scalex !== null ? `rwi=${Math.trunc(reqW / tenth)} ` : ""}${scaley !== null ? `rhi=${Math.trunc(reqH / tenth)} ` : ""}`
  const box: BoxNode = hpack([{ kind: "whatsit", text: `\\special{${special}}` }])
  box.height = reqH; box.depth = 0; box.width = reqW
  return scale !== undefined ? [hpack([box])] : [box] // (scale=: \mbox)
}

/**
 * pdfTeX's image box for a bitmap (writeimg.c's scale_image): one resolution standing for both when only one is
 * given, 72 dpi when neither is; each side round(100in × pixels / (100 × resolution)) (ext_xn_over_d)
 */
export function bitmapSize(b: Bitmap): { width: number; height: number } {
  let xr = b.xres, yr = b.yres
  if (!xr && yr) xr = yr
  if (!yr && xr) yr = xr
  if (!xr) xr = yr = 72
  const hundredInch = 7227 * 65536
  const side = (px: number, res: number) => Math.round((hundredInch * px) / (100 * res))
  return { width: side(b.width, xr), height: side(b.height, yr) }
}

/**
 * pdfTeX's image box for a PDF file's page (read_pdf_info, writeimg.c's readimage, scale_image): page= (\number of
 * it; 1 when empty or not given) and the box pagebox= names (graphicx: the crop box by default, and for a name it
 * does not know), its width and height in bp, each the difference of two doubles kept in a float (epdf_width) and
 * made sp by bp2int, round(x × 6578176 / 100.0) with web2c's zround ((int)(x + .5)); the two swapped for a page
 * whose /Rotate is 90 or 270
 */
export function pdfSize(pdf: Pdf, page: string | undefined, pagebox: string | undefined): { width: number; height: number } {
  if (pdf.unsupported) throw new Unsupported(pdf.unsupported)
  const pg = page === undefined || page.trim() === "" ? "1" : page.trim()
  if (!/^[+-]?\d+$/.test(pg)) throw new Unsupported(`\\includegraphics page=${page}`)
  const n = Number(pg)
  if (n < 1 || n > pdf.pages.length) throw new Unsupported(`page ${n} of a PDF file of ${pdf.pages.length} pages`)
  const p = pdf.pages[n - 1]
  if (!p) throw new Unsupported(`page ${n} of a PDF file whose page tree does not lead to it (pdfTeX crashes writing it)`)
  const named = /^(media|crop|bleed|trim|art)box$/.exec(pagebox?.trim() ?? "")?.[1] ?? "crop"
  const box = p[named as Exclude<keyof PdfPage, "rotate">]
  const bp2int = (x: number) => Math.trunc(Math.fround(x) * (6578176 / 100) + 0.5)
  let width = bp2int(box[2] - box[0]), height = bp2int(box[3] - box[1])
  if (p.rotate === 90 || p.rotate === 270) [width, height] = [height, width]
  if (width <= 0 || height <= 0 || width > MAX_DIMEN || height > MAX_DIMEN) throw new Unsupported("a PDF page with no width or height, or too large")
  return { width, height }
}

/**
 * \Gin@setfile's box under pdfTeX: \hbox{\Ginclude@@pdftex}, its depth zero and its size the requested one; in it
 * \hbox{\Gscale@box{x}[y]{\pdfrefximage}}, which is \hb@xt@x\wd0{\box2\kern x\wd0\hss} with box 2
 * \hbox{\pdfsave\pdfsetmatrix{x 0 0 y}\rlap{\copy0}\pdfrestore} (no matrix for the identity, \Gscale@start),
 * y times box 0's height and depth (GPT@setup@scale: a ! factor is the other)
 */
function pdftexBox(name: string, image: { width: number; height: number }, scalex: string | null, scaley: string | null, reqW: number, reqH: number, mbox: boolean): Node[] {
  const sx = scalex ?? scaley ?? "1", sy = scaley ?? sx
  const box0 = hpack([{ kind: "hlist", width: image.width, height: image.height, depth: 0, shift: 0, list: [], glueSet: 0, glueSign: 0, glueOrder: 0, image: name }])
  const rlap = hpack([box0, ssGlue()], { exactly: 0 })
  const x = normalize(sx), y = normalize(sy)
  const box2 = hpack(x === "1" && y === "1" ? [rlap] : [{ kind: "whatsit", text: "\\pdfsave" }, { kind: "whatsit", text: `\\pdfsetmatrix{${x} 0 0 ${y}}` }, rlap, { kind: "whatsit", text: "\\pdfrestore" }])
  box2.height = times(sy, box0.height); box2.depth = times(sy, box0.depth)
  const w = times(sx, box0.width)
  const scaled = hpack([box2, kern(w, true), ssGlue()], { exactly: w })
  const box = hpack([hpack([scaled])])
  box.depth = 0; box.height = reqH; box.width = reqW
  return mbox ? [hpack([box])] : [box]
}

/** \GPT@NormalizeNumber: no spaces or +, no leading zeros in the integer part or trailing ones in the fraction */
function normalize(f: string): string {
  let s = f.replace(/[\s+]/g, "").replace(/--/g, "")
  const neg = s.startsWith("-"); if (neg) s = s.slice(1)
  let [int, frac = ""] = s.split(".")
  int = int.replace(/^0+/, ""); frac = frac.replace(/0+$/, "")
  const t = int + (frac ? `.${frac}` : "")
  return t === "" ? "0" : (neg ? "-" : "") + t
}

/** \strip@pt of a dimension: its value printed without "pt", and without ".0" */
const stripPt = (x: number) => printScaled(x).replace(/\.0$/, "")

/** keyval's list: key=value pairs and bare keys, split at commas outside braces */
function keyval(options: string): Map<string, string> {
  const out = new Map<string, string>()
  let depth = 0, cur = ""
  const flush = () => {
    const t = cur.trim(); cur = ""
    if (!t) return
    const eq = t.indexOf("=")
    out.set((eq < 0 ? t : t.slice(0, eq)).trim(), eq < 0 ? "true" : t.slice(eq + 1).trim().replace(/^\{([^]*)\}$/, "$1"))
  }
  for (const c of options) {
    if (c === "{") depth++
    else if (c === "}") depth--
    if (c === "," && depth === 0) flush(); else cur += c
  }
  flush()
  return out
}

/** a factor's value, as \ifdim<factor>\p@ compares it */
const factor = (f: string) => parseDimen(`${f}pt`, { em: 0, ex: 0 })

/** <factor><dimen register>: the register scaled as scan_dimen does it (nx_plus_y, xn_over_d) */
function times(f: string, value: number): number {
  return parseDimen(`${f}\\reg`, { em: 0, ex: 0, internal: (name) => (name === "reg" ? { level: "dimen", value } as Internal : undefined) })
}

/**
 * \Gscale@div: num/den as \strip@pt prints it. The numerator is doubled (and 65536 halved) until it reaches
 * 8192pt; den/count, then num divided by that. (The denominator is printed with \the and read back, which
 * changes nothing: print_scaled prints what reads back as the same value, § 103.)
 */
export function gscaleDiv(num: number, den: number): string {
  if (den === 0) throw new Unsupported("\\includegraphics: division by 0")
  let d = num, count = 65536
  if (d < 0) { d = -d; count = -count }
  if (d > 0) {
    while ((count < 2 ? MAX_DIMEN : d) < 8192 * 65536) { d *= 2; count = Math.trunc(count / 2) }
    d = Math.trunc(d / Math.trunc(den / count))
  }
  return printScaled(d).replace(/\.0$/, "") // \strip@pt
}
