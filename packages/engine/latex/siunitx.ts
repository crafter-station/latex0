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
// In math mode (\siunitx_print_math:n with \fam = -1) the numbers and units join the formula: \nobreak is a
// penalty, \, \mskip\thinmuskip, the phrases' spaces are \ (the text font's space, § 1045) and their \text{…}
// amstext's \mathchoice of \hbox{…}, Unsupported in script styles (another font size), like \micro's.
//
// An S column's entry (siTableCell): text in braces, or a number in boxes aligned on its decimal marker or by the
// model table-format gives.
//
// Options (\usepackage[…]{siunitx}, \sisetup{…} in the preamble, a command's […]): round-mode (none, places,
// figures: rounded half up on the digits, padded with zeros, a zero without its minus), round-precision,
// round-pad, round-zero-positive; group-digits, group-separator and group-minimum-digits; output-decimal-marker
// and exponent-product (a , as \mathord{,}); uncertainty-mode = separate (separate-uncertainty): value \pm
// uncertainty, in brackets before an exponent and in a quantity (separate-uncertainty-units = bracket); per-mode
// = symbol (numerator, \! after a power, per-symbol, the denominator in brackets when its last unit ends a run
// of two or more) and fraction (\frac{numerator}{denominator}, 1 for none); inter-unit-product and
// quantity-product; range-phrase and the list separators (text then, a formula in math mode). Any other key or
// value, and anything else siunitx reads differently, is Unsupported.

import { FILL, filGlue, glue, kern, penalty, ssGlue, type BoxNode, type Node } from "../layout/nodes"
import { hpack } from "../layout/pack"
import { SPACE, SPACE_SHRINK, SPACE_STRETCH, type Font } from "../layout/font"
import { mathCharNoad, groupField, ORD, SCRIPT, type ChoiceItem, type MItem, type Noad } from "../mathlayout/mlist"
import type { MathData } from "../mathlayout/data"
import { parseMath } from "../mathlayout/parse"
import { Unsupported } from "./unsupported"

/** What siunitx puts in the paragraph: formulas, \nobreak and text (an \mbox for \text{…}; an option's value, such
 *  as quantity-product's \,, as source) */
export type SiPart = { kind: "formula"; list: MItem[] } | { kind: "nobreak" } | { kind: "text"; src: string } | { kind: "mbox"; src: string } | { kind: "source"; src: string }

/** The options modeled (token lists as their source) */
export interface SiOptions {
  roundMode: "none" | "places" | "figures"; roundPrecision: number; roundPad: boolean; roundZeroPositive: boolean
  groupInteger: boolean; groupDecimal: boolean; groupMinimum: number; groupSeparator: string
  decimalMarker: string; exponentProduct: string; separateUncertainty: boolean
  perMode: "power" | "symbol" | "fraction"; perSymbol: string; interUnitProduct: string; quantityProduct: string
  /** null: the default, \TextOrMath{\space}{\ }\text{to}… and ",\TextOrMath{\space}{\ }" */
  rangePhrase: string | null; listSeparator: string | null; listFinalSeparator: string | null; listPairSeparator: string | null
  /** S columns: table-alignment-mode (table-format sets format) and table-format */
  tableMode: "marker" | "format"; tableFormat: string
}
export const SI_DEFAULTS: SiOptions = {
  roundMode: "none", roundPrecision: 2, roundPad: true, roundZeroPositive: true,
  groupInteger: true, groupDecimal: true, groupMinimum: 5, groupSeparator: "\\,",
  decimalMarker: ".", exponentProduct: "\\times", separateUncertainty: false,
  perMode: "power", perSymbol: "/", interUnitProduct: "\\,", quantityProduct: "\\,",
  rangePhrase: null, listSeparator: null, listFinalSeparator: null, listPairSeparator: null, tableMode: "marker", tableFormat: "2.2",
}

/** A key–value list (l3keys: commas outside braces, spaces around keys and values trimmed, one level of braces
 *  stripped from a value) applied to options */
export function siOptions(src: string, base: SiOptions): SiOptions {
  const o = { ...base }
  const items: string[] = []
  let depth = 0, cur = ""
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (c === "\\") { cur += c + (src[++i] ?? ""); continue } // (a control symbol: \, is no comma)
    if (c === "{") depth++
    else if (c === "}") depth--
    if (c === "," && depth === 0) { items.push(cur); cur = "" } else cur += c
  }
  if (depth !== 0) throw new Unsupported(`siunitx options ${src}`)
  items.push(cur)
  for (const item of items) {
    if (item.trim() === "") continue
    const eq = item.indexOf("=")
    const key = (eq < 0 ? item : item.slice(0, eq)).trim()
    let value = eq < 0 ? null : item.slice(eq + 1).trim()
    if (value !== null && value.startsWith("{") && value.endsWith("}") && balanced(value.slice(1, -1))) value = value.slice(1, -1)
    const bad = () => new Unsupported(`siunitx option ${item.trim()}`)
    const bool = () => { if (value === null || value === "true") return true; if (value === "false") return false; throw bad() }
    const int = () => { if (value === null || !/^-?\d+$/.test(value)) throw bad(); return Number(value) }
    const tl = () => { if (value === null) throw bad(); return value }
    const choice = <T extends string>(...cs: T[]): T => { if (!cs.includes(value as T)) throw bad(); return value as T }
    switch (key) {
      case "round-mode": o.roundMode = choice("none", "places", "figures"); break
      case "round-precision": o.roundPrecision = int(); if (o.roundPrecision < 0) throw bad(); break
      case "round-pad": o.roundPad = bool(); break
      case "round-zero-positive": o.roundZeroPositive = bool(); break
      case "group-digits": {
        const g = value === null ? "all" : choice("all", "none", "integer", "decimal")
        o.groupInteger = g === "all" || g === "integer"; o.groupDecimal = g === "all" || g === "decimal"; break
      }
      case "group-minimum-digits": o.groupMinimum = int(); break
      case "group-separator": o.groupSeparator = tl(); break
      case "output-decimal-marker": o.decimalMarker = tl(); break
      case "exponent-product": o.exponentProduct = tl(); break
      case "uncertainty-mode": o.separateUncertainty = choice("compact", "separate") === "separate"; break
      case "separate-uncertainty": o.separateUncertainty = bool(); break // (v2's, now uncertainty-mode)
      case "per-mode": o.perMode = choice("power", "symbol", "fraction"); break
      case "per-symbol": o.perSymbol = tl(); break
      case "inter-unit-product": o.interUnitProduct = tl(); break
      case "quantity-product": o.quantityProduct = tl(); break
      case "range-phrase": o.rangePhrase = tl(); break
      case "list-separator": o.listSeparator = tl(); break
      case "list-final-separator": o.listFinalSeparator = tl(); break
      case "list-pair-separator": o.listPairSeparator = tl(); break
      case "table-format": o.tableFormat = tl(); o.tableMode = "format"; break
      case "table-alignment-mode": o.tableMode = choice("marker", "format"); break
      default: throw bad()
    }
  }
  return o
}

const balanced = (s: string) => { let d = 0; for (const c of s) { if (c === "{") d++; else if (c === "}" && --d < 0) return false } return d === 0 }

/** An option's token list in a formula */
function mathOf(src: string, data: MathData): MItem[] {
  try { return parseMath(src, data) } catch (e) { throw e instanceof Unsupported ? e : new Unsupported(`siunitx: ${(e as Error).message}`) }
}
/** A token list siunitx puts in text, which the paragraph reads: characters and \, */
function textOf(src: string): SiPart[] {
  if (src === "") return []
  if (!/^(?:[A-Za-z0-9 ,;:.\-\/()]|\\,)*$/.test(src)) throw new Unsupported(`siunitx: text ${src}`)
  return [{ kind: "source", src }]
}
/** output-decimal-marker and group-separator: a , as \mathord{,} */
const markerOf = (src: string, data: MathData): MItem[] => (src === "," ? [{ noad: ORD, nucleus: groupField(mathOf(",", data)), sup: null, sub: null }] : mathOf(src, data))

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

/** The builder's view of the document: the math data, \text{\textmu} at the current size, the current text font
 *  and \text{…} in it (in math mode) */
export interface SiContext { data: MathData; micro: () => BoxNode; font: Font; text: (src: string) => BoxNode; options: SiOptions }

/** One siunitx command in math mode, with \fam in force: its parts in the formula */
export function siunitxMath(cmd: string, opt: string | undefined, args: string[], fam: number, cx: SiContext): MItem[] {
  if (fam !== -1) throw new Unsupported(`\\${cmd} in a math alphabet`) // (\mathrm{…} around it)
  const out: MItem[] = []
  for (const x of siunitx(cmd, opt, args, cx)) {
    if (x.kind === "formula") out.push(...x.list)
    else if (x.kind === "nobreak") out.push(penalty(10000))
    else if (x.kind === "mbox") out.push(textChoice(cx.text(x.src)))
    else if (x.kind === "source") out.push(...mathOf(x.src, cx.data))
    else for (const c of x.src) out.push(c === " " ? glue(cx.font.params[SPACE], cx.font.params[SPACE_STRETCH], 0, cx.font.params[SPACE_SHRINK]) : ch(c, cx.data))
  }
  return out
}

/** amstext's \text{…} in math: {\mathchoice{\hbox{…}}…}, a math group around the choice (no lone ord to give up,
 *  § 1186), the box an ord's nucleus (§ 1076); its script sizes are not modeled */
const textChoice = (box: BoxNode): Noad => {
  const choice: ChoiceItem = {
    kind: "choice",
    choose: (style) => {
      if (style >= SCRIPT) throw new Unsupported("siunitx: \\text in a script style")
      return [{ noad: ORD, nucleus: { kind: "box", box }, sup: null, sub: null }]
    },
  }
  return { noad: ORD, nucleus: { kind: "mlist", list: [choice] }, sup: null, sub: null }
}

/** One siunitx command with its options and arguments, as paragraph material. */
export function siunitx(cmd: string, opt: string | undefined, args: string[], cx: SiContext): SiPart[] {
  const o = opt === undefined ? cx.options : siOptions(opt, cx.options)
  const { data } = cx
  const phrase = (w: string): SiPart[] => [{ kind: "text", src: " " }, { kind: "mbox", src: w }, { kind: "text", src: " " }]
  const or = (src: string | null, dflt: SiPart[]) => (src === null ? dflt : textOf(src))
  const comma: SiPart[] = [{ kind: "text", src: ", " }]
  /** \__siunitx_compound_print:nnnN: two items with the pair separator, more with the separator and the final one */
  const join = (items: SiPart[][]): SiPart[] => items.length === 2
    ? [...items[0], ...or(o.listPairSeparator, phrase("and")), ...items[1]]
    : items.flatMap((x, i) => (i === 0 ? x : [...(i === items.length - 1 ? or(o.listFinalSeparator, phrase("and")) : or(o.listSeparator, comma)), ...x]))
  const items = (s: string) => s.split(";").map((x) => x.trim())
  const num = (n: string) => formula(numberItems(number(n, o, data), o, data, false))
  switch (cmd) {
    case "num": return [num(args[0])]
    case "si": case "unit": return [formula(unit(args[0], cx, o))]
    case "SI": case "qty": return quantity(args[0], args[1], cx, o)
    case "numrange": return [num(args[0]), ...or(o.rangePhrase, phrase("to")), num(args[1])]
    case "SIrange": case "qtyrange": return [...quantity(args[0], args[2], cx, o), ...or(o.rangePhrase, phrase("to")), ...quantity(args[1], args[2], cx, o)]
    case "numlist": return join(items(args[0]).map((n) => [num(n)]))
    case "SIlist": case "qtylist": return join(items(args[0]).map((n) => quantity(n, args[1], cx, o)))
    case "ang": {
      const parts = items(args[0])
      if (parts.length > 3 || parts.every((p) => p === "")) throw new Unsupported(`\\ang{${args[0]}}`)
      const out: SiPart[] = []
      parts.forEach((p, i) => {
        if (p === "") return
        if (out.length) out.push({ kind: "nobreak" })
        out.push(num(p), { kind: "nobreak" }, formula(unit(["\\degree", "\\arcminute", "\\arcsecond"][i], cx, o)))
      })
      return out
    }
  }
  throw new Unsupported(`\\${cmd}`)
}

const formula = (list: MItem[]): SiPart => ({ kind: "formula", list })

function quantity(n: string, u: string, cx: SiContext, o: SiOptions): SiPart[] {
  const single = u.trim().match(/^\\([A-Za-z]+)$/)?.[1]
  // (\degree, \arcminute and \arcsecond declare quantity-product = {})
  const product: SiPart[] = single === "degree" || single === "arcminute" || single === "arcsecond" ? [] : textOf(o.quantityProduct)
  const us = unit(u, cx, o), num = formula(numberItems(number(n, o, cx.data), o, cx.data, true))
  // (\siunitx_quantity_print:nn: a unit that starts with 1 goes without it, \nobreak and the product)
  if (unitOne.has(us[0])) return [num, formula(us.slice(1))]
  return [num, { kind: "nobreak" }, ...product, formula(us)]
}

// ---- numbers ----

/** A number as \siunitx_number_output:N leaves it: the sign and integer digits; the decimal marker and digits with
 *  the compact uncertainty; the separate uncertainty (\pm…); the exponent product; the exponent (10^{…}) */
interface NumberOut { int: MItem[]; dec: MItem[]; unc: MItem[]; product: MItem[]; exp: MItem[] }

/** \num's brackets around a separate uncertainty before an exponent (bracket-ambiguous-numbers); a quantity's
 *  around any separate uncertainty (separate-uncertainty-units = bracket) */
function numberItems(n: NumberOut, o: SiOptions, data: MathData, inQuantity: boolean): MItem[] {
  if (n.unc.length && (inQuantity || n.exp.length)) return [ch("(", data), ...n.int, ...n.dec, ...n.unc, ch(")", data), ...n.product, ...n.exp]
  return [...n.int, ...n.dec, ...n.unc, ...n.product, ...n.exp]
}

/** The digits of a part, grouped in threes (from the right for an integer part, from the left for decimals) when
 *  it has group-minimum-digits or more and group-digits says so */
function digits(s: string, part: "integer" | "decimal", o: SiOptions, data: MathData): MItem[] {
  const out: MItem[] = []
  const grouped = (part === "integer" ? o.groupInteger : o.groupDecimal) && s.length >= o.groupMinimum
  for (let i = 0; i < s.length; i++) {
    const left = part === "decimal" ? i : s.length - i
    if (grouped && i > 0 && left % 3 === 0) out.push(...markerOf(o.groupSeparator, data))
    out.push(ch(s[i], data))
  }
  return out
}
/** \__siunitx_number_output_decimal:nn: the marker and the digits, none for no digits */
const decimal = (dec: string, o: SiOptions, data: MathData): MItem[] => (dec ? [...markerOf(o.decimalMarker, data), ...digits(dec, "decimal", o, data)] : [])

const ch = (c: string, data: MathData, fam = -1): Noad => mathCharNoad(data.mathcodes[c.charCodeAt(0)], fam)
const stripZeros = (s: string) => s.replace(/^0+(?=\d)/, "")

/**
 * \__siunitx_number_round:nnnn (round-direction = nearest, round-half = up): the digits less their last `drop`,
 * up by one when the first dropped is 5 or more; whether the carry ran through all the significant digits kept
 * (one more of them)
 */
function roundDigits(int: string, dec: string, drop: number): { int: string; dec: string; carried: boolean } {
  const all = int + dec, keep = all.slice(0, all.length - drop)
  let digitsOut = keep, carried = false
  if (all[all.length - drop] >= "5") {
    const d = keep.split("").map(Number)
    let i = d.length - 1
    for (; i >= 0 && d[i] === 9; i--) d[i] = 0
    carried = /^0*9+$/.test(keep)
    if (i >= 0) d[i]++
    else d.unshift(1)
    digitsOut = d.join("")
  }
  const decLen = Math.max(dec.length - drop, 0)
  const intOut = digitsOut.slice(0, digitsOut.length - decLen) + "0".repeat(Math.max(drop - dec.length, 0))
  return { int: stripZeros(intOut) || "0", dec: digitsOut.slice(digitsOut.length - decLen), carried }
}

function number(input: string, o: SiOptions, data: MathData): NumberOut {
  const src = input.replace(/\\pm(?![A-Za-z])/g, "±").replace(/\+-/g, "±").replace(/\s+/g, "")
  const m = src.match(/^([+\-±]?)(\d*)(?:([.,])(\d*))?(?:\((\d+)\)|±(\d*)(?:[.,](\d*))?)?(?:[eEdD]([+-]?)(\d+))?$/)
  if (!m || (m[2] === "" && m[3] === undefined && m[8] === undefined) || (m[6] === "" && m[7] === undefined)) throw new Unsupported(`siunitx number ${input}`)
  const [, signIn, intIn, marker, decIn = "", paren, uInt, uDec = "", expSign, expIn] = m
  const out: NumberOut = { int: [], dec: [], unc: [], product: [], exp: [] }
  const mantissa = intIn !== "" || marker !== undefined
  if (mantissa) {
    let int = stripZeros(intIn) || "0", dec = decIn, unc = paren ?? ""
    if (uInt !== undefined) { // compact uncertainty: both to the same number of decimals; a zero uncertainty goes
      const d = Math.max(dec.length, uDec.length)
      dec = dec.padEnd(d, "0")
      unc = stripZeros(uInt + uDec.padEnd(d, "0"))
      if (/^0+$/.test(unc)) unc = ""
    }
    // a zero has no sign (retain-negative-zero = false)
    let sign = signIn === "-" && /^0*$/.test(int + dec) ? "" : signIn
    if (o.roundMode !== "none" && (paren !== undefined || uInt !== undefined)) {
      if (!unc) throw new Unsupported(`siunitx: rounding ${input}`) // (a zero uncertainty)
    } else if (o.roundMode === "places" || o.roundMode === "figures" && !/^0*$/.test(int + dec)) { // (none with an uncertainty; figures leaves a zero)
      let drop: number
      if (o.roundMode === "places") drop = dec.length - o.roundPrecision
      else { // figures: from the first non-zero digit
        if (o.roundPrecision === 0) throw new Unsupported("siunitx: round-precision = 0 with figures")
        drop = (int + dec).replace(/^0+/, "").length - o.roundPrecision
      }
      if (drop > 0) {
        const r = roundDigits(int, dec, drop)
        if (r.carried && o.roundMode === "figures") r.dec = r.dec.slice(0, -1) // one more significant digit: a decimal goes
        int = r.int; dec = r.dec
      } else if (o.roundPad) dec += "0".repeat(-drop)
      if (/^0*$/.test(int + dec) && o.roundZeroPositive && sign === "-") sign = ""
    }
    if (sign === "-") out.int.push(ch("-", data))
    else if (sign === "±") out.int.push(mathCharNoad(data.symbols.pm))
    out.int.push(...digits(int, "integer", o, data))
    out.dec.push(...decimal(dec, o, data))
    if (unc && !o.separateUncertainty) out.dec.push(ch("(", data), ...unc.split("").map((c) => ch(c, data)), ch(")", data))
    else if (unc) { // \__siunitx_number_output_uncert_S_sep:nnnn: \pm (a break allowed), the uncertainty with the value's decimals
      const n = unc.length - dec.length
      out.unc.push(mathCharNoad(data.symbols.pm), ...(n > 0 ? digits(unc.slice(0, n), "integer", o, data) : [ch("0", data)]), ...decimal(n > 0 ? unc.slice(n) : "0".repeat(-n) + unc, o, data))
    }
  } else if (signIn || paren !== undefined || uInt !== undefined) throw new Unsupported(`siunitx number ${input}`)
  const exp = expIn === undefined ? "" : stripZeros(expIn)
  if (exp !== "" && exp !== "0") {
    if (mantissa) out.product.push(...mathOf(o.exponentProduct, data))
    const ten: Noad = ch("0", data)
    ten.sup = groupField([...(expSign === "-" ? [ch("-", data)] : []), ...digits(exp, "integer", o, data)])
    out.exp.push(ch("1", data), ten)
  } else if (!mantissa) throw new Unsupported(`siunitx number ${input}`)
  return out
}

// ---- units ----

interface UnitPart { symbol: string; power: string | null }
/** the 1 a symbol unit starts with when it has no numerator, which a quantity leaves out with its product */
const unitOne = new WeakSet<MItem>()

function unit(input: string, cx: SiContext, o: SiOptions): MItem[] {
  const src = input.trim()
  if (src === "") throw new Unsupported("siunitx: an empty unit")
  if (!src.includes("\\")) return literalUnit(src, cx, o)
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
  const units = parts.map((p) => ({ symbol: p.symbol, power: p.per ? (p.power === null ? "-1" : p.power.startsWith("-") ? p.power.slice(1) : "-" + p.power) : p.power }))
  const product = mathOf(o.interUnitProduct, cx.data)
  const joined = (us: UnitPart[]) => us.flatMap((u, i) => [...(i ? product : []), unitNoad(u, cx)])
  if (o.perMode === "power") return joined(units)
  // symbol and fraction: the negative powers made positive (1 goes) in the denominator
  const negative = (u: UnitPart) => !!u.power?.startsWith("-")
  const numerator = units.filter((u) => !negative(u))
  const denominator = units.filter(negative).map((u) => ({ symbol: u.symbol, power: u.power === "-1" ? null : u.power!.slice(1) }))
  if (!denominator.length) return joined(numerator)
  const one = ch("1", cx.data)
  const top = numerator.length ? joined(numerator) : [one]
  if (o.perMode === "fraction") return [{ noad: ORD, nucleus: groupField([{ noad: "fraction", thickness: null, num: top, denom: joined(denominator) }]), sup: null, sub: null }] // \frac
  // per-symbol-script-correction (\!) after a numerator whose last unit has a power; the brackets when the last unit
  // is a denominator's after another (\__siunitx_unit_format_output_denominator:)
  const script = numerator.length > 0 && numerator[numerator.length - 1].power !== null
  const bracket = negative(units[units.length - 1]) && denominator.length > 1
  const den = joined(denominator)
  if (!numerator.length) unitOne.add(one)
  return [...top, ...(script ? mathOf("\\!", cx.data) : []), ...mathOf(o.perSymbol, cx.data), ...(bracket ? [ch("(", cx.data), ...den, ch(")", cx.data)] : den)]
}

/** A literal unit: letters in \mathrm, . and ~ for products, / as it is, ^ a power after the letters before it */
function literalUnit(src: string, cx: SiContext, o: SiOptions): MItem[] {
  const out: MItem[] = []
  let cur = "", sep = false
  const flush = (power: string | null = null) => {
    if (!cur) { if (power !== null) throw new Unsupported(`siunitx unit ${src}`); return }
    if (sep && out.length) out.push(...mathOf(o.interUnitProduct, cx.data))
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
    else if (c === "µ") items.push(textChoice(cx.micro()))
    else if (c === "%") items.push(ch("%", data)) // \% is \chardef'd: its \mathcode
    else items.push(ch(c, data, 0))
  }
  const power = p.power === null ? null : groupField(p.power.split("").map((c) => ch(c, data)))
  return { noad: ORD, nucleus: groupField(items), sup: power, sub: null }
}

// ---- S columns ----

/** The builder's view of a tabular entry: a list as $…$ in hbox material, and text as the entry reads it (with its
 *  space factor) */
export interface SiCellContext extends SiContext { formula: (list: MItem[]) => Node[]; cell: (src: string) => Node[] }

/** \siunitx_if_number_token:N at the defaults: input-decimal-markers, -digits, -exponent-markers, -signs, -ignore,
 *  the uncertainty brackets and the comparators */
const NUMBER_TOKENS = new Set([..."0123456789.,()+-dDeE<=>", "\\pm", "\\mp", "\\,", "\\approx", "\\ge", "\\geq", "\\gg", "\\le", "\\leq", "\\ll", "\\sim"])

/**
 * An S column's entry (\siunitx_cell_begin:w … \siunitx_cell_end:): its tokens without spaces, split into the text
 * before, the number and the text after (\__siunitx_table_split:nNNN); without a number the text alone
 * (\__siunitx_table_print_text:n), else the number's integer and decimal parts in boxes aligned on the decimal
 * marker (table-alignment-mode = marker) or the widths table-format's model gives them (format), centered by
 * \hskip 0pt plus .5fill on both sides (table-alignment = center)
 */
export function siTableCell(text: string, opt: string, state: { spaceFactor: number }, cx: SiCellContext): Node[] {
  const o = opt === "" ? cx.options : siOptions(opt, cx.options)
  const { data } = cx
  // the entry's tokens: groups, control sequences, characters (\__siunitx_table_collect_loop: removes spaces)
  const toks: string[] = []
  for (let i = 0; i < text.length;) {
    const c = text[i]
    if (/\s/.test(c)) { i++; continue }
    if (c === "{") {
      let depth = 0, j = i
      for (; j < text.length; j++) { if (text[j] === "\\") { j++; continue } if (text[j] === "{") depth++; else if (text[j] === "}" && --depth === 0) break }
      if (j >= text.length) throw new Unsupported(`an S entry ${text.trim()}`)
      toks.push(text.slice(i, j + 1)); i = j + 1; continue
    }
    if (c === "}") throw new Unsupported(`an S entry ${text.trim()}`)
    const cs = text.slice(i).match(/^\\(?:[A-Za-z]+|.)/)
    if (cs) { toks.push(cs[0]); i += cs[0].length; continue }
    toks.push(c); i++
  }
  let before = "", num = "", after = ""
  for (const t of toks) {
    if (t.startsWith("{")) before += t // (after a number, text after it: Unsupported as well)
    else if (after) after += t
    else if (NUMBER_TOKENS.has(t)) num += t + (/^\\[A-Za-z]/.test(t) ? " " : "")
    else if (num) after += t
    else before += t + (/^\\[A-Za-z]/.test(t) ? " " : "")
  }
  const skip = (): Node[] => [glue(0, 32768, FILL), kern(0, true)] // \__siunitx_table_skip:n {0pt plus 0.5fill}
  if (!num) return [...skip(), ...(before ? cx.cell(before) : []), ...skip()] // (a lone group's braces go, but they change nothing here)
  if (before || after) throw new Unsupported(`an S entry with text around its number: ${text.trim()}`)
  state.spaceFactor = 1000 // (boxes)
  const n = number(num, o, data)
  if (n.unc.length && n.exp.length) { n.int.unshift(ch("(", data)); n.unc.push(ch(")", data)) } // (bracket-ambiguous-numbers)
  const box = (list: MItem[]): BoxNode => hpack(list.length ? cx.formula(list) : [])
  if (o.tableMode === "marker") { // \__siunitx_table_print_marker:nnn
    const int = box(n.int)
    const empty: Noad = { noad: ORD, nucleus: { kind: "mlist", list: [] }, sup: null, sub: null } // {}
    // \__siunitx_table_print_marker_aux:w: {} before a separate uncertainty without decimals, and alone without either
    let dec = box([...(!n.dec.length && n.unc.length ? [empty] : n.dec), ...n.unc, ...(n.dec.length || n.unc.length ? [] : [empty]), ...n.product, ...n.exp])
    const marker = box([{ noad: ORD, nucleus: groupField(mathOf(o.decimalMarker, data)), sup: null, sub: null }]).width // \mathord{marker}
    // \__siunitx_table_center_marker: (table-align-text-before and -after true)
    let intBox = int
    if (int.width > dec.width - marker) dec = hpack([...dec.list, filGlue()], { exactly: int.width + marker })
    else intBox = hpack([filGlue(), ...int.list], { exactly: dec.width - marker })
    const after = hpack([filGlue()], { exactly: 0 }) // (the empty after box, as wide as the empty before box, which goes)
    return [...skip(), intBox, dec, after, ...skip()]
  }
  // \__siunitx_table_print_format:nnn with the model of table-format
  // (a separate uncertainty and an exponent the model lacks go: \__siunitx_table_print_format_auxv:w, auxxiii)
  const fm = o.tableFormat.replace(/\s+/g, "").match(/^([+-]?)(\d+)(?:\.(\d+))?$/)
  if (!fm) throw new Unsupported(`table-format = ${o.tableFormat}`)
  const modelInt = box([...(fm[1] ? [ch(fm[1], data)] : []), ...digits(fm[2] === "0" ? "0" : "8".repeat(Number(fm[2])), "integer", o, data)])
  const modelDec = box(fm[3] ? decimal("8".repeat(Number(fm[3])), o, data) : [])
  let tmp = box(n.int)
  if (tmp.width > modelInt.width) tmp = hpack([ssGlue(), ...tmp.list], { exactly: modelInt.width }) // (\hss: it sticks out on the left)
  const intBox = hpack([filGlue(), filGlue(), ...tmp.list], { exactly: modelInt.width }) // (\fil, the comparator box's \fil, the integer)
  const dec = box(n.dec)
  const carry = modelDec.width - dec.width
  return [...skip(), hpack([filGlue()], { exactly: 0 }), intBox, dec, hpack([glue(carry), filGlue()], { exactly: carry }), ...skip()]
}
