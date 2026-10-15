// The geometry package (geometry.sty v5.9): its keys and \Gm@@process, which sets \textwidth,
// \textheight, \oddsidemargin, \evensidemargin and \topmargin from the paper and the margins,
// body size, scales and ratios given (\Gm@detall's eight cases, \Gm@detiiandiii's ratio split with
// TeX's integer \divide). Lengths are scanned as \setlength scans them; geometry keeps every result
// as \the<dimen> text, which TeX reads back to the same value.

import type { ClassOptionData } from "../../../layout/classdata"
import { Scanner, type ScanEnv } from "../../../layout/dimen"
import { printScaled, xnOverD } from "../../../layout/arith"

export class GeometryUnsupported extends Error {}

const PAPERS: Record<string, [string, string]> = {
  a0paper: ["841mm", "1189mm"], a1paper: ["594mm", "841mm"], a2paper: ["420mm", "594mm"], a3paper: ["297mm", "420mm"],
  a4paper: ["210mm", "297mm"], a5paper: ["148mm", "210mm"], a6paper: ["105mm", "148mm"],
  b0paper: ["1000mm", "1414mm"], b1paper: ["707mm", "1000mm"], b2paper: ["500mm", "707mm"], b3paper: ["353mm", "500mm"],
  b4paper: ["250mm", "353mm"], b5paper: ["176mm", "250mm"], b6paper: ["125mm", "176mm"],
  letterpaper: ["8.5in", "11in"], legalpaper: ["8.5in", "14in"], executivepaper: ["7.25in", "10.5in"],
  ansiapaper: ["8.5in", "11in"], ansibpaper: ["11in", "17in"], ansicpaper: ["17in", "22in"], ansidpaper: ["22in", "34in"], ansiepaper: ["34in", "44in"],
  b0j: ["1030mm", "1456mm"], b1j: ["728mm", "1030mm"], b2j: ["515mm", "728mm"], b3j: ["364mm", "515mm"], b4j: ["257mm", "364mm"], b5j: ["182mm", "257mm"], b6j: ["128mm", "182mm"],
}

/** Split a key=value list at top-level commas (braces group). */
function keyvals(src: string): [string, string | null][] {
  const out: [string, string | null][] = []
  let depth = 0, cur = ""
  const push = () => { const t = cur.trim(); cur = ""; if (!t) return; const i = t.indexOf("="); out.push(i < 0 ? [t, null] : [t.slice(0, i).trim(), t.slice(i + 1).trim().replace(/^\{([^]*)\}$/, "$1")]) }
  for (const c of src) { if (c === "{") depth++; else if (c === "}") depth--; if (c === "," && depth === 0) push(); else cur += c }
  push()
  return out
}

/** \Gm@branch: "a,b" sets both keys, "a" sets both to a */
const branch = (v: string) => { const parts = v.split(",").map((x) => x.trim()); return parts.length === 1 ? [parts[0], parts[0]] : [parts[0], parts[1]] }

/**
 * \usepackage[opts]{geometry} and \geometry{opts} in the preamble, in order: the class data with the
 * page lengths geometry sets.
 */
export function geometry(k: ClassOptionData, optionLists: string[], env: ScanEnv): ClassOptionData {
  const d: Record<string, number> = { ...k.dimens }
  const len = (v: string): number => {
    // <factor><length register>, as \setlength reads it (a skip register gives its width)
    const reg = v.trim().match(/^(-?)\s*([\d.]*)\s*\\([a-zA-Z@]+)$/)
    if (reg) {
      const r = reg[3] === "baselineskip" ? k.glue.baselineskip.width : reg[3] === "topskip" ? k.glue.topskip.width : d[reg[3]]
      if (r === undefined) throw new GeometryUnsupported(`geometry length "${v}"`)
      const x = reg[2] ? scaled(reg[2], r) : r
      return reg[1] ? -x : x
    }
    const s = new Scanner(v, env)
    const d = s.scanDimen().value
    if (s.errors.length || s.rest().trim()) throw new GeometryUnsupported(`geometry length "${v}"`)
    return d
  }
  /** <factor><dimen>: nx_plus_y(integer part, v, xn_over_d(v, fraction, 2^16)) (§§ 452–455) */
  const scaled = (factor: string, v: number): number => {
    const m = factor.trim().match(/^(\d*)(?:\.(\d*))?$/)
    if (!m) throw new GeometryUnsupported(`geometry scale "${factor}"`)
    const n = Number(m[1] || "0")
    let f = 0
    if (m[2]) { // round_decimals (§ 102), at most 17 digits
      let a = 0
      for (const c of m[2].slice(0, 17).split("").reverse()) a = Math.trunc((a + Number(c) * 131072) / 10)
      f = Math.trunc((a + 1) / 2)
    }
    return n * v + xnOverD(v, f, 65536)
  }
  const ratio = (r: string): [number, number] => { const m = r.match(/^\s*(\d+)\s*:\s*(\d+)\s*$/); if (!m) throw new GeometryUnsupported(`ratio ${r}`); return [Number(m[1]), Number(m[2])] }

  let twoside = k.ints.twoside === 1
  let paper: string | null = null, landscape = false
  let hbody = false, vbody = false, includehead = false, includefoot = false, heightrounded = false
  let bindingoffset = 0
  const Gm: Record<string, number | undefined> = {}
  let hscale: string | undefined, vscale: string | undefined, hratio: string | undefined, vratio: string | undefined
  const set = (key: string, v: string | null): void => {
    const val = () => { if (v === null) throw new GeometryUnsupported(`geometry key ${key} without a value`); return v }
    const bool = () => v === null || v.toLowerCase() === "true"
    switch (key) {
      case "margin": { const [a, b] = branch(val()); Gm.lmargin = len(a); Gm.tmargin = len(b); Gm.rmargin = len(a); Gm.bmargin = len(b); return }
      case "hmargin": { const [a, b] = branch(val()); Gm.lmargin = len(a); Gm.rmargin = len(b); return }
      case "vmargin": { const [a, b] = branch(val()); Gm.tmargin = len(a); Gm.bmargin = len(b); return }
      case "left": case "lmargin": case "inner": case "innermargin": Gm.lmargin = len(val()); return
      case "right": case "rmargin": case "outer": case "outermargin": Gm.rmargin = len(val()); return
      case "top": case "tmargin": Gm.tmargin = len(val()); return
      case "bottom": case "bmargin": Gm.bmargin = len(val()); return
      case "width": case "totalwidth": hbody = true; Gm.width = len(val()); return
      case "height": case "totalheight": vbody = true; Gm.height = len(val()); return
      case "total": { const [a, b] = branch(val()); set("width", a); set("height", b); return }
      case "textwidth": hbody = true; Gm.textwidth = len(val()); return
      case "textheight": vbody = true; Gm.textheight = len(val()); return
      case "text": case "body": { const [a, b] = branch(val()); set("textwidth", a); set("textheight", b); return }
      case "hscale": hbody = true; hscale = val(); return
      case "vscale": vbody = true; vscale = val(); return
      case "scale": { const [a, b] = branch(val()); set("hscale", a); set("vscale", b); return }
      case "hmarginratio": case "hratio": hratio = val(); return
      case "vmarginratio": case "vratio": vratio = val(); return
      case "marginratio": case "ratio": { const [a, b] = branch(val()); hratio = a; vratio = b; return }
      case "hcentering": if (bool()) hratio = "1:1"; return
      case "vcentering": if (bool()) vratio = "1:1"; return
      case "centering": if (bool()) { hratio = "1:1"; vratio = "1:1" } return
      case "includehead": includehead = bool(); return
      case "includefoot": includefoot = bool(); return
      case "includeheadfoot": includehead = includefoot = bool(); return
      case "ignorehead": includehead = !bool(); return
      case "ignorefoot": includefoot = !bool(); return
      case "ignoreheadfoot": includehead = includefoot = !bool(); return
      case "heightrounded": heightrounded = bool(); return
      case "headheight": case "head": d.headheight = len(val()); return
      case "headsep": d.headsep = len(val()); return
      case "footskip": case "foot": d.footskip = len(val()); return
      case "nohead": if (bool()) { d.headheight = 0; d.headsep = 0 } return
      case "nofoot": if (bool()) d.footskip = 0; return
      case "noheadfoot": if (bool()) { d.headheight = 0; d.headsep = 0; d.footskip = 0 } return
      case "marginparwidth": case "marginpar": d.marginparwidth = len(val()); return
      case "marginparsep": d.marginparsep = len(val()); return
      case "nomarginpar": if (bool()) { d.marginparwidth = 0; d.marginparsep = 0 } return
      case "columnsep": d.columnsep = len(val()); return
      case "bindingoffset": bindingoffset = len(val()); return
      case "twoside": twoside = bool(); return
      case "landscape": if (bool() !== landscape) landscape = bool(); return
      case "portrait": if (bool() === landscape) landscape = !bool(); return
      case "paper": case "papername": set(val(), null); return
      case "paperwidth": paper = "custom"; d.paperwidth = len(val()); return
      case "paperheight": paper = "custom"; d.paperheight = len(val()); return
      case "papersize": { const [a, b] = branch(val()); set("paperwidth", a); set("paperheight", b); return }
      case "onecolumn": if (bool()) return; break
      case "verbose": case "dvips": case "driver": case "pass": if (key === "pass" && bool()) break; return
      default:
        if (key in PAPERS) { paper = key; [d.paperwidth, d.paperheight] = PAPERS[key].map(len); return }
    }
    throw new GeometryUnsupported(`geometry option ${key}${v === null ? "" : `=${v}`}`)
  }
  for (const list of optionLists) for (const [key, v] of keyvals(list)) set(key, v)

  // \Gm@setdefaultpaper: no paper given, the class's, read back through \strip@pt…pt; landscape swaps
  if (paper === null) { d.paperwidth = len(`${printScaled(d.paperwidth)}pt`); d.paperheight = len(`${printScaled(d.paperheight)}pt`) }
  if (landscape) [d.paperwidth, d.paperheight] = [d.paperheight, d.paperwidth]
  const layout = { h: d.paperwidth - bindingoffset, v: d.paperheight }

  // \Gm@adjustbody
  if (hbody) {
    if (Gm.width === undefined) Gm.width = scaled(hscale ?? "0.7", layout.h)
    if (Gm.textwidth !== undefined) Gm.width = Gm.textwidth
  }
  if (vbody) {
    if (Gm.height === undefined) Gm.height = scaled(vscale ?? "0.7", layout.v)
    if (Gm.textheight !== undefined) Gm.height = Gm.textheight + (includehead ? d.headheight + d.headsep : 0) + (includefoot ? d.footskip : 0)
  }

  // \Gm@detall for one direction: body and the two margins
  const detall = (dir: "h" | "v") => {
    const [body, m1, m2] = dir === "h" ? ["width", "lmargin", "rmargin"] : ["height", "tmargin", "bmargin"]
    const L = layout[dir]
    const mratio = dir === "h" ? hratio : vratio
    const dratio = dir === "h" ? (twoside ? "2:3" : "1:1") : "2:3"
    const hasBody = dir === "h" ? hbody : vbody
    const cnt = (Gm[m1] !== undefined ? 4 : 0) + (hasBody ? 2 : 0) + (Gm[m2] !== undefined ? 1 : 0)
    const detiv = (a: string, b: string, out: string) => { Gm[out] = L - Gm[a]! - Gm[b]! }
    const detiiandiii = (bd: string, x: string, y: string) => {
      let a: number, b: number
      if (mratio === undefined) [a, b] = ratio(dratio)
      else { [a, b] = ratio(mratio); if (!(b > 0)) [a, b] = ratio(dratio) }
      let ta = L - Gm[bd]!
      const tb = ta
      ta = Math.trunc(ta / (a + b)) * a // \divide, \multiply
      Gm[x] = ta; Gm[y] = tb - ta
    }
    const setbyratio = (swap: boolean, src: string, dst: string) => {
      let [a, b] = ratio(mratio!)
      if (swap) [a, b] = [b, a]
      let t = Gm[src]!
      if (b > 0) t = Math.trunc((t * a) / b)
      Gm[dst] = t
    }
    const defaultBody = () => { Gm[body] = scaled("0.7", L) }
    switch (cnt) {
      case 0: defaultBody(); detiiandiii(body, m1, m2); break
      case 1:
        if (mratio === undefined) { defaultBody(); const c = Gm[m2]!; detiiandiii(body, m1, m2); Gm[body] = undefined; Gm[m2] = c }
        else setbyratio(false, m2, m1)
        detiv(m1, m2, body); break
      case 2: detiiandiii(body, m1, m2); break
      case 3: detiv(body, m2, m1); break
      case 4:
        if (mratio === undefined) { defaultBody(); const c = Gm[m1]!; detiiandiii(body, m2, m1); Gm[body] = undefined; Gm[m1] = c }
        else setbyratio(true, m1, m2)
        detiv(m1, m2, body); break
      case 5: detiv(m1, m2, body); break
      case 6: detiv(body, m1, m2); break
      case 7: detiv(m1, m2, body); break
    }
  }
  detall("h")
  detall("v")

  // \Gm@@process
  const inch = len("1in")
  d.textwidth = Gm.width!
  d.textheight = Gm.height!
  d.topmargin = Gm.tmargin! - inch
  d.oddsidemargin = Gm.lmargin! - inch
  d.evensidemargin = twoside ? Gm.rmargin! - inch : d.oddsidemargin
  d.oddsidemargin += bindingoffset
  if (includehead) d.textheight -= d.headheight + d.headsep
  else d.topmargin -= d.headheight + d.headsep
  if (includefoot) d.textheight -= d.footskip
  if (heightrounded) {
    const bs = k.glue.baselineskip.width, topskip = k.glue.topskip.width
    let a = d.textheight - topskip
    const n = Math.trunc(a / bs)
    let b = bs * n
    a = (a - b) * 2
    if (a > bs) b += bs
    d.textheight = b + topskip
  }
  d.columnwidth = d.textwidth // \Gm@changelayout, as \begin{document} sets them
  const h = d.textheight, frac = (n: string) => Math.trunc((h * k.ints[n]) / 65536)
  Object.assign(d, { toproom: frac("topfraction"), botroom: frac("bottomfraction"), textmin: frac("textfraction"), fpmin: frac("floatpagefraction") })
  return { ...k, dimens: d, ints: { ...k.ints, twoside: twoside ? 1 : 0 } }
}
