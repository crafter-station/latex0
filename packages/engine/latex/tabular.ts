// The kernel's tabular (latex.ltx \@tabular, \@array, \@mkpream, \multicolumn, \hline, \cline): the column
// preamble as \@mkpream builds it, the body's rows and rules, and the \halign they make. With booktabs:
// \toprule, \midrule, \bottomrule, \cmidrule, \specialrule, \addlinespace and \morecmidrules. A p{width}
// column's entry is \@classv's \vtop paragraph. With array.sty (array.sty 2.6n): its \@mkpream (>{decl}, <{decl},
// !{text}, m, p and b columns, \newcolumntype), \vline rules, \@startpbox's strut and \do@row@strut. With siunitx:
// its S[options] column (siunitx.ts).

import { halignSpans, type AlignCell } from "../layout/align"
import { emptyBox, glue, kern, paramGlue, penalty, type BoxNode, type Node, filGlue, fillGlue, ssGlue } from "../layout/nodes"
import { hpack, vpack, type PackSpec } from "../layout/pack"
import { parseDimen, type GlueSpec } from "../layout/dimen"
import { QUAD, X_HEIGHT, type Font } from "../layout/font"
import { appendToVlist } from "./paragraph"
import { Unsupported } from "./unsupported"
import { SIZE_COMMANDS, type SizeCommand } from "../layout/classdata"
import { colorPop, colorPush, xcolor } from "./xcolor"
import { FILL } from "../layout/nodes"

export class TabularUnsupported extends Unsupported {}

/** what a preamble puts around a column's entry: a rule (|), a skip, @-text, or the \\tabskip an \\extracolsep in it sets */
export type TabItem = { rule: true } | { skip: "tabcolsep" | "doublerulesep" | "halfrule" } | { text: string } | { tabskip: string }

/**
 * @{text} (array.sty: !{text} too) with an \extracolsep{skip}: \tabskip skip\relax in the preamble (the kernel's
 * \@tabclassiv expands it; array.sty's \NC@ecs puts it there), which the \halign's preamble scan takes out (§ 782):
 * the tabskip glue after this column and the next ones. The text around it stays.
 */
function atItems(text: string): TabItem[] {
  const m = text.match(/\\extracolsep(?![A-Za-z])\s*(?:\{((?:[^{}]|\{[^{}]*\})*)\}|(\\[A-Za-z]+))/)
  if (!m) return [{ text }]
  const before = text.slice(0, m.index), after = text.slice(m.index! + m[0].length)
  // (a second one: array.sty's \NC@ecs takes the first only; text on both sides has the \relax between)
  if (/\\extracolsep(?![A-Za-z])/.test(after) || before.trim() && after.trim()) throw new TabularUnsupported(`@{${text}}`)
  return [{ tabskip: m[1] ?? m[2] }, { text: before + after }]
}
/** a column's template: u, the entry aligned l, c or r or in a p{width} box (array.sty: an m or b one too, and
 *  the >{decl} before the entry and <{decl} after it), v */
export interface TabCol { align: "l" | "c" | "r" | "p" | "m" | "b"; width?: string; u: TabItem[]; v: TabItem[]; pre?: string; post?: string
  /** siunitx's S[options] (a c column around \siunitx_cell_begin:w … \siunitx_cell_end:): its options */
  si?: string
  /** array.sty's w{align}{width} and W{align}{width}: a c column whose entry is \makebox[width][align]'d */
  box?: { align: string; width: string; W: boolean }
  /** colortbl's \columncolor[model]{color} in its >{decl} */
  color?: CtColor }
/** a color as colortbl's commands take it: [model]{spec} */
export interface CtColor { spec: string; model?: string }

/** colortbl's \columncolor[model]{color} in >{decl}s (\CT@extract: the first one), taken out of them */
function columnColor(pre: string): { pre: string; color?: CtColor } {
  const m = pre.match(/\\columncolor\s*(?:\[([^\]]*)\])?\s*\{([^{}]*)\}/)
  if (!m) return { pre }
  if (/^\s*\[/.test(pre.slice(m.index! + m[0].length))) throw new TabularUnsupported(`${m[0]}[overhang]`)
  return { pre: pre.slice(0, m.index) + pre.slice(m.index! + m[0].length), color: { spec: m[2].trim(), ...(m[1] !== undefined ? { model: m[1].trim() } : {}) } }
}
/** array.sty's \newcolumntype{X}[n]{spec}'s */
export type ColumnTypes = Record<string, { n: number; spec: string }>

/** the spec's tokens: characters and the contents of braced groups (\@tfor), after \@expast's *{n}{cols} */
function specTokens(spec: string, types: ColumnTypes = {}): string[] {
  const toks: string[] = []
  const read = (s: string, i: number): [string, number] => { // an undelimited argument
    while (/\s/.test(s[i] ?? "")) i++
    if (i >= s.length) throw new TabularUnsupported(`tabular columns {${spec}}`)
    if (s[i] === "{") {
      let depth = 0, j = i
      for (; j < s.length; j++) { if (s[j] === "{") depth++; else if (s[j] === "}" && --depth === 0) break }
      if (j >= s.length) throw new TabularUnsupported(`tabular columns {${spec}}`)
      return [s.slice(i + 1, j), j + 1]
    }
    if (s[i] === "\\") throw new TabularUnsupported(`tabular columns {${spec}}`)
    return [s[i], i + 1]
  }
  let s = spec
  // array.sty's \NC@list, until nothing is rewritten: *{n}{cols}, then each \newcolumntype (at the top level)
  for (let rounds = 0; ; rounds++) {
    if (rounds > 50) throw new TabularUnsupported(`tabular columns {${spec}}`)
    let changed = false
    for (let star = s.indexOf("*"); star >= 0; star = s.indexOf("*")) {
      const [n, a] = read(s, star + 1), [cols, b] = read(s, a)
      if (!/^\s*\d+\s*$/.test(n)) throw new TabularUnsupported(`tabular columns {${spec}}`)
      s = s.slice(0, star) + cols.repeat(Number(n)) + s.slice(b)
      changed = true
    }
    for (let i = 0, depth = 0; i < s.length; i++) {
      if (s[i] === "{") depth++
      else if (s[i] === "}") depth--
      else if (depth === 0 && s[i] in types) {
        const t = types[s[i]]
        let body = t.spec, j = i + 1
        for (let k = 1; k <= t.n; k++) { const [a, e] = read(s, j); body = body.split(`#${k}`).join(a); j = e }
        s = s.slice(0, i) + body + s.slice(j)
        changed = true
        break
      }
    }
    if (!changed) break
  }
  for (let i = 0; i < s.length;) {
    if (/\s/.test(s[i])) { i++; continue }
    const [t, j] = read(s, i)
    toks.push(s[i] === "{" ? `{${t}` : t) // (a group keeps a mark)
    i = j
  }
  return toks
}

/** how many X columns a preamble has once its column types are rewritten (tabularx's \NC@rewrite@X counts them) */
export function xColumns(spec: string, types: ColumnTypes): number {
  return specTokens(spec, { ...types, X: { n: 0, spec: "p{\\TX@col@width}" } }).filter((t) => t === "{\\TX@col@width").length
}

/** array.sty's \@mkpream: the classes of \@testpach (0 a column, 1 a rule or !'s text, 2 <'s, 3 >'s, 5 @'s
 *  text, 6 !, 7 @, 8 <, 9 >, 10 m, p or b, before its width) and what each adds */
function arrayPreamble(spec: string, toks: string[], si: boolean): TabCol[] {
  type Col = { align: TabCol["align"]; width?: string; pre: string; post: string; si?: string; box?: TabCol["box"]; color?: CtColor }
  const bad = () => new TabularUnsupported(`tabular columns {${spec}}`)
  const flat: (TabItem | "&" | Col)[] = []
  let last = 4, firstAmp = true, num = 0, pre = "", col: Col | null = null
  const acol = () => flat.push({ skip: "tabcolsep" })
  const amp = () => { if (firstAmp) firstAmp = false; else flat.push("&") }
  const classx = () => { if (last === 0 || last === 2) { acol(); amp(); acol() } else if (last === 1) { amp(); acol() } else if (last === 4) { acol(); firstAmp = false } else if (last === 5) amp() }
  const classvi = () => { if (last === 0 || last === 2) acol(); else if (last === 1) flat.push({ skip: "doublerulesep" }); else if (last === 3) throw bad() }
  for (let ti = 0; ti < toks.length; ti++) {
    const t = toks[ti]
    const arg = t.replace(/^\{/, "")
    let ch: number
    if (last === 6) { ch = 1; num = 1 } else if (last === 7) ch = 5
    else if (last === 8) ch = 2
    else if (last === 9) ch = 3
    else if (last === 10) ch = 0 // (num is m's, p's or b's)
    else if (t.startsWith("{")) throw bad()
    else if ("clr".includes(t)) { ch = 0; num = "clr".indexOf(t) } else if (t === "|") { ch = 1; num = 0 } else if (t in ARRAY_CLASSES) ch = ARRAY_CLASSES[t]
    else if ("mpb".includes(t)) { ch = 10; num = "mpb".indexOf(t) + 3 }
    else if (t === "S" && si) { ch = 0; num = 0 } // (S's \NC@rewrite@S: >{…}c<{…})
    else if (t === "w" || t === "W") { // \NC@rewrite@w: >{\begin{lrbox}…}c<{…\makebox[width][align]{…}}
      const [a, w] = [toks[ti + 1], toks[ti + 2]]
      if (w === undefined || !/^\{?\s*[lcrstb]\s*$/.test(a)) throw bad()
      classx() // (as its > does; the >{decl}'s before it go inside the box)
      col = { align: "c", pre, post: "", box: { align: a.replace(/^\{/, "").trim(), width: w.replace(/^\{/, ""), W: t === "W" } }
      pre = ""; flat.push(col); ti += 2; last = 2; continue
    }
    else throw new TabularUnsupported(`tabular column ${t} in {${spec}}`)
    switch (ch) {
      case 0: // \@classz: the separators, then the column with the >{decl}'s gathered so far
        classx()
        col = { align: (["c", "l", "r", "m", "p", "b"] as const)[num], ...(num >= 3 ? { width: arg } : {}), pre, post: "" }
        if (/\\columncolor(?![A-Za-z])/.test(pre)) { const cc = columnColor(pre); col.pre = cc.pre; col.color = cc.color }
        if (t === "S" && last !== 10) { // its [options], to the ] (groups keep their braces)
          let opts = ""
          if (toks[ti + 1] === "[") {
            for (ti += 2; ti < toks.length && toks[ti] !== "]"; ti++) opts += toks[ti].startsWith("{") ? `${toks[ti]}}` : toks[ti]
            if (ti >= toks.length) throw bad()
          }
          if (pre) throw new TabularUnsupported(`>{${pre}} before S`) // (siunitx would collect it into the entry)
          col.si = opts
        }
        pre = ""; flat.push(col); break
      case 1: classvi(); flat.push(...(num === 0 ? [{ rule: true } as const] : atItems(arg))); break // \@classi: \vline, or !'s text
      case 2: if (!col) throw bad(); col.post = cat(arg, col.post); break // \@classii (save@decl puts it first)
      case 3: pre = cat(arg, pre); break
      case 5: flat.push(...atItems(arg)); break // \@classv
      case 6: classvi(); break
      case 7: if (last === 3) throw bad(); break
      case 8: if (last > 0 && last !== 2) throw bad(); break
      default: classx() // 9 and 10
    }
    last = ch
  }
  if (last === 0 || last === 2) acol()
  else if (last !== 1 && last !== 5) throw bad()
  return columns(spec, flat)
}
const ARRAY_CLASSES: Record<string, number> = { "!": 6, "@": 7, "<": 8, ">": 9 }

/** a then b, as tokens (a space after a control word; {} before one of b's spaces, which a control word would take) */
function cat(a: string, b: string): string {
  return a + (/\\[A-Za-z]+$/.test(a) ? /^[A-Za-z]/.test(b) ? " " : /^\s/.test(b) ? "{}" : "" : "") + b
}

/** the preamble's items split at its &'s into columns */
function columns(spec: string, flat: (TabItem | "&" | { align: TabCol["align"]; width?: string; pre?: string; post?: string })[]): TabCol[] {
  const cols: TabCol[] = []
  let cur: Partial<TabCol> & { u: TabItem[]; v: TabItem[] } = { u: [], v: [] }
  for (const x of [...flat, "&" as const]) {
    if (x === "&") {
      if (!cur.align) throw new TabularUnsupported(`tabular columns {${spec}}`)
      cols.push(cur as TabCol); cur = { u: [], v: [] }
    } else if ("align" in x) {
      if (cur.align) throw new TabularUnsupported(`tabular columns {${spec}}`)
      Object.assign(cur, x)
    } else (cur.align ? cur.v : cur.u).push(x)
  }
  return cols
}

/** \@mkpream with \@tabclassz: the columns' templates (array.sty's, with `array`) */
export function preamble(spec: string, array?: { types: ColumnTypes; si?: boolean }): TabCol[] {
  if (array) return arrayPreamble(spec, specTokens(spec, array.types), !!array.si)
  const flat: (TabItem | "&" | { align: "l" | "c" | "r" | "p"; width?: string })[] = []
  let last = 6, firstAmp = true
  const acol = () => flat.push({ skip: "tabcolsep" })
  const amp = () => { if (firstAmp) firstAmp = false; else flat.push("&") }
  const rule = () => flat.push({ rule: true })
  for (const t of specTokens(spec)) {
    const ch = last === 2 ? 4 : last === 3 ? 5 : t === "l" || t === "c" || t === "r" ? 0 : t === "|" ? 1 : t === "@" ? 2 : t === "p" ? 3 : -1
    if (ch < 0) throw new TabularUnsupported(`tabular column ${t.replace(/^\{/, "")} in {${spec}}`)
    if (ch === 0 || ch === 3) { // \@tabclassz, and \@classiii for p: the same separators
      if (last === 0 || last === 5) { acol(); amp(); acol() } else if (last === 1) { amp(); acol() } else if (last === 4) amp(); else { firstAmp = false; acol() }
      if (ch === 0) flat.push({ align: t as "l" })
    } else if (ch === 5) flat.push({ align: "p", width: t.replace(/^\{/, "") }) // \@classv: \@startpbox{width}\ignorespaces#\@endpbox
    else if (ch === 1) {
      if (last === 0 || last === 5) acol(); else if (last === 1) flat.push({ skip: "doublerulesep" })
      rule()
    } else if (ch === 2) { if (last === 1) flat.push({ skip: "halfrule" }) }
    else flat.push(...atItems(t.replace(/^\{/, "")))
    last = ch
  }
  if (last === 0 || last === 5) acol()
  else if (last === 2 || last === 3) throw new TabularUnsupported(`tabular columns {${spec}}`)
  return columns(spec, flat)
}

/** a cell as typed: its text, or a \multicolumn */
export type TabCell = { text: string } | { span: number; spec: string; text: string
  /** (longtable's \caption: the entry's material, made already, and what follows the \multicolumn in its cell) */
  nodes?: Node[]; after?: Node[] }
/** booktabs's dimensions */
export interface Booktabs { heavyrulewidth: number; lightrulewidth: number; cmidrulewidth: number; belowrulesep: number; belowbottomsep: number; aboverulesep: number; abovetopsep: number; cmidrulesep: number; cmidrulekern: number; defaultaddspace: number }

/** booktabs's dimensions, set as it loads, in the font current then (.08em, .05em, .03em, .65ex, .4ex, .5em), and
 *  \cmidrulesep \doublerulesep */
export function booktabsDimens(f: Font, doublerulesep: number): Booktabs {
  const d = (x: string) => parseDimen(x, { em: f.params[QUAD], ex: f.params[X_HEIGHT] })
  return { heavyrulewidth: d(".08em"), lightrulewidth: d(".05em"), cmidrulewidth: d(".03em"), belowrulesep: d(".65ex"), belowbottomsep: 0, aboverulesep: d(".4ex"), abovetopsep: 0, cmidrulesep: doublerulesep, cmidrulekern: d(".5em"), defaultaddspace: d(".5em") }
}

/** a row (and the [skip] of the \\ ending it), an \hline, a \cline{a-b}, or a booktabs rule */
export type TabLine = { cells: TabCell[]; skip?: string | number; ended?: boolean; /** \\* */ star?: boolean } | { rowcolor: CtColor } | { hline: true } | { cline: [number, number] } | BooktabsLine
/** booktabs's rules between rows: \toprule, \midrule, \bottomrule[width], \specialrule{width}{above}{below},
 *  \addlinespace[space], \cmidrule[width](trim){a-b}, \morecmidrules */
export type BooktabsLine =
  | { btrule: "top" | "mid" | "bottom"; width?: string } | { special: [string, string, string] } | { addspace: string | null }
  | { cmid: [number, number]; width?: string; trim: string } | { morecmid: true }
const isBooktabs = (l: TabLine | undefined): l is BooktabsLine => !!l && ("btrule" in l || "special" in l || "addspace" in l || "cmid" in l || "morecmid" in l)

/** the text up to `stop` at brace depth 0 (not \stop), and where it ends */
function upTo(s: string, i: number, stop: string): number {
  let depth = 0
  for (; i < s.length; i++) {
    if (s[i] === "\\") { if (depth === 0 && s.startsWith(stop, i)) return i; i++; continue }
    if (depth === 0 && s.startsWith(stop, i)) return i
    if (s[i] === "{") depth++
    else if (s[i] === "}") depth--
  }
  return -1
}

/** a braced argument at i (after spaces): its text and where it ends */
function arg(s: string, i: number): [string, number] | null {
  while (/\s/.test(s[i] ?? "")) i++
  if (s[i] !== "{") return null
  const end = upTo(s, i + 1, "}")
  return end < 0 ? null : [s.slice(i + 1, end), end + 1]
}

/** the body's rows and rules (\\ is \@tabularcr; \hline and \cline come first in a row) */
export function tabularLines(body: string): TabLine[] {
  const lines: TabLine[] = []
  let rest = body.replace(/(^|[^\\])%.*\n[ \t]*/g, "$1").trim() // a comment eats its line's end and the next line's spaces
  for (;;) {
    for (;;) {
      const h = rest.match(/^\\hline(?![A-Za-z])\s*/)
      if (h) { lines.push({ hline: true }); rest = rest.slice(h[0].length); continue }
      const c = rest.match(/^\\cline\s*\{\s*(\d+)\s*-\s*(\d+)\s*\}\s*/)
      if (c) {
        const a = Number(c[1]), b = Number(c[2])
        if (a < 1 || b < a) throw new TabularUnsupported(`\\cline{${a}-${b}}`)
        lines.push({ cline: [a, b] }); rest = rest.slice(c[0].length); continue
      }
      // booktabs (\@ifnextchar skips spaces before an optional argument)
      const r = rest.match(/^\\(toprule|midrule|bottomrule)(?![A-Za-z])\s*(?:\[([^\]]*)\])?\s*/)
      if (r) { lines.push({ btrule: r[1].slice(0, -4) as "top", ...(r[2] !== undefined ? { width: r[2] } : {}) }); rest = rest.slice(r[0].length); continue }
      const sr = rest.match(/^\\specialrule\s*\{([^{}]*)\}\s*\{([^{}]*)\}\s*\{([^{}]*)\}\s*/)
      if (sr) { lines.push({ special: [sr[1], sr[2], sr[3]] }); rest = rest.slice(sr[0].length); continue }
      const as = rest.match(/^\\addlinespace(?![A-Za-z])\s*(?:\[([^\]]*)\])?\s*/)
      if (as) { lines.push({ addspace: as[1] ?? null }); rest = rest.slice(as[0].length); continue }
      const cm = rest.match(/^\\cmidrule(?![A-Za-z])\s*(?:\[([^\]]*)\])?\s*(?:\(([^)]*)\))?\s*\{\s*(\d+)\s*-\s*(\d+)\s*\}\s*/)
      if (cm) {
        const a = Number(cm[3]), b = Number(cm[4])
        if (a < 1 || b < a || !/^[lr]*$/.test(cm[2] ?? "")) throw new TabularUnsupported(`\\cmidrule(${cm[2] ?? ""}){${a}-${b}}`)
        lines.push({ cmid: [a, b], trim: cm[2] ?? "", ...(cm[1] !== undefined ? { width: cm[1] } : {}) }); rest = rest.slice(cm[0].length); continue
      }
      // colortbl's \rowcolor[model]{color}: \noalign{…} for the row after it
      const rc = rest.match(/^\\rowcolor(?![A-Za-z])\s*(?:\[([^\]]*)\])?\s*\{([^{}]*)\}\s*/)
      if (rc) {
        if (rest.slice(rc[0].length).startsWith("[")) throw new TabularUnsupported("\\rowcolor[…]{…}[overhang]")
        lines.push({ rowcolor: { spec: rc[2].trim(), ...(rc[1] !== undefined ? { model: rc[1].trim() } : {}) } }); rest = rest.slice(rc[0].length); continue
      }
      const mc = rest.match(/^\\morecmidrules(?![A-Za-z])\s*/)
      if (mc) { lines.push({ morecmid: true }); rest = rest.slice(mc[0].length); continue }
      break
    }
    if (!rest) break
    const end = upTo(rest, 0, "\\\\")
    const row = end < 0 ? rest : rest.slice(0, end)
    rest = end < 0 ? "" : rest.slice(end + 2)
    // \\* and \\[skip] (\@tabularcr)
    let skip: string | undefined
    const opt = rest.match(/^(\*?)\s*(?:\[([^\]]*)\])?/)!
    if (opt[2] !== undefined) skip = opt[2]
    rest = rest.slice(opt[0].length).trim()
    if (/\\(?:hline|cline|toprule|midrule|bottomrule|cmidrule|specialrule|addlinespace|morecmidrules|rowcolor)(?![A-Za-z])/.test(row)) throw new TabularUnsupported("a rule inside a row")
    const cells: TabCell[] = []
    for (let i = 0; ;) {
      const e = upTo(row, i, "&")
      const text = e < 0 ? row.slice(i) : row.slice(i, e)
      const mc = text.match(/^\s*\\multicolumn(?![A-Za-z])/)
      if (mc) {
        const n = arg(text, mc[0].length), sp = n && arg(text, n[1]), t = sp && arg(text, sp[1])
        if (!n || !sp || !t || !/^\s*\d+\s*$/.test(n[0]) || text.slice(t[1]).trim()) throw new TabularUnsupported(`\\multicolumn: ${text.trim().slice(0, 40)}`)
        cells.push({ span: Number(n[0]), spec: sp[0], text: t[0] })
      } else cells.push({ text })
      if (e < 0) break
      i = e + 1
    }
    lines.push({ cells, ...(skip !== undefined ? { skip } : {}), ...(end >= 0 ? { ended: true } : {}), ...(opt[1] ? { star: true } : {}) })
  }
  return lines
}

/** \multirow[vpos]{rows}{*}{text} at an entry's start (\multirow[vpos]{rows}[bigstruts]{width}[fixup]{text}: the
 *  look for [fixup] comes before the text, and the spaces after it stay) */
function multirow(text: string): { vpos: "c" | "t" | "b"; rows: number; text: string; rest: string } | null {
  const m = text.match(/^\\multirow(?![A-Za-z])\s*(?:\[([^\]]*)\])?\s*/)
  if (!m) {
    if (/\\multirow(?![A-Za-z])/.test(text)) throw new TabularUnsupported(`\\multirow inside an entry: ${text.trim().slice(0, 40)}`)
    return null
  }
  // (a [bigstruts] after rows leaves no braced width there)
  const n = arg(text, m[0].length), w = n && arg(text, n[1]), t = w && arg(text, w[1])
  const vpos = (m[1] ?? "c").trim()
  if (!n || !w || !t || !/^[ctb]$/.test(vpos) || !/^\s*[1-9]\d*\s*$/.test(n[0]) || w[0].trim() !== "*")
    throw new TabularUnsupported(`\\multirow: ${text.trim().slice(0, 40)}`)
  return { vpos: vpos as "c", rows: Number(n[0]), text: t[0], rest: text.slice(t[1]) }
}

/**
 * multirow.sty's \@xmultirow with width *: \setbox0\vtop to rows×(\ht+\dp\@arstrutbox){\vfill (not for t)
 * \hbox{\strut text\strut} \vfill (not for b)}, then \setbox0\vtop{\vskip-d \box0\vss}\dp0=0 where d is
 * \ht\@arstrutbox (and its \dp too for b), or for t the box's height
 */
function multirowBox(env: TabularEnv, m: { vpos: "c" | "t" | "b"; rows: number; text: string }, strutbox?: { height: number; depth: number }): BoxNode {
  const { height: sh, depth: sd } = env.strut
  const sb = strutbox ?? env.array?.strutbox ?? env.strut
  const strut = (): Node => ({ kind: "rule", width: 0, height: sb.height, depth: sb.depth }) // \unhcopy\strutbox
  const hbox = hpack([strut(), ...env.cell(m.text, { spaceFactor: 1000 }), strut()])
  const box0 = vtop([...(m.vpos !== "t" ? [fillGlue()] : []), hbox, ...(m.vpos !== "b" ? [fillGlue()] : [])], { exactly: m.rows * sh + m.rows * sd })
  const d = m.vpos === "t" ? box0.height : sh + (m.vpos === "b" ? sd : 0)
  const box = vtop([glue(-d), box0, ssGlue()])
  box.depth = 0
  return box
}

/** \vtop (§ 1087): the vbox's height is its first item's if that is a box or a rule, else zero */
export function vtop(list: Node[], spec?: PackSpec): BoxNode {
  const box = vpack(list, spec)
  const first = list[0]
  const h = first && (first.kind === "hlist" || first.kind === "vlist" || first.kind === "rule") ? first.height ?? 0 : 0
  box.depth = box.depth - h + box.height; box.height = h
  return box
}

/** what a tabular is built with where it stands */
export interface TabularEnv {
  /** \@arstrutbox's height and depth */
  strut: { height: number; depth: number }
  tabcolsep: number; arrayrulewidth: number; doublerulesep: number; lineskiplimit: number
  /** the math axis of the text size (\vcenter) */
  axis: number
  /** an entry or @-text in restricted horizontal mode, with the cell's space factor */
  cell(text: string, state: { spaceFactor: number }): Node[]
  /** a p{width} column's \vtop (\@startpbox … \@endpbox) around an entry; `cr` is what \\[skip] puts at its end.
   *  With array.sty, `array`: the box (a \vtop for p, a \vbox for m and b) and the paragraph shape >{decl} gave */
  pbox(text: string, width: string, cr: Node[], array?: { kind: "p" | "m" | "b"; shape: "centering" | "raggedright" | "raggedleft" | null; size?: SizeCommand }, everypar?: boolean): BoxNode
  /** longtable's \LT@startpbox, without array.sty too: the \everypar strut in a p{width} entry */
  everyparStrut?: boolean
  /** a \\[skip]'s dimension */
  skip(text: string): number
  /** xcolor's current color where the tabular stands, when not the document's */
  color?: string
  /** colortbl loaded: its column template, its colors as the driver's specials take them, and \rowcolors in force
   *  (with \rownum, which counts on from tabular to tabular) */
  colortbl?: { color(c: CtColor): string; rows?: { start: number; odd: string; even: string; num: { n: number } } }
  /** an \extracolsep's skip */
  glue(text: string): GlueSpec
  /** multirow loaded */
  multirow?: boolean
  /** array.sty loaded, with its \newcolumntype's; \strutbox (\@arstrutbox has \extrarowheight too) */
  array?: { types: ColumnTypes; strutbox: { height: number; depth: number }; strutOf(size: SizeCommand): { height: number; depth: number }; si?: boolean }
  /** siunitx loaded: an S column's entry with the column's options (siunitx.ts) */
  si?: (text: string, options: string, state: { spaceFactor: number }) => Node[]
  /** booktabs's dimensions, when the document loads it (set in the font of its \usepackage) */
  booktabs?: Booktabs
}

/**
 * \begin{tabular}[pos]{cols}: \leavevmode\hbox{$\vcenter (\vtop for t, \vbox for b){\ialign{\@arstrut
 * template&…\cr rows}}$}, with \baselineskip and \lineskip zero. An \hline is \noalign{\hrule height
 * \arrayrulewidth}, and one right after another adds \vskip\doublerulesep\vskip-\arrayrulewidth.
 */
export function tabularBox(lines: TabLine[], cols: TabCol[], env: TabularEnv, pos: "t" | "b" | "c", to?: number): BoxNode {
  const { list } = tabularList(lines, cols, env, to)
  const box = pos === "t" ? vtop(list) : vpack(list)
  if (pos === "c") { // \vcenter: make_vcenter (§ 736), about the axis
    const delta = box.height + box.depth
    box.height = env.axis + (delta % 2 ? Math.trunc((delta + 1) / 2) : delta / 2)
    box.depth = delta - box.height
  }
  return hpack([{ kind: "math", on: true, width: 0 }, box, { kind: "math", on: false, width: 0 }])
}

/** a longtable chunk's \halign (longtable.ts): to \hsize, \LTleft and \LTright the tabskip glue around the columns */
export interface ChunkAlign {
  hsize: number; left: GlueSpec; right: GlueSpec
  /** \LT@save@row, the alignment's last row: in each column \omit and \kern its width (null: \omit alone) */
  save: (number | null)[]
  /** \prevdepth where the chunk's \vbox starts: 0pt after a chunk \LTchunksize ended (\LT@setprevdepth) */
  prevDepth: number | null
}

/**
 * The alignment's vertical list: its rows and what \noalign puts between them. `to` is tabular*'s width; `chunk` a
 * longtable chunk's (its \hline is \LT@hline's two rule rows, a booktabs rule \@BLTrule's row after \nobreak, \\*
 * puts \noalign{\nobreak} after its row); with it, `widths` are the save row's columns, which it leaves out
 */
export function tabularList(lines: TabLine[], cols: TabCol[], env: TabularEnv, to?: number, chunk?: ChunkAlign): { list: Node[]; widths: number[] } {
  const arw = env.arrayrulewidth, half = Math.trunc(arw / 2)
  const strut = (): Node => ({ kind: "rule", width: 0, height: env.strut.height, depth: env.strut.depth }) // \@arstrut
  const items = (xs: TabItem[], st: { spaceFactor: number }): Node[] => xs.flatMap((x): Node[] => {
    if ("rule" in x) { // \@arrayrule (array.sty's: \vline)
      const r: Node = { kind: "rule", width: arw, height: null, depth: null }
      return env.array ? [r] : [glue(-half), r, glue(-half)]
    }
    if ("text" in x) return env.cell(x.text, st)
    if ("tabskip" in x) return []
    return [glue(x.skip === "tabcolsep" ? env.tabcolsep : x.skip === "doublerulesep" ? env.doublerulesep : half)]
  })
  /** an entry's list: its text, or a \multirow and what follows it */
  const content = (text: string, st: { spaceFactor: number }): Node[] => {
    const m = multirow(text)
    if (!m) return env.cell(text, st)
    if (!env.multirow) throw new TabularUnsupported("\\multirow without multirow")
    st.spaceFactor = 1000 // (a box: an @{text} before may have left another)
    return [multirowBox(env, m), ...env.cell(m.rest, st)]
  }
  const unskip = (l: Node[]) => { if (l.at(-1)?.kind === "glue") l.pop() }
  /** \unskip before the last n nodes, the color pops that end the group of a >{decl} with \color's, still open then */
  const unskipUnder = (l: Node[], n: number) => {
    const k = l.length - 1 - n
    if (l.slice(k + 1).every((x) => x.kind === "whatsit" && x.text === "\\special{color pop}") && l[k]?.kind === "glue") l.splice(k, 1)
  }
  /** {\hfil\hskip1sp\ignorespaces entry\unskip\hfil} as the column aligns it, or \@startpbox{width}\ignorespaces
   *  entry\@endpbox (whose \hfil follows the \vtop); `cr` is what \\[skip] puts before \unskip */
  /** the entry after `before` (the cell's list so far: array.sty's \unskip's may reach into it) */
  const entry = (before: Node[], col: TabCol, text: string, cr: Node[], st: { spaceFactor: number }, ended = false): Node[] => {
    const align = col.align
    if (env.array) return arrayEntry(before, col, text, cr, st, ended)
    before.push(...kernelEntry(col, text, cr, st))
    return before
  }
  const kernelEntry = (col: TabCol, text: string, cr: Node[], st: { spaceFactor: number }): Node[] => {
    const align = col.align
    if (align === "p") { st.spaceFactor = 1000; return [env.pbox(text.replace(/^\s+/, ""), col.width!, cr, undefined, env.everyparStrut), filGlue()] } // (a box: the space factor is 1000)
    const l: Node[] = align === "l" ? [] : [filGlue()]
    l.push(glue(1), ...content(text.replace(/^\s+/, ""), st))
    if (cr.length) { unskip(l); l.push(...cr) }
    unskip(l)
    if (align !== "r") l.push(filGlue())
    return l
  }
  /**
   * array.sty's templates: \hskip1sp\d@llarbegin >{decl}\ignorespaces entry\textonly@unskip <{decl}\d@llarend
   * \do@row@strut with \hfil's as the column aligns it; for p, m and b \@startpbox{width}…\@endpbox (its \hfil after
   * the box: before it for m, where \ar@align@mcell lowers a box taller than \strutbox). A \\[skip] has \unskip'd
   * the entry, and \do@row@strut's \vrule depth skip+\dp\@arstrutbox comes in `cr`
   */
  const arrayEntry = (l: Node[], col: TabCol, text: string, cr: Node[], st: { spaceFactor: number }, ended: boolean, ct = false): Node[] => {
    if (col.si !== undefined) { // \hfil\hskip1sp, the entry siunitx collects (it takes \textonly@unskip too), \hfil
      if (!env.si || col.post) throw new TabularUnsupported(`an S column{${col.post ? ` <{${col.post}}` : ""}}`)
      if (multirow(text.replace(/^\s+/, ""))) throw new TabularUnsupported("\\multirow in an S column")
      // (\\[skip] runs while siunitx collects: its \unskip takes the \hskip1sp, \do@row@strut's \vrule follows the entry)
      l.push(filGlue(), ...(cr.length ? [] : [glue(1)]), ...env.si(text, col.si, st), ...cr, filGlue())
      return l
    }
    let pre = col.pre ?? ""
    const post = col.post ?? ""
    const sh = pre.match(/^\s*\\(centering|raggedright|raggedleft)(?![A-Za-z])\s*/)
    let shape: "centering" | "raggedright" | "raggedleft" | null = null
    if (sh) {
      shape = sh[1] as "centering"; pre = pre.slice(sh[0].length)
      // (without \arraybackslash, a \\ ending the row would be \@centercr in the entry's paragraph)
      if (ended && !/^\\arraybackslash(?![A-Za-z])/.test(pre)) throw new TabularUnsupported(`>{\\${shape}} without \\arraybackslash before \\\\`)
    }
    pre = pre.replace(/\\arraybackslash(?![A-Za-z])\s*/g, "")
    // (a \color in >{decl}: its pop where the declarations' group ends, after \textonly@unskip)
    const pops = [...pre.matchAll(/\\color(?![A-Za-z])/g)].length
    if (/\\(?:centering|raggedright|raggedleft)(?![A-Za-z])/.test(pre + post) || shape && !"pmb".includes(col.align)) throw new TabularUnsupported(`>{${col.pre}}`)
    /** the entry's text, then <{decl}'s after \textonly@unskip, and >{decl}'s before, in a group of their own */
    const withDecls = (t: string) => {
      if (post) {
        t = t.replace(/\s+$/, "")
        if (/(?:\\(?:[hv]fil{1,2}|hss|quad|qquad|enspace|enskip|thinspace|hspace\*?\s*\{[^{}]*\}|[ ,;:!>])|~)$/.test(t)) throw new TabularUnsupported(`a <{decl} column's entry "${t.slice(-30)}"`)
        // (after \\[skip], its \unskip and then \textonly@unskip: a second glue would go, one ending a group)
        if (cr.length && "pmb".includes(col.align)) throw new TabularUnsupported("a <{decl} column's entry before \\\\[skip]")
        if (cr.length && /(?:\s|\\(?:[hv]fil{1,2}|hss|quad|qquad|enspace|enskip|thinspace|hspace\*?\s*\{[^{}]*\}|[ ,;:!>])|~)\}+$/.test(t)) throw new TabularUnsupported(`a <{decl} column's entry "${t.slice(-30)}" before \\\\[skip]`)
        // (\textonly@unskip between: no ligature or kern across, and \check@icr sees no . or ,; in a formula that >{$}
        // opened, nothing: {} there would be an atom)
        t = /\$/.test(pre) ? cat(t, post) : `${t}{}${post}`
      }
      // (the entry is a group already: the declarations in one of their own)
      return pre || post ? `{${cat(pre, t)}}` : t
    }
    if (col.box) {
      // array.sty's w and W: \hfil\hskip1sp, then \begin{lrbox}\ar@cellbox … \ignorespaces entry\textonly@unskip
      // <{decl}'s \end{lrbox} (\unskip) and \makebox[width][align]{\unhbox\ar@cellbox}: an \hbox to the width with
      // \hss's as bm@<align> puts them (W's are \hfil's), then \hfil. A \\[skip]'s \unskip is in the box (before
      // \textonly@unskip), \do@row@strut's \vrule after it
      if (multirow(text.replace(/^\s+/, ""))) throw new TabularUnsupported("\\multirow in a w column")
      const inner = env.cell(withDecls(text.replace(/^\s+/, "")), st)
      if (!post) { unskipUnder(inner, pops); if (cr.length) unskipUnder(inner, pops) } // (\textonly@unskip in the declarations' group)
      unskip(inner)
      const a = col.box.align, ss = (): Node => col.box!.W ? filGlue() : ssGlue()
      // (lrbox's \color@setgroup: with a color package, the color pushed and popped around the entry)
      const box = hpack([..."crb".includes(a) ? [ss()] : [], ...(xcolor.on ? [colorPush(env.color ?? xcolor.normal), ...inner, colorPop()] : inner), ..."clt".includes(a) ? [ss()] : []], { exactly: env.glue(col.box.width).width })
      st.spaceFactor = 1000
      l.push(filGlue(), glue(1), box, ...cr, filGlue())
      return l
    }
    // a \multirow after >{decl}: its text in the declarations' font
    const mr = (pre || post) && "lcr".includes(col.align) ? multirow(text.replace(/^\s+/, "")) : null
    if (mr) {
      if (!env.multirow) throw new TabularUnsupported("\\multirow without multirow")
      if (/\$/.test(pre)) throw new TabularUnsupported(`\\multirow after >{${col.pre}}`)
      // (after a size, \strut is that size's \strutbox)
      const size = [...pre.matchAll(new RegExp(`\\\\(${SIZE_COMMANDS.join("|")})(?![A-Za-z])`, "g"))].at(-1)?.[1]
      if (col.align !== "l") l.push(filGlue())
      l.push(glue(1), multirowBox(env, { ...mr, text: pre ? `{${cat(pre, mr.text)}}` : mr.text }, size ? env.array!.strutOf(size as SizeCommand) : undefined))
      st.spaceFactor = 1000
      const rest = withDecls(mr.rest)
      if (rest) l.push(...env.cell(rest, st))
      if (!post) { unskip(l); if (cr.length) unskip(l) }
      l.push(...cr)
      if (col.align !== "r") l.push(filGlue())
      return l
    }
    // a size in >{decl} of a p, m or b column: \insert@pcolumn puts the declarations in no group of their own, so it is
    // still in force at the paragraph's end (its \baselineskip); with font declarations only, the whole entry is in it
    const sizeRe = new RegExp(`\\\\(${SIZE_COMMANDS.join("|")})(?![A-Za-z])\\s*`, "g"), hasSize = (t: string) => t.search(sizeRe) >= 0
    let boxSize: SizeCommand | undefined
    if ("pmb".includes(col.align) && hasSize(pre + post)) {
      const rest = pre.replace(sizeRe, "")
      if (hasSize(post) || !/^(?:\s*\\(?:bfseries|mdseries|itshape|slshape|scshape|upshape|rmfamily|sffamily|ttfamily|normalfont)(?![A-Za-z]))*\s*$/.test(rest)) throw new TabularUnsupported(`>{${col.pre}} on a ${col.align} column`)
      boxSize = [...pre.matchAll(sizeRe)].at(-1)![1] as SizeCommand
      pre = rest
    }
    const body = withDecls(text.replace(/^\s+/, ""))
    if (col.align === "p" || col.align === "m" || col.align === "b") {
      st.spaceFactor = 1000 // (a box)
      const box = env.pbox(body, col.width!, [], { kind: col.align, shape, ...(boxSize ? { size: boxSize } : {}) })
      if (col.align !== "m") { l.push(box, filGlue(), ...cr); return l }
      if (box.height > env.array!.strutbox.height) box.shift = Math.trunc((box.height - env.strut.height) / 2) // (\baselineskip is zero there)
      l.push(filGlue(), box, ...cr)
      return l
    }
    // (colortbl's: \hskip\stretch{.5}\kern\z@ or \hfill\kern\z@ first, in a box of its own, and no \hskip1sp)
    if (ct) { if (col.align !== "l") l.push(col.align === "c" ? glue(0, 32768, FILL) : fillGlue(), kern(0, true)) }
    else if (col.align !== "l") l.push(filGlue())
    // (an empty entry: \textonly@unskip takes the \hskip1sp, before the <{decl})
    const empty = post && !text.trim()
    if (empty && content(`{${pre}}`, { ...st }).length) throw new TabularUnsupported(`>{${col.pre}} with an empty entry`)
    // (after \\[skip], whose \unskip took the \hskip1sp, a glue before it)
    if (ct) { /* (nothing before the entry for \unskip to take) */ }
    else if (!empty) l.push(glue(1))
    else if (cr.length) unskip(l)
    l.push(...content(body, st))
    if (!post) { unskipUnder(l, pops); if (cr.length) unskipUnder(l, pops) } // (in the declarations' group)
    l.push(...cr)
    if (ct) { if (col.align !== "r") l.push(col.align === "c" ? glue(0, 32768, FILL) : fillGlue()) }
    else if (col.align !== "r") l.push(filGlue())
    return l
  }
  /**
   * colortbl's column template (its \@classz): \setbox\z@\hbox{the entry, aligned with \hskip\stretch{.5}\kern\z@ (c),
   * \hfill (l) or \hfill\kern\z@ (r) and no \hskip1sp; p, m and b as array.sty's}, then in a group the column's, the
   * row's and the cell's \color (each a push) and, with one, \CT@@do@color: \kern-\tabcolsep \leaders\vrule (0.4pt wide)
   * \hskip(\wd\z@ + 2\tabcolsep)\@plus1fill \kern-\tabcolsep \hskip-\wd\z@\@plus-1fill; then \vrule height
   * \ht\z@ width0pt and \unhbox\z@. \cellcolor in the entry sets the cell's (\gdef; it typesets nothing)
   */
  const ctCell = (before: Node[], col: TabCol, text: string, cr: Node[], st: { spaceFactor: number }, ended = false): Node[] => {
    let cell: CtColor | null = null
    text = text.replace(/\\cellcolor(?![A-Za-z])\s*(?:\[([^\]]*)\])?\s*\{([^{}]*)\}/g, (_, model: string | undefined, spec: string) => { cell = { spec: spec.trim(), ...(model !== undefined ? { model: model.trim() } : {}) }; return "{}" })
    if (col.si !== undefined || col.box || (col.pre || col.post) && multirow(text.replace(/^\s+/, ""))) throw new TabularUnsupported("an S or w column, or a \\multirow after >{decl}, with colortbl")
    return ctWrap(before, arrayEntry([], col, text, cr, st, ended, true), [col.color, rowColor, cell])
  }
  const ctWrap = (before: Node[], box0: Node[], cs: (CtColor | null | undefined)[]): Node[] => {
    const colors = cs.filter((c): c is CtColor => !!c).map((c) => ct!.color(c))
    const b = hpack(box0.slice()), sep = env.tabcolsep
    const out = [...before]
    if (colors.length) out.push(...colors.map((c) => colorPush(c)), kern(-sep, true), { ...glue(b.width + 2 * sep, 65536, FILL), leaders: { kind: "leaders", box: { kind: "rule", width: 26214, height: null, depth: null } } }, kern(-sep, true), glue(-b.width, -65536, FILL), ...colors.map(() => colorPop()))
    out.push({ kind: "rule", width: 0, height: b.height, depth: null }, ...box0)
    return out
  }
  const rows: AlignCell[][] = []
  const vlist: ({ row: number } | Node)[] = []
  // booktabs: \@lastruleclass (0 after a row; 1 after a rule; 2 after \specialrule or \addlinespace) and \@belowrulesep
  let lastClass = 0, belowSep = 0
  /** \@BTendrule: the class the next token makes, and the space below unless a rule of class 1 follows */
  const endRule = (cls: number, li: number) => {
    const next = lines[li + 1]
    lastClass = isBooktabs(next) && !("morecmid" in next) ? cls : 0
    if (lastClass !== 1) vlist.push(glue(belowSep))
  }
  const ruleRow = (w: number): AlignCell[] => [{ nodes: [{ ...fillGlue(), leaders: { kind: "leaders", box: { kind: "rule", width: null, height: w, depth: 0 } } }], span: cols.length }]
  let gobbled = -1
  // colortbl: \CT@row@color for the row to come, reset at each \cr (\everycr), or with \rowcolors in force set by
  // \@rowc@lors there from \rownum; \rowcolor sets it for its row
  const ct = env.colortbl
  let rowColor: CtColor | null = null
  const everycr = () => {
    const rc = ct?.rows
    if (!rc) { rowColor = null; return }
    rc.num.n++
    const c = rc.num.n < rc.start ? "" : rc.num.n % 2 ? rc.odd : rc.even
    rowColor = c ? { spec: c } : null
  }
  if (ct) everycr() // (after the preamble's \cr)
  lines.forEach((line, li) => {
    if (li === gobbled) return
    if ("rowcolor" in line) { if (!ct) throw new TabularUnsupported("\\rowcolor without colortbl"); rowColor = line.rowcolor; return }
    if (isBooktabs(line)) {
      const bt = env.booktabs
      if (!bt) throw new TabularUnsupported("booktabs rules without \\usepackage{booktabs}")
      if ("morecmid" in line) return // \noalign{\relax}
      if ("addspace" in line) { belowSep = line.addspace === null ? bt.defaultaddspace : env.skip(line.addspace); endRule(2, li); return }
      if ("cmid" in line) { // \multispan(a-1)&\multispan(b-a+1) \unskip\hskip kern {\leaders\hrule\hfill\kern\z@}\hskip kern \cr
        const [a, b] = line.cmid
        if (b > cols.length) throw new TabularUnsupported(`\\cmidrule{${a}-${b}} in ${cols.length} columns`)
        const w = line.width === undefined ? bt.cmidrulewidth : env.skip(line.width)
        if (lastClass === 0) vlist.push(glue(bt.aboverulesep))
        const r: AlignCell[] = a > 1 ? [{ nodes: [], span: a - 1 }] : []
        r.push({ nodes: [glue(line.trim.includes("l") ? bt.cmidrulekern : 0), { ...fillGlue(), leaders: { kind: "leaders", box: { kind: "rule", width: null, height: w, depth: 0 } } }, kern(0, true), glue(line.trim.includes("r") ? bt.cmidrulekern : 0)], span: b - a + 1 })
        vlist.push({ row: rows.length }); rows.push(r)
        everycr()
        const next = lines[li + 1] // \@xcmidrule
        if (next && "cmid" in next) { vlist.push(glue(-w)); lastClass = 1 }
        else if (next && "morecmid" in next) { vlist.push(glue(bt.cmidrulesep)); lastClass = 1 }
        else { vlist.push(glue(bt.belowrulesep)); lastClass = 0 }
        return
      }
      // \toprule, \midrule, \bottomrule (class 1) and \specialrule (class 2): \@BTrule, \hrule, \@BTendrule
      const special = "special" in line
      const cls = special ? 2 : 1
      const above = special ? env.skip(line.special[1]) : line.btrule === "top" ? bt.abovetopsep : bt.aboverulesep
      belowSep = special ? env.skip(line.special[2]) : line.btrule === "bottom" ? bt.belowbottomsep : bt.belowrulesep
      const w = special ? env.skip(line.special[0]) : line.width !== undefined ? env.skip(line.width) : line.btrule === "mid" ? bt.lightrulewidth : bt.heavyrulewidth
      if (chunk) vlist.push(penalty(10000)) // (in a longtable: \nobreak)
      if (cls === 2 || lastClass === 0) vlist.push(glue(above))
      else if (lastClass === 1) vlist.push(glue(env.doublerulesep))
      // (in a longtable, \@BLTrule: \@cmidruleb across every column, \multispan\LT@cols \unskip\hskip0pt
      // {\leaders\hrule\hfill\kern\z@}\hskip0pt\cr)
      if (chunk) { vlist.push({ row: rows.length }); rows.push([{ nodes: [glue(0), { ...fillGlue(), leaders: { kind: "leaders", box: { kind: "rule", width: null, height: w, depth: 0 } } }, kern(0, true), glue(0)], span: cols.length }]); everycr() }
      else vlist.push({ kind: "rule", width: null, height: w, depth: 0 })
      endRule(cls, li)
      return
    }
    lastClass = 0
    if ("hline" in line && chunk) {
      // \LT@hline: \noalign{\penalty\@M}, a row of \leaders\hrule across the columns, \noalign{\penalty-\@lowpenalty
      // \vskip-\arrayrulewidth} (for \hline\hline, which takes the second: \penalty-\@medpenalty\vskip\doublerulesep),
      // the row again, \noalign{\penalty\@M}
      // (colortbl's \LT@@hline looks for the second \hline in \LT@next, which longtable no longer sets: never doubled)
      const twice = !ct && "hline" in (lines[li + 1] ?? {})
      if (twice) gobbled = li + 1
      vlist.push(penalty(10000), { row: rows.length }, ...twice ? [penalty(-151), glue(env.doublerulesep)] : [penalty(-51), glue(-arw)], { row: rows.length + 1 }, penalty(10000))
      rows.push(ruleRow(arw), ruleRow(arw))
      everycr(); everycr()
      return
    }
    if ("hline" in line) {
      // (fin_align gives the rule the alignment's width, § 806)
      if (li > 0 && "hline" in lines[li - 1]) vlist.push(glue(env.doublerulesep), ...(env.array ? [] : [glue(-arw)])) // (array.sty's \@xhline: no \vskip-\arrayrulewidth)
      vlist.push({ kind: "rule", width: null, height: arw, depth: 0 })
      return
    }
    if ("cline" in line) { // \omit, \span\omit… for the columns before, then \leaders\hrule\hfill across a…b, \noalign{\vskip-\arrayrulewidth}
      const [a, b] = line.cline
      if (b > cols.length) throw new TabularUnsupported(`\\cline{${a}-${b}} in ${cols.length} columns`)
      const r: AlignCell[] = a > 1 ? [{ nodes: [], span: a - 1 }] : []
      r.push({ nodes: [{ ...fillGlue(), leaders: { kind: "leaders", box: { kind: "rule", width: null, height: arw, depth: 0 } } }], span: b - a + 1 })
      vlist.push({ row: rows.length }); rows.push(r)
      everycr()
      vlist.push(glue(-arw))
      return
    }
    // \\[skip]: a positive one is \unskip\vrule height0pt depth skip+\dp\@arstrutbox width0pt at the row's end; any other \noalign{\vskip skip}
    const skip = typeof line.skip === "string" ? env.skip(line.skip) : line.skip
    // (array.sty's \vrule has no height: running)
    const cr: Node[] = skip !== undefined && skip > 0 ? [{ kind: "rule", width: 0, height: env.array ? null : 0, depth: skip + env.strut.depth }] : []
    let j = 0
    const r = line.cells.map((c, ci): AlignCell => {
      const last = ci === line.cells.length - 1
      const st = { spaceFactor: 1000 } // init_span (§ 787): each cell's list starts with the space factor 1000
      if (j >= cols.length) throw new TabularUnsupported("more cells than columns")
      if ("span" in c) { // \multicolumn: \multispan{n}, then \@arstrut, its own preamble's one template around the text, \hbox{}
        const own = preamble(c.spec, env.array)
        if (own.length !== 1 || c.span < 1) throw new TabularUnsupported(`\\multicolumn{${c.span}}{${c.spec}}`)
        if (j + c.span > cols.length) throw new TabularUnsupported("a \\multicolumn past the last column")
        // (longtable's \caption: \hfil\hskip1sp, the material made already, \hfil around a c column's)
        if (c.nodes && (own[0].align !== "c" || own[0].pre || own[0].post)) throw new TabularUnsupported("a \\caption's \\multicolumn")
        const nodes = c.nodes && ct ? [...ctWrap([strut(), ...items(own[0].u, st)], [glue(0, 32768, FILL), kern(0, true), ...c.nodes, glue(0, 32768, FILL)], [own[0].color, rowColor]), ...items(own[0].v, st), emptyBox("hlist", 0), ...c.after ?? []]
          : c.nodes ? [strut(), ...items(own[0].u, st), filGlue(), glue(1), ...c.nodes, filGlue(), ...items(own[0].v, st), emptyBox("hlist", 0), ...c.after ?? []]
          : ct ? [...ctCell([strut(), ...items(own[0].u, st)], own[0], c.text, [], st), ...items(own[0].v, st), emptyBox("hlist", 0)]
          : [...entry([strut(), ...items(own[0].u, st)], own[0], c.text, [], st), ...items(own[0].v, st), emptyBox("hlist", 0)]
        if (last && cr.length) { unskip(nodes); nodes.push(...cr) }
        j += c.span
        return { nodes, span: c.span }
      }
      const col = cols[j++]
      const before = [...(j === 1 ? [strut()] : []), ...items(col.u, st)]
      return { nodes: [...(ct ? ctCell(before, col, c.text, last ? cr : [], st, last && !!line.ended) : entry(before, col, c.text, last ? cr : [], st, last && !!line.ended)), ...items(col.v, st)], span: 1 }
    })
    vlist.push({ row: rows.length }); rows.push(r)
    everycr() // (\\, or for a last row with none, \endtabular's \crcr)
    if (skip !== undefined && skip <= 0) vlist.push(glue(skip))
    if (line.star && chunk) vlist.push(penalty(10000)) // (longtable's \\*: \noalign{\nobreak})
  })
  // the tabskip glue: zero before the first column (\ialign's \tabskip\z@skip), after each one the \tabskip its
  // templates left (an \extracolsep), zero after the last (\tabskip\z@skip before the preamble's \cr); in a longtable
  // \LTleft before the first (\tabskip\z@ starts its template) and \LTright after the last
  const tab = (g: GlueSpec) => paramGlue("tabskip", glue(g.width, g.stretch, g.stretchOrder, g.shrink, g.shrinkOrder))
  let skip: GlueSpec = { width: 0, stretch: 0, stretchOrder: 0, shrink: 0, shrinkOrder: 0 }
  const tabskip = [chunk ? tab(chunk.left) : paramGlue("tabskip", glue(0))]
  for (const c of cols) {
    for (const x of [...c.u, ...c.v]) if ("tabskip" in x) skip = env.glue(x.tabskip)
    tabskip.push(tab(skip))
  }
  tabskip[cols.length] = chunk ? tab(chunk.right) : paramGlue("tabskip", glue(0))
  if (chunk) rows.push(chunk.save.map((w) => ({ nodes: w === null ? [] : [kern(w, true)], span: 1 }))) // (\LT@entry: \omit\kern width)
  // (tabular*: \halign to its width; a longtable chunk's to \hsize)
  const rowBoxes = halignSpans(rows, tabskip, chunk ? { exactly: chunk.hsize } : to === undefined ? { additional: 0 } : { exactly: to })
  const width = rowBoxes[0]?.width ?? 0
  const list: Node[] = []
  let pd: number | null = chunk ? chunk.prevDepth : null
  const zero: GlueSpec = { width: 0, stretch: 0, stretchOrder: 0, shrink: 0, shrinkOrder: 0 }
  for (const x of vlist) {
    if ("row" in x) { pd = appendToVlist(list, rowBoxes[x.row], pd, zero, zero, env.lineskiplimit); continue }
    if (x.kind === "rule") { list.push({ ...x, width }); pd = null } // a rule leaves \prevdepth at -1000pt
    else list.push(x)
  }
  // the save row's columns (\LT@get@widths); \lastbox takes it and \unskip its interline glue (with none, the glue before)
  const widths = chunk ? rowBoxes[rowBoxes.length - 1].list.flatMap((n) => (n.kind === "hlist" ? [n.width] : [])) : []
  if (chunk && pd === null && list.at(-1)?.kind === "glue") list.pop()
  return { list, widths }
}
