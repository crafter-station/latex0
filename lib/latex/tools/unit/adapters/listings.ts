// listings.sty 1.11b with `latex`: the lstlisting environment's character scanner (letters, digits,
// others, spaces and tabulators; a language's keywords, comments and strings) and the boxes it outputs,
// as listings.sty and lstmisc.sty define them. Each line is a paragraph: listings' \lst@NewLine.

import { glue, kern, FIL, type BoxNode, type Node } from "../../../layout/nodes"
import { hpack, vpack } from "../../../layout/pack"
import { appendRun } from "../../../layout/mainloop"
import { QUAD, SPACE, SPACE_SHRINK, SPACE_STRETCH, type Font } from "../../../layout/font"

export class LstUnsupported extends Error {}

/** A comment or string delimiter: [l] line comment, [s] comment from open to close, [b] string with backslash escapes */
export interface LstDelim { kind: "l" | "s" | "b"; open: string; close?: string }
/** A language: its keyword classes and its delimiters in the order they are defined (lstlang1.sty) */
export interface LstLanguage { name: string; keywords: string[][]; sensitive: boolean; delims: LstDelim[]; /** C's directives (moredelim=*[directive]\#), not modeled */ directives?: boolean }

const PY2_K1 = "and as assert break class continue def del elif else except exec finally for from global if import in is lambda not or pass print raise return try while with yield".split(" ")
const PY2_K2 = ("abs all any basestring bin bool bytearray callable chr classmethod cmp compile complex delattr dict dir divmod enumerate eval execfile file filter float format " +
  "frozenset getattr globals hasattr hash help hex id input int isinstance issubclass iter len list locals long map max memoryview min next object oct open ord pow property range " +
  "raw_input reduce reload repr reversed round set setattr slice sorted staticmethod str sum super tuple type unichr unicode vars xrange zip __import__ apply buffer coerce intern").split(" ")
/** \lst@definelanguage[2]{Python}: its [s] strings of three quotes never begin (the [b] ones take the quote first) */
const PYTHON2: LstLanguage = { name: "Python", keywords: [PY2_K1, PY2_K2], sensitive: true, delims: [{ kind: "l", open: "#" }, { kind: "b", open: "'" }, { kind: "b", open: '"' }] }
const JAVA: LstLanguage = {
  name: "Java", sensitive: true, delims: [{ kind: "l", open: "//" }, { kind: "s", open: "/*", close: "*/" }, { kind: "b", open: '"' }, { kind: "b", open: "'" }],
  keywords: [("abstract boolean break byte case catch char class const continue default do double else extends false final finally float for goto if implements import " +
    "instanceof int interface label long native new null package private protected public return short static super switch synchronized this throw throws transient true try void volatile while").split(" ")],
}
const C_K = "auto break case char const continue default do double else enum extern float for goto if int long register return short signed sizeof static struct switch typedef union unsigned void volatile while".split(" ")
const C_DELIMS: LstDelim[] = [{ kind: "s", open: "/*", close: "*/" }, { kind: "l", open: "//" }, { kind: "b", open: '"' }, { kind: "b", open: "'" }]
const C_ANSI: LstLanguage = { name: "C", keywords: [C_K], sensitive: true, delims: C_DELIMS, directives: true }
const CPP_ISO_K = ("and and_eq asm bad_cast bad_typeid bitand bitor bool catch class compl const_cast delete dynamic_cast explicit export false friend inline mutable namespace new not " +
  "not_eq operator or or_eq private protected public reinterpret_cast static_cast template this throw true try typeid type_info typename using virtual wchar_t xor xor_eq").split(" ")
const CPP_ISO: LstLanguage = { name: "C++", keywords: [[...C_K, ...CPP_ISO_K]], sensitive: true, delims: C_DELIMS, directives: true }
const CPP_11: LstLanguage = { ...CPP_ISO, keywords: [[...C_K, ...CPP_ISO_K, ..."alignas alignof char16_t char32_t constexpr decltype noexcept nullptr static_assert thread_local".split(" ")]] }

/** language=…: the name, with listings.cfg's default dialect */
export function lstLanguage(value: string): LstLanguage | null {
  const v = value.replace(/[{}\s]/g, "")
  if (v === "") return null
  if (/^(\[2\])?python$/i.test(v)) return PYTHON2
  if (/^java$/i.test(v)) return JAVA
  if (/^(\[ansi\])?c$/i.test(v)) return C_ANSI
  if (/^(\[(iso|ansi)\])?c\+\+$/i.test(v)) return CPP_ISO
  if (/^\[11\]c\+\+$/i.test(v)) return CPP_11
  throw new LstUnsupported(`language=${value}`)
}

export interface LstOptions {
  language: LstLanguage | null
  basicstyle: string; identifierstyle: string; commentstyle: string; stringstyle: string
  /** keywordstyle=[n]: index n-1 */
  keywordstyle: (string | undefined)[]
  columns: "fixed" | "flexible" | "fullflexible"
  /** \lst@leftinsert and \lst@rightinsert (half the lost space before a box, the rest after): columns=[c]… sets them,
   *  fullflexible empties them, and no other columns= brings them back */
  lostInserts: boolean
  /** \lst@columnsflexible: the last flexible kind columns= named, which flexiblecolumns=true selects */
  flexibleKind: "flexible" | "fullflexible"
  showstringspaces: boolean
  tabsize: number
  caption: string | null; label: string | null
  /** numbers=, numberstyle=, numbersep=, stepnumber=, firstnumber= (null: auto), numberblanklines=, numberfirstline= */
  numbers: "none" | "left" | "right"; numberstyle: string; numbersep: string; stepnumber: number; firstnumber: number | null; numberblanklines: boolean; numberfirstline: boolean
  /** frame= and the dimensions (as written: the caller reads them in the listing's font) */
  frame: string; framerule: string; framesep: string; rulesep: string; framexleftmargin: string; framexrightmargin: string; xleftmargin: string; xrightmargin: string
  /** breaklines=, breakatwhitespace=, breakindent=, breakautoindent= */
  breaklines: boolean; breakatwhitespace: boolean; breakindent: string; breakautoindent: boolean
}

export const LST_DEFAULTS: LstOptions = {
  language: null, basicstyle: "", identifierstyle: "", commentstyle: "\\itshape", stringstyle: "", keywordstyle: ["\\bfseries"],
  columns: "fixed", lostInserts: true, flexibleKind: "flexible", showstringspaces: true, tabsize: 8, caption: null, label: null,
  numbers: "none", numberstyle: "", numbersep: "10pt", stepnumber: 1, firstnumber: null, numberblanklines: true, numberfirstline: false,
  breaklines: false, breakatwhitespace: false, breakindent: "20pt", breakautoindent: true,
  frame: "none", framerule: ".4pt", framesep: "3pt", rulesep: "2pt", framexleftmargin: "0pt", framexrightmargin: "0pt", xleftmargin: "0pt", xrightmargin: "0pt",
}

/** key=value pairs at brace depth 0 */
function keyvals(s: string): [string, string | null][] {
  const out: [string, string | null][] = []
  let depth = 0, cur = ""
  const flush = () => {
    const t = cur.trim(); cur = ""
    if (!t) return
    const eq = t.indexOf("=")
    let v = eq < 0 ? null : t.slice(eq + 1).trim()
    if (v !== null && /^\{[^]*\}$/.test(v) && depthOk(v.slice(1, -1))) v = v.slice(1, -1)
    out.push([(eq < 0 ? t : t.slice(0, eq)).trim(), v])
  }
  for (const c of s) {
    if (c === "{") depth++
    else if (c === "}") depth--
    if (c === "," && depth === 0) flush(); else cur += c
  }
  flush()
  return out
}
const depthOk = (s: string) => { let d = 0; for (const c of s) { if (c === "{") d++; else if (c === "}" && --d < 0) return false } return d === 0 }

/** \lstset{…} or the environment's [options] on top of `base` */
export function lstOptions(src: string, base: LstOptions): LstOptions {
  const o: LstOptions = { ...base, keywordstyle: [...base.keywordstyle] }
  const bool = (v: string | null) => { if (v === null || v === "true") return true; if (v === "false") return false; throw new LstUnsupported(`listings value ${v}`) }
  const style = (v: string | null) => { if (v === null || !/^(\s*\\(bfseries|mdseries|itshape|slshape|upshape|scshape|rmfamily|sffamily|ttfamily|normalfont|tiny|scriptsize|footnotesize|small|normalsize|large|Large|color\s*(\[[^\]{}]*\])?\s*\{[^{}]*\}))*\s*$/.test(v)) throw new LstUnsupported(`listings style ${v}`); return v }
  for (const [key, v] of keyvals(src)) {
    switch (key) {
      case "language": o.language = lstLanguage(v ?? ""); break
      case "basicstyle": o.basicstyle = style(v); break
      case "identifierstyle": o.identifierstyle = style(v); break
      case "commentstyle": o.commentstyle = style(v); break
      case "stringstyle": o.stringstyle = style(v); break
      case "keywordstyle": {
        const m = (v ?? "").match(/^\s*\[(\d)\]([^]*)$/)
        if (m) o.keywordstyle[Number(m[1]) - 1] = style(m[2]); else o.keywordstyle[0] = style(v)
        break
      }
      case "columns": {
        const m = (v ?? "").match(/^(?:\[(c?)\])?(\w+)$/)
        const c = m?.[2]
        if (!m || (c !== "fixed" && c !== "flexible" && c !== "fullflexible")) throw new LstUnsupported(`columns=${v}`)
        if (m[1] === "c") o.lostInserts = true // \lst@outputpos c
        o.columns = c
        if (c !== "fixed") o.flexibleKind = c
        if (c === "fullflexible") o.lostInserts = false
        break
      }
      case "flexiblecolumns": o.columns = bool(v) ? o.flexibleKind : "fixed"; break
      case "showstringspaces": o.showstringspaces = bool(v); break
      case "tabsize": if (!/^\d+$/.test(v ?? "") || Number(v) < 1) throw new LstUnsupported(`tabsize=${v}`); o.tabsize = Number(v); break
      case "caption": if (v === null || /^\[/.test(v)) throw new LstUnsupported(`caption=${v}`); o.caption = v; break
      case "label": o.label = v; break
      case "numbers": if (v !== "none" && v !== "left" && v !== "right") throw new LstUnsupported(`numbers=${v}`); o.numbers = v; break
      case "numberstyle": o.numberstyle = style(v); break
      case "numbersep": if (!/^-?(\d+(\.\d*)?|\.\d+)\s*(pt|em|ex|mm|cm|in|bp)$/.test(v ?? "")) throw new LstUnsupported(`numbersep=${v}`); o.numbersep = v!; break
      case "stepnumber": if (!/^\d+$/.test(v ?? "")) throw new LstUnsupported(`stepnumber=${v}`); o.stepnumber = Number(v); break
      case "firstnumber": if (v === "auto") o.firstnumber = null; else if (/^\d+$/.test(v ?? "")) o.firstnumber = Number(v); else throw new LstUnsupported(`firstnumber=${v}`); break
      case "numberblanklines": o.numberblanklines = bool(v); break
      case "numberfirstline": o.numberfirstline = bool(v); break
      case "frame": lstFrameShapes(v ?? ""); o.frame = v ?? ""; break
      case "framerule": case "framesep": case "rulesep": case "framexleftmargin": case "framexrightmargin": case "xleftmargin": case "xrightmargin":
        if (!/^-?(\d+(\.\d*)?|\.\d+)\s*(pt|em|ex|mm|cm|in|bp)$/.test(v ?? "")) throw new LstUnsupported(`${key}=${v}`)
        o[key] = v!
        break
      case "breaklines": o.breaklines = bool(v); break
      case "breakatwhitespace": o.breakatwhitespace = bool(v); break
      case "breakautoindent": o.breakautoindent = bool(v); break
      case "breakindent": if (!/^-?(\d+(\.\d*)?|\.\d+)\s*(pt|em|ex|mm|cm|in|bp)$/.test(v ?? "")) throw new LstUnsupported(`breakindent=${v}`); o.breakindent = v!; break
      case "prebreak": case "postbreak": if (v) throw new LstUnsupported(`${key}=${v}`); break
      default: throw new LstUnsupported(`listings key ${key}`)
    }
  }
  return o
}

/** A token element: a character, \lst@nolig (\leavevmode\kern\z@), \lst@outputspace or \lst@visiblespace */
export type Elem = string | { nolig: true } | { space: "output" | "visible" }

/** What a token box is typeset with: the style applied to the listing's font (basicstyle) */
export interface LstFonts {
  /** the font after `style` (a font declaration list) */
  font(style: string): { font: Font; tt: boolean; bold: boolean; italicShape: boolean; size: string }
  /** a character in another encoding for \textdollar, \textasteriskcentered, \textminus (TS1), \textless,
   *  \textgreater (OML), \textbackslash, \textbraceleft, \textbar, \textbraceright (OMS) */
  other(style: string, enc: "TS1" | "OML" | "OMS"): Font
  /** the style's \color commands: what each pushes (each \aftergroup's a pop) */
  colors(style: string): string[]
}

/** Output: a new line (\lst@NewLine: \par\noindent\hbox{}), a node of the line, or \lst@@discretionary (its
 *  post-break text has the line's frame box, which the caller makes) */
export type LstEvent = { newline: true; /** after \lsthk@OnEmptyLine */ empty?: true; /** in \lst@DeInit's box that is thrown away */ discarded?: true; /** breaklines: \lst@breakshape */ shape?: [number, number] }
  | { node: Node } | { disc: true; /** \lst@breakcurrindent */ indent: number }

const hss = () => glue(0, 65536, FIL, 65536, FIL)
function charNode(f: Font, c: number): Node {
  const m = f.chars.get(c)
  if (!m) throw new LstUnsupported(`${f.name} has no character ${c}`)
  return { kind: "char", font: f.name, size: f.size, char: c, width: m.width, height: m.height, depth: m.depth, text: String.fromCharCode(c) }
}

/** listings' character classes: \lst@CCPut and \lst@CCPutMacro (the active character table) */
const LETTERS = /^[A-Za-z@$_]$/
const DIGITS = /^[0-9]$/
const OTHERS = /^[!"#%&'()*+,\-./:;<=>?[\\\]^`{|}~]$/
/** \verbatim@nolig@list: \lst@NoLig appends \lst@nolig before the character's own meaning */
const NOLIG = "`<>,'-"

export interface LstScanParams {
  width: number; lines: string[]; options: LstOptions; fonts: LstFonts
  /** \lstinline (\lsthk@TextStyle): \lst@NewLine is empty, so \lst@newlines stays 1 */
  textStyle?: boolean
  /** what outlives a listing: \lst@ifgobbledws (global, and only an output resets it), \lst@breakcurrindent and \lst@breakshape */
  carry: { gobbledws: boolean; breakcurrindent: number; breakshape: [number, number] | null }
  /** breaklines: \lst@breakindent, \linewidth and \@totalleftmargin */
  breaks?: { indent: number; lineWidth: number; left: number }
}

/**
 * The listing's lines as events. The state is listings' own: \lst@token and \lst@length (the token
 * being collected), \lst@ifletter, \lst@lastother, \lst@lostspace, \lst@pos, \lst@newlines, the
 * whitespace and gobbled-whitespace flags, and the modes (strings, comments) with their groups.
 */
export function lstScan(p: LstScanParams): LstEvent[] {
  const { options: o, fonts } = p
  const lang = o.language
  const events: LstEvent[] = []
  const W = p.width // \lst@width
  // local state (saved by a mode's group)
  interface Local { token: Elem[]; length: number; letter: boolean; lastother: string | null; mode: number; currstyle: string | null; ifmode: boolean; keywords: boolean; keepspaces: boolean; visible: boolean; Lmode: boolean }
  let L: Local = { token: [], length: 0, letter: false, lastother: "", mode: 0, currstyle: null, ifmode: false, keywords: true, keepspaces: false, visible: false, Lmode: false }
  const stack: Local[] = []
  // global state
  let lostspace = 0, pos = 0, newlines = 0, whitespace = true, gobbledws = p.carry.gobbledws, ifnewline = false
  const NOMODE = 0
  /** each delimiter has a mode of its own (\lst@UseDynamicMode) */
  const delims = lang?.delims ?? []
  const modeOf = (d: LstDelim) => 10 + delims.indexOf(d)
  const bstrings = delims.some((d) => d.kind === "b")

  const fontOf = (style: string) => fonts.font(o.basicstyle + style)
  /** an element's nodes in a font (listings' \lst@um… macros and LaTeX's text symbols): a character that
   *  TeX's main loop takes (with ligatures and kerns among its neighbours), or other nodes */
  const render = (e: Elem, style: string): Node[] | { f: Font; c: number } => {
    const F = fontOf(style), f = F.font
    if (typeof e !== "string") {
      if ("nolig" in e) return [kern(0, true)]
      if (e.space === "visible") return { f, c: 32 } // \verbvisiblespace = \asciispace
      return [glue(f.params[SPACE], f.params[SPACE_STRETCH], 0, f.params[SPACE_SHRINK], 0)] // \
    }
    const c = e.charCodeAt(0)
    const tt = F.tt
    switch (e) {
      case "$": return { f: fonts.other(o.basicstyle + style, "TS1"), c: 36 }
      case "*": return tt ? { f, c: 42 } : { f: fonts.other(o.basicstyle + style, "TS1"), c: 42 }
      case "-": return tt ? { f, c: 45 } : { f: fonts.other(o.basicstyle + style, "TS1"), c: 61 }
      case "<": case ">": return tt ? { f, c } : { f: fonts.other(o.basicstyle + style, "OML"), c }
      case "\\": return tt ? { f, c: 92 } : { f: fonts.other(o.basicstyle + style, "OMS"), c: 110 }
      case "{": return tt ? { f, c: 123 } : { f: fonts.other(o.basicstyle + style, "OMS"), c: 102 }
      case "|": return tt ? { f, c: 124 } : { f: fonts.other(o.basicstyle + style, "OMS"), c: 106 }
      case "}": return tt ? { f, c: 125 } : { f: fonts.other(o.basicstyle + style, "OMS"), c: 103 }
      case "_": {
        if (tt) return { f, c: 95 }
        // \textunderscore in OT1: \leavevmode \kern.06em \vbox{\hrule\@width.3em}
        const em = f.params[QUAD]
        const rule: Node = { kind: "rule", width: Math.floor((em * 19661) / 65536), height: 26214, depth: 0 }
        return [kern(Math.floor((em * 3932) / 65536), true), vpack([rule])]
      }
    }
    if (e === "^" || e === "~") return [charNode(f, c)] // \^{} and \~{}: an accent with nothing to go on
    return { f, c }
  }
  /** elements typeset in order: runs of characters through the main loop (restricted horizontal mode) */
  const typeset = (elems: Elem[], style: string, between: () => Node | null): Node[] => {
    const nodes: Node[] = []
    let run: number[] = [], runFont: Font | null = null
    const flush = () => { if (run.length) appendRun(nodes, run, runFont!, { paragraph: false, hyphenChar: -1 }); run = []; runFont = null }
    elems.forEach((e, i) => {
      const sep = i ? between() : null
      if (sep) { flush(); nodes.push(sep) }
      const x = render(e, style)
      if (Array.isArray(x)) { flush(); nodes.push(...x); return }
      if (runFont && runFont !== x.f) flush()
      runFont = x.f; run.push(x.c)
      if (typeof e === "string" && "'\"`".includes(e)) flush() // \char39\relax and friends: the \relax ends the main loop
    })
    flush()
    return nodes
  }

  // ---- output (listings.sty: \lst@OutputToken, \lst@CalcLostSpaceAndOutput, \lst@Kern) ----
  const out = (n: Node) => events.push({ node: n })
  /** a style's \color pushes and their pops, in a group around nodes */
  const colored = (style: string | null, nodes: Node[]): Node[] => {
    const cs = style ? fonts.colors(style) : []
    return [...cs.map((c): Node => ({ kind: "whatsit", text: `\\special{color push ${c}}` })), ...nodes, ...cs.map((): Node => ({ kind: "whatsit", text: "\\special{color pop}" }))]
  }
  const lstKern = (w: number) => out(hpack(colored(L.currstyle, [kern(w, true)]))) // \hbox{{\lst@currstyle{\kern#1}}}
  const newLine = (empty = false) => {
    if (p.textStyle) return
    const e: LstEvent = empty ? { newline: true, empty: true } : { newline: true }
    if (o.breaklines) e.shape = p.carry.breakshape ?? [p.breaks!.left, p.breaks!.lineWidth]
    events.push(e); newlines--; ifnewline = true }
  const doNewLines = () => {
    if (p.textStyle) return // (\lst@newlines is 1 and \lst@NewLine does nothing)
    while (newlines > 1) newLine(true)
    if (newlines > 0) newLine()
  }
  const trackNewLines = () => {
    if (newlines <= 0) return
    if (o.breaklines) { // \lsthk@OnNewLine: \lst@breakNewLine, from the lost space of the line's start
      const b = p.breaks!
      const a = b.indent + (o.breakautoindent ? lostspace : 0)
      p.carry.breakcurrindent = a + b.left
      p.carry.breakshape = [p.carry.breakcurrindent, b.lineWidth - a]
    }
    doNewLines()
  }
  const useLostSpace = () => { if (lostspace > 0) { lstKern(lostspace); lostspace = 0 } }
  const flexible = o.columns !== "fixed"
  /** the token box, then \lst@CalcLostSpaceAndOutput with [c] positioning */
  const calcLostSpaceAndOutput = (box: BoxNode, length: number) => {
    lostspace += length * W - box.width
    pos -= length
    const inner: Node[] = []
    const full = !o.lostInserts
    if (lostspace > 0 && !full) { lostspace = Math.trunc(lostspace / 2); inner.push(hpack(colored(L.currstyle, [kern(lostspace, true)]))) } // \lst@InsertHalfLostSpace
    inner.push(box)
    if (lostspace > 0 && !full) { inner.push(hpack(colored(L.currstyle, [kern(lostspace, true)]))); lostspace = 0 } // \lst@InsertLostSpace
    out(hpack(inner))
    ifnewline = false // \lsthk@PostOutput, then breaklines' \lst@discretionary
    if (o.breaklines && (!o.breakatwhitespace || whitespace)) events.push({ disc: true, indent: p.carry.breakcurrindent })
  }
  const outputToken = (style: string) => {
    trackNewLines()
    if (o.columns !== "fullflexible" || ifnewline) useLostSpace() // \lst@OutputLostSpace
    if (gobbledws) {
      gobbledws = false
      events.push({ disc: true, indent: p.carry.breakcurrindent })
    }
    const nodes = flexible ? typeset(L.token, style, () => null) : [hss(), ...typeset(L.token, style, hss), hss()]
    const box = flexible ? hpack(nodes) : hpack(nodes, { exactly: L.length * W })
    // {\lst@thestyle{…\lst@CalcLostSpaceAndOutput}}: the style's colors pushed before the box, popped when the group ends
    const cs = fonts.colors(style)
    for (const c of cs) out({ kind: "whatsit", text: `\\special{color push ${c}}` })
    calcLostSpaceAndOutput(box, L.length)
    for (let i = 0; i < cs.length; i++) out({ kind: "whatsit", text: "\\special{color pop}" })
    L.token = []; L.length = 0
  }
  const keywordStyle = (): string | null => {
    if (!lang || !L.keywords) return null
    const word = L.token.map((e) => (typeof e === "string" ? e : "")).join("")
    for (let i = lang.keywords.length - 1; i >= 0; i--) {
      if (lang.keywords[i].includes(lang.sensitive ? word : word.toUpperCase())) return o.keywordstyle[i] ?? o.keywordstyle[0] ?? ""
    }
    return null
  }
  const output = () => { // \lst@Output
    if (L.length) outputToken(keywordStyle() ?? (L.currstyle ?? o.identifierstyle))
    L.lastother = null
  }
  const outputOther = () => { if (L.length) outputToken(L.currstyle ?? "") }
  const printToken = () => { if (L.letter) { output(); L.letter = false } else { outputOther(); L.lastother = "" } }
  const xPrintToken = () => { printToken(); if (L.length) printToken() }
  const append = (e: Elem) => { L.length++; L.token.push(e) }
  const appendOther = (e: Elem) => { if (L.letter) { output(); L.letter = false } L.lastother = typeof e === "string" ? e : " "; append(e) }
  const appendLetter = (e: Elem) => { if (!L.letter) { outputOther(); L.letter = true } append(e) }
  const noLig = () => { L.token.push({ nolig: true }) }

  // ---- the character table ----
  const processSpace = () => {
    const space: Elem = { space: L.visible ? "visible" : "output" }
    if (L.keepspaces) { printToken(); whitespace = true; appendOther(space); printToken() }
    else if (newlines === 0 || L.length) appendSpecialSpace(space)
    else { lostspace += W; pos--; whitespace = true }
  }
  const appendSpecialSpace = (space: Elem) => {
    if (whitespace) { printToken(); lostspace += W; pos--; gobbledws = true }
    else { printToken(); whitespace = true; appendOther(space); printToken() }
  }
  const processTab = () => {
    xPrintToken(); whitespace = true
    while (pos < 1) pos += o.tabsize
    const length = pos
    if (L.keepspaces) {
      for (let i = 0; i < length; i++) appendOther({ space: L.visible ? "visible" : "output" })
      outputOther()
    } else if (newlines === 0) { // \lst@GotoTabStop
      const f = fontOf("").font
      const w = L.visible ? (f.chars.get(32)?.width ?? 0) : f.params[SPACE]
      L.length = length
      calcLostSpaceAndOutput(hpack(colored(L.currstyle, [hss()]), { exactly: w }), length) // {\lst@currstyle{\hss}}
      L.length = 0
    } else lostspace += length * W
    L.length = 0; pos = 0
  }
  /** the character's meaning before any delimiter: \lst@NoLig, then \lst@ProcessLetter, …Digit or …Other */
  const plain = (ch: string) => {
    if (NOLIG.includes(ch)) noLig()
    if (LETTERS.test(ch)) { whitespace = false; appendLetter(ch) }
    else if (DIGITS.test(ch)) { whitespace = false; if (L.letter) appendLetter(ch); else appendOther(ch) }
    else { whitespace = false; appendOther(ch) }
  }
  const enterMode = (mode: number, style: string, extra: Partial<Local>) => {
    stack.push(L)
    L = { ...L, token: [...L.token], mode, currstyle: style, ifmode: true, keywords: false, ...extra }
  }
  const leaveMode = () => { if (L.mode !== NOMODE) { L = stack.pop()!; L.token = []; L.length = 0; L.lastother = "" } }
  /** \lst@DelimPrint: the delimiter as its own token, in the mode's style */
  const delimPrint = (text: string) => {
    const saved = { ...L, token: [...L.token] }
    L.mode = NOMODE; L.ifmode = true; L.keywords = false
    for (const c of text) plain(c)
    xPrintToken()
    L = { ...saved, token: [], length: 0 }
  }
  const delimOpen = (ch: string, mode: number, style: string, extra: Partial<Local>) => {
    trackNewLines(); xPrintToken()
    enterMode(mode, style, extra)
    delimPrint(ch)
  }
  const delimClose = (ch: string) => { trackNewLines(); xPrintToken(); delimPrint(ch); leaveMode() }

  /** a character and the rest of the line from it; how many characters it took */
  const processChar = (ch: string, rest: string): number => {
    if (ch === " ") { processSpace(); return 1 }
    if (ch === "\t") { processTab(); return 1 }
    if (!LETTERS.test(ch) && !DIGITS.test(ch) && !OTHERS.test(ch)) throw new LstUnsupported(`character ${JSON.stringify(ch)} in a listing`)
    // the character's handlers, the one defined last first; each either acts or hands the character on
    // (\lst@CArgEmpty) to the one before, and the last to the character's own meaning
    for (let h = delims.length - 1; h >= 0; h--) {
      const d = delims[h]
      if (d.kind === "b" && d.open === ch) { // \lst@StringDM@b: a letter token goes out first
        if (L.letter) { output(); L.letter = false }
        if (L.mode === modeOf(d)) { if (L.lastother !== "\\") { delimClose(ch); return 1 } }
        else if (!L.ifmode) { delimOpen(ch, modeOf(d), o.stringstyle, o.showstringspaces ? { keepspaces: true, visible: true } : {}); return 1 }
      } else if (d.kind === "s" && d.close![0] === ch && rest.startsWith(d.close!)) { // \lst@DefDelimE
        if (L.mode === modeOf(d)) { delimClose(d.close!); return d.close!.length }
      } else if ((d.kind === "l" || d.kind === "s") && d.open[0] === ch && rest.startsWith(d.open)) { // \lst@DefDelimB
        if (!L.ifmode) { delimOpen(d.open, modeOf(d), o.commentstyle, d.kind === "l" ? { Lmode: true } : {}); return d.open.length }
      }
    }
    plain(ch)
    if (o.breaklines && ch === ")") outputOther() // \lst@breakProcessOther
    return 1
  }

  newlines = 1 // \lsthk@InitVarsBOL
  p.lines.forEach((line, li) => {
    if (li) { // \lst@MProcessListing: the end of the line before
      xPrintToken()
      while (L.Lmode) leaveMode()
      newlines++; lostspace = 0; L.token = []; L.length = 0; L.lastother = ""; whitespace = true; pos = 0
    }
    for (let i = 0; i < line.length; ) {
      const ch = line[i]
      // with backslash strings, \\ is two backslashes and no \lst@lastother
      if (bstrings && ch === "\\" && line[i + 1] === "\\") { plain("\\"); plain("\\"); L.lastother = null; i += 2; continue }
      i += processChar(ch, line.slice(i))
    }
  })
  // \lst@DeInit: the last token; empty lines at the end go into a box that is thrown away
  xPrintToken()
  while (L.Lmode) leaveMode()
  p.carry.gobbledws = gobbledws
  if (p.textStyle) return events
  for (newlines--; newlines > 0; newlines--) events.push(newlines > 1 ? { newline: true, empty: true, discarded: true } : { newline: true, discarded: true })
  return events
}

export { hss as lstHss }

// ---- frames (lstmisc.sty's frames aspect) ----

/** frame= and its dimensions: the shapes as \lstframe@ makes them (Y a rule, N none; corners in the top and bottom shapes) */
export interface LstFrame { tshape: string; bshape: string; lshape: string; rshape: string; rule: number; sep: number; rulesep: number; xleft: number; xright: number }

/** frame=none|leftline|topline|bottomline|lines|single or letters trbl (frameround ffff) */
export function lstFrameShapes(frame: string): { t: string; b: string; l: string; r: string } {
  const f = { none: "", leftline: "l", topline: "t", bottomline: "b", lines: "tb", single: "trbl" }[frame] ?? frame
  if (!/^[trbl]*$/.test(f)) throw new LstUnsupported(`frame=${frame}`)
  const has = (c: string) => f.includes(c)
  const corner = (c: string) => (has(c) ? "Y" : "N")
  return { t: has("t") ? `${corner("l")}Y${corner("r")}` : "", b: has("b") ? `${corner("l")}Y${corner("r")}` : "", l: has("l") ? "Y" : "", r: has("r") ? "Y" : "" }
}

const lstRule = (width: number | null, height: number | null, depth: number | null): Node => ({ kind: "rule", width, height, depth })
const llap = (nodes: Node[]) => hpack([hss(), ...nodes], { exactly: 0 })
const rlap = (nodes: Node[]) => hpack([...nodes, hss()], { exactly: 0 })
/** \lst@frameBlock with no colour: \hbox{\vrule\@height h\@depth d\@width\z@ \kern w} */
const block = (w: number, h: number, d: number) => hpack([lstRule(0, h, d), kern(w, true)])
const shifted = (b: BoxNode, down: number) => { b.shift = down; return b }

/** \lst@frameMakeBoxV: the box \everypar puts at each line's start (and \lst@@discretionary after a break) */
export function lstFrameBoxV(f: LstFrame, lineWidth: number, h: number, d: number): BoxNode {
  const out: Node[] = []
  if (f.lshape) out.push(llap([block(f.sep, h, d), kern(f.xleft, true)]))
  // \lst@frameL: \kern-\lst@rulesep, then \kern\lst@rulesep and a rule (Y) or its width (N) for each
  const frameL: Node[] = f.lshape ? [kern(-f.rulesep, true), ...[...f.lshape].flatMap((c) => [kern(f.rulesep, true), c === "Y" ? lstRule(f.rule, null, null) : kern(f.rule, true)])] : []
  const zl = hpack([lstRule(0, h, d), ...frameL])
  out.push(llap([rlap([block(zl.width, zl.height, zl.depth)]), zl, kern(f.sep, true), kern(f.xleft, true)]))
  // \lst@frameR: a rule or its width and \kern\lst@rulesep for each, then \kern-\lst@rulesep
  const frameR: Node[] = f.rshape ? [...[...f.rshape].flatMap((c) => [c === "Y" ? lstRule(f.rule, null, null) : kern(f.rule, true), kern(f.rulesep, true)]), kern(-f.rulesep, true)] : []
  const zr = hpack([lstRule(0, h, d), ...frameR])
  out.push(rlap([kern(-f.xleft, true), block(lineWidth + f.xleft + f.xright, h, d), f.rshape ? block(f.sep, h, d) : kern(f.sep, true), rlap([block(zr.width, zr.height, zr.depth)]), zr]))
  return hpack(out)
}

/** \lst@frameH T|B: the top or bottom of the frame (null: no shape) */
export function lstFrameH(f: LstFrame, lineWidth: number, which: "T" | "B"): BoxNode | null {
  const shape = which === "T" ? f.tshape : f.bshape
  if (!shape) return null
  let framediml = 0, framedimr = 0
  let z = hpack([])
  const R = f.rule
  for (let cnt = 0; cnt * 3 < shape.length; cnt++) { // \lst@frameh for each three letters
    const [lc, mid, rc] = shape.slice(cnt * 3, cnt * 3 + 3)
    const a = ((f.rulesep + R) * cnt + f.sep + R) * 2 // \lst@frameCalcDimA
    const half = Math.trunc(a / 2)
    const cornerBox = (corner: "TL" | "TR" | "BL" | "BR"): BoxNode => {
      const down = (b: BoxNode, x: number) => shifted(b, x)
      switch (corner) {
        case "TL": return hpack([down(hpack([lstRule(R, 0, half)]), -R), kern(-R, true), lstRule(half, R, 0)])
        case "TR": return hpack([lstRule(half, R, 0), kern(-R, true), down(hpack([lstRule(R, 0, half)]), -R)])
        case "BL": return hpack([lstRule(R, half, 0), kern(-R, true), lstRule(half, R, 0)])
        case "BR": return hpack([lstRule(half, R, 0), kern(-R, true), lstRule(R, half, 0)])
      }
    }
    // \lst@frameCornerX: the corner (Y) in \llap or \rlap, or (N) a \vphantom of it, which is zero wide
    const corner = (side: "L" | "R", yn: string): { node: Node; width: number } => {
      const b = cornerBox(`${which}${side}` as "TL")
      if (yn === "Y") return { node: side === "L" ? llap([b]) : rlap([b]), width: b.width }
      const ph = hpack([]); ph.height = b.height; ph.depth = b.depth // \vphantom: \null with the box's height and depth
      return { node: ph, width: 0 }
    }
    const left = corner("L", lc), right = corner("R", rc)
    if (framediml < left.width) framediml = left.width
    if (framedimr < right.width) framedimr = right.width
    const inner = hpack([kern(-f.xleft, true), left.node, lstRule(f.xleft + f.xright + lineWidth, mid === "Y" ? R : 0, 0), right.node])
    z = hpack([rlap([shifted(inner, which === "T" ? -inner.depth : inner.height)]), z])
  }
  let tempdimb = f.sep + R
  const tempdimc = -tempdimb + z.height + z.depth
  /** \lst@frameHBkg with no colours: #3 is \@firstoftwo (first) or \@secondoftwo */
  const bkg = (h: number, first: boolean): BoxNode => {
    const nodes: Node[] = [kern(-f.xleft, true)]
    let a = 0
    if (first) nodes.push(kern(-framediml, true))
    if (framediml > tempdimb) {
      if (first) nodes.push(block(framediml - tempdimb, tempdimb, 0))
      else { nodes.push(kern(-framediml, true)); a += framediml }
    }
    if (first) { a = 0; if (f.lshape) a += tempdimb; if (f.rshape) a += tempdimb }
    else if (framedimr > tempdimb) a += framedimr
    a += lineWidth + f.xleft + f.xright
    nodes.push(block(a, h, 0))
    if (first && framedimr > tempdimb) nodes.push(block(-tempdimb + framedimr, tempdimb, 0))
    return hpack(nodes)
  }
  const out: Node[] = []
  const b1 = bkg(tempdimb, true)
  out.push(rlap([which === "T" ? shifted(b1, -b1.depth) : shifted(b1, b1.height)]))
  const b2 = bkg(tempdimc, false)
  tempdimb += b2.height
  out.push(rlap([which === "T" ? shifted(b2, -f.sep) : shifted(b2, tempdimb)]))
  out.push(rlap([z]))
  return hpack(out)
}
