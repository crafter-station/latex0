// Math mode input to an mlist, as TeX's math mode builds it (§§ 1136–1193):
// characters by \mathcode (§ 1151), symbol commands by their \mathchar,
// math groups and their collapse to a lone ord's nucleus (§ 1186), sub_sup
// with its dummy noads (§§ 1176–1177), \limits and \nolimits (§ 1159),
// style commands (§ 1169), and three LaTeX definitions: \frac
// ({\begingroup#1\endgroup\over#2}), \int and \oint (\intop\nolimits), and
// the prime ' (^\bgroup\prime…\egroup, which takes in a superscript that
// follows: x'^{ab} is x^{\prime ab}).

import type { MathData } from "./data"
import { groupField, mathCharField, mathCharNoad, OP, ORD, type Field, type MItem, type Noad } from "./mlist"

const STYLES: Record<string, number> = { displaystyle: 0, textstyle: 2, scriptstyle: 4, scriptscriptstyle: 6 }
const OPERATOR_MACROS: Record<string, string> = { int: "intop", oint: "ointop" }

type Token = { cs: string } | { ch: string }

function tokenize(src: string): Token[] {
  const out: Token[] = []
  for (let i = 0; i < src.length;) {
    const c = src[i]
    if (c === "\\") {
      const m = src.slice(i + 1).match(/^([A-Za-z]+|.)/)
      if (!m) throw new Error("math: \\ at end of input")
      out.push({ cs: m[1] }); i += 1 + m[1].length
      if (/^[A-Za-z]/.test(m[1])) while (/\s/.test(src[i] ?? "")) i++ // spaces after a control word
    } else if (/\s/.test(c)) i++ // spaces are ignored in math mode
    else if (c === "%") { while (i < src.length && src[i] !== "\n") i++ }
    else { out.push({ ch: c }); i++ }
  }
  return out
}

const isCh = (t: Token | undefined, c: string) => !!t && "ch" in t && t.ch === c

/** Parse a formula (the text between $…$) into an mlist. */
export function parseMath(src: string, data: MathData): MItem[] {
  return parseTokens(tokenize(src), data)
}

function parseTokens(toks: Token[], data: MathData): MItem[] {
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
  const sub = (ts: Token[]) => parseTokens(ts, data)
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
      return mathCharField(code)
    }
    if (t.cs === "frac") return fraction()
    const code = data.symbols[t.cs]
    if (code === undefined) throw new Error(`math: unsupported script \\${t.cs}`)
    return mathCharField(code)
  }
  /** sub_sup (§ 1176): attach to the tail noad, or to a new dummy noad. */
  const subSup = (out: MItem[], which: "sup" | "sub", field: () => Field) => {
    let tail = out[out.length - 1]
    if (!scriptsAllowed(tail) || tail[which] !== null) { tail = { noad: ORD, nucleus: null, sup: null, sub: null }; out.push(tail) }
    tail[which] = field()
  }

  const list = (inGroup: boolean): MItem[] => {
    const out: MItem[] = []
    for (;;) {
      const t = toks[pos++]
      if (!t) { if (inGroup) throw new Error("math: missing }"); return out }
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
        out.push(mathCharNoad(code))
        continue
      }
      const cs = OPERATOR_MACROS[t.cs] ?? t.cs
      if (cs in STYLES) out.push({ kind: "style", style: STYLES[cs] })
      else if (cs === "limits" || cs === "nolimits") {
        const tail = out[out.length - 1]
        if (!tail || !("noad" in tail) || tail.noad !== OP) throw new Error("math: Limit controls must follow a math operator")
        tail.limits = cs
      } else if (cs === "frac") out.push({ noad: ORD, nucleus: fraction(), sup: null, sub: null })
      else if (cs in data.symbols) {
        out.push(mathCharNoad(data.symbols[cs]))
        if (cs !== t.cs) (out[out.length - 1] as Noad).limits = "nolimits"
      } else throw new Error(`math: unsupported command \\${t.cs}`)
    }
  }
  return list(false)
}
