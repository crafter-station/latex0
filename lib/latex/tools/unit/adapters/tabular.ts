// The kernel's tabular (latex.ltx \@tabular, \@array, \@mkpream, \multicolumn, \hline, \cline): the column
// preamble as \@mkpream builds it, the body's rows and rules, and the \halign they make.

import { halignSpans, type AlignCell } from "../../../layout/align"
import { emptyBox, FIL, FILL, glue, paramGlue, type BoxNode, type Node } from "../../../layout/nodes"
import { hpack, vpack } from "../../../layout/pack"
import type { GlueSpec } from "../../../layout/dimen"
import { appendToVlist } from "./paragraph"

export class TabularUnsupported extends Error {}

/** what a preamble puts around a column's entry: a rule (|), a skip, or @-text */
export type TabItem = { rule: true } | { skip: "tabcolsep" | "doublerulesep" | "halfrule" } | { text: string }
/** a column's template: u, the entry aligned l, c or r, v */
export interface TabCol { align: "l" | "c" | "r"; u: TabItem[]; v: TabItem[] }

/** the spec's tokens: characters and the contents of braced groups (\@tfor), after \@expast's *{n}{cols} */
function specTokens(spec: string): string[] {
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
  for (let star = s.indexOf("*"); star >= 0; star = s.indexOf("*")) {
    const [n, a] = read(s, star + 1), [cols, b] = read(s, a)
    if (!/^\s*\d+\s*$/.test(n)) throw new TabularUnsupported(`tabular columns {${spec}}`)
    s = s.slice(0, star) + cols.repeat(Number(n)) + s.slice(b)
  }
  for (let i = 0; i < s.length;) {
    if (/\s/.test(s[i])) { i++; continue }
    const [t, j] = read(s, i)
    toks.push(s[i] === "{" ? `{${t}` : t) // (a group keeps a mark)
    i = j
  }
  return toks
}

/** \@mkpream with \@tabclassz: the columns' templates */
export function preamble(spec: string): TabCol[] {
  const flat: (TabItem | "&" | { align: "l" | "c" | "r" })[] = []
  let last = 6, firstAmp = true
  const acol = () => flat.push({ skip: "tabcolsep" })
  const amp = () => { if (firstAmp) firstAmp = false; else flat.push("&") }
  const rule = () => flat.push({ rule: true })
  for (const t of specTokens(spec)) {
    const ch = last === 2 ? 4 : last === 3 ? 5 : t === "l" || t === "c" || t === "r" ? 0 : t === "|" ? 1 : t === "@" ? 2 : t === "p" ? 3 : -1
    if (ch < 0 || ch === 3 || ch === 5) throw new TabularUnsupported(`tabular column ${t.replace(/^\{/, "")} in {${spec}}`)
    if (ch === 0) {
      if (last === 0 || last === 5) { acol(); amp(); acol() } else if (last === 1) { amp(); acol() } else if (last === 4) amp(); else { firstAmp = false; acol() }
      flat.push({ align: t as "l" })
    } else if (ch === 1) {
      if (last === 0 || last === 5) acol(); else if (last === 1) flat.push({ skip: "doublerulesep" })
      rule()
    } else if (ch === 2) { if (last === 1) flat.push({ skip: "halfrule" }) }
    else flat.push({ text: t.replace(/^\{/, "") })
    last = ch
  }
  if (last === 0 || last === 5) acol()
  else if (last === 2 || last === 3) throw new TabularUnsupported(`tabular columns {${spec}}`)
  const cols: TabCol[] = []
  let cur: { align?: "l" | "c" | "r"; u: TabItem[]; v: TabItem[] } = { u: [], v: [] }
  for (const x of [...flat, "&" as const]) {
    if (x === "&") {
      if (!cur.align) throw new TabularUnsupported(`tabular columns {${spec}}`)
      cols.push(cur as TabCol); cur = { u: [], v: [] }
    } else if ("align" in x) { if (cur.align) throw new TabularUnsupported(`tabular columns {${spec}}`); cur.align = x.align }
    else (cur.align ? cur.v : cur.u).push(x)
  }
  return cols
}

/** a cell as typed: its text, or a \multicolumn */
export type TabCell = { text: string } | { span: number; spec: string; text: string }
/** a row (and the [skip] of the \\ ending it), an \hline, or a \cline{a-b} */
export type TabLine = { cells: TabCell[]; skip?: string | number } | { hline: true } | { cline: [number, number] }

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
      break
    }
    if (!rest) break
    const end = upTo(rest, 0, "\\\\")
    const row = end < 0 ? rest : rest.slice(0, end)
    rest = end < 0 ? "" : rest.slice(end + 2)
    // \\* and \\[skip] (\@tabularcr)
    let skip: string | undefined
    const opt = rest.match(/^\*?\s*(?:\[([^\]]*)\])?/)!
    if (opt[1] !== undefined) skip = opt[1]
    rest = rest.slice(opt[0].length).trim()
    if (/\\(?:hline|cline)(?![A-Za-z])/.test(row)) throw new TabularUnsupported("\\hline or \\cline inside a row")
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
    lines.push({ cells, ...(skip !== undefined ? { skip } : {}) })
  }
  return lines
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
  /** a \\[skip]'s dimension */
  skip(text: string): number
}

/**
 * \begin{tabular}[pos]{cols}: \leavevmode\hbox{$\vcenter (\vtop for t, \vbox for b){\ialign{\@arstrut
 * template&…\cr rows}}$}, with \baselineskip and \lineskip zero. An \hline is \noalign{\hrule height
 * \arrayrulewidth}, and one right after another adds \vskip\doublerulesep\vskip-\arrayrulewidth.
 */
export function tabularBox(lines: TabLine[], cols: TabCol[], env: TabularEnv, pos: "t" | "b" | "c"): BoxNode {
  const arw = env.arrayrulewidth, half = Math.trunc(arw / 2)
  const strut = (): Node => ({ kind: "rule", width: 0, height: env.strut.height, depth: env.strut.depth }) // \@arstrut
  const items = (xs: TabItem[], st: { spaceFactor: number }): Node[] => xs.flatMap((x): Node[] => {
    if ("rule" in x) return [glue(-half), { kind: "rule", width: arw, height: null, depth: null }, glue(-half)] // \@arrayrule
    if ("text" in x) return env.cell(x.text, st)
    return [glue(x.skip === "tabcolsep" ? env.tabcolsep : x.skip === "doublerulesep" ? env.doublerulesep : half)]
  })
  const unskip = (l: Node[]) => { if (l.at(-1)?.kind === "glue") l.pop() }
  const hfil = () => glue(0, 65536, FIL)
  /** {\hfil\hskip1sp\ignorespaces entry\unskip\hfil} as the column aligns it; `cr` is what \\[skip] puts before \unskip */
  const entry = (align: "l" | "c" | "r", text: string, cr: Node[], st: { spaceFactor: number }): Node[] => {
    const l: Node[] = align === "l" ? [] : [hfil()]
    l.push(glue(1), ...env.cell(text.replace(/^\s+/, ""), st))
    if (cr.length) { unskip(l); l.push(...cr) }
    unskip(l)
    if (align !== "r") l.push(hfil())
    return l
  }
  const rows: AlignCell[][] = []
  const vlist: ({ row: number } | Node)[] = []
  lines.forEach((line, li) => {
    if ("hline" in line) {
      // (fin_align gives the rule the alignment's width, § 806)
      if (li > 0 && "hline" in lines[li - 1]) vlist.push(glue(env.doublerulesep), glue(-arw))
      vlist.push({ kind: "rule", width: null, height: arw, depth: 0 })
      return
    }
    if ("cline" in line) { // \omit, \span\omit… for the columns before, then \leaders\hrule\hfill across a…b, \noalign{\vskip-\arrayrulewidth}
      const [a, b] = line.cline
      if (b > cols.length) throw new TabularUnsupported(`\\cline{${a}-${b}} in ${cols.length} columns`)
      const r: AlignCell[] = a > 1 ? [{ nodes: [], span: a - 1 }] : []
      r.push({ nodes: [{ ...glue(0, 65536, FILL), leaders: { kind: "leaders", box: { kind: "rule", width: null, height: arw, depth: 0 } } }], span: b - a + 1 })
      vlist.push({ row: rows.length }); rows.push(r)
      vlist.push(glue(-arw))
      return
    }
    // \\[skip]: a positive one is \unskip\vrule height0pt depth skip+\dp\@arstrutbox width0pt at the row's end; any other \noalign{\vskip skip}
    const skip = typeof line.skip === "string" ? env.skip(line.skip) : line.skip
    const cr: Node[] = skip !== undefined && skip > 0 ? [{ kind: "rule", width: 0, height: 0, depth: skip + env.strut.depth }] : []
    let j = 0
    const r = line.cells.map((c, ci): AlignCell => {
      const last = ci === line.cells.length - 1
      const st = { spaceFactor: 1000 } // init_span (§ 787): each cell's list starts with the space factor 1000
      if (j >= cols.length) throw new TabularUnsupported("more cells than columns")
      if ("span" in c) { // \multicolumn: \multispan{n}, then \@arstrut, its own preamble's one template around the text, \hbox{}
        const own = preamble(c.spec)
        if (own.length !== 1 || c.span < 1) throw new TabularUnsupported(`\\multicolumn{${c.span}}{${c.spec}}`)
        if (j + c.span > cols.length) throw new TabularUnsupported("a \\multicolumn past the last column")
        const nodes = [strut(), ...items(own[0].u, st), ...entry(own[0].align, c.text, [], st), ...items(own[0].v, st), emptyBox("hlist", 0)]
        if (last && cr.length) { unskip(nodes); nodes.push(...cr) }
        j += c.span
        return { nodes, span: c.span }
      }
      const col = cols[j++]
      return { nodes: [...(j === 1 ? [strut()] : []), ...items(col.u, st), ...entry(col.align, c.text, last ? cr : [], st), ...items(col.v, st)], span: 1 }
    })
    vlist.push({ row: rows.length }); rows.push(r)
    if (skip !== undefined && skip <= 0) vlist.push(glue(skip))
  })
  const tabskip = Array.from({ length: cols.length + 1 }, () => paramGlue("tabskip", glue(0)))
  const rowBoxes = halignSpans(rows, tabskip, { additional: 0 })
  const width = rowBoxes[0]?.width ?? 0
  const list: Node[] = []
  let pd: number | null = null
  const zero: GlueSpec = { width: 0, stretch: 0, stretchOrder: 0, shrink: 0, shrinkOrder: 0 }
  for (const x of vlist) {
    if ("row" in x) { pd = appendToVlist(list, rowBoxes[x.row], pd, zero, zero, env.lineskiplimit); continue }
    if (x.kind === "rule") { list.push({ ...x, width }); pd = null } // a rule leaves \prevdepth at -1000pt
    else list.push(x)
  }
  const box = vpack(list)
  if (pos === "t") { // \vtop (§ 1087)
    const first = list[0]
    const h = first && (first.kind === "hlist" || first.kind === "vlist" || first.kind === "rule") ? first.height ?? 0 : 0
    box.depth = box.depth - h + box.height; box.height = h
  } else if (pos === "c") { // \vcenter: make_vcenter (§ 736), about the axis
    const delta = box.height + box.depth
    box.height = env.axis + (delta % 2 ? Math.trunc((delta + 1) / 2) : delta / 2)
    box.depth = delta - box.height
  }
  return hpack([{ kind: "math", on: true, width: 0 }, box, { kind: "math", on: false, width: 0 }])
}
