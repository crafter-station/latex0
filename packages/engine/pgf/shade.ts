// pgf's shadings (pgfcoreshade.code.tex, line numbers cite it) and the drivers' shading boxes: dvips's
// PostScript-3 pattern or shfill in an \hbox of the shading's size (pgfsys-dvips.def 220–311), pdfTeX's form
// XObject made at once and referenced by \pdfrefxform (pgfsys-pdftex.def 80–138). A shading's colour stops
// become PDF function dictionaries (\pgf@parsefunc), every position a dimension in big points as \the prints
// it. A shading declared with colour dependencies ([bg,parent.bg]) is made when used, once per combination
// of their values (a global counter and the colours name it): every shading made is a global macro. Only
// xcolor's natural (rgb) target model is modelled.

import { filGlue, glue, ssGlue, type BoxNode, type Node } from "../layout/nodes"
import { hpack, vpack } from "../layout/pack"
import { Unsupported } from "../latex/unsupported"
import type { Colors } from "../latex/xcolor"
import type { PgfDriver } from "./drivers"
import { DvipsDriver } from "./drivers/dvips"
import { PdftexDriver } from "./drivers/pdftex"
import { TexArith, toNumber } from "./fixed"
import { invoke } from "./paths"
import { pdfXform } from "./pdfforms"
import { parse, setLength, trig, type PgfPointMacro } from "./points"
import type { PgfState } from "./state"
import { mul } from "./transformations"

type Kind = "horizontal" | "vertical" | "radial"

/** a shading's box as its macro (@pgfshading<name>!) typesets it */
type Made =
  | { driver: "dvips"; width: number; height: number; text: string }
  | { driver: "pdftex"; width: number; height: number; form: number }

/** what \pgfdeclare…shading leaves for a shading with dependencies: \pgf@func…, \pgf@args… (the arguments unexpanded) */
interface Declared { kind: Kind; size: string | PgfPointMacro; spec: string }

/**
 * The local macros of a shading with dependencies: `deps:<name>` (\pgf@deps@pgfshading<name>!, empty without
 * them), `func:<name>` (its arguments), `box:<name>` (its own name \let to empty).
 */
export type ShadingMacros = Readonly<Record<string, string | Declared | null>>

/** the global ones: the shadings made (\pgfsys@…shading's \global\let), \pgf@num…, \pgf@shadingcount, pdfTeX's forms */
interface Globals {
  boxes: Map<string, Made>
  num: Map<string, string>
  count: number
}
const globals = new WeakMap<PgfState, Globals>()
function global(s: PgfState): Globals {
  let g = globals.get(s)
  if (!g) globals.set(s, (g = { boxes: new Map(), num: new Map(), count: 0 }))
  return g
}

const setMacro = (s: PgfState, key: string, value: string | Declared | null) => s.setLocal({ shadings: { ...s.local.shadings, [key]: value } })

/** \pgf@sys@bp@correct: `#1=0.99627#1` */
const bpCorrect = (x: number) => mul("0.99627", x)

/** a colour expression's values in rgb, comma-separated (\pgfutil@extractcolorspec, \pgfutil@convertcolorspec to rgb) */
function rgbValues(colors: Colors, expr: string): string {
  const [model, ...v] = colors.spec(expr).split(" ")
  if (model === "rgb") return v.join(",")
  if (model === "gray") return [v[0], v[0], v[0]].join(",")
  throw new Unsupported(`pgf: a ${model} colour in a shading`)
}

/** \pgf@convertstring (561–627): each stop in the shading model, the colour converted; `;` as `; ` */
function convertString(spec: string, colors: Colors): string {
  let i = 0, conv = ""
  const skip = () => { while (/\s/.test(spec[i] ?? "")) i++ }
  for (;;) {
    skip()
    if (i >= spec.length) return conv
    if (spec[i] === ";") { conv += "; "; i++; continue }
    const m = spec.slice(i).match(/^(rgb|cmyk|gray|color)\(([^)]*)\)=\(([^)]*)\)/)
    if (!m) throw new Unsupported(`pgf: illformed shading specification ${spec}`)
    i += m[0].length
    let values: string
    if (m[1] === "color") values = rgbValues(colors, m[3])
    else {
      colors.define("pgf@tempcol", m[1], m[3])
      values = rgbValues(colors, "pgf@tempcol")
    }
    conv += `rgb(${m[2]})=(${values})`
  }
}

/** a stop of the converted specification */
interface Stop { pos: string; rgb: string }

/** what \pgf@parsefunc (5–33) leaves: the domain and function of the PDF shading, the last position (\pgf@max) */
interface Parsed { doma: string; domb: string; domain: string; func: string; max: number }

/** \pgf@parsefunc{#1} with \pgf@parsefirstrgb, …lastdomrgb, …midrgb, …restrgb (36–102) */
function parseFunc(s: PgfState, spec: string, colors: Colors): Parsed {
  const conv = convertString(spec, colors)
  const items = conv.split("; ")
  const stops: Stop[] = items.map((x) => {
    const m = x.match(/^rgb\(([^)]*)\)=\(([^,]*),([^,]*),([^,]*)\)$/)
    if (!m) throw new Unsupported(`pgf: shading specification ${spec}`)
    // \pgf@getrgbtuplewithmixin: \definecolor{pgfshadetemp}{rgb}{…} and its values in rgb
    colors.define("pgfshadetemp", "rgb", `${m[2]},${m[3]},${m[4]}`)
    return { pos: m[1], rgb: rgbValues(colors, "pgfshadetemp").split(",").join(" ") }
  })
  if (stops.length < 2) throw new Unsupported(`pgf: a shading of one colour ${spec}`)
  const bp = (pos: string) => toNumber(bpCorrect(setLength(pos, s)))
  const doma = bp(stops[0].pos)
  const last = stops[stops.length - 1]
  const max = setLength(last.pos, s)
  const domb = toNumber(bpCorrect(max))
  let funcs = "", bounds = "", encode = "", single = ""
  let prev = stops[0].rgb
  for (let k = 1; k < stops.length; k++) {
    const { pos, rgb } = stops[k]
    if (k < stops.length - 1) {
      bounds += ` ${bp(pos)}`
      encode += " 0 1"
    } else setLength(pos, s)
    single = ` << /FunctionType 2 /Domain [0 1] /C0 [${prev}] /C1 [${rgb}] /N 1 >> `
    funcs += ` << /FunctionType 2 /Domain [${doma} ${domb}] /C0 [${prev}] /C1 [${rgb}] /N 1 >> `
    prev = rgb
  }
  if (bounds === "") return { doma, domb, domain: "0 1", func: `${single} `, max }
  return { doma, domb, domain: `${doma} ${domb}`, func: `<< /FunctionType 3 /Domain [${doma} ${domb}] /Functions [${funcs} ] /Bounds [${bounds}] /Encode [0 1 ${encode}] >> `, max }
}

/** \pgfsys@horishading, \pgfsys@vertshading, \pgfsys@radialshading: the shading's macro */
function make(s: PgfState, d: PgfDriver, kind: Kind, size: string | PgfPointMacro, spec: string, colors: Colors): Made {
  const p = parseFunc(s, spec, colors)
  const fn = `/Function ${p.func}`
  const a = new TexArith(s.units)
  if (d instanceof DvipsDriver) {
    if (kind === "radial") {
      // dvips.def 278–311
      const c = (size as PgfPointMacro)()
      const x = bpCorrect(p.max), y = bpCorrect(p.max)
      const xa = bpCorrect(c.x + p.max), ya = bpCorrect(c.y + p.max)
      const max = mul("2", p.max)
      const text = ` << /ShadingType 3 /ColorSpace /DeviceRGB /Domain [${p.domain}] /Coords [${toNumber(xa)} ${toNumber(ya)} ${p.doma} ${toNumber(x)} ${toNumber(y)} ${p.domb}] ${fn}/Extend [true false] >> shfill `
      return { driver: "dvips", width: max, height: max, text }
    }
    // dvips.def 220–277: the box's width and the rule's height, the rectangle the pattern fills
    const len = setLength(size as string, s)
    const [w, h] = kind === "horizontal" ? [p.max, len] : [len, p.max]
    const coords = kind === "horizontal" ? `${p.doma} 0 ${p.domb} 0` : `0 ${p.doma} 0 ${p.domb}`
    const text = ` ${toNumber(bpCorrect(h))} ${toNumber(bpCorrect(w))} 0 0 pgfe << /PatternType 2 /Shading << /ShadingType 2 /ColorSpace /DeviceRGB /Domain [${p.domain}] /Coords [${coords}] ${fn}>> >> matrix makepattern setpattern fill `
    return { driver: "dvips", width: w, height: h, text }
  }
  if (!(d instanceof PdftexDriver)) throw new Unsupported("pgf: shadings under this driver")
  // pdftex.def 80–138: the form's box (\hbox to w{\vbox to h{\vfil\pdfliteral{/Sh sh}}\hfil}); its resources
  let w: number, h: number, coords: string, type = "2", extend = "false false"
  if (kind === "radial") {
    w = h = mul("2", p.max)
    const c = (size as PgfPointMacro)()
    const xa = bpCorrect(c.x + p.max), ya = bpCorrect(c.y + p.max), x = bpCorrect(p.max)
    coords = `${toNumber(xa)} ${toNumber(ya)} ${p.doma} ${toNumber(x)} ${toNumber(x)} ${p.domb}`
    type = "3"
    extend = "true false"
  } else {
    const len = a.dimen(`${parse(size as string, s.units)}pt`)
    ;[w, h] = kind === "horizontal" ? [p.max, len] : [len, p.max]
    setLength(size as string, s) // \pgf@process{\pgfpoint{\pgf@max}{#2}}
    coords = kind === "horizontal" ? `${p.doma} 0 ${p.domb} 0` : `0 ${p.doma} 0 ${p.domb}`
  }
  // (the \hbox's height: the \vbox's, if not below 0)
  h = Math.max(0, h)
  // \hbox to w{\vbox to h{\vfil\pgfsys@invoke{/Sh sh}}\hfil}
  const box = hpack([vpack([filGlue(), { kind: "whatsit", text: "\\pdfliteral{/Sh sh}" }], { exactly: h }), filGlue()], { exactly: w })
  const form = pdfXform(s, "shading", box, true, "", `/Shading << /Sh << /ShadingType ${type} /ColorSpace /DeviceRGB /Domain [${p.domain}] /Coords [${coords}] ${fn}/Extend [${extend}] >> >>`)
  return { driver: "pdftex", width: w, height: h, form }
}

/**
 * \pgfdeclarehorizontalshading[#1]{#2}{#3}{#4} (321–336), …vertical… (341–356), …radial… (361–376): `deps` the
 * colours it depends on, `size` the height, the width or the centre point. Without dependencies the
 * shading is made at once (global); with them, its arguments are kept (local) and \pgf@shadingcount counts.
 */
export function pgfDeclareShading(s: PgfState, d: PgfDriver, kind: Kind, deps: string, name: string, size: string | PgfPointMacro, spec: string, colors: Colors) {
  const g = global(s)
  const key = `@pgfshading${name}!`
  setMacro(s, `deps:${key}`, deps)
  if (deps === "") {
    g.num.set(key, "")
    g.boxes.set(key, make(s, d, kind, size, spec, colors))
    return
  }
  g.count++
  g.num.set(key, `\\${g.count}\\`)
  setMacro(s, `func:${key}`, { kind, size, spec })
  setMacro(s, `box:${key}`, null)
}

/** the shading's box (\pgfsys@horishading's \hbox …, pdfTeX's \hbox{\pdfrefxform N}) */
function shadingBox(s: PgfState, d: PgfDriver, made: Made): BoxNode {
  if (made.driver === "pdftex") return hpack([{ ...hpack([]), width: made.width, height: made.height, depth: 0, form: made.form }])
  // \hbox to w{\vrule width0pt height h \pgfsys@beginpurepicture \pgfsys@outerinvoke{…}\hss \pgfsys@endpurepicture}
  const outer = s.out
  s.out = [{ kind: "rule", width: 0, height: made.height, depth: null }]
  s.begingroup()
  d.beginPicture()
  s.special(`ps: ${made.text}`)
  s.out.push(ssGlue())
  d.endPicture()
  s.endgroup()
  const list: Node[] = s.out
  s.out = outer
  return hpack(list, { exactly: made.width })
}

/** \pgfuseshading{#1} (516–556) */
export function pgfUseShading(s: PgfState, d: PgfDriver, name: string, colors: Colors) {
  const g = global(s)
  const key = `@pgfshading${name}!`
  const own = s.local.shadings[`box:${key}`]
  if (own === undefined && !g.boxes.has(key)) throw new Unsupported(`pgf: undefined shading "${name}"`)
  // \pgf@num… (undefined: \relax), then each dependency's colour in the shading model
  let adds = g.num.get(key) ?? "\\relax"
  const deps = s.local.shadings[`deps:${key}`]
  if (typeof deps === "string" && deps !== "") {
    for (const dep of deps.split(",")) {
      if (dep !== dep.trim() || dep === "") throw new Unsupported(`pgf: shading dependency "${dep}"`)
      adds += `,${rgbValues(colors, dep)}`
    }
  }
  const xname = `@pgfshading${name}${adds}!`
  let made = g.boxes.get(xname)
  if (made === undefined) {
    const f = s.local.shadings[`func:${key}`]
    if (!f || typeof f !== "object" || !("spec" in f)) throw new Unsupported(`pgf: shading "${name}" without its declaration`)
    s.begingroup()
    made = make(s, d, f.kind, f.size, f.spec, colors)
    s.endgroup()
    g.boxes.set(xname, made)
  }
  const box = shadingBox(s, d, made)
  if (!s.inPicture) { s.out.push(box); return } // \pgfsys@shadingoutsidepgfpicture
  // \pgfsys@shadinginsidepgfpicture (pgfsys.code.tex 1511–1515): centred on the origin, \pgfqbox'ed
  const b1 = hpack([box]) // \pgf@makehbox
  const b2 = hpack([glue(-mul(".5", b1.width)), { ...hpack([b1]), shift: mul(".5", b1.height) }])
  d.hbox(b2, true)
}

/**
 * \pgfshadepath{#1}{#2} (686–760): the shading, rotated by #2, scaled to the path's extent (50bp to it) and
 * clipped by the path, which stays the current path. With no path, a warning (only in the log).
 */
export function pgfShadePath(s: PgfState, d: PgfDriver, name: string, angle: string, colors: Colors) {
  const q = s.path
  if (q.minX === 16000 * 65536) return
  s.begingroup()
  const xb = mul(".5", q.maxX) + mul(".5", q.minX)
  const yb = mul(".5", q.maxY) + mul(".5", q.minY)
  const a = parse(angle, s.units)
  const sin = trig("sin", a, s.units), cos = trig("cos", a, s.units)
  const xa = q.maxX - q.minX, ya = q.maxY - q.minY
  const abssin = parse(`abs(${sin})`, s.units), abscos = parse(`abs(${cos})`, s.units)
  let xc = mul(abscos, xa) + mul(abssin, ya)
  let yc = mul(abssin, xa) + mul(abscos, ya)
  const f = parse(`.01992528/${parse(`${abscos}+${abssin}`, s.units)}`, s.units)
  xc = mul(f, xc)
  yc = mul(f, yc)
  const tiny = new TexArith(s.units).dimen("0.0001pt")
  const none = (v: number) => v < tiny && v > -tiny
  if (!none(xc) && !none(yc)) {
    d.beginscope()
    invoke(s, d)
    d.clipnext()
    d.discardpath()
    d.transformcm("1", "0", "0", "1", xb, yb)
    const x = new TexArith(s.units).dimen(`${sin}pt`)
    d.transformcm(cos, sin, toNumber(-x), cos, 0, 0)
    d.transformcm(toNumber(xc), "0", "0", toNumber(yc), 0, 0)
    pgfUseShading(s, d, name, colors)
    d.endscope()
  }
  s.endgroup()
}
