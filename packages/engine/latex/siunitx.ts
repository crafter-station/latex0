// siunitx v3.4 (TeX Live 2025) at its defaults: \num, \si and \unit, \SI and \qty, \numrange, \SIrange and
// \qtyrange, \numlist, \SIlist and \qtylist, and \ang, as what siunitx typesets in text: each number and each
// unit a formula of its own (\ensuremath), joined by text.
//
// A number (\siunitx_number_parse:nN, \siunitx_number_output:N): the sign (a + goes, a zero has none), the
// integer part without leading zeros (0 when empty), the decimal part (none when empty), the uncertainty in
// compact form (value and uncertainty padded to the same number of decimals; none when zero) and
// \times10^{exponent} (no exponent 0; 10^{n} alone without a mantissa). Integer and exponent digits are
// grouped in threes from the right, decimals from the left, with \, when a part has five or more.
//
// A unit (\siunitx_unit_format:nN): each unit's prefix and symbol in \mathrm, its power ^{n} after it, units
// joined by \, (inter-unit-product); \per makes the next unit's power negative (per-mode = power). \micro is
// \text{\textmu}, \ohm \mathrm{\Omega}, \degree {}^{\circ}, \arcminute {}' and \arcsecond {}''. A literal unit
// (no macros) is \mathrm{letters}, with . and ~ as products, / as it is, and ^ a power.
//
// A quantity (\siunitx_quantity_print:nn): the number, \nobreak, \, (quantity-product) and the unit; a
// \degree, \arcminute or \arcsecond alone has no \, and \kWh none between its units. Ranges and lists put
// \space\text{to}\space, ",\space" and \space\text{and}\space between their numbers or quantities (range-units
// and list-units = repeat); \ang's degrees, minutes and seconds are numbers and units joined by \nobreak.
//
// Options ([…], \sisetup) and anything else siunitx reads differently are Unsupported.

import type { BoxNode } from "../layout/nodes"
import { mathCharNoad, groupField, ORD, type MItem, type Noad } from "../mathlayout/mlist"
import type { MathData } from "../mathlayout/data"
import { Unsupported } from "./unsupported"

/** What siunitx puts in the paragraph: formulas, \nobreak, the quantity's \, and text (an \mbox for \text{…}). */
export type SiPart = { kind: "formula"; list: MItem[] } | { kind: "nobreak" } | { kind: "thinspace" } | { kind: "text"; src: string } | { kind: "mbox"; src: string }

/** The commands and how many arguments each takes */
export const SI_COMMANDS: Record<string, number> = { num: 1, si: 1, unit: 1, SI: 2, qty: 2, numrange: 2, SIrange: 3, qtyrange: 3, numlist: 1, SIlist: 2, qtylist: 2, ang: 1 }

const PREFIXES: Record<string, string> = {
  quecto: "q", ronto: "r", yocto: "y", zepto: "z", atto: "a", femto: "f", pico: "p", nano: "n", micro: "µ", milli: "m", centi: "c",
  deci: "d", deca: "da", deka: "da", hecto: "h", kilo: "k", mega: "M", giga: "G", tera: "T", peta: "P", exa: "E", zetta: "Z",
  yotta: "Y", ronna: "R", quetta: "Q", kibi: "Ki", mebi: "Mi", gibi: "Gi", tebi: "Ti", pebi: "Pi", exbi: "Ei", zebi: "Zi", yobi: "Yi",
}
/** Units: a symbol (° ′ ″ Ω µ stand for the constructions above), or the units and prefixes a unit is made of */
const UNITS: Record<string, string> = {
  metre: "m", meter: "m", mole: "mol", second: "s", ampere: "A", kelvin: "K", candela: "cd", gram: "g", becquerel: "Bq",
  degreeCelsius: "°C", coulomb: "C", farad: "F", gray: "Gy", hertz: "Hz", henry: "H", joule: "J", katal: "kat", lumen: "lm",
  lux: "lx", newton: "N", ohm: "Ω", pascal: "Pa", radian: "rad", siemens: "S", sievert: "Sv", steradian: "sr", tesla: "T",
  volt: "V", watt: "W", weber: "Wb", astronomicalunit: "au", bel: "B", dalton: "Da", day: "d", electronvolt: "eV", hectare: "ha",
  hour: "h", litre: "L", liter: "L", minute: "min", neper: "Np", tonne: "t", arcminute: "′", arcsecond: "″", degree: "°",
  percent: "%", bit: "bit", byte: "B",
}
const COMPOUNDS: Record<string, string> = {
  kilogram: "kilo gram", decibel: "deci bel",
  ...abbreviations({ ampere: "A p n u m k", hertz: "Hz m k M G T", mole: "mol f p n u m k", volt: "V p n u m k", litre: "l h m u L h m u",
    gram: "g f p n u m k", watt: "W n u m k M G", joule: "J u m k", electronvolt: "eV m k M G T", metre: "m p n u m c d k",
    kelvin: "K", farad: "F f p n u m", henry: "H f p n u m", coulomb: "C n u m", tesla: "T u m", newton: "N m k M",
    pascal: "Pa k M G", ohm: "ohm m k M", second: "s a f p n u m" }),
  dB: "deci bel",
}
/** siunitx's abbreviations (\kg, \mA, \kohm…): a symbol, then the prefixes it takes ("l h m u L h m u": \l \hl \ml \ul, \L \hL \mL \uL) */
function abbreviations(table: Record<string, string>): Record<string, string> {
  const letter: Record<string, string> = { a: "atto", f: "femto", p: "pico", n: "nano", u: "micro", m: "milli", c: "centi", d: "deci", h: "hecto", k: "kilo", M: "mega", G: "giga", T: "tera" }
  const out: Record<string, string> = {}
  for (const [unit, spec] of Object.entries(table)) {
    let base = ""
    for (const w of spec.split(" ")) {
      if (!base || w === "L") { base = w; if (base !== unit) out[base] = unit; continue } // (\ohm is the unit)
      out[w + base] = `${letter[w]} ${unit}`
    }
  }
  return out
}
/** prefix powers before a unit and postfix powers after one */
const PREPOWERS: Record<string, string> = { square: "2", cubic: "3" }
const POSTPOWERS: Record<string, string> = { squared: "2", cubed: "3" }

/** The builder's view of the document: the math data and \text{\textmu} at the current size. */
export interface SiContext { data: MathData; micro: () => BoxNode }

/** One siunitx command with its arguments, as paragraph material. */
export function siunitx(cmd: string, args: string[], cx: SiContext): SiPart[] {
  // (list-pair-separator and list-final-separator are the same: \space\text{and}\space)
  const join = (items: SiPart[][], sep: SiPart[], last: SiPart[]): SiPart[] =>
    items.flatMap((x, i) => (i === 0 ? x : [...(i === items.length - 1 ? last : sep), ...x]))
  const phrase = (w: string): SiPart[] => [{ kind: "text", src: " " }, { kind: "mbox", src: w }, { kind: "text", src: " " }]
  const comma: SiPart[] = [{ kind: "text", src: ", " }]
  const items = (s: string) => s.split(";").map((x) => x.trim())
  switch (cmd) {
    case "num": return [formula(number(args[0], cx.data))]
    case "si": case "unit": return [formula(unit(args[0], cx))]
    case "SI": case "qty": return quantity(args[0], args[1], cx)
    case "numrange": return [formula(number(args[0], cx.data)), ...phrase("to"), formula(number(args[1], cx.data))]
    case "SIrange": case "qtyrange": return [...quantity(args[0], args[2], cx), ...phrase("to"), ...quantity(args[1], args[2], cx)]
    case "numlist": return join(items(args[0]).map((n) => [formula(number(n, cx.data))]), comma, phrase("and"))
    case "SIlist": case "qtylist": return join(items(args[0]).map((n) => quantity(n, args[1], cx)), comma, phrase("and"))
    case "ang": {
      const parts = items(args[0])
      if (parts.length > 3 || parts.every((p) => p === "")) throw new Unsupported(`\\ang{${args[0]}}`)
      const out: SiPart[] = []
      parts.forEach((p, i) => {
        if (p === "") return
        if (out.length) out.push({ kind: "nobreak" })
        out.push(formula(number(p, cx.data)), { kind: "nobreak" }, formula(unit(["\\degree", "\\arcminute", "\\arcsecond"][i], cx)))
      })
      return out
    }
  }
  throw new Unsupported(`\\${cmd}`)
}

const formula = (list: MItem[]): SiPart => ({ kind: "formula", list })

function quantity(num: string, u: string, cx: SiContext): SiPart[] {
  const single = u.trim().match(/^\\([A-Za-z]+)$/)?.[1]
  const product: SiPart[] = single === "degree" || single === "arcminute" || single === "arcsecond" ? [] : [{ kind: "thinspace" }]
  return [formula(number(num, cx.data)), { kind: "nobreak" }, ...product, formula(unit(u, cx))]
}

// ---- numbers ----

/** The digits of a part with \, between groups of three: from the right for an integer part, from the left for decimals. */
function digits(s: string, fromLeft: boolean, data: MathData): MItem[] {
  const out: MItem[] = []
  for (let i = 0; i < s.length; i++) {
    const left = fromLeft ? i : s.length - i
    if (s.length >= 5 && i > 0 && left % 3 === 0) out.push({ kind: "muglue", spec: data.muskips.thinmuskip })
    out.push(ch(s[i], data))
  }
  return out
}

const ch = (c: string, data: MathData, fam = -1): Noad => mathCharNoad(data.mathcodes[c.charCodeAt(0)], fam)
const stripZeros = (s: string) => s.replace(/^0+(?=\d)/, "")

function number(input: string, data: MathData): MItem[] {
  const src = input.replace(/\\pm(?![A-Za-z])/g, "±").replace(/\+-/g, "±").replace(/\s+/g, "")
  const m = src.match(/^([+\-±]?)(\d*)(?:([.,])(\d*))?(?:\((\d+)\)|±(\d*)(?:[.,](\d*))?)?(?:[eEdD]([+-]?)(\d+))?$/)
  if (!m || (m[2] === "" && m[3] === undefined && m[8] === undefined) || (m[6] === "" && m[7] === undefined)) throw new Unsupported(`siunitx number ${input}`)
  const [, sign, intIn, marker, decIn = "", paren, uInt, uDec = "", expSign, expIn] = m
  const out: MItem[] = []
  const mantissa = intIn !== "" || marker !== undefined
  if (mantissa) {
    let int = stripZeros(intIn) || "0", dec = decIn, unc = paren ?? ""
    if (uInt !== undefined) { // compact uncertainty: both to the same number of decimals; a zero uncertainty goes
      const d = Math.max(dec.length, uDec.length)
      dec = dec.padEnd(d, "0")
      unc = stripZeros(uInt + uDec.padEnd(d, "0"))
      if (/^0+$/.test(unc)) unc = ""
    }
    const zero = /^0*$/.test(int + dec)
    if (sign === "-" && !zero) out.push(ch("-", data))
    else if (sign === "±") out.push(mathCharNoad(data.symbols.pm))
    out.push(...digits(int, false, data))
    if (dec) out.push(ch(".", data), ...digits(dec, true, data))
    if (unc) out.push(ch("(", data), ...unc.split("").map((c) => ch(c, data)), ch(")", data))
  } else if (sign || paren !== undefined || uInt !== undefined) throw new Unsupported(`siunitx number ${input}`)
  const exp = expIn === undefined ? "" : stripZeros(expIn)
  if (exp !== "" && exp !== "0") {
    if (mantissa) out.push(mathCharNoad(data.symbols.times))
    const ten: Noad = ch("0", data)
    ten.sup = groupField([...(expSign === "-" ? [ch("-", data)] : []), ...digits(exp, false, data)])
    out.push(ch("1", data), ten)
  } else if (!mantissa) throw new Unsupported(`siunitx number ${input}`)
  return out
}

// ---- units ----

interface UnitPart { symbol: string; power: string | null }

function unit(input: string, cx: SiContext): MItem[] {
  const src = input.trim()
  if (src === "") throw new Unsupported("siunitx: an empty unit")
  if (!src.includes("\\")) return literalUnit(src, cx)
  if (src.match(/^\\kWh$/)) return [unitNoad({ symbol: "kW", power: null }, cx), unitNoad({ symbol: "h", power: null }, cx)] // (inter-unit-product empty)
  // the macros, and the braced arguments of \tothe and \raiseto
  const toks: string[] = []
  for (let i = 0; i < src.length;) {
    if (/\s/.test(src[i])) { i++; continue }
    const cs = src.slice(i).match(/^\\([A-Za-z]+)/)
    if (!cs) throw new Unsupported(`siunitx unit ${input}`)
    toks.push(cs[1]); i += cs[0].length
    if (cs[1] === "tothe" || cs[1] === "raiseto") {
      const arg = src.slice(i).match(/^\s*\{\s*(-?\d+(?:\.\d+)?)\s*\}/)
      if (!arg) throw new Unsupported(`siunitx unit ${input}`)
      toks.push(arg[1]); i += arg[0].length
    }
  }
  const parts: (UnitPart & { per: boolean })[] = []
  let prefix = "", prepower: string | null = null, per = false
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    if (t === "kWh") throw new Unsupported("siunitx: \\kWh with other units")
    if (t in COMPOUNDS) {
      const ex = COMPOUNDS[t].split(" ")
      if (prefix && ex.length > 1) throw new Unsupported(`siunitx: a prefix before \\${t}`)
      toks.splice(i + 1, 0, ...ex); continue
    }
    if (t in PREFIXES) { if (prefix) throw new Unsupported(`siunitx unit ${input}`); prefix = PREFIXES[t]; continue }
    if (t in PREPOWERS || t === "raiseto") {
      if (prepower !== null || prefix) throw new Unsupported(`siunitx unit ${input}`)
      prepower = t === "raiseto" ? toks[++i] : PREPOWERS[t]; continue
    }
    if (t === "per") { if (per || prefix || prepower !== null) throw new Unsupported(`siunitx unit ${input}`); per = true; continue }
    if (t in UNITS) { parts.push({ symbol: prefix + UNITS[t], power: prepower, per }); prefix = ""; prepower = null; per = false; continue }
    if (t in POSTPOWERS || t === "tothe") {
      const last = parts[parts.length - 1]
      if (!last || last.power !== null || prefix || prepower !== null || per) throw new Unsupported(`siunitx unit ${input}`)
      last.power = t === "tothe" ? toks[++i] : POSTPOWERS[t]; continue
    }
    throw new Unsupported(`siunitx unit \\${t}`)
  }
  if (prefix || prepower !== null || per || !parts.length) throw new Unsupported(`siunitx unit ${input}`)
  const out: MItem[] = []
  for (const p of parts) {
    if (out.length) out.push({ kind: "muglue", spec: cx.data.muskips.thinmuskip })
    const power = p.per ? (p.power === null ? "-1" : p.power.startsWith("-") ? p.power.slice(1) : "-" + p.power) : p.power
    out.push(unitNoad({ symbol: p.symbol, power }, cx))
  }
  return out
}

/** A literal unit: letters in \mathrm, . and ~ for products, / as it is, ^ a power after the letters before it */
function literalUnit(src: string, cx: SiContext): MItem[] {
  const out: MItem[] = []
  let cur = "", sep = false
  const flush = (power: string | null = null) => {
    if (!cur) { if (power !== null) throw new Unsupported(`siunitx unit ${src}`); return }
    if (sep && out.length) out.push({ kind: "muglue", spec: cx.data.muskips.thinmuskip })
    sep = false
    out.push(unitNoad({ symbol: cur, power }, cx)); cur = ""
  }
  for (let i = 0; i < src.length;) {
    const c = src[i]
    if (/[A-Za-z]/.test(c)) { cur += c; i++ }
    else if (c === "." || c === "~") { flush(); sep = true; i++ }
    else if (c === "/") { flush(); out.push(ch("/", cx.data)); i++ }
    else if (c === "^") {
      const p = src.slice(i + 1).match(/^(\d)|^\{(-?\d+)\}/)
      if (!p) throw new Unsupported(`siunitx unit ${src}`)
      flush(p[1] ?? p[2]); i += 1 + p[0].length
    } else throw new Unsupported(`siunitx unit ${src}`)
  }
  flush()
  return out
}

/** \mathrm{symbol}^{power}: a math group whose lone ord gives up its nucleus (§ 1186) */
function unitNoad(p: UnitPart, cx: SiContext): Noad {
  const { data } = cx
  const empty = (sup: MItem[]): Noad => ({ noad: ORD, nucleus: { kind: "mlist", list: [] }, sup: groupField(sup), sub: null }) // {}^{…}
  const items: MItem[] = []
  for (const c of p.symbol) {
    if (c === "°") items.push(empty([mathCharNoad(data.symbols.circ)]))
    else if (c === "′" || c === "″") items.push(empty(Array.from({ length: c === "′" ? 1 : 2 }, () => mathCharNoad(data.symbols.prime))))
    else if (c === "Ω") items.push(mathCharNoad(data.symbols.Omega)) // (class 7: family 0)
    else if (c === "µ") items.push({ noad: ORD, nucleus: { kind: "box", box: cx.micro() }, sup: null, sub: null })
    else if (c === "%") items.push(ch("%", data)) // \% is \chardef'd: its \mathcode
    else items.push(ch(c, data, 0))
  }
  const power = p.power === null ? null : groupField(p.power.split("").map((c) => ch(c, data)))
  return { noad: ORD, nucleus: groupField(items), sup: power, sub: null }
}
