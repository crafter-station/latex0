// graphicx's \includegraphics with the dvips driver (graphics.sty, graphicx.sty,
// dvips.def). The file's bounding box gives the natural size (\Gin@setfile:
// ury−lly by urx−llx, in bp); width=, height=, keepaspectratio and scale= ask for
// another (\Gin@esetsize, \Gscale@div); the result is an \hbox of that size,
// depth zero, holding dvips's PSfile special (\Ginclude@eps), and scale= puts
// it in an \mbox (\Gscale@@box with no size).

import { printScaled } from "../layout/arith"
import { MAX_DIMEN, parseDimen, type Internal } from "../layout/dimen"
import { hpack } from "../layout/pack"
import type { BoxNode, Node } from "../layout/nodes"
import { widthRegisters } from "./boxes"
import type { Ctx } from "./context"
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
  // \Gin@extensions for dvips: a name without one is tried as .eps, then .ps
  const name = /\.[A-Za-z0-9]+$/.test(file) ? file : [`${file}.eps`, `${file}.ps`].find((f) => cx.images.has(f)) ?? `${file}.eps`
  if (!/\.e?ps$/i.test(name)) throw new Unsupported(`a graphic of type ${name.replace(/^.*\./, "")} (dvips reads EPS)`)
  const bb = cx.images.get(name)
  if (!bb) throw new Unsupported(`a graphic whose size is not known: ${name}`)
  const keys = keyval(options)
  for (const k of keys.keys()) if (!["width", "height", "keepaspectratio", "scale"].includes(k)) throw new Unsupported(`\\includegraphics option ${k}`)
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
  // \Ginclude@eps: the requested size in tenths of a bp, for the factors that are not !
  const tenth = parseDimen(".1bp", { em: 0, ex: 0 })
  const special = `PSfile="${name}" llx=${bb.llx} lly=${bb.lly} urx=${bb.urx} ury=${bb.ury} ${scalex !== null ? `rwi=${Math.trunc(reqW / tenth)} ` : ""}${scaley !== null ? `rhi=${Math.trunc(reqH / tenth)} ` : ""}`
  const box: BoxNode = hpack([{ kind: "whatsit", text: `\\special{${special}}` }])
  box.height = reqH; box.depth = 0; box.width = reqW
  return scale !== undefined ? [hpack([box])] : [box] // (scale=: \mbox)
}

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
