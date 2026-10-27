// Vertical mode with declarations in force: the body of a titlepage, and a group that holds whole paragraphs
// ({\large … \par}). Declarations (\bfseries, \large, \centering …) last to the end of the group or environment
// they are in; a paragraph starts in the font and size in force where it starts, and its \par uses the
// \baselineskip, \leftskip, \rightskip and \parfillskip in force where it ends. Between paragraphs: \vspace,
// \vspace*, \vfill, \bigskip, \medskip, \smallskip and \null; \\ under \centering and friends is \@centercr.

import { SIZE_COMMANDS, type SizeCommand } from "../layout/classdata"
import { parseGlue, type GlueSpec } from "../layout/dimen"
import { QUAD, X_HEIGHT } from "../layout/font"
import { lineBreak } from "../layout/linebreak"
import { emptyBox, filGlue, FILL, penalty, type Node } from "../layout/nodes"
import { hpack } from "../layout/pack"
import { displaySegments } from "./blocks"
import type { Ctx } from "./context"
import { centering, raggedleft, raggedright } from "./kernel"
import { BODY_DECLARATIONS, closingBrace, fontDeclaration, paragraphInput, selectFont, SKIP_AMOUNTS, type FontAttrs } from "./paragraph"
import { groupStart } from "./source"
import { leadingColor } from "./colors"
import { Unsupported } from "./unsupported"
import { dimen, negate } from "./vlist"
import type { OutputHook } from "./output"
import { clearpage, newpage } from "./sectioning"

export const ALIGNMENTS = ["centering", "raggedright", "raggedleft"] as const
type Alignment = typeof ALIGNMENTS[number] | null
/** what declarations set: the size, the font's attributes, and \centering, \raggedright or \raggedleft */
export interface DeclState { size: SizeCommand; attrs: FontAttrs; align: Alignment }

const isSize = (name: string) => (SIZE_COMMANDS as readonly string[]).includes(name)
export const isDeclaration = (name: string) => BODY_DECLARATIONS.includes(name) || isSize(name) || (ALIGNMENTS as readonly string[]).includes(name)

/** a declaration's effect */
export function declare(cx: Ctx, st: DeclState, name: string): DeclState {
  if (isSize(name)) return { ...st, size: name as SizeCommand }
  if ((ALIGNMENTS as readonly string[]).includes(name)) return { ...st, align: name as Alignment }
  return { ...st, attrs: fontDeclaration(name, st.attrs, cx.run.k, st.size, cx.doc, selectFont(cx.run.k, st.size, st.attrs))! }
}

/** the declarations at the top level of paragraph text (not in a group, a formula or an argument), in order */
export function topDeclarations(text: string): string[] {
  const out: string[] = []
  for (let i = 0; i < text.length; ) {
    if (text[i] === "{") { i = closingBrace(text, i) + 1; continue }
    if (text[i] === "$") { const j = text.indexOf("$", i + 1); if (j < 0) throw new Unsupported("an unbalanced $"); i = j + 1; continue }
    const m = text.slice(i).match(/^\\([A-Za-z]+|[^])/)
    if (m) { if (isDeclaration(m[1])) out.push(m[1]); i += m[0].length; continue }
    i++
  }
  return out
}

/** where `\par` stands at the top level of the text (not in a group), or -1 */
function topPar(text: string, from = 0): number {
  for (let i = from; i < text.length; ) {
    if (text[i] === "{") { i = closingBrace(text, i) + 1; continue }
    if (text[i] === "\\") {
      if (/^\\par(?![A-Za-z])/.test(text.slice(i))) return i
      i += /^\\[A-Za-z]/.test(text.slice(i)) ? text.slice(i).match(/^\\[A-Za-z]+/)![0].length : 2
      continue
    }
    i++
  }
  return -1
}

/** Whether a body paragraph's text needs this mode: a \par, or a skip between paragraphs. */
export const needsVerticalMode = (text: string) => /\\par(?![A-Za-z])|^\s*\\(?:vfill|bigskip|medskip|smallskip|null)(?![A-Za-z])/.test(text)

/**
 * The material of a group or environment in vertical mode. `top`: the body's own level, where a declaration would
 * last past this text (not laid out). A group's \clubpenalty and \everypar settings end with it.
 */
/** `first`: what starts the first paragraph in place of the indent box (\@item's \box\@labels), and the \clubpenalty
 *  its \everypar sets (`club`: \@item's, in place of \@afterheading's) */
export interface MaterialOptions { first?: Node[]; club?: number }

export function verticalMaterial(cx: Ctx, src: string, st: DeclState, top: boolean, mo: MaterialOptions = {}) {
  const { run, v } = cx
  const font = () => selectFont(run.k, st.size, st.attrs)
  const units = () => ({ em: font().params[QUAD], ex: font().params[X_HEIGHT] })
  const skip = (x: string): GlueSpec => { try { return parseGlue(x, units()) } catch { throw new Unsupported(`\\vspace{${x}}`) } }
  let i = 0
  while (i < src.length) {
    const rest = src.slice(i)
    const ws = rest.match(/^(?:\s|\\par(?![A-Za-z]))+/) // (a blank line is \par, which does nothing in vertical mode)
    if (ws) { i += ws[0].length; continue }
    // \@vspace: \vskip skip \vskip\z@skip; \@vspacer first \hrule\@height\z@ \nobreak (and keeps \prevdepth)
    const vs = rest.match(/^\\vspace(?![A-Za-z])\s*(\*?)\s*\{([^{}]*)\}/)
    if (vs) {
      const g = skip(vs[2])
      if (vs[1]) v.nodes.push({ kind: "rule", width: null, height: 0, depth: 0 }, penalty(10000))
      v.vskip(g); v.vskip(dimen(0)); i += vs[0].length; continue
    }
    const sk = rest.match(/^\\(bigskip|medskip|smallskip)(?![A-Za-z])/)
    if (sk) {
      if (cx.pre.cls === "letter" && sk[1] === "medskip") throw new Unsupported("\\medskip in a letter")
      v.vskip(SKIP_AMOUNTS[sk[1]]); v.vskip(dimen(0)); i += sk[0].length; continue
    }
    const vf = rest.match(/^\\vfill(?![A-Za-z])/)
    if (vf) { v.vskip({ width: 0, stretch: 65536, stretchOrder: FILL, shrink: 0, shrinkOrder: 0 }); i += vf[0].length; continue }
    const nl = rest.match(/^\\null(?![A-Za-z])/)
    if (nl) { v.box(hpack([]), run.k.sizes[st.size].baselineskip); i += nl[0].length; continue }
    const decl = rest.match(/^\\([A-Za-z]+)(?![A-Za-z])/)
    if (decl && isDeclaration(decl[1])) {
      if (top) throw new Unsupported(`\\${decl[1]} for the paragraphs after it`)
      st = declare(cx, st, decl[1]); i += decl[0].length; continue
    }
    if (rest[0] === "{" && !rest.startsWith("{}")) {
      const j = closingBrace(src, i), inner = src.slice(i + 1, j)
      const last = topPar(inner)
      if (last >= 0) { // a group in vertical mode that ends its paragraphs in it
        let end = last
        for (let p = last; p >= 0; p = topPar(inner, p + 4)) end = p
        if (!/^\s*$/.test(inner.slice(end + 4))) throw new Unsupported("a paragraph starting in a group that ends after it")
        const saved = { club: v.club, everypar: v.afterheadingEverypar }
        verticalMaterial(cx, inner, { ...st }, false, mo)
        v.club = saved.club; v.afterheadingEverypar = saved.everypar
        i = j + 1; continue
      }
    }
    const np = rest.match(/^\\(newpage|clearpage)(?![A-Za-z])\s*/)
    if (np) { if (np[1] === "newpage") newpage(cx); else clearpage(cx); i += np[0].length; continue }
    if (/^\\(?:begin|end|vskip|label|hrule|\\)(?![A-Za-z])/.test(rest)) throw new Unsupported(`${rest.slice(0, 20)} in vertical mode here`)
    // a paragraph: to a blank line, a \par, \vfill, the end, or \@centercr (\\ under \centering and friends)
    let j = i
    let cr: RegExpMatchArray | null = null
    while (j < src.length) {
      const r = src.slice(j)
      if (r[0] === "{") {
        const k = closingBrace(src, j)
        if (topPar(src.slice(j + 1, k)) >= 0) throw new Unsupported("a paragraph ending in a group it did not start in")
        j = k + 1; continue
      }
      if (r[0] === "$") { const k = src.indexOf("$", j + 1); if (k < 0) throw new Unsupported("an unbalanced $"); j = k + 1; continue }
      if (/^\n[ \t]*\n|^\\(?:par|vfill|newpage|clearpage)(?![A-Za-z])/.test(r)) break // (\newpage's \par)
      if (st.align && (cr = r.match(/^\\\\(\*)?\s*(?:\[([^\]]*)\])?/))) break
      j += r[0] === "\\" ? (r.match(/^\\(?:[A-Za-z]+|[^])/)?.[0].length ?? 1) : 1
    }
    const text = src.slice(i, j)
    if (top && topDeclarations(text).length) throw new Unsupported("a declaration for the paragraphs after it")
    const end = topDeclarations(text).reduce((s, d) => declare(cx, s, d), st)
    if (end.align !== st.align && /\\\\/.test(text)) throw new Unsupported("\\\\ after \\centering in a paragraph")
    paragraph(cx, text, st, end, cr ? 1 : 0, mo)
    delete mo.first
    st = end
    i = j
    if (cr) { // \@centercr: \par, \nobreak for \\*, \addvspace{-\parskip}, \vskip skip for [skip]
      if (cr[1]) v.nodes.push(penalty(10000))
      v.addvspace(negate(cx.outerParskip))
      if (cr[2] !== undefined) v.vskip(skip(cr[2]))
      i += cr[0].length
    }
  }
}

/** a paragraph read from `st` to its \par in `end` */
function paragraph(cx: Ctx, text: string, st: DeclState, end: DeclState, unskip: number, mo: MaterialOptions) {
  const { amsmath } = cx.pre
  const { counted, decisions, doc, outerParskip, run, v } = cx
  if (displaySegments(text).length > 1) throw new Unsupported("a display in a paragraph here")
  let indent = !/^\\noindent(?![A-Za-z])/.test(text)
  if (!indent && mo.first) throw new Unsupported("\\noindent where \\@item's labels go")
  v.par()
  if (v.endpeEverypar) throw new Unsupported("a paragraph after a list here")
  // \@afterheading's \everypar
  if (v.afterheadingEverypar && mo.club === undefined) {
    if (groupStart(text)) throw new Unsupported("a paragraph starting in a group after a heading here")
    if (v.nobreak) { v.nobreak = false; v.club = 10000; if (!v.afterindent) indent = false }
    else { v.club = run.k.ints.clubpenalty; v.afterheadingEverypar = false }
  }
  // (a {\color …} group that starts it: the push on the vertical list, before the paragraph)
  if (/^\{\\color(?![A-Za-z])/.test(text)) text = leadingColor(cx, text)
  const align = end.align === "centering" ? centering() : end.align === "raggedright" ? raggedright() : end.align === "raggedleft" ? raggedleft() : {}
  const start: Node[] = mo.first ?? (indent ? [emptyBox("hlist", st.align ? 0 : run.k.dimens.parindent)] : [])
  const { list, params, notes } = paragraphInput(counted(text, true), run.k, st.size, doc, { start, attrs: st.attrs, groups: true, topDecls: true, centercr: !!st.align, clubPenalty: mo.club ?? v.club, amsmath, ...align, ...(unskip ? { unskip } : {}) })
  const { vlist, trace } = lineBreak(list, params)
  decisions.push(...notes, trace)
  v.paragraph(vlist, outerParskip, run.k.sizes[end.size].baselineskip)
}

/**
 * The titlepage environment (one column): \newpage (\if@nobreak \@nobreakfalse \everypar{}\fi \par \vfil \penalty-\@M),
 * \thispagestyle{empty}, \setcounter{page}\@ne, its material, then \newpage and, one-sided, \setcounter{page}\@ne
 */
export function titlepage(cx: Ctx, body: string) {
  const { run, v } = cx
  if (cx.pre.cls === "letter") throw new Unsupported("titlepage in a letter")
  v.par()
  if (v.endpePar || v.endpeEverypar) throw new Unsupported("titlepage right after a list")
  const hook = (h: OutputHook): Node => ({ kind: "whatsit", text: "", hook: h })
  const saved = { club: v.club, everypar: v.afterheadingEverypar } // (the environment's group)
  if (v.nobreak) { v.nobreak = false; v.afterheadingEverypar = false }
  v.nodes.push(filGlue(), penalty(-10000), hook("empty"), hook("page=1"))
  verticalMaterial(cx, body, { size: "normalsize", attrs: cx.normalAttrs, align: null }, false)
  v.nodes.push(filGlue(), penalty(-10000))
  if (!run.k.ints.twoside) v.nodes.push(hook("page=1"))
  v.club = saved.club; v.afterheadingEverypar = saved.everypar
}
