// Math mode input to an mlist, as TeX's math mode builds it (§§ 1136–1193):
// characters by \mathcode (§ 1151), symbol commands by their \mathchar,
// math groups and their collapse to a lone ord's nucleus (§ 1186), sub_sup
// with its dummy noads (§§ 1176–1177), \limits and \nolimits (§ 1159),
// style commands (§ 1169), \overline and \underline (§ 1163), \penalty, \sqrt (\radical, § 1163), and these LaTeX definitions: \allowbreak
// (\penalty0), \nobreak (\penalty10000), \, \: \; \! and their names (\tmspace: \mskip±\thinmuskip…),
// \quad and \qquad (\hskip1em, \hskip2em), \ne and \neq (\not=), \frac
// ({\begingroup#1\endgroup\over#2}), \int and \oint (\intop\nolimits), and
// the prime ' (^\bgroup\prime…\egroup, which takes in a superscript that
// follows: x'^{ab} is x^{\prime ab}).

import type { MathData } from "./data"
import type { GlueSpec } from "../layout/dimen"
import { glue, kern, penalty } from "../layout/nodes"
import { delimiterOf, groupField, INNER, mathCharField, mathCharNoad, OP, ORD, type Delimiter, type Field, type MItem, type Noad } from "./mlist"

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
/** \quad and \qquad: \hskip in em of the current (text) font */
const QUADS: Record<string, number> = { quad: 1, qquad: 2 }
/** delimiters LaTeX defines through others in math: \{ (\lbrace), \} (\rbrace), \| (\Vert); amsmath's \lvert… */
const DELIMITER_MACROS: Record<string, string> = { "{": "lbrace", "}": "rbrace", "|": "Vert" }
const AMS_DELIMITERS: Record<string, string> = { lvert: "vert", rvert: "vert", lVert: "Vert", rVert: "Vert" }
/** amsmath's matrix environments: their \left and \right */
const MATRICES: Record<string, [string, string] | null> = { matrix: null, pmatrix: ["(", ")"], bmatrix: ["[", "]"], Bmatrix: ["lbrace", "rbrace"], vmatrix: ["vert", "vert"], Vmatrix: ["Vert", "Vert"] }

/** Options of the document the formula is in. */
export interface MathOptions {
  amsmath?: boolean
  /** math alphabet commands (\mathbf{…}) and the family each sets in its argument, a math group */
  alphabets?: Record<string, number>
  /** \fontdimen6 of the current text font, the em of \quad and \qquad */
  em?: number
}

type Token = { cs: string; value?: number } | { ch: string }

function tokenize(src: string): Token[] {
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
      } else out.push({ cs: m[1] })
    } else if (/\s/.test(c)) i++ // spaces are ignored in math mode
    else if (c === "%") { while (i < src.length && src[i] !== "\n") i++ }
    else { out.push({ ch: c }); i++ }
  }
  return out
}

/** a glue register with a sign, as scan_glue negates it (§ 461) */
const scaled = (g: GlueSpec, sign: 1 | -1): GlueSpec => ({ ...g, width: sign * g.width, stretch: sign * g.stretch, shrink: sign * g.shrink })

/** braces balanced throughout, never closing below zero */
const balanced = (ts: Token[]) => { let d = 0; for (const t of ts) { if (isCh(t, "{")) d++; else if (isCh(t, "}") && --d < 0) return false } return d === 0 }

const isCh = (t: Token | undefined, c: string) => !!t && "ch" in t && t.ch === c

/** Parse a formula (the text between $…$) into an mlist. */
export function parseMath(src: string, data: MathData, opts: MathOptions = {}): MItem[] {
  return parseTokens(tokenize(src), data, opts, -1)
}

/** `fam`: \fam in force (-1: none), which class-7 characters take (§ 1151) */
function parseTokens(toks: Token[], data: MathData, opts: MathOptions, fam: number): MItem[] {
  const macroOf = (cs: string) => DELIMITER_MACROS[cs] ?? (opts.amsmath ? AMS_DELIMITERS[cs] : undefined) ?? cs
  let pos = 0
  const scriptsAllowed = (x: MItem | undefined): x is Noad => !!x && "noad" in x && x.noad !== "fraction"

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
  const sub = (ts: Token[], f = fam) => parseTokens(ts, data, opts, f)
  /** a math alphabet's argument: a math group with \fam set */
  const alphabet = (cs: string): Field | undefined => (opts.alphabets && cs in opts.alphabets ? groupField(sub(argument(), opts.alphabets[cs])) : undefined)
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
  /** an \array body: rows split at \\, cells at &, outside braces and inner environments */
  const arrayRows = (body: Token[]) => {
    const rows: MItem[][][] = [], crs: boolean[] = []
    let row: MItem[][] = [], cell: Token[] = [], depth = 0
    for (const t of body) {
      if ("ch" in t && t.ch === "{") depth++
      else if ("ch" in t && t.ch === "}") depth--
      else if ("cs" in t && t.cs === "begin") depth++
      else if ("cs" in t && t.cs === "end") depth--
      if (depth === 0 && "ch" in t && t.ch === "&") { row.push(sub(cell)); cell = []; continue }
      if (depth === 0 && "cs" in t && t.cs === "\\") { row.push(sub(cell)); rows.push(row); crs.push(true); row = []; cell = []; continue }
      cell.push(t)
    }
    // \crcr: a last row without \\ (an empty one after a final \\ is no row)
    if (cell.length || row.length) { row.push(sub(cell)); rows.push(row); crs.push(false) }
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
  /** scan_math (§ 1151): the field a script takes. */
  const scanMath = (): Field => {
    const t = toks[pos++]
    if (!t) throw new Error("math: missing script")
    if ("ch" in t) {
      if (t.ch === "{") { const l = list(true); return groupField(l) }
      const code = data.mathcodes[t.ch.charCodeAt(0)]
      if (code === undefined || code >= 0x8000) throw new Error(`math: unsupported script ${t.ch}`)
      return mathCharField(code, fam)
    }
    if (t.cs === "frac") return fraction()
    const a = alphabet(t.cs)
    if (a !== undefined) return a
    const dname = macroOf(t.cs)
    if (dname in data.delimiters) return mathCharField(data.delimiters[dname] >> 12) // a \delimiter's \mathchar part
    const code = data.symbols[t.cs]
    if (code === undefined) throw new Error(`math: unsupported script \\${t.cs}`)
    return mathCharField(code)
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
    const item: MItem = { kind: "root", index: groupField(sub(index)), radicand: groupField(sub(argument())), amsmath: !!opts.amsmath }
    // amsmath's \root is \bgroup…\egroup: a math group, an ord noad (§ 1186)
    return opts.amsmath ? { noad: ORD, nucleus: { kind: "mlist", list: [item] }, sup: null, sub: null } : item
  }
  /** sub_sup (§ 1176): attach to the tail noad, or to a new dummy noad. */
  const subSup = (out: MItem[], which: "sup" | "sub", field: () => Field) => {
    let tail = out[out.length - 1]
    if (!scriptsAllowed(tail) || tail[which] !== null) { tail = { noad: ORD, nucleus: null, sup: null, sub: null }; out.push(tail) }
    tail[which] = field()
  }

  const list = (inGroup: boolean, inFence = false): MItem[] => {
    const out: MItem[] = []
    for (;;) {
      const t = toks[pos++]
      if (!t) { if (inGroup || inFence) throw new Error(inFence ? "math: missing \\right" : "math: missing }"); return out }
      if ("cs" in t && t.cs === "right") { if (!inFence) throw new Error("math: Extra \\right"); return out }
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
        const inner = list(false, true)
        const right = delimiter("right")
        out.push({ noad: INNER, nucleus: { kind: "mlist", list: [{ noad: "left", delim: left }, ...inner, { noad: "right", delim: right }] }, sup: null, sub: null })
        continue
      }
      if ("ch" in t) {
        const c = t.ch
        if (c === "}") { if (!inGroup) throw new Error("math: extra }"); return out }
        if (c === "{") { out.push({ noad: ORD, nucleus: groupField(list(true)), sup: null, sub: null }); continue }
        if (c === "^" || c === "_") { subSup(out, c === "^" ? "sup" : "sub", scanMath); continue }
        if (c === "'") { // latex.ltx \active@math@prime
          let n = 1
          while (isCh(toks[pos], "'")) { n++; pos++ }
          const primes = Array.from({ length: n }, () => mathCharNoad(data.symbols.prime))
          let more: MItem[] = []
          if (isCh(toks[pos], "^")) { pos++; more = sub(argument()) }
          subSup(out, "sup", () => groupField([...primes, ...more]))
          continue
        }
        const code = data.mathcodes[c.charCodeAt(0)]
        if (code === undefined || code >= 0x8000) throw new Error(`math: unsupported character ${c}`)
        out.push(mathCharNoad(code, fam))
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
          if ("ch" in x && /^[A-Za-z0-9]$/.test(x.ch)) nucleus.push(mathCharNoad(data.mathcodes[x.ch.charCodeAt(0)], 0))
          else if ("cs" in x && x.cs === ",") nucleus.push({ kind: "muglue", spec: data.muskips.thinmuskip })
          else throw new Error(`math: an operator name with ${"ch" in x ? x.ch : `\\${x.cs}`}`)
        }
        out.push({ noad: OP, nucleus: { kind: "mlist", list: nucleus }, sup: null, sub: null, ...(kind === "o" ? { limits: "nolimits" as const } : {}) })
        // \nolimits@: \@ifnextchar\limits{\nolimits\@gobble}{\nolimits}
        if (opts.amsmath && kind === "o" && "cs" in (toks[pos] ?? {}) && (toks[pos] as { cs: string }).cs === "limits") pos++
        continue
      }
      if (t.cs === "ne" || t.cs === "neq") { toks.splice(pos, 0, { cs: "not" }, { ch: "=" }); continue } // fontmath.ltx: \not=
      if (t.cs in MU_SPACES) { const [sign, reg] = MU_SPACES[t.cs]; out.push({ kind: "muglue", spec: scaled(data.muskips[reg], sign) }); continue }
      if (t.cs in QUADS) {
        if (opts.em === undefined) throw new Error(`math: \\${t.cs} without the current font`)
        out.push(glue(QUADS[t.cs] * opts.em)); continue
      }
      if (opts.amsmath && t.cs === "colon") throw new Error("math: amsmath's \\colon") // \nobreak\mskip2mu\mathpunct{}…
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
      else if (cs === "sqrt") { // \sqrtsign: \radical"270370; \sqrt[n] is \root n\of
        if (isCh(toks[pos], "[")) { out.push(root()); continue }
        out.push({ noad: ORD, radical: delimiterOf(0x270370), nucleus: scanMath(), sup: null, sub: null })
      }
      else if (opts.alphabets && cs in opts.alphabets) out.push({ noad: ORD, nucleus: alphabet(cs)!, sup: null, sub: null })
      else if (macroOf(cs) in data.delimiters) out.push(mathCharNoad(data.delimiters[macroOf(cs)] >> 12)) // \delimiter: its \mathchar part
      else if (cs in data.symbols) {
        out.push(mathCharNoad(data.symbols[cs]))
        if (cs !== t.cs) (out[out.length - 1] as Noad).limits = "nolimits"
      } else throw new Error(`math: unsupported command \\${t.cs}`)
    }
  }
  return list(false)
}
