// listings.sty 1.11b with `latex`: the lstlisting environment's character scanner (letters, digits,
// others, spaces and tabulators; a language's keywords, comments and strings) and the boxes it outputs,
// as listings.sty and lstmisc.sty define them. Each line is a paragraph: listings' \lst@NewLine.

import { glue, kern, FIL, type BoxNode, type Node } from "../../../layout/nodes"
import { hpack, vpack } from "../../../layout/pack"
import { appendRun } from "../../../layout/mainloop"
import { QUAD, SPACE, SPACE_SHRINK, SPACE_STRETCH, type Font } from "../../../layout/font"

export class LstUnsupported extends Error {}

/** A language: its keyword classes, line comments and backslash strings (lstlang1.sty) */
export interface LstLanguage { name: string; keywords: string[][]; sensitive: boolean; lineComments: string[]; bStrings: string[] }

const PY2_K1 = "and as assert break class continue def del elif else except exec finally for from global if import in is lambda not or pass print raise return try while with yield".split(" ")
const PY2_K2 = ("abs all any basestring bin bool bytearray callable chr classmethod cmp compile complex delattr dict dir divmod enumerate eval execfile file filter float format " +
  "frozenset getattr globals hasattr hash help hex id input int isinstance issubclass iter len list locals long map max memoryview min next object oct open ord pow property range " +
  "raw_input reduce reload repr reversed round set setattr slice sorted staticmethod str sum super tuple type unichr unicode vars xrange zip __import__ apply buffer coerce intern").split(" ")
/** \lst@definelanguage[2]{Python}: its [s] strings of three quotes never begin (the [b] ones take the quote first) */
const PYTHON2: LstLanguage = { name: "Python", keywords: [PY2_K1, PY2_K2], sensitive: true, lineComments: ["#"], bStrings: ["'", '"'] }

/** language=…: the name, with listings.cfg's default dialect */
export function lstLanguage(value: string): LstLanguage | null {
  const v = value.replace(/[{}\s]/g, "")
  if (v === "") return null
  if (/^(\[2\])?python$/i.test(v)) return PYTHON2
  throw new LstUnsupported(`language=${value}`)
}

export interface LstOptions {
  language: LstLanguage | null
  basicstyle: string; identifierstyle: string; commentstyle: string; stringstyle: string
  /** keywordstyle=[n]: index n-1 */
  keywordstyle: (string | undefined)[]
  columns: "fixed" | "flexible" | "fullflexible"
  showstringspaces: boolean
  tabsize: number
  caption: string | null; label: string | null
}

export const LST_DEFAULTS: LstOptions = {
  language: null, basicstyle: "", identifierstyle: "", commentstyle: "\\itshape", stringstyle: "", keywordstyle: ["\\bfseries"],
  columns: "fixed", showstringspaces: true, tabsize: 8, caption: null, label: null,
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
  const style = (v: string | null) => { if (v === null || !/^(\s*\\(bfseries|mdseries|itshape|slshape|upshape|scshape|rmfamily|sffamily|ttfamily|normalfont|tiny|scriptsize|footnotesize|small|normalsize|large|Large))*\s*$/.test(v)) throw new LstUnsupported(`listings style ${v}`); return v }
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
        const c = (v ?? "").replace(/^\[c\]/, "")
        if (c !== "fixed" && c !== "flexible" && c !== "fullflexible") throw new LstUnsupported(`columns=${v}`)
        o.columns = c
        break
      }
      case "flexiblecolumns": o.columns = bool(v) ? "flexible" : "fixed"; break
      case "showstringspaces": o.showstringspaces = bool(v); break
      case "tabsize": if (!/^\d+$/.test(v ?? "") || Number(v) < 1) throw new LstUnsupported(`tabsize=${v}`); o.tabsize = Number(v); break
      case "caption": if (v === null || /^\[/.test(v)) throw new LstUnsupported(`caption=${v}`); o.caption = v; break
      case "label": o.label = v; break
      case "numbers": if (v !== "none") throw new LstUnsupported(`numbers=${v}`); break
      case "frame": if (v !== "none") throw new LstUnsupported(`frame=${v}`); break
      case "breaklines": if (bool(v)) throw new LstUnsupported("breaklines"); break
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
}

/** Output: a new line (\lst@NewLine: \par\noindent\hbox{}), a node of the line, or \lst@@discretionary (its
 *  post-break text has the line's frame box, which the caller makes) */
export type LstEvent = { newline: true; /** in \lst@DeInit's box that is thrown away */ discarded?: true } | { node: Node } | { disc: true }

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

export interface LstScanParams { width: number; lines: string[]; options: LstOptions; fonts: LstFonts }

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
  let lostspace = 0, pos = 0, newlines = 0, whitespace = true, gobbledws = false, ifnewline = false
  const NOMODE = 0, COMMENT = 1
  const stringMode = (d: string) => 10 + (lang?.bStrings.indexOf(d) ?? 0)

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
    })
    flush()
    return nodes
  }

  // ---- output (listings.sty: \lst@OutputToken, \lst@CalcLostSpaceAndOutput, \lst@Kern) ----
  const out = (n: Node) => events.push({ node: n })
  const lstKern = (w: number) => out(hpack([kern(w, true)]))
  const newLine = () => { events.push({ newline: true }); newlines--; ifnewline = true }
  const doNewLines = () => { while (newlines > 1) newLine(); if (newlines > 0) newLine() }
  const trackNewLines = () => { if (newlines > 0) doNewLines() }
  const useLostSpace = () => { if (lostspace > 0) { lstKern(lostspace); lostspace = 0 } }
  const flexible = o.columns !== "fixed"
  /** the token box, then \lst@CalcLostSpaceAndOutput with [c] positioning */
  const calcLostSpaceAndOutput = (box: BoxNode, length: number) => {
    lostspace += length * W - box.width
    pos -= length
    const inner: Node[] = []
    const full = o.columns === "fullflexible"
    if (lostspace > 0 && !full) { lostspace = Math.trunc(lostspace / 2); inner.push(hpack([kern(lostspace, true)])) } // \lst@InsertHalfLostSpace
    inner.push(box)
    if (lostspace > 0 && !full) { inner.push(hpack([kern(lostspace, true)])); lostspace = 0 } // \lst@InsertLostSpace
    out(hpack(inner))
    ifnewline = false // \lsthk@PostOutput
  }
  const outputToken = (style: string) => {
    trackNewLines()
    if (o.columns !== "fullflexible" || ifnewline) useLostSpace() // \lst@OutputLostSpace
    if (gobbledws) {
      gobbledws = false
      events.push({ disc: true })
    }
    const nodes = flexible ? typeset(L.token, style, () => null) : [hss(), ...typeset(L.token, style, hss), hss()]
    const box = flexible ? hpack(nodes) : hpack(nodes, { exactly: L.length * W })
    calcLostSpaceAndOutput(box, L.length)
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
      calcLostSpaceAndOutput(hpack([hss()], { exactly: w }), length)
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
  const delimPrint = (ch: string) => {
    const saved = { ...L, token: [...L.token] }
    L.mode = NOMODE; L.ifmode = true; L.keywords = false
    plain(ch); xPrintToken()
    L = { ...saved, token: [], length: 0 }
  }
  const delimOpen = (ch: string, mode: number, style: string, extra: Partial<Local>) => {
    trackNewLines(); xPrintToken()
    enterMode(mode, style, extra)
    delimPrint(ch)
  }
  const delimClose = (ch: string) => { trackNewLines(); xPrintToken(); delimPrint(ch); leaveMode() }

  const processChar = (ch: string) => {
    if (ch === " ") return processSpace()
    if (ch === "\t") return processTab()
    if (!LETTERS.test(ch) && !DIGITS.test(ch) && !OTHERS.test(ch)) throw new LstUnsupported(`character ${JSON.stringify(ch)} in a listing`)
    if (lang?.bStrings.includes(ch)) { // \lst@StringDM@b
      if (L.letter) { output(); L.letter = false }
      if (L.mode === stringMode(ch)) { if (L.lastother === "\\") plain(ch); else delimClose(ch) }
      else if (!L.ifmode) delimOpen(ch, stringMode(ch), o.stringstyle, o.showstringspaces ? { keepspaces: true, visible: true } : {})
      else plain(ch)
      return
    }
    if (lang?.lineComments.includes(ch)) { // \lst@CommentDM@l
      if (!L.ifmode) delimOpen(ch, COMMENT, o.commentstyle, { Lmode: true }); else plain(ch)
      return
    }
    plain(ch)
  }

  newlines = 1 // \lsthk@InitVarsBOL
  p.lines.forEach((line, li) => {
    if (li) { // \lst@MProcessListing: the end of the line before
      xPrintToken()
      while (L.Lmode) leaveMode()
      newlines++; lostspace = 0; L.token = []; L.length = 0; L.lastother = ""; whitespace = true; pos = 0
    }
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      // with backslash strings, \\ is two backslashes and no \lst@lastother
      if (lang?.bStrings.length && ch === "\\" && line[i + 1] === "\\") { plain("\\"); plain("\\"); L.lastother = null; i++; continue }
      processChar(ch)
    }
  })
  // \lst@DeInit: the last token; empty lines at the end go into a box that is thrown away
  xPrintToken()
  for (newlines--; newlines > 0; newlines--) events.push({ newline: true, discarded: true })
  return events
}

export { hss as lstHss }
