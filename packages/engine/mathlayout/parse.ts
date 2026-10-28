// Math mode input to an mlist, as TeX's math mode builds it (§§ 1136–1193):
// characters by \mathcode (§ 1151), symbol commands by their \mathchar,
// math groups and their collapse to a lone ord's nucleus (§ 1186), sub_sup
// with its dummy noads (§§ 1176–1177), \limits and \nolimits (§ 1159),
// style commands (§ 1169), \overline and \underline (§ 1163), \penalty, \sqrt (\radical, § 1163), and these LaTeX definitions: \allowbreak
// (\penalty0), \nobreak (\penalty10000), \, \: \; \! and their names (\tmspace: \mskip±\thinmuskip…),
// \quad and \qquad (\hskip1em, \hskip2em), \ne and \neq (\not=), \frac
// ({\begingroup#1\endgroup\over#2}), \int and \oint (\intop\nolimits), and
// the prime ' (^\bgroup\prime…\egroup, which takes in a superscript that
// follows: x'^{ab} is x^{\prime ab}); \mathord … \mathinner, \mkern, \mskip and \nonscript; LaTeX's and
// amsmath's \dots (amsmath's by the token after it), \cdots, \vdots, \ddots, \colon, \bmod, \pmod, \pod, \mod.

import type { MathData } from "./data"
import { Scanner, type GlueSpec } from "../layout/dimen"
import { charNode, filGlue, fillGlue, glue, kern, paramGlue, penalty, type BoxNode, type Node } from "../layout/nodes"
import { hpack, vpack } from "../layout/pack"
import type { Font } from "../layout/font"
import { delimiterOf, groupField, groupNoad, mlistToHlist, TEXT as TEXT_STYLE, type FractionNoad, type MathEnv, INNER, mathCharField, mathCharNoad, OP, ORD, type Delimiter, type Field, type MItem, type Noad } from "./mlist"

const STYLES: Record<string, number> = { displaystyle: 0, textstyle: 2, scriptstyle: 4, scriptscriptstyle: 6 }
const OPERATOR_MACROS: Record<string, string> = { int: "intop", oint: "ointop" }
/** Operator names: latex.ltx's \mathop{\operator@font name} (with \nolimits: "o"), amsopn's \qopname\relax o|m{name}
 *  (o: \nolimits@, m: \nmlimits@, \displaylimits), whose nucleus starts with \kern\z@ */
const OPERATORS: Record<string, [string, "o" | "m"]> = {
  log: ["log", "o"], lg: ["lg", "o"], ln: ["ln", "o"], lim: ["lim", "m"], limsup: ["lim\\,sup", "m"], liminf: ["lim\\,inf", "m"],
  sin: ["sin", "o"], arcsin: ["arcsin", "o"], sinh: ["sinh", "o"], cos: ["cos", "o"], arccos: ["arccos", "o"], cosh: ["cosh", "o"],
  tan: ["tan", "o"], arctan: ["arctan", "o"], tanh: ["tanh", "o"], cot: ["cot", "o"], coth: ["coth", "o"], sec: ["sec", "o"], csc: ["csc", "o"],
  max: ["max", "m"], min: ["min", "m"], sup: ["sup", "m"], inf: ["inf", "m"], arg: ["arg", "o"], ker: ["ker", "o"], dim: ["dim", "o"],
  hom: ["hom", "o"], det: ["det", "m"], exp: ["exp", "o"], Pr: ["Pr", "m"], gcd: ["gcd", "m"], deg: ["deg", "o"],
}
/** \tmspace in math (latex.ltx, amsmath): \mskip with a sign and a mu skip register (\> is \:) */
const MU_SPACES: Record<string, [1 | -1, "thinmuskip" | "medmuskip" | "thickmuskip"]> = {
  ",": [1, "thinmuskip"], thinspace: [1, "thinmuskip"], "!": [-1, "thinmuskip"], negthinspace: [-1, "thinmuskip"],
  ":": [1, "medmuskip"], ">": [1, "medmuskip"], medspace: [1, "medmuskip"], negmedspace: [-1, "medmuskip"],
  ";": [1, "thickmuskip"], thickspace: [1, "thickmuskip"], negthickspace: [-1, "thickmuskip"],
}
/** \mathord … \mathinner (§ 1155): a noad of that class, its nucleus scan_math's */
const MATH_CLASSES: Record<string, Noad["noad"]> = { mathord: ORD, mathop: OP, mathbin: 2, mathrel: 3, mathopen: 4, mathclose: 5, mathpunct: 6, mathinner: INNER }
/** \chardef'd characters (latex.ltx): \# \% \& */
const CHARDEFS = ["#", "%", "&"]
/** amsmath's macros that start \DOTSB (B) or \DOTSI (I), which \dots looks for after it */
const DOTS_MACROS: Record<string, "B" | "I"> = {
  ...Object.fromEntries("coprod bigvee bigwedge biguplus bigcap bigcup prod sum bigotimes bigoplus bigodot bigsqcup implies impliedby And longrightarrow Longrightarrow longleftarrow Longleftarrow longleftrightarrow Longleftrightarrow mapsto longmapsto hookrightarrow hookleftarrow iff doteq".split(" ").map((x) => [x, "B"])),
  ...Object.fromEntries("int oint iint iiint iiiint idotsint".split(" ").map((x) => [x, "I"])),
}
/** amsmath's \rightdelim@: what \dots and \cdots put a thin space before */
const RIGHT_DELIMS = ["rbrack", "}", "rbrace", "rangle", "rceil", "rfloor", "rgroup", "rmoustache", "right", "bigr", "biggr", "Bigr", "Biggr"]
/** fontmath.ltx's \DeclareMathAccent's: \mathaccent codes (amsmath's \mathaccentV gives each class 7) */
const ACCENTS: Record<string, number> = {
  acute: 0x7013, grave: 0x7012, ddot: 0x707f, tilde: 0x707e, bar: 0x7016, breve: 0x7015, check: 0x7014, hat: 0x705e, vec: 0x017e, dot: 0x705f,
  widetilde: 0x0365, widehat: 0x0362, mathring: 0x7017,
}
/** LaTeX's text font commands in math (\nfss@text{<declaration>#1}) */
const TEXT_FONT_COMMANDS: Record<string, string> = {
  textrm: "rmfamily", textsf: "sffamily", texttt: "ttfamily", textnormal: "normalfont", textbf: "bfseries", textmd: "mdseries",
  textit: "itshape", textsl: "slshape", textsc: "scshape", textup: "upshape",
}
/** mathtools's colon relations (\vcentcolon: \mathrel{\mathop\ordinarycolon}, a colon centered on the axis) */
const VCENTCOLON = "\\mathrel{\\mathop:}", DBLCOLON = `${VCENTCOLON}\\mathrel{\\mkern-.9mu}${VCENTCOLON}`
const COLONS: Record<string, string> = {
  vcentcolon: VCENTCOLON, dblcolon: DBLCOLON,
  coloneqq: `${VCENTCOLON}\\mathrel{\\mkern-1.2mu}=`, coloneq: `${VCENTCOLON}\\mathrel{\\mkern-1.2mu}=`,
  Coloneqq: `${DBLCOLON}\\mathrel{\\mkern-1.2mu}=`, Coloneq: `${DBLCOLON}\\mathrel{\\mkern-1.2mu}=`,
  eqqcolon: `=\\mathrel{\\mkern-1.2mu}${VCENTCOLON}`, eqcolon: `=\\mathrel{\\mkern-1.2mu}${VCENTCOLON}`,
  Eqqcolon: `=\\mathrel{\\mkern-1.2mu}${DBLCOLON}`, Eqcolon: `=\\mathrel{\\mkern-1.2mu}${DBLCOLON}`,
  colonapprox: `${VCENTCOLON}\\mathrel{\\mkern-1.2mu}\\approx`, Colonapprox: `${DBLCOLON}\\mathrel{\\mkern-1.2mu}\\approx`,
  approxcolon: `\\approx\\mathrel{\\mkern-1.2mu}${VCENTCOLON}`, Approxcolon: `\\approx\\mathrel{\\mkern-1.2mu}${DBLCOLON}`,
  colonsim: `${VCENTCOLON}\\mathrel{\\mkern-1.2mu}\\sim`, Colonsim: `${DBLCOLON}\\mathrel{\\mkern-1.2mu}\\sim`,
  simcolon: `\\sim\\mathrel{\\mkern-1.2mu}${VCENTCOLON}`, Simcolon: `\\sim\\mathrel{\\mkern-1.2mu}${DBLCOLON}`,
  colondash: `${VCENTCOLON}\\mathrel{\\mkern-1.2mu}\\mathrel{-}`, Colondash: `${DBLCOLON}\\mathrel{\\mkern-1.2mu}\\mathrel{-}`,
  dashcolon: `\\mathrel{-}\\mathrel{\\mkern-1.2mu}${VCENTCOLON}`, Dashcolon: `\\mathrel{-}\\mathrel{\\mkern-1.2mu}${DBLCOLON}`,
}
/** an empty math group, {} */
const ORD_EMPTY = (): Noad => ({ noad: ORD, nucleus: { kind: "mlist", list: [] }, sup: null, sub: null })
/** amsmath's \iint … and \idotsint: how many \intop's */
const MULTI_INTEGRALS: Record<string, number> = { iint: 2, iiint: 3, iiiint: 4, idotsint: 0 }
/** amsmath's \intdots@ between two \intop's */
const INTDOTS = "\\mathchoice{\\mathinner{\\cdotp\\cdotp\\cdotp}}{{\\cdotp}\\mkern1.5mu{\\cdotp}\\mkern1.5mu{\\cdotp}}{{\\cdotp}\\mkern1mu{\\cdotp}\\mkern1mu{\\cdotp}}{{\\cdotp}\\mkern1mu{\\cdotp}\\mkern1mu{\\cdotp}}"
/** amsmath's \genfrac's: delimiters, thickness, style */
const GENFRACS: Record<string, [string, string, string, string]> = {
  dfrac: ["", "", "", "0"], tfrac: ["", "", "", "1"], binom: ["(", ")", "0pt", ""] /* (\z@) */, dbinom: ["(", ")", "0pt", "0"], tbinom: ["(", ")", "0pt", "1"],
}
/** the generalized fraction primitives (§ 1178) and LaTeX's \choose, \brack and \brace: thickness default, zero or
 *  scanned; delimiters scanned ("") or given */
const FRACTION_PRIMITIVES: Record<string, ["over" | "atop" | "above", string | null]> = {
  over: ["over", null], atop: ["atop", null], above: ["above", null],
  overwithdelims: ["over", ""], atopwithdelims: ["atop", ""], abovewithdelims: ["above", ""],
  choose: ["atop", "()"], brack: ["atop", "[]"], brace: ["atop", "\\{\\}"],
}
/** amsmath's capitalized accents: the accent (\def\Hat{\hat}) */
const ACCENT_ALIASES = ["Hat", "Check", "Tilde", "Acute", "Grave", "Dot", "Ddot", "Breve", "Bar", "Vec"]
/** amssymb's AMSb family (codegen/math.ts PACKAGE_FAMILIES) */
const AMSB = 9
/** fontmath.ltx's arrows and relations built of others (\joinrel: \mathrel{\mkern-3mu}), and amsmath's (its \DOTSB is \relax) */
const ARROWS: Record<string, [string | null, string]> = {
  implies: [null, "\\;\\Longrightarrow\\;"], impliedby: [null, "\\;\\Longleftarrow\\;"],
  joinrel: ["\\mathrel{\\mkern-3mu}", "\\mathrel{\\mkern-3mu}"],
  longrightarrow: ["\\relbar\\joinrel\\rightarrow", "\\relbar\\joinrel\\rightarrow"],
  Longrightarrow: ["\\Relbar\\joinrel\\Rightarrow", "\\Relbar\\joinrel\\Rightarrow"],
  longleftarrow: ["\\leftarrow\\joinrel\\relbar", "\\leftarrow\\joinrel\\relbar"],
  Longleftarrow: ["\\Leftarrow\\joinrel\\Relbar", "\\Leftarrow\\joinrel\\Relbar"],
  longleftrightarrow: ["\\leftarrow\\joinrel\\rightarrow", "\\leftarrow\\joinrel\\rightarrow"],
  Longleftrightarrow: ["\\Leftarrow\\joinrel\\Rightarrow", "\\Leftarrow\\joinrel\\Rightarrow"],
  mapsto: ["\\mapstochar\\rightarrow", "\\mapstochar\\rightarrow"],
  longmapsto: ["\\mapstochar\\longrightarrow", "\\mapstochar\\longrightarrow"],
  hookrightarrow: ["\\lhook\\joinrel\\rightarrow", "\\lhook\\joinrel\\rightarrow"],
  hookleftarrow: ["\\leftarrow\\joinrel\\rhook", "\\leftarrow\\joinrel\\rhook"],
  iff: ["\\;\\Longleftrightarrow\\;", "\\;\\Longleftrightarrow\\;"],
  models: ["\\mathrel{|}\\joinrel\\Relbar", "\\mathrel{|}\\joinrel\\Relbar"],
  bowtie: ["\\mathrel\\triangleright\\joinrel\\mathrel\\triangleleft", "\\mathrel\\triangleright\\joinrel\\mathrel\\triangleleft"],
}
/** \quad and \qquad: \hskip in em of the current (text) font */
const QUADS: Record<string, number> = { quad: 1, qquad: 2 }
/** delimiters LaTeX defines through others in math: \{ (\lbrace), \} (\rbrace), \| (\Vert); amsmath's \lvert… */
const DELIMITER_MACROS: Record<string, string> = { "{": "lbrace", "}": "rbrace", "|": "Vert" }
const AMS_DELIMITERS: Record<string, string> = { lvert: "vert", rvert: "vert", lVert: "Vert", rVert: "Vert" }
/** amsmath's matrix environments: their \left and \right */
const MATRICES: Record<string, [string, string] | null> = { matrix: null, pmatrix: ["(", ")"], bmatrix: ["[", "]"], Bmatrix: ["lbrace", "rbrace"], vmatrix: ["vert", "vert"], Vmatrix: ["Vert", "Vert"] }

export type MathText = (src: string, size: 0 | 1 | 2, style: "display" | "text" | null, declaration?: string) => BoxNode

/** Options of the document the formula is in. */
export interface MathOptions {
  amsmath?: boolean
  /** math alphabet commands (\mathbf{…}) and the family each sets in its argument, a math group */
  alphabets?: Record<string, number>
  /** \fontdimen6 of the current text font, the em of \quad and \qquad */
  em?: number
  /** commands a package binding typesets from the source of an optional […] and its braced arguments (siunitx's):
   *  how many braced arguments each takes, and their mlist with \fam in force */
  commands?: { arity: Record<string, number>; build: (cmd: string, opt: string | undefined, args: string[], fam: number) => MItem[] }
  /** packages whose symbols and delimiters are defined (MathData.packages: amsmath, amsfonts, amssymb), in loading order */
  packages?: string[]
  /** the current text font: \hbox{.} in \vdots and \ddots */
  font?: Font
  /** amsmath's \if@display: the formula is in a display (\everydisplay sets it), for \pod, \pmod and \mod */
  display?: boolean
  /** amsmath's \text and LaTeX's \mbox (and \textrm …) in math: the text in an \hbox at \f@size (0), \sf@size (1) or
   *  \ssf@size (2), with \everymath setting a style (or not: null), after a font declaration (\rmfamily …) */
  text?: MathText
  /** the fonts and parameters the formula is set with (amsmath's \binrel@ measures in them) */
  env?: MathEnv
  /** \fbox's frame around a box (\@frameb@x with \fboxsep and \fboxrule), for amsmath's \boxed */
  frame?: (box: BoxNode) => BoxNode
  /** (internal) the formula's source, which text arguments are cut from */
  raw?: string
  /** (internal) amsmath's \accentclass@ is 0 (\noaccents@), not 7 */
  accentClass0?: boolean
  /** (internal) amsmath's \finsm@sh where the formula starts: t, b or tb */
  finsmash?: "t" | "b" | "tb"
  /** array.sty is loaded: its \array cells end with \textonly@unskip, LaTeX's with a $ (which \dots looks ahead to) */
  arrayPackage?: boolean
  /** a $ follows the formula (inline math, $$ displays), which amsmath's \dots and \cdots look ahead to */
  dollarNext?: boolean
  /** \mathcode's the document changes (beamer's \DeclareMathSymbol for the Latin letters), by character code */
  mathcodes?: Record<number, number>
  /** operators a language redefines (spanish.ldf's \es@operators: \mathop{\operator@font l\acute{\dotlessi}m}): the
   *  name (letters, \, and \acute{letter or \dotlessi}, in family 0) and whether \nolimits follows */
  operators?: Record<string, { name: string; nolimits: boolean }>
}

/** a token; braces from the formula's own source keep their offset in it (`at`), for text arguments */
type Token = { cs: string; value?: number; spec?: GlueSpec } | { ch: string; at?: number }

/** \mkern's mu dimension and \mskip's mu glue (scan_dimen and scan_glue with mu, §§ 448–461), the mu skip registers
 *  coerced (\mkern-\thinmuskip: its width) */
function scanMu(src: string, cs: "mkern" | "mskip", muskips?: Record<string, GlueSpec>): { spec: GlueSpec; length: number } {
  const s = new Scanner(src, { em: 0, ex: 0, internal: (name) => (muskips && name in muskips ? { level: "glue", value: muskips[name] } : undefined) })
  const spec = cs === "mkern" ? { width: s.scanDimen(true).value, stretch: 0, stretchOrder: 0 as const, shrink: 0, shrinkOrder: 0 as const } : s.scanGlue(true)
  if (s.errors.length) throw new Error(`math: \\${cs}: ${s.errors[0]}`)
  return { spec, length: s.pos }
}

function tokenize(src: string, muskips?: Record<string, GlueSpec>, offsets = false): Token[] {
  const out: Token[] = []
  for (let i = 0; i < src.length;) {
    const c = src[i]
    if (c === "\\") {
      const m = src.slice(i + 1).match(/^([A-Za-z]+|.)/)
      if (!m) throw new Error("math: \\ at end of input")
      i += 1 + m[1].length
      if (/^[A-Za-z]/.test(m[1])) while (/\s/.test(src[i] ?? "")) i++ // spaces after a control word
      if (m[1] === "penalty") { // scan_int (§ 440): optional signs, digits, one optional space
        const n = src.slice(i).match(/^([+-\s]*)(\d+) ?/)
        if (!n) throw new Error("math: \\penalty needs an integer")
        out.push({ cs: m[1], value: ((n[1].match(/-/g) ?? []).length % 2 ? -1 : 1) * Number(n[2]) }); i += n[0].length
      } else if (m[1] === "mkern" || m[1] === "mskip") {
        const { spec, length } = scanMu(src.slice(i), m[1], muskips)
        out.push({ cs: m[1], spec }); i += length
      } else out.push({ cs: m[1] })
    } else if (/\s/.test(c)) i++ // spaces are ignored in math mode
    else if (c === "%") { while (i < src.length && src[i] !== "\n") i++ }
    else { out.push(offsets && (c === "{" || c === "}") ? { ch: c, at: i } : { ch: c }); i++ }
  }
  return out
}

/** a glue register with a sign, as scan_glue negates it (§ 461) */
const scaled = (g: GlueSpec, sign: 1 | -1): GlueSpec => ({ ...g, width: sign * g.width, stretch: sign * g.stretch, shrink: sign * g.shrink })

/** braces balanced throughout, never closing below zero */
const balanced = (ts: Token[]) => { let d = 0; for (const t of ts) { if (isCh(t, "{")) d++; else if (isCh(t, "}") && --d < 0) return false } return d === 0 }

const isCh = (t: Token | undefined, c: string) => !!t && "ch" in t && t.ch === c

/** tokens as source again (a space after a control word) */
const source = (ts: Token[]) => ts.map((t) => ("ch" in t ? t.ch : `\\${t.cs}${/^[A-Za-z]/.test(t.cs) ? " " : ""}`)).join("")

/** Parse a formula (the text between $…$) into an mlist. */
export function parseMath(src: string, data: MathData, opts: MathOptions = {}): MItem[] {
  return parseTokens(tokenize(src, data.muskips, true), withPackages(data, opts.packages ?? []), { ...opts, raw: src }, -1)
}

const merged = new WeakMap<MathData, Map<string, MathData>>()
/** LaTeX's symbols and delimiters with those the packages declare (DeclareMathSymbol redefines: theirs win) */
function withPackages(data: MathData, packages: string[]): MathData {
  if (!packages.length) return data
  const key = packages.join(",")
  let m = merged.get(data)
  if (!m) merged.set(data, (m = new Map()))
  let d = m.get(key)
  if (!d) {
    const ps = packages.map((p) => { const x = data.packages?.[p]; if (!x) throw new Error(`math: no data for ${p}`); return x })
    d = { ...data, symbols: Object.assign({}, data.symbols, ...ps.map((p) => p.symbols)), delimiters: Object.assign({}, data.delimiters, ...ps.map((p) => p.delimiters)) }
    m.set(key, d)
  }
  return d
}

/** `fam`: \fam in force (-1: none), which class-7 characters take (§ 1151) */
function parseTokens(input: Token[], data: MathData, opts: MathOptions, fam: number): MItem[] {
  const toks = input.slice() // (macros expand in place: a list read twice reads its source)
  const macroOf = (cs: string) => DELIMITER_MACROS[cs] ?? (opts.amsmath ? AMS_DELIMITERS[cs] : undefined) ?? cs
  const mathcode = (ch: string) => opts.mathcodes?.[ch.charCodeAt(0)] ?? data.mathcodes[ch.charCodeAt(0)]
  let pos = 0
  const scriptsAllowed = (x: MItem | undefined): x is Noad => !!x && "noad" in x && typeof x.noad === "number" // (ord … inner, § 1176)

  /** An undelimited macro argument: a balanced group without its braces, or one token. */
  const argument = (): Token[] => {
    const t = toks[pos++]
    if (!t) throw new Error("math: missing argument")
    if (!isCh(t, "{")) return [t]
    const start = pos
    for (let depth = 1; ; pos++) {
      if (pos >= toks.length) throw new Error("math: missing }")
      if (isCh(toks[pos], "{")) depth++
      else if (isCh(toks[pos], "}") && --depth === 0) break
    }
    return toks.slice(start, pos++)
  }
  // (a list of its own: its end is a } or an \endgroup, not the formula's $)
  const inner = opts.dollarNext ? { ...opts, dollarNext: false } : opts
  /** \finsm@sh as amsmath's \smash last \edef'ed it in this group (what \relbar's \mathsm@sh then does) */
  let finsmash = opts.finsmash ?? "tb"
  const sub = (ts: Token[], f = fam, more: Partial<MathOptions> = {}) => parseTokens(ts, data, { ...inner, finsmash, ...more }, f)
  /** a math group in this list: what it defines ends with it */
  const group = <T>(f: () => T): T => { const saved = finsmash; const x = f(); finsmash = saved; return x }
  /** \mathpalette: a choice node whose list `build` makes for the style (#1: \displaystyle … \scriptscriptstyle, never cramped) */
  const palette = (build: (style: number) => MItem[]): MItem => ({ kind: "choice", choose: (st) => build(2 * (st >> 1)) })
  /** $\m@th#1{#2}$ in an \hbox: a new formula (\fam -1) with the style, then #2 as a math group */
  const inHbox = (style: number, arg: Token[], fs: typeof finsmash): MItem[] => [{ kind: "style", style }, groupNoad(parseTokens(arg, data, { ...inner, finsmash: fs }, -1))]
  /** \mathpalette\mathsm@sh: \setbox\z@\hbox{$\m@th#1{#2}$}{}\finsm@sh, the box's height and depth (amsmath's [t], [b]) zero */
  const smash = (arg: Token[], mode: "t" | "b" | "tb"): MItem => {
    const fs = finsmash
    return palette((st) => [{ noad: ORD, nucleus: { kind: "mlist", list: [] }, sup: null, sub: null }, { noad: ORD, nucleus: { kind: "hmath", list: inHbox(st, arg, fs), smash: mode }, sup: null, sub: null }])
  }
  /**
   * amsmath's \binrel@{base}\binrel@@{…}: a noad around `noad` of base's class, from base measured as ${}#1{}$ less $#1$
   * with \thinmuskip 0, \medmuskip -1mu and \thickmuskip 1mu (negative: \mathbin, positive: \mathrel, else \relax{…})
   */
  const binrel = (base: Token[], noad: Noad): Noad => {
    if (!opts.env) throw new Error("math: \\binrel@ without the fonts")
    const mu = { width: 65536, stretch: 0, stretchOrder: 0 as const, shrink: 0, shrinkOrder: 0 as const }
    const env = { ...opts.env, muskips: { thinmuskip: { ...mu, width: 0 }, medmuskip: { ...mu, width: -65536 }, thickmuskip: mu } }
    const width = (l: MItem[]) => hpack(mlistToHlist(l, env, TEXT_STYLE, false)).width
    const w = width([ORD_EMPTY(), ...parseTokens(base, data, { ...inner, finsmash }, -1), ORD_EMPTY()]) - width(parseTokens(base, data, { ...inner, finsmash }, -1))
    return w === 0 ? groupNoad([noad]) : { noad: w < 0 ? 2 : 3, nucleus: groupField([noad]), sup: null, sub: null }
  }
  /** an \array cell before an &: \@sharp, then the v-part of the template, $ in LaTeX's */
  const cellBefore = (ts: Token[]) => parseTokens(ts, data, { ...opts, dollarNext: !opts.arrayPackage, finsmash }, -1)
  /** amsmath's \dots and its kin as the source they become, by the token after them (the end of the formula: a $ when
   *  dollarNext); null: not one of them */
  const dotsMacro = (cs: string): string | null => {
    const MATHELLIPSIS = "\\mathinner{\\ldotp\\ldotp\\ldotp}", CDOTS = "\\mathinner{\\cdotp\\cdotp\\cdotp}"
    if (!opts.amsmath) return cs === "dots" || cs === "ldots" || cs === "mathellipsis" ? MATHELLIPSIS : cs === "cdots" ? CDOTS : null
    const next = toks[pos], atEnd = pos >= toks.length
    // \extra@: a right delimiter, or $, follows
    const extra = () => atEnd ? !!opts.dollarNext : "ch" in next ? next.ch === ")" || next.ch === "]" : RIGHT_DELIMS.includes(next.cs)
    // \extrap@: , ; . or what \extra@ takes
    const extrap = (d: string) => (!atEnd && "ch" in next && ",;.".includes(next.ch)) || extra() ? `${d}\\,` : d
    switch (cs) {
      case "ldots": case "mathellipsis": return MATHELLIPSIS
      case "cdots": case "dotsb": case "dotsm": return extrap(CDOTS)
      case "dotso": return extrap(MATHELLIPSIS)
      case "dotsi": return `\\!${CDOTS}`
      case "dotsc": return (!atEnd && "ch" in next && ";.".includes(next.ch)) || extra() ? `${MATHELLIPSIS}\\,` : MATHELLIPSIS
      case "dots": { // \mdots@@: by what the next token is
        if (atEnd) return extra() ? `${MATHELLIPSIS}\\,` : MATHELLIPSIS // (\dotso@)
        if ("ch" in next) {
          if (next.ch === ",") return MATHELLIPSIS // \dotsc before a , (neither ; nor . nor what \extra@ takes)
          if ("+=<>-*:".includes(next.ch)) return CDOTS // \keybin@
          return MATHELLIPSIS + (next.ch === ")" || next.ch === "]" ? "\\," : "") // \dotso@ with \extra@
        }
        if (next.cs === "boldsymbol") throw new Error("math: \\dots before \\boldsymbol")
        const code = data.symbols[next.cs]
        // \not, a \mathchar of class 2 or 3 (\getmathch@; \not is one), or a macro starting \DOTSB: \dotsb@; \DOTSI: \dotsi
        if ((code !== undefined && !(next.cs in DOTS_MACROS) && ((code >> 12) === 2 || (code >> 12) === 3)) || DOTS_MACROS[next.cs] === "B" || (next.cs === "vcentcolon" && opts.packages?.includes("mathtools"))) return CDOTS // (mathtools's \vcentcolon: a macro starting \mathrel)
        if (DOTS_MACROS[next.cs] === "I") return `\\!${CDOTS}`
        return MATHELLIPSIS + (RIGHT_DELIMS.includes(next.cs) ? "\\," : "")
      }
    }
    return null
  }
  /** a math alphabet's argument: a math group with \fam set */
  const alphabet = (cs: string): Field | undefined => (opts.alphabets && cs in opts.alphabets ? groupField(alphabetList(cs)) : undefined)
  /** an alphabet's argument with its \fam; amsmath: an alphabet of the U, OML or OMS encoding runs \noaccents@ (\M@U …) */
  const alphabetList = (cs: string) => sub(argument(), opts.alphabets![cs], opts.amsmath && ["mathnormal", "mathcal", "mathbb", "mathfrak", "mathscr"].includes(cs) ? { accentClass0: true } : {})
  /** \begin{name}: the environment's name and its body's tokens, to the matching \end */
  const environment = (): { name: string; body: Token[] } => {
    const nameToks = argument()
    const name = nameToks.map((t) => ("ch" in t ? t.ch : "")).join("")
    const start = pos
    for (let depth = 0; ; pos++) {
      const t = toks[pos]
      if (!t) throw new Error(`math: \\begin{${name}} without its \\end`)
      if ("cs" in t && (t.cs === "begin" || t.cs === "end")) {
        if (t.cs === "begin") depth++
        else if (depth-- === 0) { const body = toks.slice(start, pos); pos++; argument(); return { name, body } }
      }
    }
  }
  /** an \array body: rows split at \\, cells at &, outside braces and inner environments; each cell a formula of its
   *  own, where \fam is -1 (§ 1139) */
  const arrayRows = (body: Token[]) => {
    const rows: MItem[][][] = [], crs: boolean[] = []
    let row: MItem[][] = [], cell: Token[] = [], depth = 0
    for (const t of body) {
      if ("ch" in t && t.ch === "{") depth++
      else if ("ch" in t && t.ch === "}") depth--
      else if ("cs" in t && t.cs === "begin") depth++
      else if ("cs" in t && t.cs === "end") depth--
      if (depth === 0 && "ch" in t && t.ch === "&") { row.push(cellBefore(cell)); cell = []; continue }
      if (depth === 0 && "cs" in t && t.cs === "\\") { row.push(sub(cell, -1)); rows.push(row); crs.push(true); row = []; cell = []; continue }
      cell.push(t)
    }
    // \crcr: a last row without \\ (an empty one after a final \\ is no row)
    if (cell.length || row.length) { row.push(sub(cell, -1)); rows.push(row); crs.push(false) }
    return { rows, crs }
  }
  /** scan_delimiter (§ 1160): a character's \delcode or a \delimiter command */
  const delimiter = (after: string): Delimiter => {
    const t = toks[pos++]
    if (t && "ch" in t) {
      const d = data.delcodes[t.ch.charCodeAt(0)]
      if (d !== undefined && d >= 0) return delimiterOf(d)
    } else if (t) {
      const name = macroOf(t.cs)
      if (name in data.delimiters) return delimiterOf(data.delimiters[name] & 0xffffff)
    }
    throw new Error(`math: Missing delimiter (. inserted) after \\${after}`)
  }
  const fraction = (): Field => {
    const num = argument(), den = argument()
    return groupField([{ noad: "fraction", thickness: null, num: sub(num), denom: sub(den) }])
  }
  /** a text argument as its source: a braced group of the formula's own (spaces and all), or one token */
  const rawArgument = (after: string): string => {
    const t = toks[pos]
    if (!t) throw new Error(`math: \\${after} without its argument`)
    if (!isCh(t, "{")) { pos++; return "ch" in t ? t.ch : `\\${t.cs} ` }
    const start = pos
    argument()
    const open = toks[start] as { ch: string; at?: number }, close = toks[pos - 1] as { ch: string; at?: number }
    if (open.at === undefined || close.at === undefined || opts.raw === undefined) throw new Error(`math: \\${after} of a macro's argument`)
    return opts.raw.slice(open.at + 1, close.at)
  }
  /** scan_dimen (§ 448) on the characters that follow; em from the current font */
  const dimension = (after: string): number => {
    let text = ""
    const starts: number[] = []
    for (let i = pos; i < toks.length; i++) {
      const x = toks[i]
      starts.push(text.length)
      if ("ch" in x && /^[-+.,0-9A-Za-z]$/.test(x.ch)) text += x.ch
      else break
    }
    const sc = new Scanner(text, { em: opts.em ?? 0, ex: 0 })
    const v = sc.scanDimen().value
    if (sc.errors.length || (opts.em === undefined && /em/.test(text.slice(0, sc.pos))) || /ex/.test(text.slice(0, sc.pos))) throw new Error(`math: \\${after} ${text.slice(0, sc.pos)}`)
    while (pos < toks.length && starts[0] !== undefined && starts.shift()! < sc.pos) pos++
    return v
  }
  /** scan_math (§ 1151): the field a script takes. */
  const scanMath = (): Field => {
    const t = toks[pos++]
    if (!t) throw new Error("math: missing script")
    if ("ch" in t) {
      if (t.ch === "{") { const l = group(() => list(true)); return groupField(l) }
      const code = mathcode(t.ch)
      if (code === undefined || code >= 0x8000) throw new Error(`math: unsupported script ${t.ch}`)
      return mathCharField(code, fam)
    }
    if (t.cs === "frac") return fraction()
    const a = alphabet(t.cs)
    if (a !== undefined) return a
    const dname = macroOf(t.cs)
    if (dname in data.delimiters) return mathCharField(data.delimiters[dname] >> 12, fam) // a \delimiter's \mathchar part
    const code = data.symbols[t.cs]
    if (code === undefined) throw new Error(`math: unsupported script \\${t.cs}`)
    return mathCharField(code, fam)
  }
  /** \@sqrt[#1]{\root #1\of}: the index, delimited by ] outside braces (one braced group loses its braces), and \r@@t's argument */
  const root = (): MItem => {
    const start = ++pos
    for (let depth = 0; depth > 0 || !isCh(toks[pos], "]"); pos++) {
      if (pos >= toks.length) throw new Error("math: \\sqrt[ without ]")
      if (isCh(toks[pos], "{")) depth++
      else if (isCh(toks[pos], "}")) depth--
    }
    let index = toks.slice(start, pos++)
    if (index.length >= 2 && isCh(index[0], "{") && isCh(index.at(-1), "}") && balanced(index.slice(1, -1))) index = index.slice(1, -1)
    if (index.some((t) => "cs" in t && (t.cs === "uproot" || t.cs === "leftroot"))) throw new Error("math: \\uproot and \\leftroot")
    // (each in an \hbox{$…$}, a new formula, where \fam is -1 (§ 1139); \rootbox: $\scriptscriptstyle{#1}$)
    const radicand = argument()
    const item: MItem = { kind: "root", index: () => groupNoad(sub(index, -1)), radicand: () => groupField(sub(radicand, -1)), amsmath: !!opts.amsmath }
    // amsmath's \root is \bgroup…\egroup: a math group, an ord noad (§ 1186)
    return opts.amsmath ? { noad: ORD, nucleus: { kind: "mlist", list: [item] }, sup: null, sub: null } : item
  }
  /** sub_sup (§ 1176): attach to the tail noad, or to a new dummy noad. */
  const subSup = (out: MItem[], which: "sup" | "sub", field: () => Field, head = 0) => {
    let tail = out.length > head ? out[out.length - 1] : undefined // (after \over the list starts again)
    if (!scriptsAllowed(tail) || tail[which] !== null) { tail = { noad: ORD, nucleus: null, sup: null, sub: null }; out.push(tail) }
    tail[which] = field()
  }

  const list = (inGroup: boolean, inFence = false): MItem[] => {
    let out: MItem[] = []
    // an incompleat noad (§ 1181): \over and its kin make what came before (since the last \middle) the numerator, what
    // follows the denominator; fin_mlist (§ 1184) completes it
    let incompleat: (Omit<FractionNoad, "num" | "denom"> & { at: number }) | null = null, segment = 0
    const done = (): MItem[] => {
      if (!incompleat) return out
      const { at, ...f } = incompleat
      incompleat = null
      return [...out.slice(0, segment), { ...f, num: out.slice(segment, at), denom: out.slice(at) }]
    }
    for (;;) {
      const t = toks[pos++]
      if (!t) { if (inGroup || inFence) throw new Error(inFence ? "math: missing \\right" : "math: missing }"); return done() }
      if ("cs" in t && t.cs === "right") { if (!inFence) throw new Error("math: Extra \\right"); return done() }
      if ("cs" in t && t.cs === "relax") continue // (no noad)
      if ("cs" in t && t.cs === "middle") { // e-TeX: it ends the group so far (fin_mlist), a fraction in it too
        if (!inFence) throw new Error("math: Extra \\middle")
        out = done()
        out.push({ noad: "middle", delim: delimiter("middle") }); segment = out.length; continue
      }
      if ("cs" in t && t.cs in FRACTION_PRIMITIVES) { // math_fraction (§ 1181)
        if (incompleat) throw new Error("math: Ambiguous; you need another { and }")
        const [kind, delims] = FRACTION_PRIMITIVES[t.cs]
        if (delims) toks.splice(pos, 0, ...tokenize(delims)) // \choose: \atopwithdelims()
        const left = delims !== null ? delimiter(t.cs) : undefined
        const right = left ? delimiter(t.cs) : undefined
        const thickness = kind === "above" ? dimension(t.cs) : kind === "atop" ? 0 : null
        incompleat = { noad: "fraction", thickness, at: out.length, ...(left ? { left, right } : {}) }
        continue
      }
      if ("cs" in t && t.cs === "begin") { // amsmath's matrix, pmatrix, bmatrix, Bmatrix, vmatrix, Vmatrix
        const { name, body } = environment()
        if (!opts.amsmath || !(name in MATRICES)) throw new Error(`math: unsupported environment ${name}`)
        const fence = MATRICES[name]
        const center: MItem[] = [{ kind: "colsep" }, { noad: ORD, vcenter: true, nucleus: { kind: "array", ...arrayRows(body) }, sup: null, sub: null }, { kind: "colsep" }]
        if (!fence) out.push(...center)
        else {
          const d = (x: string) => (x.length === 1 ? delimiterOf(data.delcodes[x.charCodeAt(0)]) : delimiterOf(data.delimiters[x] & 0xffffff))
          out.push({ noad: INNER, nucleus: { kind: "mlist", list: [{ noad: "left", delim: d(fence[0]) }, ...center, { noad: "right", delim: d(fence[1]) }] }, sup: null, sub: null })
        }
        continue
      }
      if ("cs" in t && t.cs === "left") { // math_left_right (§ 1191): an inner noad whose sub-mlist the fences end
        const left = delimiter("left")
        const inner = group(() => list(false, true)) // (math_left_group)
        const right = delimiter("right")
        out.push({ noad: INNER, nucleus: { kind: "mlist", list: [{ noad: "left", delim: left }, ...inner, { noad: "right", delim: right }] }, sup: null, sub: null })
        continue
      }
      if ("ch" in t) {
        const c = t.ch
        if (c === "}") { if (!inGroup) throw new Error("math: extra }"); return done() }
        if (c === "{") { out.push(groupNoad(group(() => list(true)))); continue }
        if (c === "^" || c === "_") { subSup(out, c === "^" ? "sup" : "sub", scanMath, incompleat?.at); continue }
        if (c === "'") { // latex.ltx \active@math@prime
          let n = 1
          while (isCh(toks[pos], "'")) { n++; pos++ }
          const primes = Array.from({ length: n }, () => mathCharNoad(data.symbols.prime))
          let more: MItem[] = []
          if (isCh(toks[pos], "^")) { pos++; more = sub(argument()) }
          subSup(out, "sup", () => groupField([...primes, ...more]), incompleat?.at)
          continue
        }
        const code = mathcode(c)
        if (code === undefined || code >= 0x8000) throw new Error(`math: unsupported character ${c}`)
        out.push(mathCharNoad(code, fam))
        continue
      }
      if (opts.commands && t.cs in opts.commands.arity) {
        let opt: string | undefined
        if (isCh(toks[pos], "[")) { // to the first ] outside braces
          const start = ++pos
          for (let depth = 0; depth > 0 || !isCh(toks[pos], "]"); pos++) {
            if (pos >= toks.length) throw new Error(`math: \\${t.cs}[ without ]`)
            if (isCh(toks[pos], "{")) depth++
            else if (isCh(toks[pos], "}")) depth--
          }
          opt = source(toks.slice(start, pos++))
        }
        const args = Array.from({ length: opts.commands.arity[t.cs] }, () => {
          if (!isCh(toks[pos], "{")) throw new Error(`math: \\${t.cs} without its arguments in braces`)
          return source(argument())
        })
        out.push(...opts.commands.build(t.cs, opt, args, fam))
        continue
      }
      if (opts.operators && Object.hasOwn(opts.operators, t.cs)) { // \mathop{\operator@font name}: a math group in family 0
        const op = opts.operators[t.cs], name = tokenize(op.name), nucleus: MItem[] = []
        for (let j = 0; j < name.length; j++) {
          const x = name[j]
          if ("ch" in x && /^[A-Za-z]$/.test(x.ch)) nucleus.push(mathCharNoad(data.mathcodes[x.ch.charCodeAt(0)], 0))
          else if ("cs" in x && x.cs === ",") nucleus.push({ kind: "muglue", spec: data.muskips.thinmuskip })
          else if ("cs" in x && x.cs === "acute" && isCh(name[j + 1], "{") && isCh(name[j + 3], "}")) {
            // \acute{\dotlessi}: {\mathchar"7010} in family 0, one ord, whose group gives up its nucleus
            const b = name[j + 2], base = "cs" in b && b.cs === "dotlessi" ? 0x7010 : "ch" in b ? data.mathcodes[b.ch.charCodeAt(0)] : -1
            if (base < 0) throw new Error(`math: an operator name with \\acute{${"cs" in b ? `\\${b.cs}` : b.ch}}`)
            nucleus.push({ noad: ORD, accent: mathCharField(ACCENTS.acute, 0), nucleus: mathCharField(base, 0), sup: null, sub: null }); j += 3
          } else throw new Error(`math: an operator name with ${"ch" in x ? x.ch : `\\${x.cs}`}`)
        }
        out.push({ noad: OP, nucleus: { kind: "mlist", list: nucleus }, sup: null, sub: null, ...(op.nolimits ? { limits: "nolimits" as const } : {}) })
        continue
      }
      if (t.cs in OPERATORS || t.cs === "operatorname") { // (amsmath's \operatorname{name}, \operatorname*{name}: \qopname\newmcodes@ o|m)
        let name: Token[], kind: "o" | "m"
        if (t.cs === "operatorname") {
          if (!opts.amsmath) throw new Error("math: \\operatorname without amsmath")
          kind = isCh(toks[pos], "*") ? (pos++, "m") : "o"
          name = argument()
        } else { name = tokenize(OPERATORS[t.cs][0]); kind = OPERATORS[t.cs][1] }
        // the nucleus: \mathop{\kern\z@\operator@font name}, a math group in family 0 (\symoperators)
        const nucleus: MItem[] = opts.amsmath ? [kern(0, true)] : []
        for (const x of name) {
          if ("ch" in x && /^[A-Za-z0-9]$/.test(x.ch)) nucleus.push(mathCharNoad(mathcode(x.ch), 0))
          else if ("cs" in x && x.cs === ",") nucleus.push({ kind: "muglue", spec: data.muskips.thinmuskip })
          else throw new Error(`math: an operator name with ${"ch" in x ? x.ch : `\\${x.cs}`}`)
        }
        out.push({ noad: OP, nucleus: { kind: "mlist", list: nucleus }, sup: null, sub: null, ...(kind === "o" ? { limits: "nolimits" as const } : {}) })
        // \nolimits@: \@ifnextchar\limits{\nolimits\@gobble}{\nolimits}
        if (opts.amsmath && kind === "o" && "cs" in (toks[pos] ?? {}) && (toks[pos] as { cs: string }).cs === "limits") pos++
        continue
      }
      const accent = t.cs in ACCENTS ? t.cs : opts.amsmath && ACCENT_ALIASES.includes(t.cs) ? t.cs.toLowerCase() : null
      if (accent) {
        const name = accent, code = ACCENTS[name]
        if (opts.amsmath && name !== "widehat" && name !== "widetilde") { // \mathaccentV: \mathaccent"\accentclass@ (7) with the family and character
          const arg = argument()
          // (an accent in the argument: \macc@nested)
          if (arg.some((x) => "cs" in x && ((x.cs in ACCENTS && x.cs !== "widehat" && x.cs !== "widetilde") || ACCENT_ALIASES.includes(x.cs)))) throw new Error("math: amsmath's nested accents")
          out.push({ noad: ORD, accent: mathCharField((opts.accentClass0 ? 0 : 0x7000) | (code & 0xfff), fam), nucleus: groupField(sub(arg)), sup: null, sub: null })
        } else if (opts.packages?.includes("amsfonts") && (name === "widehat" || name === "widetilde")) { // amsfonts: AMSb's wider accent past 2em
          const arg = argument()
          if (opts.em === undefined) throw new Error(`math: \\${name} without the current font`)
          const large = mathCharField(0x0000 | (AMSB << 8) | (name === "widehat" ? 0x5b : 0x5d))
          out.push({ noad: ORD, accent: mathCharField(code, fam), wide: { accent: large, width: 2 * opts.em, measure: () => [{ kind: "style", style: 2 }, ...parseTokens(arg, data, { ...opts, dollarNext: true, finsmash }, -1)] }, nucleus: groupField(sub(arg)), sup: null, sub: null })
        } else out.push({ noad: ORD, accent: mathCharField(code, fam), nucleus: scanMath(), sup: null, sub: null }) // math_ac (§ 1165)
        continue
      }
      if (t.cs in ARROWS && (opts.amsmath || ARROWS[t.cs][0] !== null)) { toks.splice(pos, 0, ...tokenize(ARROWS[t.cs][opts.amsmath ? 1 : 0]!, data.muskips)); continue }
      if (t.cs === "relbar") { out.push({ noad: 3, nucleus: groupField([smash(tokenize("-"), opts.amsmath ? finsmash : "tb")]), sup: null, sub: null }); continue } // \mathrel{\smash-}, amsmath's \mathrel{\mathpalette\mathsm@sh\std@minus}
      if (t.cs === "Relbar") { if (opts.amsmath) out.push({ noad: 3, nucleus: mathCharField(mathcode("=")), sup: null, sub: null }); else toks.splice(pos, 0, ...tokenize("\\mathrel{=}")); continue } // amsmath's \mathrel\std@equal
      if (t.cs === "smash") { // amsmath's \smash[t|b|tb]
        let mode: "t" | "b" | "tb" = "tb"
        if (opts.amsmath && isCh(toks[pos], "[")) {
          const end = toks.findIndex((x, i) => i > pos && isCh(x, "]"))
          const o = end < 0 ? "" : toks.slice(pos + 1, end).map((x) => ("ch" in x ? x.ch : "?")).join("")
          if (o !== "t" && o !== "b" && o !== "tb") throw new Error(`math: \\smash[${o}]`)
          mode = o; pos = end + 1
        }
        if (opts.amsmath) finsmash = mode // (\edef\finsm@sh)
        out.push(smash(argument(), mode)); continue
      }
      if (t.cs === "phantom" || t.cs === "hphantom" || t.cs === "vphantom" || t.cs === "mathstrut") { // \mathph@nt, \finph@nt; \mathstrut: \vphantom(
        const arg = t.cs === "mathstrut" ? [{ ch: "(" }] : argument(), mode = t.cs === "phantom" ? "vh" : t.cs === "hphantom" ? "h" : "v", fs = finsmash
        out.push(palette((st) => [{ noad: ORD, nucleus: { kind: "hmath", list: inHbox(st, arg, fs), phantom: mode }, sup: null, sub: null }])); continue
      }
      const big = t.cs.match(/^(big|Big|bigg|Bigg)([lmr]?)$/)
      if (big) { // \bigl is \mathopen\big, \bigm \mathrel, \bigr \mathclose; \big a math group around a box: an ord
        let arg = toks[pos]
        if (isCh(arg, "{")) { const a = argument(); if (a.length !== 1) throw new Error(`math: \\${t.cs} of more than a delimiter`); arg = a[0]; pos-- ; toks[pos] = arg }
        const delim = delimiter(t.cs)
        const i = ["big", "Big", "bigg", "Bigg"].indexOf(big[1]), pt = 65536
        // fontmath.ltx: \vbox to 8.5, 11.5, 14.5, 17.5pt; amsmath: \@ne, 1.5, \tw@, 2.5 times \big@size
        const nucleus: Field = opts.amsmath ? { kind: "big", delim, factor: [1 + (i >> 1), i % 2 ? 0x8000 : 0] } : { kind: "big", delim, height: (8.5 + 3 * i) * pt }
        out.push({ noad: big[2] === "l" ? 4 : big[2] === "r" ? 5 : big[2] === "m" ? 3 : ORD, nucleus, sup: null, sub: null })
        continue
      }
      if (t.cs === "mbox" || t.cs === "text" || t.cs in TEXT_FONT_COMMANDS) {
        if (!opts.text) throw new Error(`math: \\${t.cs} without the text font`)
        const text = opts.text, src = rawArgument(t.cs), decl = TEXT_FONT_COMMANDS[t.cs]
        const box = (b: BoxNode): Noad => ({ noad: ORD, nucleus: { kind: "box", box: b }, sup: null, sub: null })
        if (t.cs === "mbox" || !opts.amsmath) { out.push(box(text(src, 0, null, decl))); continue } // \leavevmode\hbox{#1}; \nfss@text: {\mbox{<decl>#1}}
        // amstext's \text@: {\mathchoice{\textdef@\displaystyle\f@size{#1}}{\textdef@\textstyle\f@size{…}}{…\sf@size…}{…\ssf@size…}}
        out.push(groupNoad([palette((st) => [box(text(src, st < 4 ? 0 : st < 6 ? 1 : 2, st === 0 ? "display" : "text", decl))])]))
        continue
      }
      if (opts.packages?.includes("mathtools") && t.cs in COLONS) { toks.splice(pos, 0, ...tokenize(COLONS[t.cs], data.muskips)); continue }
      if (opts.packages?.includes("mathtools") && /^math[lrc]lap$/.test(t.cs)) { // \mathpalette\MT_mathclap:Nn: {}\clap{$\m@th#1{#2}$}, or with [style] that style
        let style: number | null = null
        if (isCh(toks[pos], "[")) {
          const end = toks.findIndex((x, i) => i > pos && isCh(x, "]")), o = toks.slice(pos + 1, end)
          if (o.length !== 1 || !("cs" in o[0]) || !(o[0].cs in STYLES)) throw new Error(`math: \\${t.cs}[${source(o)}]`)
          style = STYLES[o[0].cs]; pos = end + 1
        }
        const arg = argument(), lap = t.cs[4] as "l" | "r" | "c", fs = finsmash
        const build = (st: number): MItem[] => [{ noad: ORD, nucleus: { kind: "mlist", list: [] }, sup: null, sub: null }, { noad: ORD, nucleus: { kind: "hmath", list: inHbox(st, arg, fs), lap }, sup: null, sub: null }]
        if (style === null) out.push(palette(build)); else out.push(...build(style))
        continue
      }
      if (t.cs === "LXpaired") { // mathtools's \DeclarePairedDelimiter'd command (preamble.ts): its delimiters, then * or [size], and the argument
        const l = argument(), r = argument()
        if (isCh(toks[pos], "*")) { // \mathopen{}\mathclose\bgroup\left#2 #1\aftergroup\egroup\right#3
          pos++
          const arg = argument()
          toks.splice(pos, 0, ...tokenize("\\mathopen{}\\mathclose{\\left"), ...l, ...arg, { cs: "relax" }, { cs: "right" }, ...r, { ch: "}" }) // (\relax: \aftergroup)
          continue
        }
        let size: Token[] = []
        if (isCh(toks[pos], "[")) { const end = toks.findIndex((x, i) => i > pos && isCh(x, "]")); size = toks.slice(pos + 1, end); pos = end + 1 }
        const arg = argument()
        if (size.length) { // \mathopen{\bigl#2}#1\mathclose{\bigr#3}
          if (size.length !== 1 || !("cs" in size[0]) || !/^(big|Big|bigg|Bigg)$/.test(size[0].cs)) throw new Error(`math: a paired delimiter of size ${source(size)}`)
          const cs = size[0].cs
          toks.splice(pos, 0, ...tokenize(`\\mathopen{\\${cs}l`), ...l, { ch: "}" }, ...arg, ...tokenize(`\\mathclose{\\${cs}r`), ...r, { ch: "}" })
        } else toks.splice(pos, 0, ...(isCh(l[0], ".") ? [] : [{ cs: "mathopen" }, ...l]), ...arg, ...(isCh(r[0], ".") ? [] : [{ cs: "mathclose" }, ...r])) // \ifx.#1\else\mathopen#1\fi
        continue
      }
      if (t.cs === "mathchoice") { // \mathchoice (§ 1172): four lists, one for each style
        const lists = [argument(), argument(), argument(), argument()], fs = finsmash
        out.push({ kind: "choice", choose: (st) => parseTokens(lists[st >> 1], data, { ...inner, finsmash: fs }, fam) })
        continue
      }
      if (opts.amsmath && (t.cs === "overset" || t.cs === "underset" || t.cs === "overunderset")) { // \binrel@{#2}\binrel@@{\mathop{\kern\z@#2}\limits^{#1}}
        const a = argument(), b = t.cs === "overunderset" ? argument() : null, base = argument()
        const [sup, sb] = t.cs === "overset" ? [a, null] : t.cs === "underset" ? [null, a] : [a, b]
        out.push(binrel(base, { noad: OP, limits: "limits", nucleus: groupField([kern(0, true), ...sub(base)]), sup: sup && groupField(sub(sup)), sub: sb && groupField(sub(sb)) }))
        continue
      }
      if (t.cs === "stackrel") { // latex.ltx: \mathrel{\mathop{#2}\limits^{#1}}
        const a = argument(), base = argument()
        out.push({ noad: 3, nucleus: groupField([{ noad: OP, limits: "limits", nucleus: groupField(sub(base)), sup: groupField(sub(a)), sub: null }]), sup: null, sub: null })
        continue
      }
      if (t.cs === "doteq") { // latex.ltx's \buildrel\textstyle.\over=, amsmath's \mathrel{\mathop{\kern0pt =}\limits^{\textstyle.}}: the same
        const op: Noad = { noad: OP, limits: "limits", nucleus: groupField([kern(0, true), mathCharNoad(mathcode("="))]), sup: groupField(sub(tokenize("\\textstyle."))), sub: null }
        out.push({ noad: 3, nucleus: groupField([op]), sup: null, sub: null }); continue
      }
      if (opts.amsmath && t.cs in MULTI_INTEGRALS) { // \MultiIntegral{n}: \intop\intkern@ … \intop\ilimits@ (with \limits after it: \ints@b's \mathop group)
        const n = MULTI_INTEGRALS[t.cs]
        const ints = "\\intop" + (n === 0 ? INTDOTS : "\\mkern-6mu\\mathchoice{\\mkern-3mu}{}{}{}") + (n > 2 ? "\\intop\\mkern-6mu\\mathchoice{\\mkern-3mu}{}{}{}" : "") + (n > 3 ? "\\intop\\mkern-6mu\\mathchoice{\\mkern-3mu}{}{}{}" : "") + "\\intop"
        const limits = "cs" in (toks[pos] ?? {}) && ((toks[pos] as { cs: string }).cs === "limits" || (toks[pos] as { cs: string }).cs === "displaylimits")
        toks.splice(pos, 0, ...tokenize(limits ? `\\mkern-7mu\\mathchoice{\\mkern-2mu}{}{}{}\\mathop{\\mkern7mu\\mathchoice{\\mkern2mu}{}{}{}${ints}}` : `${ints}\\nolimits`, data.muskips))
        continue
      }
      if (opts.amsmath && t.cs === "boxed") { // \fbox{\m@th$\displaystyle#1$}
        if (!opts.frame) throw new Error("math: \\boxed without \\fbox")
        const arg = argument(), frame = opts.frame
        out.push({ noad: ORD, nucleus: { kind: "boxed", list: () => [{ kind: "style", style: 0 }, ...parseTokens(arg, data, { ...opts, dollarNext: true, finsmash }, -1)], frame }, sup: null, sub: null })
        continue
      }
      if (t.cs === "relax") continue
      if (t.cs === "strut") { out.push({ noad: ORD, nucleus: { kind: "strut" }, sup: null, sub: null }); continue } // \copy\strutbox
      if (t.cs === "hfill" || t.cs === "hfil") { out.push(t.cs === "hfill" ? fillGlue() : filGlue()); continue }
      if (t.cs === "mkern") { out.push({ kind: "mukern", width: t.spec!.width }); continue }
      if (t.cs === "mskip") { out.push({ kind: "muglue", spec: t.spec! }); continue }
      if (t.cs === "vdots" || t.cs === "ddots") { // fontmath.ltx: dots in \hbox'es of the current font, \p@ apart
        if (!opts.font) throw new Error(`math: \\${t.cs} without the current font`)
        const f = opts.font, pt = 65536
        const dot = (raise = 0): BoxNode => { const b = hpack([charNode(f, 46)]); b.shift = -raise; return b }
        const box = (b: BoxNode): Noad => ({ noad: ORD, nucleus: { kind: "box", box: b }, sup: null, sub: null }) // a box in math: an ord noad (§ 1076)
        if (t.cs === "vdots") { // \vbox{\baselineskip4\p@ \lineskiplimit\z@ \kern6\p@\hbox{.}\hbox{.}\hbox{.}}
          const v: Node[] = [kern(6 * pt, true)]
          for (let i = 0; i < 3; i++) { const b = dot(); if (i) v.push(paramGlue("baselineskip", glue(4 * pt - b.height - (v[v.length - 1] as BoxNode).depth))); v.push(b) } // (§ 679, never below \lineskiplimit 0)
          out.push(box(vpack(v)))
        } else { // \mathinner{\mkern1mu\raise7\p@\vbox{\kern7\p@\hbox{.}}\mkern2mu\raise4\p@\hbox{.}\mkern2mu\raise\p@\hbox{.}\mkern1mu}
          const v = vpack([kern(7 * pt, true), dot()]); v.shift = -7 * pt
          const mu = (n: number): MItem => ({ kind: "mukern", width: n * 65536 })
          out.push({ noad: INNER, nucleus: { kind: "mlist", list: [mu(1), box(v), mu(2), box(dot(4 * pt)), mu(2), box(dot(pt)), mu(1)] }, sup: null, sub: null })
        }
        continue
      }
      if (t.cs === "nonscript") { out.push({ kind: "nonscript" }); continue }
      if (t.cs in MATH_CLASSES) { // math_comp (§ 1176)
        if (t.cs === "mathord" && isCh(toks[pos], "{")) { pos++; out.push(groupNoad(group(() => list(true)))); continue }
        out.push({ noad: MATH_CLASSES[t.cs], nucleus: scanMath(), sup: null, sub: null }); continue
      }
      if (CHARDEFS.includes(t.cs)) { out.push(mathCharNoad(mathcode(t.cs), fam)); continue } // \chardef\#=`\# (latex.ltx): set_math_char of its \mathcode
      if (t.cs === "$") { out.push(mathCharNoad(data.symbols.mathdollar, fam)); continue } // \ifmmode\mathdollar
      const dots = dotsMacro(t.cs)
      if (dots !== null) { toks.splice(pos, 0, ...tokenize(dots, data.muskips)); continue }
      if (t.cs === "bmod" || t.cs === "pmod" || t.cs === "pod" || (opts.amsmath && t.cs === "mod")) { // latex.ltx's and amsmath's
        if (t.cs === "bmod") { toks.splice(pos, 0, ...tokenize("\\nonscript\\mskip-\\medmuskip\\mkern5mu\\mathbin{\\mathrm{mod}}\\penalty900\\mkern5mu\\nonscript\\mskip-\\medmuskip", data.muskips)); continue }
        if (t.cs === "pod" && !opts.amsmath) throw new Error("math: unsupported command \\pod")
        const arg = argument()
        const sp = opts.display ? 18 : t.cs === "mod" ? 12 : 8
        const src = !opts.amsmath ? "\\allowbreak\\mkern18mu({\\mathrm{mod}}\\,\\,#)" // \pmod
          : t.cs === "pmod" ? `\\allowbreak\\mkern${sp}mu({\\mathrm{mod}}\\mkern6mu#)` : t.cs === "pod" ? `\\allowbreak\\mkern${sp}mu(#)` : `\\allowbreak\\mkern${sp}mu{\\mathrm{mod}}\\,\\,#`
        const [a, b] = src.split("#")
        toks.splice(pos, 0, ...tokenize(a, data.muskips), ...arg, ...tokenize(b, data.muskips))
        continue
      }
      if (t.cs === "ne" || t.cs === "neq") { toks.splice(pos, 0, { cs: "not" }, { ch: "=" }); continue } // fontmath.ltx: \not=
      if (t.cs in MU_SPACES) { const [sign, reg] = MU_SPACES[t.cs]; out.push({ kind: "muglue", spec: scaled(data.muskips[reg], sign) }); continue }
      if (t.cs in QUADS) {
        if (opts.em === undefined) throw new Error(`math: \\${t.cs} without the current font`)
        out.push(glue(QUADS[t.cs] * opts.em)); continue
      }
      if (opts.amsmath && t.cs === "colon") { toks.splice(pos, 0, ...tokenize("\\nobreak\\mskip2mu\\mathpunct{}\\nonscript\\mkern-\\thinmuskip{:}\\mskip6muplus1mu", data.muskips)); continue }
      const cs = OPERATOR_MACROS[t.cs] ?? t.cs
      if (cs in STYLES) out.push({ kind: "style", style: STYLES[cs] })
      else if (cs === "allowbreak" || cs === "nobreak") out.push(penalty(cs === "nobreak" ? 10000 : 0))
      else if (cs === "penalty") out.push(penalty(t.value!))
      else if (cs === "limits" || cs === "nolimits") {
        const tail = out[out.length - 1]
        if (!tail || !("noad" in tail) || tail.noad !== OP) throw new Error("math: Limit controls must follow a math operator")
        tail.limits = cs
      } else if (cs === "overline" || cs === "underline") out.push({ noad: ORD, line: cs === "overline" ? "over" : "under", nucleus: scanMath(), sup: null, sub: null }) // math_comp
      else if (cs === "frac") out.push({ noad: ORD, nucleus: fraction(), sup: null, sub: null })
      else if (opts.amsmath && (cs in GENFRACS || cs === "genfrac")) { // \genfrac[4] … \@genfrac: {#1{\begingroup#4\endgroup#2#3\relax#5}}
        const [l, r, th, st] = cs === "genfrac" ? [argument(), argument(), argument(), argument()] : GENFRACS[cs].map((x) => tokenize(x))
        if (!l.length !== !r.length) throw new Error("math: \\genfrac with one delimiter")
        let left: Delimiter | undefined, right: Delimiter | undefined, thickness: number | null = null
        if (l.length) { toks.splice(pos, 0, ...l, ...r); left = delimiter(cs); right = delimiter(cs) }
        if (th.length) { toks.splice(pos, 0, ...th, { cs: "relax" }); thickness = dimension(cs); if (!("cs" in toks[pos] && (toks[pos] as { cs: string }).cs === "relax")) throw new Error(`math: \\${cs} thickness`); pos++ } // (\@@above#3\relax)
        const style = st.map((x) => ("ch" in x ? x.ch : "?")).join("")
        if (!/^[0-9]?$/.test(style)) throw new Error(`math: \\${cs} style ${style}`) // (\@mathstyle: \ifcase#1)
        const num = argument(), den = argument()
        const frac: FractionNoad = { noad: "fraction", thickness, num: sub(num), denom: sub(den), ...(left ? { left, right } : {}) }
        out.push(groupNoad([...(style ? [{ kind: "style" as const, style: 2 * Math.min(Number(style), 3) }] : []), groupNoad([frac])]))
      } else if (opts.amsmath && cs === "cfrac") { // \cfrac[#1]#2#3: {\displaystyle\frac{\strut\ifx r#1\hfill\fi#2\ifx l#1\hfill\fi}{#3}}\kern-\nulldelimiterspace
        let side = "c"
        if (isCh(toks[pos], "[")) { const end = toks.findIndex((x, i) => i > pos && isCh(x, "]")); side = toks.slice(pos + 1, end).map((x) => ("ch" in x ? x.ch : "?")).join(""); pos = end + 1 }
        const num = argument(), den = argument()
        const n = sub([{ cs: "strut" }, ...(side === "r" ? [{ cs: "hfill" }] : []), ...num, ...(side === "l" ? [{ cs: "hfill" }] : [])])
        out.push(groupNoad([{ kind: "style", style: 0 }, groupNoad([{ noad: "fraction", thickness: null, num: n, denom: sub(den) }])]), kern(-data.dimens.nulldelimiterspace, true))
      }
      else if (cs === "sqrt") { // \sqrtsign: \radical"270370; \sqrt[n] is \root n\of
        if (isCh(toks[pos], "[")) { out.push(root()); continue }
        out.push({ noad: ORD, radical: delimiterOf(0x270370), nucleus: scanMath(), sup: null, sub: null })
      }
      else if (opts.alphabets && cs in opts.alphabets) out.push(groupNoad(alphabetList(cs)))
      else if (macroOf(cs) in data.delimiters) out.push(mathCharNoad(data.delimiters[macroOf(cs)] >> 12, fam)) // \delimiter: its \mathchar part
      else if (cs in data.symbols) {
        out.push(mathCharNoad(data.symbols[cs], fam))
        if (cs !== t.cs) (out[out.length - 1] as Noad).limits = "nolimits"
      } else throw new Error(`math: unsupported command \\${t.cs}`)
    }
  }
  return list(false)
}
