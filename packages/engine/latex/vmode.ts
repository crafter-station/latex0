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
import { BODY_DECLARATIONS, closingBrace, fontDeclaration, noteSubstitution, paragraphInput, selectFont, SKIP_AMOUNTS, type FontAttrs } from "./paragraph"
import { groupStart, NO_ARGUMENT } from "./source"
import { leadingColor } from "./colors"
import { Unsupported } from "./unsupported"
import { dimen, negate } from "./vlist"
import type { OutputHook } from "./output"
import { clearpage, columnSwitch, newpage } from "./sectioning"
import { getpen } from "./body"

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
  const attrs = fontDeclaration(name, st.attrs, cx.run.k, st.size, cx.doc, selectFont(cx.run.k, st.size, st.attrs))!
  noteSubstitution(cx.run.k, st.size, attrs, cx.doc)
  return { ...st, attrs }
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
export const needsVerticalMode = (text: string) => /\\par(?![A-Za-z])|^\s*\\(?:vfill|bigskip|medskip|smallskip|null)(?![A-Za-z])/.test(text.replace(PARBOX_TEXT, ""))
/** a \parbox's text, whose \par is the box's */
const PARBOX_TEXT = /\\parbox(?:\s*\[[^\]{}]*\])*\s*\{[^{}]*\}\s*\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}/g

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
  let reopened = false // (the paragraph starts in the groups a \\ in them left open)
  while (i < src.length) {
    const rest = src.slice(i)
    // (a blank line is \par, which does nothing in vertical mode, and so does an empty group: what a definition left)
    const ws = rest.match(/^(?:\s|\\par(?![A-Za-z])|\{\})+/)
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
        reopened = false // (its paragraphs start in it, as here)
        verticalMaterial(cx, inner, { ...st }, false, mo)
        outputBaselineskip(cx, st) // (the page builder goes on after the group)
        v.club = saved.club; v.afterheadingEverypar = saved.everypar
        i = j + 1; continue
      }
    }
    // \pagebreak[n] and \nopagebreak[n] in vertical mode: \penalty ∓\@getpen{n}
    const pb = rest.match(/^\\(no)?pagebreak(?![A-Za-z])\s*(?:\[\s*([0-4])\s*\])?/)
    if (pb) { v.nodes.push(penalty((pb[1] ? 1 : -1) * getpen(cx, pb[2] === undefined ? 4 : Number(pb[2])))); i += pb[0].length; continue }
    const np = rest.match(/^\\(newpage|clearpage)(?![A-Za-z])\s*/)
    if (np) { if (np[1] === "newpage") newpage(cx); else clearpage(cx); i += np[0].length; continue }
    if (/^\\(?:begin|end|vskip|label|hrule|\\)(?![A-Za-z])/.test(rest)) throw new Unsupported(`${rest.slice(0, 20)} in vertical mode here`)
    // a paragraph: to a blank line, a \par, \vfill, the end, or \@centercr (\\ under \centering and friends)
    let j = i
    let cr: RegExpMatchArray | null = null
    let ending: { inner: string; next: number } | null = null // a group whose \par ends the paragraph
    let gcr: GroupCr | null = null // a \\ in a group, which ends the paragraph there
    while (j < src.length) {
      const r = src.slice(j)
      if (r[0] === "{") {
        const k = closingBrace(src, j), inner = src.slice(j + 1, k), p = topPar(inner)
        const g = st.align ? groupCr(src, i, j) : null
        if (g && (p < 0 || g.at < j + 1 + p)) { gcr = g; j = g.chain[0].start; break }
        if (p >= 0) { // ({\Large … \par} after text: the paragraph ends in the group, with its declarations in force)
          if (!/^(?:\s|\\par(?![A-Za-z]))*$/.test(inner.slice(p))) throw new Unsupported("a paragraph ending in a group it did not start in")
          ending = { inner: inner.slice(0, p), next: k + 1 }
          break
        }
        j = k + 1; continue
      }
      if (r[0] === "$") { const k = src.indexOf("$", j + 1); if (k < 0) throw new Unsupported("an unbalanced $"); j = k + 1; continue }
      if (/^\n[ \t]*\n|^\\(?:par|vfill|newpage|clearpage)(?![A-Za-z])/.test(r)) break // (\newpage's \par)
      if (st.align && (cr = r.match(/^\\\\(\*)?\s*(?:\[([^\]]*)\])?/))) break
      j += r[0] === "\\" ? (r.match(/^\\(?:[A-Za-z]+|[^])/)?.[0].length ?? 1) : 1
    }
    const before = src.slice(i, j)
    // (a \\ in groups: the paragraph ends in them, the text up to it in each; the next one starts in them again, with
    // the declarations each had before it; a text font command's \check@icr does not come, \nocorr)
    const segs = gcr ? gcr.chain.map((g, n) => ({ ...g, text: src.slice(g.body, gcr!.chain[n + 1]?.start ?? gcr!.at) })) : []
    for (const g of segs) if (g.cmd && !g.text.trim()) throw new Unsupported("\\\\ first in a text font command's argument")
    // (a color's pop comes where its group ends, after the \par)
    if (segs.some((g) => /\\color(?![A-Za-z])/.test(g.text))) throw new Unsupported("\\\\ in a \\color group")
    const text = ending ? `${before}{${ending.inner}}` : gcr ? before + segs.map((g) => `${g.cmd ? `\\${g.cmd}` : ""}{${g.text}`).join("") + segs.map((g) => (g.cmd ? "\\nocorr}" : "}")).join("") : before
    if (top && topDeclarations(text).length) throw new Unsupported("a declaration for the paragraphs after it")
    const end = topDeclarations(before).reduce((s, d) => declare(cx, s, d), st)
    const parEnd = [ending?.inner ?? "", ...segs.map((g) => g.text)].reduce((e, t) => topDeclarations(t).reduce((s, d) => declare(cx, s, d), e), end)
    if (parEnd.align !== st.align && /\\\\/.test(text)) throw new Unsupported("\\\\ after \\centering in a paragraph")
    // (one that starts in the groups and ends in the outermost again: another \\ in it)
    paragraph(cx, text, st, parEnd, cr || gcr ? 1 : 0, mo, reopened ? (gcr?.chain[0].start === 0 ? "open" : "closed") : undefined)
    delete mo.first
    reopened = false
    st = end
    i = ending ? ending.next : j
    if (gcr) { // \@centercr in the groups; the text after it (\ignorespaces) in them again
      if (gcr.star) v.nodes.push(penalty(10000))
      v.addvspace(negate(cx.outerParskip))
      if (gcr.skip !== undefined) { const outer = st; st = parEnd; v.vskip(skip(gcr.skip)); st = outer }
      // (groups that end right after it end in vertical mode: the paragraph starts after them)
      let open = segs.length, after = gcr.end
      while (open > 0 && !src.slice(after, closingBrace(src, segs[open - 1].body - 1)).trim()) after = closingBrace(src, segs[--open].body - 1) + 1
      src = segs.slice(0, open).map((g) => `${g.cmd ? `\\${g.cmd}` : ""}{${topDeclarations(g.text).map((d) => `\\${d} `).join("")}`).join("") + src.slice(after).replace(/^\s+/, "")
      i = 0
      reopened = open > 0
    }
    if (cr) { // \@centercr: \par, \nobreak for \\*, \addvspace{-\parskip}, \vskip skip for [skip]
      if (cr[1]) v.nodes.push(penalty(10000))
      v.addvspace(negate(cx.outerParskip))
      if (cr[2] !== undefined) v.vskip(skip(cr[2]))
      i += cr[0].length
    }
  }
}

/** the text font commands, whose argument is a group of the paragraph's text */
const TEXT_FONT_COMMANDS = new Set(["textbf", "textmd", "textit", "textsl", "textsc", "textup", "textrm", "textsf", "texttt", "textnormal", "emph"])

/** commands in paragraph text and their arguments in braces: a { after them all opens a group */
const ARITY: Record<string, number> = {
  vspace: 1, hspace: 1, label: 1, ref: 1, pageref: 1, eqref: 1, cite: 1, cref: 1, Cref: 1, autoref: 1, nameref: 1, footnote: 1,
  underline: 1, mbox: 1, fbox: 1, rule: 2, textcolor: 2, colorbox: 2, LXfloat: 1, LXtabular: 1, LXminipage: 1, LXtikz: 1, LXgraphic: 1,
  ...Object.fromEntries([...TEXT_FONT_COMMANDS].map((c) => [c, 1])),
}

/** the command whose arguments (in braces, and options) come right before `open` in the text from `from` (spaces
 *  between them), with how many arguments in braces; null when text or a character comes right before it */
function commandBefore(src: string, from: number, open: number): { name: string; args: number; at: number } | null {
  const items: { kind: "cs" | "group" | "option" | "space" | "other"; name?: string; at: number }[] = []
  for (let k = from; k < open; ) {
    const c = src[k]
    if (c === "{") { items.push({ kind: "group", at: k }); k = closingBrace(src, k) + 1; continue }
    if (/\s/.test(c)) { items.push({ kind: "space", at: k }); k++; continue }
    const cs = src.slice(k).match(/^\\([A-Za-z]+\*?|[^])/)
    if (cs) { items.push({ kind: "cs", name: cs[1].replace(/\*$/, ""), at: k }); k += cs[0].length; continue }
    const prev = items.filter((x) => x.kind !== "space").at(-1)
    const e = src.indexOf("]", k)
    if (c === "[" && prev && prev.kind !== "other" && e >= 0 && e < open) { items.push({ kind: "option", at: k }); k = e + 1; continue }
    items.push({ kind: "other", at: k }); k++
  }
  let args = 0
  for (let n = items.length - 1; n >= 0; n--) {
    const x = items[n]
    if (x.kind === "space") continue
    if (x.kind === "group") { args++; continue }
    if (x.kind === "option") continue
    return x.kind === "cs" ? { name: x.name!, args, at: x.at } : null
  }
  return null
}

/** a \\ in groups of a paragraph's text: the groups it is in, outermost first (each one's text font command or a plain
 *  group, where that starts, and where its text starts), and the \\ (where, where it and its * and [skip] end) */
interface GroupCr { chain: { cmd: string | null; start: number; body: number }[]; at: number; end: number; star: boolean; skip?: string }

/** the \\ in the group that opens at `open` (text from `from` before it), if it is in plain groups and text font
 *  commands' arguments only (not a box's, a footnote's …) */
function groupCr(src: string, from: number, open: number): GroupCr | null {
  const head = commandBefore(src, from, open)
  if (head && !(TEXT_FONT_COMMANDS.has(head.name) && !head.args) && !(NO_ARGUMENT.has(head.name) && !head.args) && ARITY[head.name] !== head.args) return null
  const cmd = head && TEXT_FONT_COMMANDS.has(head.name) && !head.args ? head.name : null
  const level = { cmd, start: cmd ? head!.at : open, body: open + 1 }
  const close = closingBrace(src, open)
  for (let k = open + 1; k < close; ) {
    if (src[k] === "{") {
      const inner = groupCr(src, open + 1, k)
      if (inner) return { ...inner, chain: [level, ...inner.chain] }
      k = closingBrace(src, k) + 1; continue
    }
    if (src[k] === "$") { const e = src.indexOf("$", k + 1); if (e < 0) throw new Unsupported("an unbalanced $"); k = e + 1; continue }
    const m = src.slice(k).match(/^\\\\(\*)?\s*(?:\[([^\]]*)\])?/)
    if (m) return { chain: [level], at: k, end: k + m[0].length, star: !!m[1], ...(m[2] !== undefined ? { skip: m[2] } : {}) }
    k += src[k] === "\\" ? (src.slice(k).match(/^\\(?:[A-Za-z]+|[^])/)?.[0].length ?? 1) : 1
  }
  return null
}

/** a paragraph read from `st` to its \par in `end` */
/** `inGroup`: it starts in a group (a \\ in it ended the one before), which ends before its \par ("closed") or not */
function paragraph(cx: Ctx, text: string, st: DeclState, end: DeclState, unskip: number, mo: MaterialOptions, inGroup?: "open" | "closed") {
  const { amsmath } = cx.pre
  const { counted, decisions, doc, outerParskip, run, v } = cx
  if (displaySegments(text).length > 1) throw new Unsupported("a display in a paragraph here")
  let indent = !/^\\noindent(?![A-Za-z])/.test(text)
  if (!indent && mo.first) throw new Unsupported("\\noindent where \\@item's labels go")
  v.par()
  if (v.endpeEverypar) throw new Unsupported("a paragraph after a list here")
  // \@afterheading's \everypar (in a group: its \clubpenalty and \everypar{} last to the group's end)
  let club = mo.club ?? v.club, noteClubs: { leadGroupNoteClubPenalty?: number } = {}
  if (v.afterheadingEverypar && mo.club === undefined && inGroup) {
    if (v.nobreak) throw new Unsupported("a paragraph starting in a group right after a heading")
    if (inGroup === "open") club = run.k.ints.clubpenalty
    noteClubs = { leadGroupNoteClubPenalty: run.k.ints.clubpenalty } // (footnotes in the group)
  } else if (v.afterheadingEverypar && mo.club === undefined) {
    if (groupStart(text)) throw new Unsupported("a paragraph starting in a group after a heading here")
    if (v.nobreak) { v.nobreak = false; v.club = 10000; if (!v.afterindent) indent = false }
    else { v.club = run.k.ints.clubpenalty; v.afterheadingEverypar = false }
    club = v.club
  }
  // (a {\color …} group that starts it: the push on the vertical list, before the paragraph)
  if (/^\{\\color(?![A-Za-z])/.test(text)) text = leadingColor(cx, text)
  const align = end.align === "centering" ? centering() : end.align === "raggedright" ? raggedright() : end.align === "raggedleft" ? raggedleft() : {}
  const start: Node[] = mo.first ?? (indent ? [emptyBox("hlist", st.align ? 0 : run.k.dimens.parindent)] : [])
  const { list, params, notes } = paragraphInput(counted(text, true), run.k, st.size, doc, { start, attrs: st.attrs, groups: true, topDecls: true, centercr: !!st.align, clubPenalty: club, ...noteClubs, amsmath, ...align, ...(unskip ? { unskip } : {}) })
  const { vlist, trace } = lineBreak(list, params)
  decisions.push(...notes, trace)
  // (the page builder sees the \parskip where the paragraph starts, new_graf's build_page, and its lines at its \par: an
  // output routine fired there sees the \baselineskip in force then)
  outputBaselineskip(cx, st)
  v.paragraph(vlist, outerParskip, run.k.sizes[end.size].baselineskip)
  if (end.size !== st.size) { const h = outputBaselineskip(cx, end, false); v.nodes.splice(v.paraStart, 0, ...h); v.paraStart += h.length }
}

/** a hook for the output routine where the \baselineskip of `st` comes into force (when it is not the one already) */
function outputBaselineskip(cx: Ctx, st: DeclState, push = true): Node[] {
  const { run } = cx
  const bs = run.k.sizes[st.size].baselineskip.width
  if (bs === (run.outputBaselineskip ?? run.k.sizes.normalsize.baselineskip.width)) return []
  run.outputBaselineskip = bs
  const hook: Node = { kind: "whatsit", text: "", hook: { baselineskip: bs } satisfies OutputHook }
  if (push) cx.v.nodes.push(hook)
  return [hook]
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
  // (in two columns \onecolumn instead of \newpage, and \twocolumn at the end)
  const restonecol = !!run.k.ints.twocolumn
  if (restonecol) columnSwitch(cx, false)
  else v.nodes.push(filGlue(), penalty(-10000))
  v.nodes.push(hook("empty"), hook("page=1"))
  verticalMaterial(cx, body, { size: "normalsize", attrs: cx.normalAttrs, align: null }, false)
  if (restonecol) columnSwitch(cx, true)
  else v.nodes.push(filGlue(), penalty(-10000))
  if (!run.k.ints.twoside) v.nodes.push(hook("page=1"))
  v.club = saved.club; v.afterheadingEverypar = saved.everypar
}
