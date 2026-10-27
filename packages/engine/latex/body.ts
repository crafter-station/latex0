// The body's blocks in order on the main vertical list: paragraphs (with \@doendpe, run-in headings and
// \@noskipsec), headings, lists, floats, listings, letters and the front and back matter.

import type { GlueSpec } from "../layout/dimen"
import { parseGlue } from "../layout/dimen"
import { blocksOf, displaySegments, HEADINGS, type Block, type ListBlock } from "./blocks"
import { groupStart, tabularStart } from "./source"
import { COUNTER_COMMANDS } from "./counters"
import type { Ctx } from "./context"
import { Unsupported } from "./unsupported"
import { dimen, IGNORE_DEPTH, LOW_PENALTY } from "./vlist"
import { FIL, filGlue, penalty, type Node } from "../layout/nodes"
import { hpack } from "../layout/pack"
import { appendText } from "../layout/hmode"
import { loadFont } from "../layout/font"
import { dataFont } from "./data"
import { crefWrites, labelWrite } from "./paragraph"
import { bibliography, listOf, maketitle, tableOfContents } from "./frontmatter"
import { appendix, chapter, cleardoublepage, clearpage, heading, matter, newpage } from "./sectioning"
import type { OutputHook } from "./output"
import { markboth, markright, markValue } from "./marks"
import { leadingColor } from "./colors"
import { paragraphWithDisplays } from "./displays"
import { list, topCtx } from "./lists"
import { floatBlock, floatMarker } from "./floats"
import { listing } from "./lstlisting"
import { letter } from "./letter"
import { needsVerticalMode, titlepage, verticalMaterial } from "./vmode"
import { babelAux, babelLanguage } from "./babel"

export function processBlock(cx: Ctx, b: Block, bi: number, blocks: Block[]) {
  // the floats that start in a paragraph are built where they stand in it
  if (b.kind !== "par" || !b.floats) return block(cx, b, bi, blocks)
  const floats = b.floats
  // (a \label in one is read in the paragraph: the page builder has seen its \parskip, or all up to a display)
  cx.doc.float = (n, traces, club) => {
    const writes = cx.refs.cleveref?.writes, w0 = writes?.length ?? 0
    const marker = floatMarker(cx, floats[n], traces, club)
    for (const w of writes?.slice(w0) ?? []) w.inPara = true
    return marker
  }
  try { block(cx, b, bi, blocks) } finally { delete cx.doc.float }
}

function block(cx: Ctx, b: Block, bi: number, blocks: Block[]) {
  const { amsmath, cls } = cx.pre
  const { bodyUnits, counted, esphackNobreaks, noskipsecPar, refs, run, v } = cx
  // letter.cls has no headings, floats, \maketitle, \tableofcontents, thebibliography or front matter
  if (cls === "letter" && b.kind !== "par" && b.kind !== "list" && b.kind !== "letter" && b.kind !== "listing") throw new Unsupported(`a ${b.kind} in a letter`)
  if (cls === "letter" && b.kind === "list" && b.env === "abstract") throw new Unsupported("abstract in a letter")
  // a float leaves a run-in heading waiting; a list's \@trivlist starts its paragraph (\if@noskipsec\leavevmode)
  // (inside the list's group, so the heading's \clubpenalty\@M ends with the list)
  if (run.runIn && b.kind === "list") { const club = v.club; runInAlone(cx); list(cx, { ...b, inPar: true, blank: false }, topCtx(cx)); v.club = club; v.afterheadingEverypar = false; v.endpePar = true; return }
  if (run.runIn && !(b.kind === "par" || b.kind === "heading" || b.kind === "float" || b.kind === "toc" || b.kind === "lof" || b.kind === "matter" || b.kind === "bib" || b.kind === "listing" || b.kind === "newpage")) throw new Unsupported(`a ${b.kind} right after a run-in heading`)
  if (b.kind === "heading") { if (b.blank && !run.runIn) v.par(); if (run.runIn) runInAlone(cx); if (b.level === 0) chapter(cx, b); else heading(cx, b); return }
  if (run.noskipsec && (b.kind === "maketitle" || b.kind === "titlepage" || b.kind === "toc" || b.kind === "lof" || b.kind === "matter" || b.kind === "bib" || b.kind === "letter")) throw new Unsupported(`a ${b.kind} after a run-in heading lost to a listing`)
  if (b.kind === "maketitle") { maketitle(cx); return }
  if (b.kind === "titlepage") { titlepage(cx, b.body); return }
  // (after a run-in heading, \newpage's \leavevmode starts its paragraph; its \par after a list is the next paragraph's v.par())
  if (b.kind === "newpage") {
    if (run.runIn) runInAlone(cx)
    if (b.cmd === "newpage") newpage(cx); else if (b.cmd === "clearpage") clearpage(cx); else cleardoublepage(cx)
    return
  }
  if (b.kind === "pagebreak" || b.kind === "pagestyle") {
    if (run.runIn || run.noskipsec) throw new Unsupported(`\\${b.kind === "pagebreak" ? `${b.no ? "no" : ""}pagebreak` : b.cmd} right after a run-in heading`)
    if (b.kind === "pagebreak") { v.nodes.push(penalty((b.no ? 1 : -1) * getpen(cx, b.n))); return }
    // \thispagestyle: \global\@specialpagetrue\gdef\@specialstyle; \pagenumbering: \global\c@page\@ne, \gdef\thepage
    const hook: OutputHook | null = b.cmd === "thispagestyle" ? (b.style === "plain" || b.style === "empty" ? b.style : null) : b.style === "roman" || b.style === "arabic" ? b.style : null
    if (!hook) throw new Unsupported(`\\${b.cmd}{${b.style}}`)
    v.nodes.push({ kind: "whatsit", text: "", hook })
    return
  }
  if (b.kind === "toc") { if (run.runIn) runInAlone(cx); tableOfContents(cx); return }
  if (b.kind === "appendix") { appendix(cx); return }
  if (b.kind === "contentsline") { // \addcontentsline{toc}: hyperref's bookmark to \@currentHref, then \addtocontents (\protected@write)
    if (run.runIn || run.noskipsec) throw new Unsupported("\\addcontentsline right after a run-in heading")
    if (b.level === "chapter" && cls === "article") throw new Unsupported("\\addcontentsline{toc}{chapter} in article")
    v.nodes.push(...cx.contentsWrites(HEADINGS[b.level], null, b.title, cx.refs.href, v.nobreak))
    return
  }
  if (b.kind === "mark") { // \markboth and \markright in vertical mode: the \marks, \nobreak while \if@nobreak
    if (run.runIn || run.noskipsec) throw new Unsupported("\\markboth or \\markright right after a run-in heading")
    const value = (t: string) => markValue([{ text: t.replace(/\s+/g, " ") }], false)
    cx.v.nodes.push(...cx.marks.insert(b.left === null ? markright(value(b.right)) : markboth(value(b.left), value(b.right)), v.nobreak))
    return
  }
  if (b.kind === "lof") { if (run.runIn) runInAlone(cx); listOf(cx, b.file); return }
  if (b.kind === "matter") { if (run.runIn) runInAlone(cx); matter(cx, b.which); return }
  if (b.kind === "bib") { if (run.runIn) runInAlone(cx); bibliography(cx); return }
  if (b.kind === "letter") { if (run.runIn) runInAlone(cx); letter(cx, b); return }
  if (b.kind === "float") { floatBlock(cx, b); return }
  // a listing right after a run-in heading: its \everypar (then \lst@doendpe's) replaces the heading's, which never runs
  // (unless a top frame's paragraph runs it first: the heading goes in place there)
  if (b.kind === "listing") { const head = run.runIn; if (head) { run.runIn = null; run.noskipsec = true } listing(cx, b, head); return }
  if (b.kind === "par") {
    // \label before the paragraph starts: the \write on the vertical list, and while \if@nobreak holds
    // the \nobreak of \protected@write and of \@esphack
    // likewise \vspace (\vskip skip \vskip\z@skip) and \hrule (after which no interline glue comes, § 1056)
    // (\vspace*: \@vspacer's \hrule\@height\z@ \nobreak first, \prevdepth kept)
    // babel's \selectlanguage and otherlanguage's \begin and \end write to the .aux file there (\nobreak too)
    const lead = b.text.match(/^(?:\s*(?:\\label\{[A-Za-z0-9:._-]+\}|\\vspace\s*\*?\s*\{[^{}]*\}|\\hrule(?![A-Za-z])|\\selectlanguage\s*\{[A-Za-z]+\}|\\LX(?:end)?otherlanguage(?:star)?\{[A-Za-z]*\}))+\s*/)
    if (lead) {
      if (run.runIn) throw new Unsupported("\\label, \\vspace, \\hrule or \\selectlanguage right after a run-in heading")
      for (const m of lead[0].matchAll(/\\label\{([^}]*)\}|\\vspace\s*(\*?)\s*\{([^{}]*)\}|\\hrule|\\(selectlanguage\s*|LXotherlanguage|LXendotherlanguage)(star)?\{([A-Za-z]*)\}/g)) {
        if (m[4] !== undefined) {
          const lang = babelLanguage(cx.pre.babel, m[6])
          if (!m[5]) v.nodes.push({ kind: "whatsit", text: babelAux(lang) }, ...(v.nobreak ? [penalty(10000)] : []))
        } else if (m[1] !== undefined) {
          for (const w of [labelWrite(refs, m[1]), ...crefWrites(refs, m[1], false)]) v.nodes.push(w, ...esphackNobreaks(v.nobreak))
        } else if (m[3] !== undefined) {
          let g: GlueSpec
          try { g = parseGlue(m[3], bodyUnits) } catch { throw new Unsupported(`\\vspace{${m[3]}}`) }
          if (m[2]) v.nodes.push({ kind: "rule", width: null, height: 0, depth: 0 }, penalty(10000))
          v.vskip(g); v.vskip(dimen(0))
        } else { v.nodes.push({ kind: "rule", width: null, height: 26214, depth: 0 }); v.prevDepth = IGNORE_DEPTH } // 0.4pt
      }
      b.text = b.text.slice(lead[0].length)
      if (!b.text) return
    }
    // counter commands in vertical mode make no paragraph
    // (\setcounter{page}{n}: \global\c@page, which the output routine reads when it ships the page)
    if (!b.text.replace(COUNTER_COMMANDS, "").trim()) { counted(b.text.replace(/\\setcounter\s*\{\s*page\s*\}\s*\{\s*(\d+)\s*\}/g, (_, n: string) => { v.nodes.push({ kind: "whatsit", text: "", hook: `page=${Number(n)}` satisfies OutputHook }); return "{}" })); return }
    // \par in the text (a group that holds whole paragraphs, {\large … \par}) or skips between paragraphs
    if (needsVerticalMode(b.text)) {
      if (run.runIn) throw new Unsupported("\\par or a skip right after a run-in heading")
      if (b.noindent || b.afterThm) throw new Unsupported("\\par or a skip right after a list")
      v.par()
      verticalMaterial(cx, b.text, { size: "normalsize", attrs: cx.normalAttrs, align: null }, true)
      return
    }
    // a group that starts before the paragraph does (with \color: the push goes on the vertical list)
    const cg = groupStart(b.text)
    if (/^\s*\{\\color(?![A-Za-z])/.test(b.text)) {
      // (after a list, \@doendpe's \everypar runs in the group; its \par at the end of the paragraph clears all it set)
      b.text = leadingColor(cx, b.text)
    }
    // a run-in heading goes in place first: its title sees the counters as the paragraph starts
    const head = run.runIn ? run.runIn() : null
    const text = counted(b.text, true)
    if (head) { // \@xsect's \everypar: the indent box gives way to the heading, \clubpenalty\@M
      const start = head
      run.runIn = null
      v.par()
      if (v.nobreak) throw new Unsupported("a run-in heading right after a heading")
      // (\@xsect's \hskip-\@tempskipa is read in the group, in its font)
      if (cg && !/^\s*\{\\(?:color|LXcolorpushed)(?![A-Za-z])/.test(text)) throw new Unsupported("a group starting the text of a run-in heading")
      // a display environment that starts the paragraph starts it in its own group: \clubpenalty\@M ends there
      const segs0 = displaySegments(text)
      const grouped = !!cg || tabularStart(text) || (!(segs0[0] as string).trim() && typeof segs0[1] !== "string" && (segs0[1].kind !== "dollars" && (segs0[1].kind !== "bracket" || amsmath)))
      const outer = v.club
      // (the heading's own lines, before the first display, are inside that group; in a {\color …} group only
      // its footnotes are: the lines see the \clubpenalty at the \par, after the group)
      if (cg) paragraphWithDisplays(cx, text, false, outer, outer, start, b.unskip, outer, 10000)
      else paragraphWithDisplays(cx, text, false, grouped ? outer : 10000, grouped ? outer : 10000, start, b.unskip, 10000)
      // the next paragraph's \everypar (still the run-in heading's) sets \@clubpenalty; when a display started
      // this one, its \clubpenalty\@M ended with the display's group
      if (!grouped) v.club = 10000
      v.afterheadingEverypar = true
      return
    }
    // right after an amsthm environment, an earlier list's \@doendpe (its \everypar and \par) is still in force:
    // \@trivlist's \par ran inside the environment's group
    if (b.noindent || (b.afterThm && v.doendpe)) {
      const noindent = b.noindent || v.endpeEverypar
      v.endpeEverypar = false
      // right after a list: \@doendpe's \everypar drops the indent box; its \par resets \clubpenalty
      // first, so the lines see \@clubpenalty while footnotes read before it see the value in force
      // (a list that follows at once runs that \par inside its own group, so the reset does not last)
      const noteClub = v.club
      const next = blocks[bi + 1]
      if (next?.kind === "list" && next.inPar) paragraphWithDisplays(cx, text, noindent, noteClub, run.k.ints.clubpenalty, undefined, b.unskip)
      else { v.par(); paragraphWithDisplays(cx, text, noindent, noteClub, v.club, undefined, b.unskip) }
      return
    }
    v.par() // the blank line before it
    let noindent = false
    // a display environment (or amsmath's \[, which is \begin{equation*}) that starts the paragraph
    // starts it inside the environment's group: \everypar's assignments there do not last
    const segs = displaySegments(text)
    // (so do a {\color …} group and a tabular: the paragraph starts inside it)
    const grouped = !!cg || tabularStart(text) || (!(segs[0] as string).trim() && typeof segs[1] !== "string" && (segs[1].kind !== "dollars" && (segs[1].kind !== "bracket" || amsmath)))
    // (footnotes read in such a color group, and a leading tabular's p{width} entries, see its \clubpenalty, which the
    // group's end takes back)
    let leadNoteClub: number | undefined
    if (v.afterheadingEverypar) {
      // \@afterheading's \everypar: \clubpenalty\@M and no indentation unless \@afterindent; later, \@clubpenalty
      if (v.nobreak) { v.nobreak = false; noindent = !v.afterindent; if (!grouped) v.club = 10000; else leadNoteClub = 10000 }
      else if (!grouped) { v.club = run.k.ints.clubpenalty; v.afterheadingEverypar = false }
      else leadNoteClub = run.k.ints.clubpenalty
    }
    paragraphWithDisplays(cx, text, noindent, v.club, v.club, undefined, b.unskip, v.club, cg || tabularStart(text) ? leadNoteClub : undefined)
    return
  }
  if (b.env === "abstract" && cls === "report") { reportAbstract(cx, b, blocks[bi + 1]); return }
  if (b.blank) v.par() // a blank line before the list
  const before = { club: v.club, afterheading: v.afterheadingEverypar }
  // \@trivlist's \if@noskipsec\leavevmode (in the environment's group), then \unskip\par and no \partopsep
  if (run.noskipsec && !b.inPar) {
    if (b.env === "abstract") throw new Unsupported("an abstract after a run-in heading lost to a listing")
    const club = v.club
    noskipsecPar("a list")
    v.club = club // (an \everypar's \clubpenalty there is the environment's own)
    b = { ...b, inPar: true }
  }
  list(cx, b, topCtx(cx))
  // the list's group ends (its \clubpenalty and \everypar settings with it); \end then runs \@doendpe, except
  // after amsthm's environments (\@endpefalse): the \everypar and \clubpenalty from before them are back
  if (b.env === "LXtheorem" || b.env === "proof") { v.club = before.club; v.afterheadingEverypar = before.afterheading; return }
  v.afterheadingEverypar = false
  v.endpePar = v.doendpe = v.endpeEverypar = true
}

/**
 * report's abstract (\if@titlepage): \titlepage (\newpage, \thispagestyle{empty}, \setcounter{page}\@ne), \null\vfil,
 * \@beginparpenalty\@lowpenalty, \begin{center}\bfseries\abstractname \@endparpenalty\@M\end{center}, the text (its
 * paragraphs after the center's \@doendpe), then \par\vfil\null\endtitlepage (\newpage, one-sided \setcounter{page}\@ne)
 */
function reportAbstract(cx: Ctx, b: ListBlock, next: Block | undefined) {
  const { run, v } = cx
  if (!cx.pre.titlepage) throw new Unsupported("abstract in report with notitlepage")
  if (run.runIn || run.noskipsec) throw new Unsupported("an abstract right after a run-in heading")
  v.par()
  if (v.endpePar || v.endpeEverypar) throw new Unsupported("an abstract right after a list")
  if (v.nobreak) throw new Unsupported("an abstract right after a heading")
  // (an \@afterheading \everypar after \tableofcontents, \if@nobreak cleared: the lists' and \@doendpe's take its place
  // in the environment's group, and the \clubpenalty they leave is \@clubpenalty, which it would set)
  const hook = (h: OutputHook): Node => ({ kind: "whatsit", text: "", hook: h })
  v.nodes.push(filGlue(), penalty(-10000), hook("empty"), hook("page=1"))
  v.box(hpack([]), run.k.sizes.normalsize.baselineskip)
  v.vskip({ width: 0, stretch: 65536, stretchOrder: FIL, shrink: 0, shrinkOrder: 0 })
  const head: Node[] = []
  const bf = run.k.sizes.normalsize.bold
  appendText(head, "Abstract", loadFont(dataFont(bf.name), bf.at), { spaceFactor: 1000 }, false)
  list(cx, { kind: "list", env: "center", items: [{ label: null, parts: [{ kind: "text", text: "", start: "label", nodes: head }] }], inPar: false, blank: false }, { ...topCtx(cx), beginparpenalty: LOW_PENALTY, endparpenalty: 10000 })
  const body = b.source ?? ""
  const blocks = blocksOf(body)
  // (text right after \begin{abstract}: the center's \@doendpe takes its indent)
  if (blocks[0]?.kind === "par" && !/^\s*\n[ \t]*\n/.test(body)) blocks[0].noindent = true
  blocks.forEach((x, i, all) => { if (x.kind !== "par") throw new Unsupported(`a ${x.kind} in report's abstract`); processBlock(cx, x, i, all) })
  // (\end{abstract} finds \if@endpe false: the center's \@doendpe went with the text's first paragraph; with no text it holds)
  if (!blocks.length && next) throw new Unsupported("an empty abstract in report")
  if (next?.kind === "par") next.noindent = false
  v.par()
  v.vskip({ width: 0, stretch: 65536, stretchOrder: FIL, shrink: 0, shrinkOrder: 0 })
  v.box(hpack([]), run.k.sizes.normalsize.baselineskip)
  v.nodes.push(filGlue(), penalty(-10000))
  if (!run.k.ints.twoside) v.nodes.push(hook("page=1"))
}

/** \@getpen: 0, \@lowpenalty, \@medpenalty, \@highpenalty (51, 151, 301 in the standard classes; letter.cls sets none), \@M */
export function getpen(cx: Ctx, n: number): number {
  if (n === 0 || n >= 4) return n === 0 ? 0 : 10000
  return cx.pre.cls === "letter" ? 0 : [51, 151, 301][n - 1]
}

/** a run-in heading followed by another heading: \@startsection's \leavevmode\par makes it a paragraph of its own */
export function runInAlone(cx: Ctx) {
  const { outerParskip, run, typeset, v } = cx
  const start = run.runIn!()
  run.runIn = null
  v.par()
  v.club = 10000
  typeset("", { start, clubPenalty: 10000 }, outerParskip)
  v.afterheadingEverypar = true
}
