// Math lists to horizontal lists: "TeX: The Program" §§ 699–767 (Appendix G).
// Noads with math-character, box and sub-mlist nuclei; the eight styles and
// their size and mu changes (§§ 702–703, rule 17 of Appendix G); mathcode
// classes (§ 1151), rule 5's bin demotion (§§ 728–729); make_ord's kerns and
// ligatures (§§ 749–753); characters with their italic corrections (§ 755);
// \overline and \underline (§§ 734–735);
// operators with and without limits (§§ 749–750); generalized fractions and
// their delimiters (§§ 743–748); sub- and superscripts (§§ 756–759, rules
// 18a–f); and the inter-atom spacing and penalties of the second pass
// (§§ 760–767); \left and \right with var_delimiter's variants and extensible
// characters (§§ 706–714, 762); e-TeX's \middle; radicals (§ 737); accents (§§ 738–742); \nonscript (§ 732).

import { xnOverD } from "../layout/arith"
import type { GlueSpec } from "../layout/dimen"
import { SPACE, X_HEIGHT, type CharMetrics, type Font } from "../layout/font"
import { emptyBox, glue, kern, paramGlue, penalty, type BoxNode, type Node, charNode, filGlue, ssGlue } from "../layout/nodes"
import { hpack, vpack } from "../layout/pack"
import { halign } from "../layout/align"

export const ORD = 0, OP = 1, BIN = 2, REL = 3, OPEN = 4, CLOSE = 5, PUNCT = 6, INNER = 7
export type NoadType = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7
/** Styles (§ 688): D, D', T, T', S, S', SS, SS'; odd styles are cramped. */
export const DISPLAY = 0, TEXT = 2, SCRIPT = 4, SCRIPT_SCRIPT = 6

/** A noad field (§ 681): a math character, a box, a sub-mlist, or empty (null). */
export type Field =
  | { kind: "char"; fam: number; char: number; /** math_text_char: made by make_ord or a |=:|>> ligature */ text?: boolean }
  | { kind: "box"; box: BoxNode }
  | { kind: "mlist"; list: MItem[] }
  /** \array{*\c@MaxMatrixCols c} in a \vcenter (amsmath's matrix environments): each cell's formula, and
   *  whether \\ ended each row (its \@arraycr leaves ${} in the last cell) */
  | { kind: "array"; rows: MItem[][][]; crs: boolean[] }
  /** \big … \Bigg's box (fontmath.ltx: \hbox{$\left#1\vbox to8.5\p@{}\right.\n@space$}; amsmath's \bBigg@: \left#1\vcenter
   *  to `factor`\big@size{}\right. in an \hbox, \nulldelimiterspace zero), which needs the text size's fonts */
  | { kind: "big"; delim: Delimiter; height: number } | { kind: "big"; delim: Delimiter; factor: [number, number] }
  /** \hbox{$\m@th<style>{…}$}, as \mathpalette's \mathsm@sh and \mathph@nt set it: `list` from the style node on; then
   *  \smash's \finsm@sh (zero height, depth or both) or \phantom's \finph@nt (an empty box with its height and depth, width) */
  | { kind: "hmath"; list: MItem[]; smash?: "t" | "b" | "tb"; phantom?: "v" | "h" | "vh"; /** \llap, \rlap, \clap: \hbox to\z@ with \hss */ lap?: "l" | "r" | "c" }
  /** \copy\strutbox: \hbox{\vrule height.7\baselineskip depth.3\baselineskip width\z@} (MathEnv.strut) */
  | { kind: "strut" }
  | null
/** An ord…inner noad (§ 682). `limits` is an op noad's subtype: \\limits, \\nolimits, or undefined for normal;
 *  `vcenter` makes it a vcenter noad (§ 687) and `line` an over or under noad (§ 687), ords for spacing */
export interface Noad { noad: NoadType; nucleus: Field; sup: Field; sub: Field; limits?: "limits" | "nolimits"; vcenter?: boolean; line?: "over" | "under"
  /** a radical noad (§ 683, \radical): its left delimiter */
  radical?: Delimiter
  /** an accent noad (§ 687, \mathaccent): its accent character, an ord for spacing */
  accent?: Field
  /** amsfonts' \widehat and \widetilde: the accent above when the argument, in an \hbox in text style, is wider than `width` */
  wide?: { accent: Field; width: number; measure: () => MItem[] } }
/** \hskip-\arraycolsep (amsmath's \env@matrix and \endmatrix) */
export interface ColsepSkip { kind: "colsep" }
/** \\mskip glue (§ 149 mu_glue): in mu, converted with the math unit of its style (§ 732) */
export interface MuGlue { kind: "muglue"; spec: GlueSpec }
/** \\mkern (§ 155 mu_glue subtype): in mu, converted like \\mskip (§ 732) */
export interface MuKern { kind: "mukern"; width: number }
/**
 * \\root index\\of radicand (latex.ltx; amsmath's \\plainroot@ with \\uproot and \\leftroot zero): the index in
 * \\rootbox at scriptscript style, then a \\mathchoice of \\r@@t, which the first pass expands in its style
 */
export interface RootItem { kind: "root"; /** fresh noads each time (the list converted is used up) */ index: () => Noad; radicand: () => Field; amsmath: boolean }
/** \\nonscript (§ 1171): glue of subtype cond_math_glue, which deletes glue or a kern after it below text size (§ 732) */
export interface NonscriptItem { kind: "nonscript" }
/** A choice node (§ 689, \\mathchoice): the first pass puts in its place the list for its style (§ 731) */
export interface ChoiceItem { kind: "choice"; choose: (style: number) => MItem[] }
/** A generalized fraction (§ 683) with null delimiters; thickness null is default_code. */
export interface FractionNoad { noad: "fraction"; thickness: number | null; num: MItem[]; denom: MItem[]; /** …withdelims */ left?: Delimiter; right?: Delimiter }
/** A style node (§ 688): \\displaystyle, \\textstyle, \\scriptstyle, \\scriptscriptstyle, possibly cramped. */
export interface StyleNode { kind: "style"; style: number }
/** A delimiter field (§ 683): small and large variants; all zero is the null delimiter. */
export interface Delimiter { smallFam: number; smallChar: number; largeFam: number; largeChar: number }
/** \\left and \\right (§ 687): the ends of the sub-mlist of the inner noad \\left…\\right makes (§ 1191). */
export interface FenceNoad { noad: "left" | "right" | "middle"; delim: Delimiter }
/** An mlist: noads, style nodes, and plain nodes (kerns, glue, penalties, rules). */
export type MItem = Noad | FractionNoad | FenceNoad | StyleNode | ColsepSkip | MuGlue | MuKern | NonscriptItem | RootItem | ChoiceItem | Node

const isNoad = (x: MItem): x is Noad | FractionNoad | FenceNoad => "noad" in x
const isFence = (x: MItem): x is FenceNoad => "noad" in x && (x.noad === "left" || x.noad === "right" || x.noad === "middle")
/** A 24-bit \\delcode or a \\delimiter code without its class: small fam, small char, large fam, large char. */
export const delimiterOf = (d: number): Delimiter => ({ smallFam: (d >> 20) & 15, smallChar: (d >> 12) & 255, largeFam: (d >> 8) & 15, largeChar: d & 255 })

/** set_math_char (§ 1155): a mathcode becomes a noad; class 7 takes \\fam when it is a valid family. */
export function mathCharNoad(mathcode: number, fam = -1): Noad {
  if (mathcode >= 0x8000) throw new Error("active math character")
  return { noad: mathcodeClass(mathcode), nucleus: mathCharField(mathcode, fam), sup: null, sub: null }
}
/** The noad type a mathcode makes: class 7 is ord. */
export const mathcodeClass = (mathcode: number): NoadType => ((mathcode >> 12) === 7 ? ORD : mathcode >> 12) as NoadType
/** scan_math's math_char field (§ 1151), which keeps only family and character. */
export function mathCharField(mathcode: number, fam = -1): Field {
  const f = (mathcode >> 8) & 15
  return { kind: "char", fam: mathcode >> 12 === 7 && fam >= 0 && fam < 16 ? fam : f, char: mathcode & 255 }
}
/** A math group {…} as scan_math leaves it (§ 1186): a lone ord without scripts gives up its nucleus. */
export function groupField(list: MItem[]): Field {
  if (list.length === 1) { const p = list[0]; if (isNoad(p) && p.noad === ORD && !("vcenter" in p && p.vcenter) && !("line" in p && p.line) && !("radical" in p && p.radical) && !("accent" in p && p.accent) && !p.sub && !p.sup) return p.nucleus }
  return { kind: "mlist", list }
}

/** A math group {…} that is the nucleus of a new ord (§§ 1186–1187): groupField's, except that one accent noad replaces
 *  the ord, scripts and all */
export function groupNoad(list: MItem[]): Noad {
  const p = list[0]
  if (list.length === 1 && isNoad(p) && p.noad === ORD && "accent" in p && p.accent) return p
  return { noad: ORD, nucleus: groupField(list), sup: null, sub: null }
}

export interface MathEnv {
  /** fam_fnt(fam + size): fonts of families 0–15 for text, script and scriptscript size */
  fonts: (Font | undefined)[][]
  /** \\thinmuskip, \\medmuskip, \\thickmuskip in mu */
  muskips: { thinmuskip: GlueSpec; medmuskip: GlueSpec; thickmuskip: GlueSpec }
  binoppenalty: number
  relpenalty: number
  scriptspace: number
  nulldelimiterspace: number
  /** \\delimiterfactor and \\delimitershortfall (§ 762) */
  delimiterfactor: number
  delimitershortfall: number
  /** \\arraycolsep and the \\@arstrutbox rule (\\strutbox at \\arraystretch 1), for arrays */
  arraycolsep?: number
  /** array.sty's \array: \hskip1sp before each cell's formula, and no ${} from its \@arraycr */
  arrayPackage?: boolean
  arstrut?: { height: number; depth: number }
  /** \strutbox's height and depth */
  strut?: { height: number; depth: number }
  /** called for a character the font lacks (char_warning) */
  missing?: (fam: number, c: number) => void
}

// § 764: the spacing table, rows by the preceding noad's type, columns by this one
const MATH_SPACING = "02340001" + "22*40001" + "33**3**3" + "44*04004" + "00*00000" + "02340001" + "11*11111" + "12341011"
const LIST_TAG = 2, LIG_TAG = 1, EXT_TAG = 3

/** x_over_n (§ 106): quotient and remainder, truncating toward zero */
function xOverN(x: number, n: number): [number, number] {
  if (n === 0) throw new Error("x_over_n: division by zero")
  if (n < 0) { x = -x; n = -n }
  if (x >= 0) return [Math.floor(x / n), x % n]
  return [-Math.floor(-x / n), -((-x) % n)]
}

/** nx_plus_y (mult_and_add with max 2^30-1, § 105) */
function nxPlusY(n: number, x: number, y: number): number {
  if (n < 0) { x = -x; n = -n }
  if (n === 0) return y
  const max = 0o7777777777
  if (x <= Math.trunc((max - y) / n) && -x <= Math.trunc((max + y) / n)) return n * x + y
  throw new Error("arithmetic overflow in math glue")
}

/** half (§ 100): rounds odd values up */
const half = (x: number) => (x % 2 !== 0 ? Math.trunc((x + 1) / 2) : Math.trunc(x / 2))

/** math_glue (§ 716): mu glue to pt glue for a math unit m */
export function mathGlue(g: GlueSpec, m: number): GlueSpec {
  let [n, f] = xOverN(m, 0o200000)
  if (f < 0) { n--; f += 0o200000 }
  const mult = (x: number) => nxPlusY(n, x, xnOverD(x, f, 0o200000))
  return {
    width: mult(g.width),
    stretch: g.stretchOrder === 0 ? mult(g.stretch) : g.stretch, stretchOrder: g.stretchOrder,
    shrink: g.shrinkOrder === 0 ? mult(g.shrink) : g.shrink, shrinkOrder: g.shrinkOrder,
  }
}

// subsidiary styles (§ 702)
const crampedStyle = (s: number) => 2 * (s >> 1) + 1
const subStyle = (s: number) => 2 * (s >> 2) + SCRIPT + 1
const supStyle = (s: number) => 2 * (s >> 2) + SCRIPT + (s % 2)
const numStyle = (s: number) => s + 2 - 2 * Math.floor(s / 6)
const denomStyle = (s: number) => 2 * (s >> 1) + 1 + 2 - 2 * Math.floor(s / 6)

/**
 * mlist_to_hlist (§ 726) in a starting style. `penalties` is mlist_penalties:
 * true for inline math in a paragraph (§ 1194).
 */
export function mlistToHlist(mlist: MItem[], env: MathEnv, style = TEXT, penalties = false): Node[] {
  return new Converter(env).convert(mlist, style, penalties)
}

class Converter {
  curStyle = TEXT
  curSize = 0 // 0, 1, 2 for text, script, scriptscript size
  curMu = 0
  constructor(readonly env: MathEnv) {}

  /** § 703 */
  setStyle(s: number) {
    this.curStyle = s
    this.curSize = s < SCRIPT ? 0 : (s - TEXT) >> 1
    this.curMu = xOverN(this.mathsy(6, this.curSize), 18)[0]
  }
  font(fam: number, size: number) { return this.env.fonts[size]?.[fam] }
  /** math-symbol parameters of family 2 (§ 700) */
  mathsy(n: number, size: number) {
    const f = this.font(2, size)
    if (!f || f.params.length <= 22) throw new Error("Math formula deleted: Insufficient symbol fonts")
    return f.params[n]
  }
  /** math-extension parameters of family 3 at the current size (§ 701) */
  mathex(n: number) {
    const f = this.font(3, this.curSize)
    if (!f || f.params.length <= 13) throw new Error("Math formula deleted: Insufficient extension fonts")
    return f.params[n]
  }
  get axisHeight() { return this.mathsy(22, this.curSize) }
  get mathXHeight() { return this.mathsy(5, this.curSize) }
  get ruleThickness() { return this.mathex(8) }

  /** fetch (§ 722): the font and metrics of a math_char field; a missing character empties it. */
  fetch(holder: { [k: string]: unknown }, key: string) {
    const a = holder[key] as Extract<Field, { kind: "char" }>
    const f = this.font(a.fam, this.curSize)
    if (!f) throw new Error(`${["\\textfont", "\\scriptfont", "\\scriptscriptfont"][this.curSize]} ${a.fam} is undefined (character ${String.fromCharCode(a.char)})`)
    const m = f.chars.get(a.char)
    if (!m) { this.env.missing?.(a.fam, a.char); holder[key] = null }
    return { f, m }
  }

  convert(mlist: MItem[], style: number, penalties: boolean): Node[] {
    const colsep = (x: MItem) => ("kind" in x && x.kind === "colsep" ? glue(-(this.env.arraycolsep ?? 0)) : x)
    const list = mlist.map(colsep)
    const hl = new Map<object, Node[]>() // new_hlist(q)
    this.setStyle(style)
    // first pass (§§ 727–759); max_h and max_d are the list's height and depth for \left and \right (§ 727)
    let r: Noad | FractionNoad | FenceNoad | null = null
    let rType: NoadType | "fraction" | "left" = OP
    let maxH = 0, maxD = 0
    const check = (nodes: Node[] | undefined) => { const z = hpack(nodes ?? []); if (z.height > maxH) maxH = z.height; if (z.depth > maxD) maxD = z.depth }
    for (let i = 0; i < list.length; i++) {
      const q = list[i]
      if (!isNoad(q)) { // § 730
        if ("kind" in q && q.kind === "style") this.setStyle(q.style)
        else if ("kind" in q && q.kind === "muglue") { const g = mathGlue(q.spec, this.curMu); list[i] = glue(g.width, g.stretch, g.stretchOrder, g.shrink, g.shrinkOrder) } // § 732
        else if ("kind" in q && q.kind === "mukern") list[i] = kern(mathGlue({ width: q.width, stretch: 0, stretchOrder: 0, shrink: 0, shrinkOrder: 0 }, this.curMu).width, true) // math_kern (§ 717)
        else if ("kind" in q && q.kind === "nonscript") { // § 732: a glue node that stays, printed \glue(\nonscript)
          list[i] = paramGlue("nonscript", glue(0))
          const p = list[i + 1]
          if (this.curSize !== 0 && p && "kind" in p && ["muglue", "mukern", "glue", "kern"].includes(p.kind)) list.splice(i + 1, 1)
        }
        else if ("kind" in q && q.kind === "root") { list.splice(i, 1, ...this.root(q)); i-- } // § 731: the choice for cur_style
        else if ("kind" in q && q.kind === "choice") { list.splice(i, 1, ...q.choose(this.curStyle).map(colsep)); i-- } // § 731
        else if ("kind" in q && q.kind === "rule") { if ((q.height ?? 0) > maxH) maxH = q.height ?? 0; if ((q.depth ?? 0) > maxD) maxD = q.depth ?? 0 }
        continue
      }
      if (isFence(q)) { // § 733: done_with_noad
        if (q.noad !== "left") { // a final bin becomes an ord; r_type is then left_noad, in the list's style (e-TeX's \middle: a right noad)
          if (rType === BIN && r) (r as Noad).noad = ORD
          this.setStyle(style)
        }
        r = q; rType = "left"
        continue
      }
      if (q.noad === "fraction") { hl.set(q, this.makeFraction(q)); check(hl.get(q)); r = q; rType = "fraction"; continue }
      let delta = 0
      if (q.noad === BIN && (rType === BIN || rType === OP || rType === REL || rType === OPEN || rType === PUNCT || rType === "left")) q.noad = ORD // § 729
      if ((q.noad === REL || q.noad === CLOSE || q.noad === PUNCT) && rType === BIN && r) (r as Noad).noad = ORD
      if (q.noad === OP) {
        delta = this.makeOp(q, hl)
        if (q.limits === "limits") { check(hl.get(q)); r = q; rType = q.noad; continue }
      } else if (q.line) q.nucleus = { kind: "box", box: q.line === "over" ? this.makeOver(q.nucleus) : this.makeUnder(q.nucleus) }
      else if (q.radical) q.nucleus = { kind: "box", box: this.makeRadical(q.nucleus, q.radical) }
      else if (q.accent) this.makeMathAccent(q)
      else if (q.noad === ORD) this.makeOrd(list, i)
      // § 754: the nucleus as an hlist
      let p: Node[]
      const n = q.nucleus
      if (n?.kind === "char") { // § 755
        const { f, m } = this.fetch(q as never, "nucleus")
        if (m) {
          delta = m.italic
          p = [charNode(f, n.char)]
          if (n.text && f.params[SPACE] !== 0) delta = 0 // no italic correction in mid-word of a text font
          if (!q.sub && delta !== 0) { p.push(kern(delta)); delta = 0 }
        } else p = []
      } else if (!n) p = []
      else if (n.kind === "big" || n.kind === "hmath" || n.kind === "strut") {
        let b: BoxNode
        if (n.kind === "strut") {
          if (!this.env.strut) throw new Error("math: \\strut without the \\strutbox")
          b = hpack([{ kind: "rule", width: 0, height: this.env.strut.height, depth: this.env.strut.depth }])
        } else b = n.kind === "big" ? this.big(n) : this.hmath(n)
        q.nucleus = { kind: "box", box: b }; p = [b]
      }
      else if (n.kind === "array") {
        const b = this.array(n)
        if (q.vcenter) { const delta = b.height + b.depth; b.height = this.axisHeight + half(delta); b.depth = delta - b.height } // make_vcenter (§ 736)
        q.nucleus = { kind: "box", box: b }
        p = [b]
      }
      else if (n.kind === "box") {
        if (q.vcenter) { const b = n.box, delta = b.height + b.depth; b.height = this.axisHeight + half(delta); b.depth = delta - b.height } // make_vcenter (§ 736)
        p = [n.box]
      }
      else {
        const save = this.curStyle
        const inner = this.convert(n.list, this.curStyle, false)
        this.setStyle(save)
        p = [hpack(inner)]
      }
      hl.set(q, p)
      if (q.sub || q.sup) this.makeScripts(q, p, delta)
      check(hl.get(q))
      r = q; rType = q.noad
    }
    if (rType === BIN && r) (r as Noad).noad = ORD // § 729: a final bin

    // second pass (§§ 760–767)
    const out: Node[] = []
    this.setStyle(style)
    let prev = -1 // r_type; -1 before the first noad
    for (let i = 0; i < list.length; i++) {
      const q = list[i]
      if (!isNoad(q)) {
        if ("kind" in q && q.kind === "style") this.setStyle(q.style)
        else out.push(q as Node)
        continue
      }
      // \left and \right: make_left_right in the list's style, an open and a close (§ 762)
      const t = isFence(q) ? this.makeLeftRight(q, style, maxD, maxH, hl) : q.noad === "fraction" ? ORD : q.noad
      if (prev >= 0) {
        const code = MATH_SPACING[prev * 8 + t]
        if (code === "*") throw new Error("mlist4: impossible noad sequence")
        const small = this.curStyle >= SCRIPT
        const which = code === "1" ? (small ? null : "thinmuskip") : code === "2" ? "thinmuskip"
          : code === "3" ? (small ? null : "medmuskip") : code === "4" ? (small ? null : "thickmuskip") : null
        if (which) { const g = mathGlue(this.env.muskips[which], this.curMu); out.push(paramGlue(which, glue(g.width, g.stretch, g.stretchOrder, g.shrink, g.shrinkOrder))) }
      }
      out.push(...(hl.get(q) ?? []))
      const pen = t === BIN ? this.env.binoppenalty : t === REL ? this.env.relpenalty : 10000
      if (penalties && pen < 10000 && i + 1 < list.length) {
        const nx = list[i + 1]
        if (!(!isNoad(nx) && "kind" in nx && nx.kind === "penalty") && !(isNoad(nx) && nx.noad === REL)) out.push(penalty(pen))
      }
      prev = isFence(q) && q.noad !== "left" ? OPEN : t
    }
    return out
  }

  /**
   * \array{*10c} (latex.ltx \@array): \ialign with each row starting with \@arstrut, each cell
   * \hskip\arraycolsep\hfil$cell$\hfil\hskip\arraycolsep in text style, \tabskip zero, rows stacked with
   * \baselineskip and \lineskip zero
   */
  array(a: Extract<Field, { kind: "array" }>): BoxNode {
    const colsep = this.env.arraycolsep ?? 0, strut = this.env.arstrut ?? { height: 0, depth: 0 }
    const math = (l: MItem[]): Node[] => [{ kind: "math", on: true, width: 0 }, ...new Converter(this.env).convert(l, TEXT, false), { kind: "math", on: false, width: 0 }]
    const rows = a.rows.map((row, ri) => row.map((cell, ci) => [
      ...(ci === 0 ? [{ kind: "rule", width: 0, height: strut.height, depth: strut.depth } as Node] : []),
      glue(colsep), filGlue(), ...(this.env.arrayPackage ? [glue(1)] : []), ...math(cell),
      ...(a.crs[ri] && ci === row.length - 1 && !this.env.arrayPackage ? math([{ noad: ORD, nucleus: { kind: "mlist", list: [] }, sup: null, sub: null }]) : []), // \@arraycr's ${}
      filGlue(), glue(colsep),
    ]))
    const cols = 10 // \c@MaxMatrixCols
    if (a.rows.some((r) => r.length > cols)) throw new Error("math: Extra alignment tab has been changed to \\cr")
    const boxes = halign(rows, Array.from({ length: cols + 1 }, () => paramGlue("tabskip", glue(0))), { additional: 0 })
    const v: Node[] = []
    boxes.forEach((b, i) => { if (i) v.push(paramGlue("lineskip", glue(0))); v.push(b) })
    return vpack(v)
  }

  /** \big … \Bigg (Field "big"): a formula in text style, in an \hbox, with \mathsurround and \nulldelimiterspace zero */
  big(n: Extract<Field, { kind: "big" }>): BoxNode {
    let inner: Noad
    if ("height" in n) inner = { noad: ORD, nucleus: { kind: "box", box: vpack([], { exactly: n.height }) }, sup: null, sub: null }
    else {
      // amsmath's \big@size: 1.2\ht\Mathstrutbox@ plus 1.2\dp\Mathstrutbox@, the height and depth of ( in \textfont0 (§ 455's
      // decimal factor times an internal dimension: nx_plus_y with xn_over_d of the fraction); the \vcenter to that times the factor
      const paren = this.font(0, 0)?.chars.get(40)
      if (!paren) throw new Error("math: \\big without ( in \\textfont0")
      const times = (n: number, f: number, v: number) => nxPlusY(n, v, xnOverD(v, f, 0o200000))
      const size = times(1, 13107, paren.height) + times(1, 13107, paren.depth)
      inner = { noad: ORD, vcenter: true, nucleus: { kind: "box", box: vpack([], { exactly: times(n.factor[0], n.factor[1], size) }) }, sup: null, sub: null }
    }
    const list: MItem[] = [{ noad: INNER, nucleus: { kind: "mlist", list: [{ noad: "left", delim: n.delim }, inner, { noad: "right", delim: { smallFam: 0, smallChar: 0, largeFam: 0, largeChar: 0 } }] }, sup: null, sub: null }]
    return hpack([{ kind: "math", on: true, width: 0 }, ...new Converter({ ...this.env, nulldelimiterspace: 0 }).convert(list, TEXT, false), { kind: "math", on: false, width: 0 }])
  }

  /** Field "hmath": the formula in an \hbox, then smashed or a phantom */
  hmath(n: Extract<Field, { kind: "hmath" }>): BoxNode {
    const math: Node[] = [{ kind: "math", on: true, width: 0 }, ...new Converter(this.env).convert(n.list, TEXT, false), { kind: "math", on: false, width: 0 }]
    if (n.lap) return hpack([...(n.lap !== "r" ? [ssGlue()] : []), ...math, ...(n.lap !== "l" ? [ssGlue()] : [])], { exactly: 0 })
    const b = hpack(math)
    if (n.smash) { if (n.smash !== "b") b.height = 0; if (n.smash !== "t") b.depth = 0; return b }
    if (!n.phantom) return b
    const e = emptyBox("hlist") // \setbox\tw@\null
    if (n.phantom !== "h") { e.height = b.height; e.depth = b.depth }
    if (n.phantom !== "v") e.width = b.width
    return e
  }

  /** make_left_right (§ 762): a delimiter for the list's height and depth around the axis */
  makeLeftRight(q: FenceNoad, style: number, maxD: number, maxH: number, hl: Map<object, Node[]>): NoadType {
    this.setStyle(style)
    let delta2 = maxD + this.axisHeight
    let delta1 = maxH + maxD - delta2
    if (delta2 > delta1) delta1 = delta2 // the maximum distance from the axis
    let delta = Math.trunc(delta1 / 500) * this.env.delimiterfactor
    delta2 = delta1 + delta1 - this.env.delimitershortfall
    if (delta < delta2) delta = delta2
    hl.set(q, [this.varDelimiter(q.delim, this.curSize, delta)])
    return q.noad === "left" ? OPEN : CLOSE
  }

  /**
   * var_delimiter (§§ 706–714): the first variant of the small, then the large character (each family
   * from size s down to text size, along its charlist) at least v tall, else the tallest; an extensible
   * recipe is built at once; the box is centered on the axis
   */
  varDelimiter(d: Delimiter, s: number, v: number): BoxNode {
    let f: Font | undefined, c = 0, fq: CharMetrics | undefined, w = 0
    let large = false, z = d.smallFam, x = d.smallChar
    search: for (;;) {
      if (z !== 0 || x !== 0) {
        for (let size = s; size >= 0; size--) {
          const g = this.font(z, size)
          if (!g) continue
          for (let y = x; ;) {
            const q = g.chars.get(y)
            if (!q) break
            if (q.tag === EXT_TAG) { f = g; c = y; fq = q; break search }
            const u = q.height + q.depth
            if (u > w) { f = g; c = y; fq = q; w = u; if (u >= v) break search }
            if (q.tag !== LIST_TAG) break
            y = q.remainder
          }
        }
      }
      if (large) break
      large = true; z = d.largeFam; x = d.largeChar
    }
    let b: BoxNode
    if (f && fq) b = fq.tag === EXT_TAG ? extensible(f, fq, v) : charBox(f, c)
    else b = emptyBox("hlist", this.env.nulldelimiterspace) // no delimiter found
    b.shift = half(b.height - b.depth) - this.mathsy(22, s)
    return b
  }

  /** clean_box (§ 720): a field as a box with zero shift, in style s. */
  cleanBox(field: Field, s: number): BoxNode {
    let q: Node[]
    if (field?.kind === "box") q = [field.box]
    else if (!field) q = [emptyBox("hlist")]
    else {
      const save = this.curStyle
      const mlist: MItem[] = field.kind === "char" || field.kind === "array" || field.kind === "big" || field.kind === "hmath" || field.kind === "strut" ? [{ noad: ORD, nucleus: { ...field }, sup: null, sub: null }] : field.list
      q = this.convert(mlist, s, false)
      this.setStyle(save)
    }
    let x: BoxNode
    const q0 = q[0]
    if (!q0 || q0.kind === "char") x = hpack(q)
    else if (q.length === 1 && (q0.kind === "hlist" || q0.kind === "vlist") && q0.shift === 0) x = q0
    else x = hpack(q)
    // § 721: drop an unneeded italic correction (the width keeps it)
    const l = x.list
    if (l.length === 2 && l[0].kind === "char" && l[1].kind === "kern") x.list = [l[0]]
    return x
  }

  /** make_ord (§§ 749–753): kerns and ligatures between adjacent characters of one family. */
  makeOrd(list: MItem[], i: number) {
    for (;;) { // restart
      const q = list[i] as Noad
      const p = list[i + 1]
      const n = q.nucleus
      if (q.sub || q.sup || n?.kind !== "char" || n.text) return
      if (!p || !isNoad(p) || p.noad === "fraction" || isFence(p) || p.noad > PUNCT || p.vcenter || p.line || p.radical || p.accent) return
      const pn = p.nucleus
      if (pn?.kind !== "char" || pn.text || pn.fam !== n.fam) return
      n.text = true
      const { f, m } = this.fetch(q as never, "nucleus")
      if (!m || m.tag !== LIG_TAG) return
      let a = m.remainder
      let w = f.ligKern[a] >>> 0
      if (w >>> 24 > 128) { a = 256 * ((w >>> 8) & 255) + (w & 255); w = f.ligKern[a] >>> 0 }
      for (;;) {
        const skip = w >>> 24, next = (w >>> 16) & 255, op = (w >>> 8) & 255, rem = w & 255
        if (next === pn.char && skip <= 128) {
          if (op >= 128) { list.splice(i + 1, 0, kern(f.kerns[256 * (op - 128) + rem])); return }
          switch (op) {
            case 1: case 5: n.char = rem; break // =:|  =:|>
            case 2: case 6: pn.char = rem; break // |=:  |=:>
            case 3: case 7: case 11: { // |=:|  |=:|>  |=:|>>
              list.splice(i + 1, 0, { noad: ORD, nucleus: { kind: "char", fam: n.fam, char: rem, ...(op === 11 ? { text: true } : {}) }, sup: null, sub: null })
              break
            }
            default: list.splice(i + 1, 1); n.char = rem; q.sub = p.sub; q.sup = p.sup // =:
          }
          if (op > 3) return
          n.text = false
          break // restart
        }
        if (skip >= 128) return
        a += skip + 1
        w = f.ligKern[a] >>> 0
      }
    }
  }

  /**
   * make_math_accent (§§ 738–742): the nucleus cramped in a box x; the accent (the largest of its successors no wider
   * than x) over it, shifted right by the skew (the kern with the \skewchar after a lone character) and centered,
   * lowered by min(height(x), its x-height); the scripts of a lone character go into x first
   */
  makeMathAccent(q: Noad) {
    if (q.wide) { // amsfonts: \@mathmeasure\z@\textstyle{#1}, \ifdim\wd\z@>\tw@ em
      const w = hpack(new Converter(this.env).convert(q.wide.measure(), TEXT, false)).width
      if (w > q.wide.width) q.accent = q.wide.accent
    }
    const { f, m } = this.fetch(q as never, "accent")
    if (!m) return
    const a = q.accent as Extract<Field, { kind: "char" }>
    let c = a.char, i = m
    let s = 0 // § 741: the skew
    if (q.nucleus?.kind === "char") {
      const { f: nf, m: nm } = this.fetch(q as never, "nucleus")
      const skew = skewChar(nf.name), n = q.nucleus as Extract<Field, { kind: "char" }> | null
      if (nm && n && skew >= 0 && nm.tag === LIG_TAG) {
        let k = nm.remainder, w = nf.ligKern[k] >>> 0
        if (w >>> 24 > 128) { k = 256 * ((w >>> 8) & 255) + (w & 255); w = nf.ligKern[k] >>> 0 }
        for (;;) {
          const skip = w >>> 24, next = (w >>> 16) & 255, op = (w >>> 8) & 255, rem = w & 255
          if (next === skew) { if (op >= 128 && skip <= 128) s = nf.kerns[256 * (op - 128) + rem]; break }
          if (skip >= 128) break
          k += skip + 1; w = nf.ligKern[k] >>> 0
        }
      }
    }
    let x = this.cleanBox(q.nucleus, crampedStyle(this.curStyle))
    const w = x.width
    let h = x.height
    for (;;) { // § 740: a larger accent, while one no wider than x follows
      if (i.tag !== LIST_TAG) break
      const y = i.remainder, iy = f.chars.get(y)
      if (!iy || iy.width > w) break
      c = y; i = iy
    }
    const xh = f.params[5]
    let delta = h < xh ? h : xh
    if ((q.sup || q.sub) && q.nucleus?.kind === "char") { // § 742: the scripts go into x
      q.nucleus = { kind: "mlist", list: [{ noad: ORD, nucleus: q.nucleus, sup: q.sup, sub: q.sub }] }
      q.sup = q.sub = null
      x = this.cleanBox(q.nucleus, this.curStyle)
      delta += x.height - h; h = x.height
    }
    const y = charBox(f, c)
    y.shift = s + half(w - y.width); y.width = 0
    const v = vpack([y, kern(-delta), x])
    v.width = x.width
    if (v.height < h) { v.list.unshift(kern(h - v.height)); v.height = h } // § 739
    q.nucleus = { kind: "box", box: v }
  }

  /** make_over (§ 734): the nucleus, cramped, under a rule of default thickness θ, 3θ above it and θ clear */
  makeOver(n: Field): BoxNode {
    const t = this.ruleThickness
    return vpack([kern(t), { kind: "rule", width: null, height: t, depth: 0 }, kern(3 * t), this.cleanBox(n, this.curStyle | 1)])
  }

  /**
   * make_radical (§ 737): the nucleus cramped, with a clearance above it (θ + |x-height|/4 in display styles,
   * θ + θ/4 otherwise) and a delimiter at least that tall plus θ; extra depth of the delimiter adds half to the
   * clearance; the delimiter raised to the box's top, then overbar (§ 705) with the delimiter's height as rule
   */
  /**
   * \\r@@t in the current style: \\setbox0\\hbox{$\\m@th<style>\\sqrtsign{radicand}$}, \\dimen@ its height minus its
   * depth, then \\mkern5mu\\raise.6\\dimen@\\copy\\rootbox\\mkern-10mu\\box0 (amsmath adds \\mkern∓\\leftroot@ mu around
   * the index, zero kerns, and 1.667\\wd of an empty \\mskip to \\dimen@). A box in math is an ord noad (§ 1076).
   */
  root(q: RootItem): (Noad | MuKern)[] {
    const mathBox = (l: MItem[], style: number) => hpack([{ kind: "math", on: true, width: 0 }, ...new Converter(this.env).convert(l, style, false), { kind: "math", on: false, width: 0 }])
    const rootbox = mathBox([{ kind: "style", style: SCRIPT_SCRIPT }, q.index()], TEXT)
    const box0 = mathBox([{ noad: ORD, radical: delimiterOf(0x270370), nucleus: q.radicand(), sup: null, sub: null }], this.curStyle)
    rootbox.shift = -xnOverD(box0.height - box0.depth, 39322, 0o200000) // .6 (round_decimals, § 452) times \\dimen@ (§ 455)
    const zero: MuKern[] = q.amsmath ? [{ kind: "mukern", width: 0 }] : []
    const ord = (box: BoxNode): Noad => ({ noad: ORD, nucleus: { kind: "box", box }, sup: null, sub: null })
    return [...zero, { kind: "mukern", width: 5 * 65536 }, ord(rootbox), { kind: "mukern", width: -10 * 65536 }, ...zero, ord(box0)]
  }

  makeRadical(n: Field, d: Delimiter): BoxNode {
    const t = this.ruleThickness
    const x = this.cleanBox(n, crampedStyle(this.curStyle))
    let clr = this.curStyle < TEXT ? t + (Math.abs(this.mathXHeight) >> 2) : t + (Math.abs(t) >> 2)
    const y = this.varDelimiter(d, this.curSize, x.height + x.depth + clr + t)
    const delta = y.depth - (x.height + x.depth + clr)
    if (delta > 0) clr += half(delta)
    y.shift = -(x.height + clr)
    return hpack([y, vpack([kern(y.height), { kind: "rule", width: null, height: y.height, depth: 0 }, kern(clr), x])])
  }

  /** make_under (§ 735): a rule 3θ below the nucleus, θ clear beneath it; the box keeps the nucleus's height */
  makeUnder(n: Field): BoxNode {
    const t = this.ruleThickness
    const x = this.cleanBox(n, this.curStyle)
    const y = vpack([x, kern(3 * t), { kind: "rule", width: null, height: t, depth: 0 }])
    const delta = y.height + y.depth + t
    y.height = x.height; y.depth = delta - y.height
    return y
  }

  /** make_op (§§ 749–750): returns the italic correction that offsets the superscript. */
  makeOp(q: Noad, hl: Map<object, Node[]>): number {
    if (!q.limits && this.curStyle < TEXT) q.limits = "limits"
    let delta = 0
    const n = q.nucleus
    if (n?.kind === "char") {
      let { f, m } = this.fetch(q as never, "nucleus")
      if (m && this.curStyle < TEXT && m.tag === LIST_TAG) { // make it larger
        const c = m.remainder, i = f.chars.get(c)
        if (i) { m = i; n.char = c }
      }
      delta = m?.italic ?? 0
      const x = this.cleanBox(q.nucleus, this.curStyle)
      if (q.sub && q.limits !== "limits") x.width -= delta // remove italic correction
      x.shift = half(x.height - x.depth) - this.axisHeight // center vertically
      q.nucleus = { kind: "box", box: x }
    }
    if (q.limits === "limits") { // § 750
      const x = this.cleanBox(q.sup, supStyle(this.curStyle))
      const y = this.cleanBox(q.nucleus, this.curStyle)
      const z = this.cleanBox(q.sub, subStyle(this.curStyle))
      const v = emptyBox("vlist")
      v.width = Math.max(y.width, x.width, z.width)
      const xb = rebox(x, v.width), yb = rebox(y, v.width), zb = rebox(z, v.width)
      xb.shift = half(delta); zb.shift = -xb.shift
      v.height = yb.height; v.depth = yb.depth
      // § 751
      const s1 = this.mathex(9), s2 = this.mathex(10), s3 = this.mathex(11), s4 = this.mathex(12), s5 = this.mathex(13)
      const items: Node[] = []
      if (q.sup) {
        const shiftUp = Math.max(s3 - xb.depth, s1)
        items.push(kern(s5), xb, kern(shiftUp))
        v.height += s5 + xb.height + xb.depth + shiftUp
      }
      items.push(yb)
      if (q.sub) {
        const shiftDown = Math.max(s4 - zb.height, s2)
        items.push(kern(shiftDown), zb, kern(s5))
        v.depth += s5 + zb.height + zb.depth + shiftDown
      }
      v.list = items
      hl.set(q, [v])
    }
    return delta
  }

  /** make_fraction (§§ 743–748) */
  makeFraction(q: FractionNoad): Node[] {
    const t = q.thickness ?? this.ruleThickness
    let x = this.cleanBox({ kind: "mlist", list: q.num }, numStyle(this.curStyle))
    let z = this.cleanBox({ kind: "mlist", list: q.denom }, denomStyle(this.curStyle))
    if (x.width < z.width) x = rebox(x, z.width); else z = rebox(z, x.width)
    const display = this.curStyle < TEXT
    let shiftUp: number, shiftDown: number
    if (display) { shiftUp = this.mathsy(8, this.curSize); shiftDown = this.mathsy(11, this.curSize) }
    else { shiftDown = this.mathsy(12, this.curSize); shiftUp = this.mathsy(t !== 0 ? 9 : 10, this.curSize) }
    let delta = 0
    if (t === 0) { // § 745
      const clr = display ? 7 * this.ruleThickness : 3 * this.ruleThickness
      delta = half(clr - ((shiftUp - x.depth) - (z.height - shiftDown)))
      if (delta > 0) { shiftUp += delta; shiftDown += delta }
    } else { // § 746
      const clr = display ? 3 * t : t
      delta = half(t)
      const delta1 = clr - ((shiftUp - x.depth) - (this.axisHeight + delta))
      const delta2 = clr - ((this.axisHeight - delta) - (z.height - shiftDown))
      if (delta1 > 0) shiftUp += delta1
      if (delta2 > 0) shiftDown += delta2
    }
    // § 747
    const v = emptyBox("vlist")
    v.height = shiftUp + x.height; v.depth = z.depth + shiftDown; v.width = x.width
    v.list = t === 0
      ? [x, kern((shiftUp - x.depth) - (z.height - shiftDown)), z]
      : [x, kern((shiftUp - x.depth) - (this.axisHeight + delta)), { kind: "rule", width: null, height: t, depth: 0 }, kern((this.axisHeight - delta) - (z.height - shiftDown)), z]
    // § 748: the delimiters at least delim1 (display) or delim2 tall (a null delimiter: an empty box of \\nulldelimiterspace)
    const size = this.mathsy(display ? 20 : 21, this.curSize), none: Delimiter = { smallFam: 0, smallChar: 0, largeFam: 0, largeChar: 0 }
    return [hpack([this.varDelimiter(q.left ?? none, this.curSize, size), v, this.varDelimiter(q.right ?? none, this.curSize, size)])]
  }

  /** make_scripts (§§ 756–759): attach the scripts of q to its hlist p. */
  makeScripts(q: Noad, p: Node[], delta: number) {
    let shiftUp = 0, shiftDown = 0
    if (p[0]?.kind !== "char") {
      const z = hpack(p)
      const t = this.curStyle < SCRIPT ? 1 : 2
      shiftUp = z.height - this.mathsy(18, t)
      shiftDown = z.depth + this.mathsy(19, t)
    }
    const xh = Math.abs(this.mathXHeight)
    let x: BoxNode
    if (!q.sup) { // § 757
      x = this.cleanBox(q.sub, subStyle(this.curStyle))
      x.width += this.env.scriptspace
      if (shiftDown < this.mathsy(16, this.curSize)) shiftDown = this.mathsy(16, this.curSize)
      const clr = x.height - Math.trunc((xh * 4) / 5)
      if (shiftDown < clr) shiftDown = clr
      x.shift = shiftDown
    } else {
      x = this.cleanBox(q.sup, supStyle(this.curStyle)) // § 758
      x.width += this.env.scriptspace
      let clr = this.curStyle % 2 ? this.mathsy(15, this.curSize) : this.curStyle < TEXT ? this.mathsy(13, this.curSize) : this.mathsy(14, this.curSize)
      if (shiftUp < clr) shiftUp = clr
      clr = x.depth + Math.trunc(xh / 4)
      if (shiftUp < clr) shiftUp = clr
      if (!q.sub) x.shift = -shiftUp
      else { // § 759
        const y = this.cleanBox(q.sub, subStyle(this.curStyle))
        y.width += this.env.scriptspace
        if (shiftDown < this.mathsy(17, this.curSize)) shiftDown = this.mathsy(17, this.curSize)
        clr = 4 * this.ruleThickness - ((shiftUp - x.depth) - (y.height - shiftDown))
        if (clr > 0) {
          shiftDown += clr
          clr = Math.trunc((xh * 4) / 5) - (shiftUp - x.depth)
          if (clr > 0) { shiftUp += clr; shiftDown -= clr }
        }
        x.shift = delta // the superscript is delta to the right of the subscript
        x = vpack([x, kern((shiftUp - x.depth) - (y.height - shiftDown)), y])
        x.shift = shiftDown
      }
    }
    p.push(x)
  }
}


/** \skewchar as LaTeX's font families set it (\DeclareFontFamily{OML}{cmm}{\skewchar\font'177}, OMS cmsy's '60; omllmm.fd and
 *  omslmsy.fd the same; mathrsfs's ursfs.fd '177), else -1 */
const skewChar = (name: string) => (/^((cm|lm)mib?|rsfs)\d/.test(name) ? 127 : /^(cm|lm)(b?)sy\d/.test(name) ? 48 : -1)

/** char_box (§ 709): a character in an hbox whose width includes its italic correction */
function charBox(f: Font, c: number): BoxNode {
  const m = f.chars.get(c)!
  const b = emptyBox("hlist", m.width + m.italic)
  b.height = m.height; b.depth = m.depth; b.list = [charNode(f, c)]
  return b
}

/** An extensible character (§§ 713–714): bottom, repeaters, middle, repeaters, top stacked in a vbox at least v tall */
function extensible(f: Font, q: CharMetrics, v: number): BoxNode {
  const r = f.exten![q.remainder] >>> 0
  const top = r >>> 24, mid = (r >>> 16) & 255, bot = (r >>> 8) & 255, rep = r & 255
  const hd = (ch: number) => { const m = f.chars.get(ch)!; return m.height + m.depth }
  const b = emptyBox("vlist")
  const rm = f.chars.get(rep)!
  b.width = rm.width + rm.italic
  const u = hd(rep)
  let w = 0
  if (bot) w += hd(bot)
  if (mid) w += hd(mid)
  if (top) w += hd(top)
  let n = 0
  if (u > 0) while (w < v) { w += u; n++; if (mid) w += u }
  const stack = (ch: number) => { const p = charBox(f, ch); b.list.unshift(p); b.height = p.height } // stack_into_box (§ 711)
  if (bot) stack(bot)
  for (let m = 0; m < n; m++) stack(rep)
  if (mid) { stack(mid); for (let m = 0; m < n; m++) stack(rep) }
  if (top) stack(top)
  b.depth = w - b.height
  return b
}

/** rebox (§ 715): center box b in width w with \\hss glue at both ends. */
function rebox(b: BoxNode, w: number): BoxNode {
  if (b.width !== w && b.list.length) {
    if (b.kind === "vlist") b = hpack([b])
    const p = b.list.slice()
    if (p.length === 1 && p[0].kind === "char") {
      const v = p[0].width
      if (v !== b.width) p.push(kern(b.width - v))
    }
    return hpack([ssGlue(), ...p, ssGlue()], { exactly: w })
  }
  b.width = w
  return b
}
