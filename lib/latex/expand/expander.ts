// TeX's expansion machinery for macros: "TeX: The Program" §§ 366–401 (expand,
// macro_call), 464–486 (str_toks, scan_toks), 487–510 (conditionals) and the
// definition commands of main_control (§§ 1208–1226). Token in, token out, with
// TeX's grouping of definitions. A fuel counter makes every run terminate.
//
// Covered: \def \gdef \edef \xdef \let \global \long \protected; undelimited,
// delimited and #{ parameters; \expandafter \noexpand \csname \string \number
// \meaning \unexpanded \detokenize; \ifx \if \ifcat \ifnum \iftrue \iffalse
// \else \fi; \relax, {}, \begingroup \endgroup.

import { LEFT_BRACE, MAC_PARAM, OTHER_CHAR, RIGHT_BRACE, SPACER, Tokenizer, latexCatcodes, printCs, sameTok, showTokens, type Tok } from "./tokens"

/** A macro's parameter text: literal tokens and parameter markers; `brace` for a final #{. */
export type ParamItem = { tok: Tok } | { param: number }
export type BodyItem = { tok: Tok } | { arg: number }
export interface Macro { kind: "macro"; params: ParamItem[]; brace: boolean; body: BodyItem[]; long: boolean; protected: boolean }
export type Meaning = Macro | { kind: "prim"; name: string } | { kind: "char"; cat: number; c: number } | { kind: "undefined" }

const EXPANDABLE = new Set(["expandafter", "noexpand", "csname", "string", "number", "meaning", "unexpanded", "detokenize",
  "ifx", "if", "ifcat", "ifnum", "iftrue", "iffalse", "else", "fi", "or"])
const CONDITIONALS = new Set(["ifx", "if", "ifcat", "ifnum", "iftrue", "iffalse"])
const PRIMITIVES = [...EXPANDABLE, "def", "gdef", "edef", "xdef", "let", "global", "long", "protected", "relax", "endcsname",
  "begingroup", "endgroup", "par"]

export class ExpansionError extends Error {}

const key = (t: Tok) => (t.cs === undefined ? null : (t.active ? "\u0000" : "") + t.cs)

export class Expander {
  private meanings = new Map<string, Meaning>()
  private saveStack: { key: string; old: Meaning | undefined }[][] = []
  private input: { toks: Tok[]; i: number }[] = []
  private conds: ("if" | "else")[] = [] // open conditionals: the branch being read
  fuel: number
  readonly catcodes = latexCatcodes()

  constructor(private reader: Tokenizer, fuel = 1_000_000) {
    this.fuel = fuel
    for (const p of PRIMITIVES) this.meanings.set(p, { kind: "prim", name: p })
  }

  meaning(t: Tok): Meaning {
    const k = key(t)
    if (k === null) return { kind: "char", cat: t.cat!, c: t.c! }
    return this.meanings.get(k) ?? { kind: "undefined" }
  }
  meaningOf(name: string): Meaning { return this.meanings.get(name) ?? { kind: "undefined" } }

  private define(k: string, m: Meaning, global: boolean) {
    if (global) { this.meanings.set(k, m); return } // a global definition outlives every group (§ 279: the saved values are ignored)
    const level = this.saveStack[this.saveStack.length - 1]
    if (level && !level.some((s) => s.key === k)) level.push({ key: k, old: this.meanings.get(k) })
    this.meanings.set(k, m)
  }
  private beginGroup() { this.saveStack.push([]) }
  private endGroup() {
    const level = this.saveStack.pop()
    if (!level) throw new ExpansionError("Too many }'s")
    for (const s of level.reverse()) { if (s.old === undefined) this.meanings.delete(s.key); else this.meanings.set(s.key, s.old) }
  }

  // ---- input (§§ 321–325, 341) ----
  private getNext(): Tok | null {
    if (--this.fuel < 0) throw new ExpansionError("expansion fuel exhausted (a macro that never stops expanding?)")
    while (this.input.length) {
      const top = this.input[this.input.length - 1]
      if (top.i < top.toks.length) return top.toks[top.i++]
      this.input.pop()
    }
    return this.reader.next()
  }
  backInput(toks: Tok[]) { if (toks.length) this.input.push({ toks, i: 0 }) }

  private expandable(t: Tok): boolean {
    if (t.cs === undefined || t.dontExpand) return false
    const m = this.meaning(t)
    return m.kind === "macro" || (m.kind === "prim" && EXPANDABLE.has(m.name))
  }

  /** get_x_token (§ 380): expand until an unexpandable token comes up. A \\noexpand'ed token acts as \\relax here. */
  getXToken(): Tok | null {
    for (;;) {
      const t = this.getNext()
      if (!t) return null
      if (!this.expandable(t)) return t
      this.expand(t)
    }
  }

  /** expand (§ 366) */
  expand(t: Tok) {
    const m = this.meaning(t)
    if (m.kind === "macro") { this.macroCall(t, m); return }
    if (m.kind !== "prim") throw new ExpansionError(`cannot expand ${printCs(t.cs!)}`)
    switch (m.name) {
      case "expandafter": { // § 368
        const a = this.need(this.getNext()), b = this.need(this.getNext())
        if (this.expandable(b)) this.expand(b); else this.backInput([b])
        this.backInput([a])
        return
      }
      case "noexpand": { // § 369
        const a = this.need(this.getNext())
        this.backInput([a.cs !== undefined ? { ...a, dontExpand: true } : a])
        return
      }
      case "csname": { // § 372
        let name = ""
        for (;;) {
          const x = this.need(this.getXToken())
          if (x.cs !== undefined) { if (this.meaning(x).kind === "prim" && (this.meaning(x) as { name: string }).name === "endcsname") break; throw new ExpansionError("Missing \\endcsname inserted") }
          name += String.fromCharCode(x.c)
        }
        const r: Tok = { cs: name }
        if (this.meaning(r).kind === "undefined") this.define(name, { kind: "prim", name: "relax" }, false)
        this.backInput([r])
        return
      }
      case "string": { const a = this.need(this.getNext()); this.backInput(strToks(a.cs !== undefined ? sprintCs(a) : String.fromCharCode(a.c))); return } // § 470
      case "number": this.backInput(strToks(String(this.scanInt()))); return
      case "meaning": { const a = this.need(this.getNext()); this.backInput(strToks(this.printMeaning(a))); return }
      case "detokenize": this.backInput(strToks(showTokens(this.scanGeneralText()))); return
      case "unexpanded": this.backInput(this.scanGeneralText().map((x) => (x.cs !== undefined ? { ...x, dontExpand: true } : x))); return
      case "fi": case "else": case "or": this.condEnd(m.name); return
      default: if (CONDITIONALS.has(m.name)) { this.conditional(m.name); return }
    }
    throw new ExpansionError(`unhandled expandable ${m.name}`)
  }

  private need(t: Tok | null): Tok {
    if (!t) throw new ExpansionError("File ended while scanning")
    return t
  }

  /** macro_call (§§ 389–400) */
  private macroCall(t: Tok, m: Macro) {
    const args: Tok[][] = []
    let pi = 0
    const items = m.params
    while (pi < items.length) {
      const item = items[pi]
      if ("tok" in item) { // literal tokens before a parameter must match exactly (§ 397)
        const x = this.need(this.getNext())
        if (!sameTok(x, item.tok)) throw new ExpansionError(`Use of ${printCs(t.cs!, t.active).trim()} doesn't match its definition`)
        pi++; continue
      }
      // the delimiter: literal tokens up to the next parameter, or #{ at the end
      const delim: Tok[] = []
      let j = pi + 1
      while (j < items.length && "tok" in items[j]) { delim.push((items[j] as { tok: Tok }).tok); j++ }
      args[item.param - 1] = delim.length ? this.delimitedArg(t, delim, m.long) : this.undelimitedArg(t, m.long)
      pi = j
    }
    const out: Tok[] = []
    for (const b of m.body) { if ("tok" in b) out.push(b.tok); else out.push(...args[b.arg - 1]) }
    this.backInput(out)
  }

  private undelimitedArg(t: Tok, long: boolean): Tok[] {
    let x = this.need(this.getNext())
    while (x.cat === SPACER) x = this.need(this.getNext()) // § 393: spaces before an undelimited argument
    if (x.cat === RIGHT_BRACE) throw new ExpansionError("Argument of " + printCs(t.cs!).trim() + " has an extra }")
    if (x.cat !== LEFT_BRACE) { this.parCheck(x, t, long); return [x] }
    return this.balanced(t, long)
  }

  /** Tokens up to the matching right brace (the left brace already read). */
  private balanced(t: Tok, long: boolean): Tok[] {
    const out: Tok[] = []
    let depth = 1
    for (;;) {
      const x = this.need(this.getNext())
      this.parCheck(x, t, long)
      if (x.cat === LEFT_BRACE) depth++
      else if (x.cat === RIGHT_BRACE && --depth === 0) return out
      out.push(x)
    }
  }

  private delimitedArg(t: Tok, delim: Tok[], long: boolean): Tok[] {
    // § 397: match the delimiter at brace level 0; a mismatch keeps the tokens read so far
    const arg: Tok[] = []
    let matched = 0
    for (;;) {
      const x = this.need(this.getNext())
      if (sameTok(x, delim[matched])) { // a left brace can only be a delimiter through #{
        matched++
        if (matched === delim.length) break
        continue
      }
      if (matched > 0) {
        // § 397: back up to the first token that could start the delimiter again
        const seen = [...delim.slice(0, matched), x]
        arg.push(seen.shift()!)
        matched = 0
        this.backInput(seen)
        continue
      }
      this.parCheck(x, t, long)
      if (x.cat === RIGHT_BRACE) throw new ExpansionError(`Argument of ${printCs(t.cs!).trim()} has an extra }`)
      if (x.cat === LEFT_BRACE) { arg.push(x, ...this.balanced(t, long), { cat: RIGHT_BRACE, c: 125 }); continue }
      arg.push(x)
    }
    // § 400: an argument that is a single group loses its braces
    if (arg.length >= 2 && arg[0].cat === LEFT_BRACE && arg[arg.length - 1].cat === RIGHT_BRACE) {
      let d = 0, whole = true
      for (let i = 0; i < arg.length; i++) {
        if (arg[i].cat === LEFT_BRACE) d++
        else if (arg[i].cat === RIGHT_BRACE && --d === 0 && i < arg.length - 1) { whole = false; break }
      }
      if (whole) return arg.slice(1, -1)
    }
    return arg
  }

  private parCheck(x: Tok, t: Tok, long: boolean) {
    if (!long && x.cs === "par" && !x.active) throw new ExpansionError(`Paragraph ended before ${printCs(t.cs!).trim()} was complete`)
  }

  /** scan_int (§ 440) for decimal constants, with expansion; one optional space after the digits. */
  scanInt(): number {
    let negative = false
    let x = this.need(this.getXToken())
    while (x.cat === SPACER || (x.cat === OTHER_CHAR && (x.c === 43 || x.c === 45))) { if (x.c === 45) negative = !negative; x = this.need(this.getXToken()) }
    if (!(x.cat === OTHER_CHAR && x.c >= 48 && x.c <= 57)) { this.backInput([x]); throw new ExpansionError("Missing number, treated as zero") }
    let v = 0
    while (x.cat === OTHER_CHAR && x.c >= 48 && x.c <= 57) {
      v = v * 10 + x.c - 48
      if (v > 2147483647) throw new ExpansionError("Number too big")
      const y = this.getXToken()
      if (!y) return negative ? -v : v
      x = y
    }
    if (x.cat !== SPACER) this.backInput([x])
    return negative ? -v : v
  }

  /** scan_general_text: a braced group, its left brace found by expansion (§ 473 "scan a left brace"). */
  private scanGeneralText(): Tok[] {
    let x = this.need(this.getXToken())
    while (x.cat === SPACER || (x.cs !== undefined && this.meaning(x).kind === "prim" && (this.meaning(x) as { name: string }).name === "relax")) x = this.need(this.getXToken())
    if (x.cat !== LEFT_BRACE) throw new ExpansionError("Missing { inserted")
    return this.balanced(x, true)
  }

  // ---- conditionals (§§ 487–510) ----
  private conditional(name: string) {
    let b: boolean
    switch (name) {
      case "iftrue": b = true; break
      case "iffalse": b = false; break
      case "ifx": b = this.sameMeaning(this.need(this.getNext()), this.need(this.getNext())); break
      case "if": case "ifcat": {
        const code = (x: Tok) => { // § 506
          if (x.cs === undefined) return [x.cat, x.c]
          const m = x.dontExpand ? { kind: "prim" } as Meaning : this.meaning(x)
          return m.kind === "char" ? [m.cat, m.c] : [16, 256]
        }
        const [ca, a] = code(this.need(this.getXToken())), [cb, bb] = code(this.need(this.getXToken()))
        b = name === "if" ? a === bb : ca === cb
        break
      }
      case "ifnum": {
        const a = this.scanInt()
        let r = this.need(this.getXToken())
        while (r.cat === SPACER) r = this.need(this.getXToken())
        if (!(r.cat === OTHER_CHAR && (r.c === 60 || r.c === 61 || r.c === 62))) throw new ExpansionError("Missing = inserted for \\ifnum")
        const c = this.scanInt()
        b = r.c === 60 ? a < c : r.c === 61 ? a === c : a > c
        break
      }
      default: throw new ExpansionError(`unknown conditional ${name}`)
    }
    if (b) { this.conds.push("if"); return }
    // pass_text (§ 494): skip to the matching \\else or \\fi
    if (this.passText() === "else") this.conds.push("else")
  }

  private passText(): "else" | "fi" {
    let level = 0
    for (;;) {
      const x = this.need(this.getNext())
      if (x.cs === undefined || x.dontExpand) continue
      const m = this.meaning(x)
      if (m.kind !== "prim") continue
      if (CONDITIONALS.has(m.name)) level++
      else if (m.name === "fi") { if (level === 0) return "fi"; level-- }
      else if (m.name === "else" && level === 0) return "else"
    }
  }

  private condEnd(name: string) {
    const top = this.conds.pop()
    if (top === undefined) throw new ExpansionError(`Extra \\${name}`)
    if (name === "fi") return
    if (top === "else") throw new ExpansionError("Extra \\else")
    if (this.passText() === "else") throw new ExpansionError("Extra \\else")
  }

  private sameMeaning(a: Tok, b: Tok): boolean { // § 507
    const ma = a.dontExpand ? { kind: "prim", name: "relax" } as Meaning : this.meaning(a)
    const mb = b.dontExpand ? { kind: "prim", name: "relax" } as Meaning : this.meaning(b)
    if (ma.kind !== mb.kind) return false
    if (ma.kind === "char") return ma.cat === (mb as typeof ma).cat && ma.c === (mb as typeof ma).c
    if (ma.kind === "prim") return ma.name === (mb as typeof ma).name
    if (ma.kind === "undefined") return true
    const x = mb as Macro
    return ma.long === x.long && ma.protected === x.protected && macroText(ma) === macroText(x)
  }

  // ---- printing ----
  printMeaning(t: Tok): string { // print_meaning (§ 296)
    if (t.cs === undefined) {
      const kinds: Record<number, string> = { 1: "begin-group character ", 2: "end-group character ", 3: "math shift character ", 4: "alignment tab character ",
        6: "macro parameter character ", 7: "superscript character ", 8: "subscript character ", 10: "blank space ", 11: "the letter ", 12: "the character " }
      return (kinds[t.cat] ?? "") + String.fromCharCode(t.c)
    }
    const m = this.meaning(t)
    if (m.kind === "undefined") return "undefined"
    if (m.kind === "prim") return "\\" + m.name
    if (m.kind === "char") return this.printMeaning({ cat: m.cat, c: m.c })
    const prefix = (m.protected ? "\\protected" : "") + (m.long ? "\\long" : "")
    return (prefix ? prefix + " " : "") + "macro:" + macroText(m)
  }

  // ---- main control: definitions and grouping (§§ 1208–1226) ----
  /** Run the input to the end, performing definitions; unexpandable non-definition tokens are discarded. */
  run(): void {
    for (;;) {
      const t = this.getXToken()
      if (!t) return
      this.command(t, { global: false, long: false, protected: false })
    }
  }

  private command(t: Tok, pre: { global: boolean; long: boolean; protected: boolean }) {
    if (t.cat === LEFT_BRACE) { this.beginGroup(); return }
    if (t.cat === RIGHT_BRACE) { this.endGroup(); return }
    if (t.cs === undefined || t.dontExpand) return
    const m = this.meaning(t)
    if (m.kind !== "prim") return
    switch (m.name) {
      case "global": case "long": case "protected": {
        const n = this.need(this.getXToken())
        this.command(n, { ...pre, [m.name]: true })
        return
      }
      case "def": case "gdef": case "edef": case "xdef": this.def(m.name, pre); return
      case "let": this.let(pre.global); return
      case "begingroup": this.beginGroup(); return
      case "endgroup": this.endGroup(); return
      default: return
    }
  }

  private getRToken(): Tok {
    let x = this.need(this.getNext())
    while (x.cat === SPACER) x = this.need(this.getNext())
    if (x.cs === undefined) throw new ExpansionError("Missing control sequence inserted")
    return x
  }

  private def(kind: string, pre: { global: boolean; long: boolean; protected: boolean }) {
    const target = this.getRToken()
    // § 473: the parameter text
    const params: ParamItem[] = []
    let brace = false, n = 0
    for (;;) {
      const x = this.need(this.getNext())
      if (x.cat === LEFT_BRACE) break
      if (x.cat === RIGHT_BRACE) throw new ExpansionError("Missing { inserted")
      if (x.cat === MAC_PARAM) {
        const y = this.need(this.getNext())
        if (y.cat === LEFT_BRACE) { brace = true; params.push({ tok: y }); break }
        if (y.cat === OTHER_CHAR && y.c === 49 + n && n < 9) { params.push({ param: ++n }); continue }
        throw new ExpansionError("Parameters must be numbered consecutively")
      }
      params.push({ tok: x })
    }
    // #{: the brace stays in the parameter text as the last delimiter (§ 476)
    // § 477: the body, expanded for \\edef and \\xdef
    const expandBody = kind === "edef" || kind === "xdef"
    const body: BodyItem[] = []
    let depth = 1
    for (;;) {
      let x = this.need(this.getNext())
      if (expandBody) {
        while (this.expandable(x) && !this.isProtected(x)) {
          if (this.meaning(x).kind === "prim" && (this.meaning(x) as { name: string }).name === "unexpanded") {
            for (const u of this.scanGeneralText()) body.push({ tok: u })
            x = this.need(this.getNext())
            continue
          }
          this.expand(x)
          x = this.need(this.getNext())
        }
        if (x.dontExpand) x = { cs: x.cs!, ...(x.active ? { active: true } : {}) }
      }
      if (x.cat === LEFT_BRACE) depth++
      else if (x.cat === RIGHT_BRACE && --depth === 0) break
      if (x.cat === MAC_PARAM) {
        const y = this.need(this.getNext())
        if (y.cat === MAC_PARAM) { body.push({ tok: y }); continue } // ## → one parameter character
        if (y.cat === OTHER_CHAR && y.c >= 49 && y.c < 49 + n) { body.push({ arg: y.c - 48 }); continue }
        throw new ExpansionError(`Illegal parameter number in definition of ${printCs(target.cs!).trim()}`)
      }
      body.push({ tok: x })
    }
    if (brace) body.push({ tok: { cat: LEFT_BRACE, c: 123 } }) // § 476: #{ puts the brace back at the end of the body
    const global = pre.global || kind === "gdef" || kind === "xdef"
    this.define(key(target)!, { kind: "macro", params, brace, body, long: pre.long, protected: pre.protected }, global)
  }

  private isProtected(x: Tok): boolean { const m = this.meaning(x); return m.kind === "macro" && m.protected }

  private let(global: boolean) { // § 1221
    const target = this.getRToken()
    let x = this.need(this.getNext())
    while (x.cat === SPACER) x = this.need(this.getNext())
    if (x.cat === OTHER_CHAR && x.c === 61) { x = this.need(this.getNext()); if (x.cat === SPACER) x = this.need(this.getNext()) }
    const m: Meaning = x.cs === undefined ? { kind: "char", cat: x.cat, c: x.c } : x.dontExpand ? { kind: "prim", name: "relax" } : this.meaning(x)
    this.define(key(target)!, m, global)
  }
}

/** A macro's text as \\meaning shows it after "macro:": parameters, "->", body (§ 294). */
export function macroText(m: Macro): string {
  let out = ""
  for (const p of m.params) out += "tok" in p ? showTokens([p.tok]) : "#" + p.param
  out += "->"
  for (const b of m.body) out += "tok" in b ? showTokens([b.tok]) : "#" + b.arg
  return out
}

/** sprint_cs (§ 263): the name without the trailing space print_cs adds. */
function sprintCs(t: Tok): string {
  if (t.active) return t.cs!
  return t.cs === "" ? "\\csname\\endcsname" : "\\" + t.cs
}

/** str_toks (§ 464): characters as category 12, spaces as category 10. */
export function strToks(s: string): Tok[] {
  return [...s].map((c) => (c === " " ? { cat: SPACER, c: 32 } : { cat: OTHER_CHAR, c: c.charCodeAt(0) }))
}

