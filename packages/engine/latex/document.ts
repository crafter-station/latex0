// Layout "document": whole documents in a growing subset of LaTeX, laid out
// end to end. Today: a standard class at 10pt, 11pt or 12pt; \pagestyle plain,
// empty or headings (the class's default; with no sectioning yet the marks are
// empty, so a running head is the page number at the outer edge); paragraphs of text, inline math and footnotes (as
// the paragraph adapter reads them); and itemize and enumerate lists, one level
// deep; \section, \subsection and \subsubsection, starred or numbered (latex.ltx
// \@startsection, \@sect, \@xsect, \@afterheading). Anything else throws
// Unsupported and the fixture stays pending.
//
// The main vertical list is built as LaTeX builds it: \par's \parskip pair,
// interline glue (§ 679), and LaTeX's list kernel (latex.ltx \list, \@trivlist,
// \@item, \endtrivlist, \@endparenv) with \addvspace and \addpenalty, which look
// at \lastskip and \prevdepth. Pages come from the engine's page builder and go
// through \@makecol and \@outputpage: the head box, \headsep, the text, and the
// foot at \footskip with the page number.

import { dataFont } from "./data"
import { emitBoxes } from "../emit/boxes"
import { shipOut } from "../emit/trace"
import { SIZE_COMMANDS, type SizeCommand } from "../layout/classdata"
import type { GlueSpec } from "../layout/dimen"
import { loadFont, QUAD, SPACE, SPACE_SHRINK, SPACE_STRETCH, X_HEIGHT } from "../layout/font"
import { parseDimen, parseGlue } from "../layout/dimen"
import { appendText } from "../layout/hmode"
import { lineBreak } from "../layout/linebreak"
import { emptyBox, glue, kern, paramGlue, penalty, type BoxNode, type Node, filGlue, ssGlue } from "../layout/nodes"
import { hpack, vpack } from "../layout/pack"
import { xnOverD } from "../layout/arith"
import type { ParagraphTrace } from "../trace/decisions"
import type { LayoutResult } from "./result"
import { blocksOf, displaySegments, type Block } from "./blocks"
import { prepareSource, tabularStart, type Listing, type MinipageSource, type TabularSource } from "./source"
import { COUNTER_COMMANDS, Counters } from "./counters"
import { markText, MarkWriter, pageMarks } from "./marks"
import { TocWriter, type TocEntry } from "./toc"
import { readPreamble } from "./preamble"
import { runState } from "./run"
import type { Ctx } from "./context"
import { Unsupported } from "./unsupported"
import { dimen, IGNORE_DEPTH, negate, plain, VerticalList } from "./vlist"
import { endDocument, outputOptions, makeColumns, outputPage, NobreakFloat, OutputUnsupported, type Float, type OutputHook } from "./output"
import { anchor, Bookmarks, documentStart, labelName, spotAnchor, type Bookmark } from "./hyperref"
import { Colors, ColorUnsupported, COLOR_CMD, colorPop, colorPush, setgroup, xcolor } from "./xcolor"
import { preamble, tabularBox, tabularLines, TabularUnsupported, vtop, type TabCol, type TabLine, type TabularEnv } from "./tabular"
import { lstFrameBoxV, lstFrameH, lstFrameShapes, lstOptions, lstScan, LstUnsupported, type LstFrame, type LstOptions } from "./listings"
import { classParams, fontAt, fontDeclaration, hlistInput, appendToVlist, labelWrite, mathEnv, paragraphInput, selectFont, type DocState, type FontAttrs, type Refs, type TabularOuter } from "./paragraph"
import { bibliography, maketitle, tableOfContents, today } from "./frontmatter"
import { chapter, heading, matter } from "./sectioning"
import { leadingColor, styleColors } from "./colors"
import { paragraphWithDisplays } from "./displays"
import { list, topCtx } from "./lists"



export interface DocumentOptions {
  /** the date \today prints, in seconds since 1970 (SOURCE_DATE_EPOCH); now by default */
  epoch?: number
}

export function document(source: string, { epoch = Math.floor(Date.now() / 1000) }: DocumentOptions = {}): LayoutResult {
  const { src, listings, tabulars, minipages } = prepareSource(source)
  // Whether a float right after a heading goes here decides \if@nobreak for the text after it,
  // which is laid out before the output routine places the float: the document is laid out again,
  // with the float not placed here, until every such guess holds.
  const run = (aux: Aux | null) => {
    const notHere = new Set<number>()
    for (;;) {
      try { return layout(src, notHere, aux, listings, tabulars, minipages, epoch) } catch (e) {
        if (!(e instanceof NobreakFloat) || notHere.has(e.index)) throw e
        notHere.add(e.index)
      }
    }
  }
  // the oracle runs LaTeX twice: the second run reads the .toc and .aux files the first one wrote
  const first = run(null)
  return first.written ? run(first.written).result : first.result
}

/** What a run writes for the next one: the .toc file's lines and the .aux file's \newlabel values. */
interface Aux { toc: TocEntry[]; labels: Map<string, { label: string; page: string; href: string }>; /** hyperref's .out file */ bookmarks: Bookmark[]; /** \bibcite: key → number */ cites: Map<string, string> }

/**
 * The document laid out once, as one LaTeX run: `prev` is what the run before wrote (null: none
 * yet). `written` is what this run writes, when the document reads it (a \tableofcontents, a \ref).
 */

function layout(src: string, notHere: Set<number>, prev: Aux | null, listings: Listing[], tabulars: TabularSource[], minipages: MinipageSource[], epoch: number): { result: LayoutResult; written: Aux | null } {
  const toc = prev ? prev.toc : null
  const pre = readPreamble(src)
  const { cls, option, classTextwidth, medskipamount, lstBase, usesListings, usesXcolor, amsmath, hyper, t1, booktabsT1, colorDefs, pagestyle, title, letterInfo, newCounters, body } = pre
  const run = runState(pre.k)
  const blocks = blocksOf(body)

  const v = new VerticalList(run.k)
  xcolor.on = usesXcolor
  outputOptions.xcolor = usesXcolor
  if (usesXcolor) v.nodes.push(colorPush()) // \begin{document}'s \normalcolor
  const refs: Refs = { label: "", href: hyper ? "Doc-Start" : "", name: "", prev: prev ? prev.labels : null, writes: [], hyper, cites: prev?.cites }
  /** \Hy@writebookmark's state */
  const bookmarks = new Bookmarks()
  /** the main vertical list's last node, as \lastskip and \lastnodetype see it (a hook is no node) */
  const lastNode = () => v.nodes.findLast((x) => !(x.kind === "whatsit" && x.hook))
  if (hyper) {
    // \AtBeginDocument: the outlines, /DOCVIEW, the Catalog; the Doc-Start anchor
    v.nodes.push(...documentStart(prev ? prev.bookmarks : []))
    v.nodes.push(...anchor("Doc-Start", run.k.sizes.normalsize.baselineskip.width, "v", lastNode()))
  }
  if (colorDefs.length && !usesXcolor) throw new Unsupported("\\definecolor without xcolor")
  const colors = new Colors()
  try { for (const [n, m, x] of colorDefs) colors.define(n, m, x) } catch (e) { if (e instanceof ColorUnsupported) throw new Unsupported(e.message); throw e }
  const colorSpec = (spec: string, model?: string) => {
    if (!usesXcolor) throw new Unsupported("a color without xcolor")
    try { return colors.spec(spec, model) } catch (e) { if (e instanceof ColorUnsupported) throw new Unsupported(e.message); throw e }
  }
  const doc: DocState = { footnote: 0, refs, xcolor: usesXcolor, color: colorSpec }
  const decisions: ParagraphTrace[] = []
  const outerParskip = run.k.glue.parskip
  const typeset = (text: string, opts: Parameters<typeof paragraphInput>[4], parskip: GlueSpec, size: SizeCommand = "normalsize") => {
    const { list, params, notes } = paragraphInput(counted(text, true), run.k, size, doc, { ...opts, amsmath })
    const { vlist, trace } = lineBreak(list, params)
    decisions.push(...notes, trace)
    v.paragraph(vlist, parskip, run.k.sizes[size].baselineskip)
  }
  const roman = run.k.sizes.normalsize.font
  // skips in ex are read in the body font (\@startsection evaluates them before the heading's font)
  const romanFont = loadFont(dataFont(roman.name), roman.at)
  const bodyUnits = { em: romanFont.params[QUAD], ex: romanFont.params[X_HEIGHT] }
  const tocFile = new TocWriter()
  const marks = new MarkWriter()
  const headings = pre.markDefs, mkboth = pagestyle === "headings"
  /** hyperref's \addcontentsline: the bookmark line (to the depth of \c@tocdepth), then the toc line; each
   *  \protected@write adds \nobreak while \if@nobreak holds */
  const contentsWrites = (level: TocEntry["level"], number: string | null, title: string, anchorName: string, nobreak: boolean): Node[] => {
    const out: Node[] = []
    if (hyper && level <= (cls === "article" ? 3 : 2)) {
      const bm = bookmarks.add(level, anchorName, title)
      if (!bm) throw new Unsupported(`a bookmark for "${title}"`)
      out.push(bm)
      if (nobreak) out.push(penalty(10000))
    }
    out.push(tocFile.write(level, number, title, hyper ? anchorName : ""))
    if (nobreak) out.push(penalty(10000))
    return out
  }
  const lstCarry: { gobbledws: boolean; breakcurrindent: number; breakshape: [number, number] | null } = { gobbledws: false, breakcurrindent: 0, breakshape: null }
  /**
   * \lstinline: \leavevmode\bgroup\lstset{flexiblecolumns,options}, \lsthk@TextStyle (no skips, frame or margins, an
   * empty \everypar and \lst@NewLine), \lst@Init and \lst@DeInit with no \par: the token boxes go into the paragraph
   */
  // booktabs's dimensions, set as it loads, in the class's \normalsize roman (.08em, .05em, .03em, .65ex, .4ex, .5em)
  const booktabs = booktabsT1 === null ? null : (() => {
    const f = selectFont(run.k, "normalsize", { enc: booktabsT1 ? "T1" : "OT1", fam: "cmr", ser: "m", shape: "n" })
    const d = (x: string) => parseDimen(x, { em: f.params[QUAD], ex: f.params[X_HEIGHT] })
    return { heavyrulewidth: d(".08em"), lightrulewidth: d(".05em"), cmidrulewidth: d(".03em"), belowrulesep: d(".65ex"), belowbottomsep: 0, aboverulesep: d(".4ex"), abovetopsep: 0, cmidrulesep: run.k.dimens.doublerulesep, cmidrulekern: d(".5em"), defaultaddspace: d(".5em") }
  })()
  const normalAttrs: FontAttrs = { enc: t1 ? "T1" : "OT1", fam: "cmr", ser: "m", shape: "n" }
  doc.tabular = (n, size, attrs, sfcodes, outer) => {
    const t = tabulars[n]
    let lines: TabLine[], cols: TabCol[]
    try { lines = tabularLines(t.body); cols = preamble(t.spec) } catch (e) { if (e instanceof TabularUnsupported) throw new Unsupported(e.message); throw e }
    return tabular(lines, cols, size, t.pos, attrs, sfcodes, outer)
  }
  /**
   * \begin{minipage}[pos]{width}: \setbox\@tempboxa\vbox{\hsize width \@parboxrestore (\parindent and \parskip zero,
   * \sloppy, the normal baselines) \@setminipage body \par\unskip}, then \@iiiparbox: \vbox{\unvbox\@tempboxa} as
   * $\vcenter{…}\m@th$ for c, a \vtop for t, a \vbox for b
   */
  /** \textwidth, \columnwidth and \linewidth in a width (`lineWidth`: \linewidth where it stands) */
  const widthRegisters = (lineWidth?: number) => (name: string) => {
    const value = name === "textwidth" ? run.minipageWidth ?? run.k.dimens.textwidth : name === "columnwidth" ? run.minipageWidth ?? run.k.dimens.columnwidth : name === "linewidth" ? lineWidth : undefined
    return value === undefined ? undefined : { level: "dimen" as const, value }
  }
  doc.minipage = (n, size, attrs, sfcodes, outer) => {
    const m = minipages[n]
    if (m.height !== null) throw new Unsupported("a minipage with a height")
    const font = selectFont(run.k, size, attrs), sz = run.k.sizes[size]
    let hsize: number
    try { hsize = parseDimen(m.width, { em: font.params[QUAD], ex: font.params[X_HEIGHT], internal: widthRegisters(outer.lineWidth) }) } catch { throw new Unsupported(`a minipage {${m.width}}`) }
    let body = m.body.replace(/(^|[^\\])%.*\n[ \t]*/g, "$1")
    // a leading \centering: \leftskip and \rightskip \@flushglue, \parfillskip zero, \finalhyphendemerits zero
    // \centering in vertical mode (first, or after a caption): \leftskip and \rightskip \@flushglue, \parfillskip zero,
    // \finalhyphendemerits zero, from there on
    let centering = false
    const flush = (p: string) => paramGlue(p, filGlue())
    const shape = () => centering ? { leftSkip: flush("leftskip"), rightSkip: flush("rightskip"), parFillSkip: paramGlue("parfillskip", glue(0)), finalHyphenDemerits: 0 } : { finalHyphenDemerits: outer.finalHyph }
    const odd = body.match(/\\(?:footnote|begin|item|raggedright|raggedleft|vspace|noindent|LXlstinline)(?![A-Za-z])|\\\[|\$\$/) ?? (/\\centering(?![A-Za-z])/.test(body) ? body.match(/\\\\/) : null)
    if (odd) throw new Unsupported(`${odd[0]} in a minipage`)
    const list: Node[] = []
    let pd: number | null = IGNORE_DEPTH
    // (in it, \textwidth and \columnwidth are its \hsize, and so is \linewidth after \@parboxrestore)
    const outerWidth = run.minipageWidth
    run.minipageWidth = hsize
    try {
    const lines = (vl: Node[]) => { for (const x of vl) { if (x.kind === "hlist") pd = appendToVlist(list, x, pd, sz.baselineskip, run.k.glue.lineskip, run.k.dimens.lineskiplimit); else list.push(x) } }
    // new_graf in internal vertical mode adds \parskip (zero here) only to a list that is not empty, and so does
    // LaTeX's restart of the paragraph
    const parskips = () => { if (list.length) list.push(paramGlue("parskip", glue(0)), paramGlue("parskip", glue(0))) }
    // \caption (\par first) and a \label right after it, in vertical mode; paragraphs between
    let cap: { number: number; name: string } | null = null
    for (const part of body.split(/(\\caption\s*\{(?:[^{}]|\{[^{}]*\})*\}|\\label\s*\{[^{}]*\})/)) {
      const cm = part.match(/^\\caption\s*\{([^]*)\}$/)
      if (cm) {
        if (!run.captype) throw new Unsupported("\\caption in a minipage outside a float")
        if (size !== "normalsize" || attrs.ser !== "m" || attrs.shape !== "n" || attrs.fam !== "cmr") throw new Unsupported("a minipage caption in another font")
        cap = caption(run.captype, cm[1], hsize, {
          push: (x) => list.push(x),
          box: (x) => { pd = appendToVlist(list, x, pd, run.k.sizes.normalsize.baselineskip, run.k.glue.lineskip, run.k.dimens.lineskiplimit) },
          // \@parboxrestore undoes \centering's skips (not its \finalhyphendemerits)
          paragraph: (start, text) => {
            parskips()
            const p = paragraphInput(text, run.k, "normalsize", doc, { start, hsize, amsmath, tolerance: 9999, emergencyStretch: 3 * romanFont.params[QUAD], clubPenalty: outer.club, widowPenalty: outer.widow, finalHyphenDemerits: centering ? 0 : outer.finalHyph })
            const lb = lineBreak(p.list, p.params)
            outer.notes.push(...p.notes, lb.trace)
            lines(lb.vlist)
          },
        })
        continue
      }
      const lm = part.match(/^\\label\s*\{([A-Za-z0-9:._-]+)\}$/)
      if (lm) {
        if (!cap) throw new Unsupported("a \\label in a minipage")
        list.push(labelWrite(refs, lm[1], counters.the(cap.number), refs.href, hyper ? cap.name : refs.name)) // nameref: the caption
        continue
      }
      if (/^\\label/.test(part)) throw new Unsupported(`${part} in a minipage`)
      if (part.trim()) cap = null // (a \label after text is in a paragraph)
    for (let text of part.split(/\n[ \t]*\n|\\par(?![A-Za-z])/)) {
      if (/^\s*\\centering(?![A-Za-z])/.test(text)) { centering = true; text = text.replace(/^\s*\\centering\s*/, "") }
      if (/\\centering(?![A-Za-z])/.test(text)) throw new Unsupported("\\centering in a minipage's paragraph")
      if (!text.trim()) continue
      parskips()
      let p: ReturnType<typeof paragraphInput>
      try {
        p = paragraphInput(text, run.k, size, doc, { attrs, ...(sfcodes ? { sfcodes } : {}), hsize, start: [emptyBox("hlist", 0)], amsmath, tolerance: 9999, emergencyStretch: 3 * font.params[QUAD], clubPenalty: outer.club, widowPenalty: outer.widow, noteWidowPenalty: outer.widow, ...shape() })
      } catch (e) {
        if (e instanceof Error && e.message.startsWith("paragraph adapter")) throw new Unsupported(`a minipage paragraph "${text.trim().slice(0, 40)}"`)
        throw e
      }
      const lb = lineBreak(p.list, p.params)
      outer.notes.push(...p.notes, lb.trace)
      lines(lb.vlist)
    }
    }
    } finally { run.minipageWidth = outerWidth }
    if (list.at(-1)?.kind === "glue") list.pop() // \unskip
    if (m.pos === "t") return [vtop(list)]
    const box = vpack(list)
    if (m.pos === "b") return [box]
    const delta = box.height + box.depth // \vcenter: make_vcenter (§ 736), about the axis
    box.height = mathEnv(run.k, size, amsmath).fonts[0][2]!.params[22] + (delta % 2 ? Math.trunc((delta + 1) / 2) : delta / 2)
    box.depth = delta - box.height
    return [{ kind: "math", on: true, width: 0 }, box, { kind: "math", on: false, width: 0 }]
  }
  doc.lstinline = (n, size, attrs) => {
    if (!usesListings) throw new Unsupported("\\lstinline without \\usepackage{listings}")
    if (t1) throw new Unsupported("listings with T1")
    let o: LstOptions
    try { o = lstOptions(listings[n].options, lstOptions("flexiblecolumns", lstBase)) } catch (e) { if (e instanceof LstUnsupported) throw new Unsupported(e.message); throw e }
    const { styleOf, fonts } = lstFontsAt(size, attrs)
    const base = styleOf(o.basicstyle), baseFont = selectFont(run.k, base.size, base.a)
    const width = parseDimen(o.columns === "fixed" ? "0.6em" : "0.45em", { em: baseFont.params[QUAD], ex: baseFont.params[X_HEIGHT] })
    if (lstCarry.gobbledws) throw new Unsupported("\\lstinline after gobbled whitespace")
    if (o.breaklines) throw new Unsupported("\\lstinline with breaklines")
    let events
    try { events = lstScan({ width, lines: listings[n].lines, options: o, fonts, textStyle: true, carry: lstCarry }) } catch (e) { if (e instanceof LstUnsupported) throw new Unsupported(e.message); throw e }
    run.lstLineno = 1 // InitVars, and no end of line
    const nodes = events.map((e) => { if ("node" in e) return e.node; throw new Unsupported("\\lstinline with a line break") })
    const basicColors = styleColors(cx, o.basicstyle) // basicstyle in \lst@Init: its pushes before the tokens
    nodes.unshift(...basicColors.map((c) => colorPush(c)))
    if (xcolor.on) nodes.push(colorPush()) // \lst@DeInit's \normalcolor; then the group's end pops them all
    nodes.push(...basicColors.map(() => colorPop()), ...(xcolor.on ? [colorPop()] : []))
    return nodes
  }
  const counters = new Counters(cls, newCounters, () => doc.footnote)
  /** counter commands in text: a \refstepcounter outside text sets \@currentlabel and \@currentHref (and hyperref's anchor) */
  const counted = (text: string, inText = false): string => counters.counted(text, inText, (label, h) => {
    refs.label = label; refs.href = h
    if (hyper) v.nodes.push(...anchor(refs.href, run.k.sizes.normalsize.baselineskip.width, "v", lastNode())) // hyperref's anchor
  })
  /** a \label in vertical mode: \protected@write's \nobreak while \if@nobreak, \@esphack's then or while \if@noskipsec */
  const esphackNobreaks = (nobreak: boolean): Node[] => [...(nobreak ? [penalty(10000)] : []), ...(nobreak || run.noskipsec ? [penalty(10000)] : [])]
  /** \if@noskipsec \leavevmode: an empty paragraph (the indent box) in the \everypar in force */
  const noskipsecPar = (what: string) => {
    if (!run.noskipsec) return
    if (v.nobreak) { // \@afterheading's \everypar: \@nobreakfalse\clubpenalty\@M, the indent box gone unless \@afterindent
      v.nobreak = false; v.club = 10000
      if (!v.afterindent) { v.paragraph([], outerParskip); return }
      typeset("", { clubPenalty: v.club }, outerParskip)
      return
    }
    // \@doendpe's \everypar takes the indent box: an empty paragraph makes no line (\parskip is there already)
    if (v.endpeEverypar) { v.paragraph([], outerParskip); v.endpeEverypar = false; return }
    if (v.afterheadingEverypar) { v.club = run.k.ints.clubpenalty; v.afterheadingEverypar = false } // its \everypar: \@clubpenalty, \everypar{}
    typeset("", { clubPenalty: v.club }, outerParskip)
  }
  /** a run-in heading followed by another heading: \@startsection's \leavevmode\par makes it a paragraph of its own */
  const runInAlone = () => {
    const start = run.runIn!()
    run.runIn = null
    v.par()
    v.club = 10000
    typeset("", { start, clubPenalty: 10000 }, outerParskip)
    v.afterheadingEverypar = true
  }
  function processBlock(b: Block, bi: number, blocks: Block[]) {
    // letter.cls has no headings, floats, \maketitle, \tableofcontents, thebibliography or front matter
    if (cls === "letter" && b.kind !== "par" && b.kind !== "list" && b.kind !== "letter" && b.kind !== "listing") throw new Unsupported(`a ${b.kind} in a letter`)
    if (cls === "letter" && b.kind === "list" && b.env === "abstract") throw new Unsupported("abstract in a letter")
    // a float leaves a run-in heading waiting; a list's \@trivlist starts its paragraph (\if@noskipsec\leavevmode)
    // (inside the list's group, so the heading's \clubpenalty\@M ends with the list)
    if (run.runIn && b.kind === "list") { const club = v.club; runInAlone(); list(cx, { ...b, inPar: true, blank: false }, topCtx(cx)); v.club = club; v.afterheadingEverypar = false; v.endpePar = true; return }
    if (run.runIn && !(b.kind === "par" || b.kind === "heading" || b.kind === "float" || b.kind === "toc" || b.kind === "matter" || b.kind === "bib" || b.kind === "listing")) throw new Unsupported(`a ${b.kind} right after a run-in heading`)
    if (b.kind === "heading") { if (b.blank && !run.runIn) v.par(); if (run.runIn) runInAlone(); if (b.level === 0) chapter(cx, b); else heading(cx, b); return }
    if (run.noskipsec && (b.kind === "maketitle" || b.kind === "toc" || b.kind === "matter" || b.kind === "bib" || b.kind === "letter")) throw new Unsupported(`a ${b.kind} after a run-in heading lost to a listing`)
    if (b.kind === "maketitle") { maketitle(cx); return }
    if (b.kind === "toc") { if (run.runIn) runInAlone(); tableOfContents(cx); return }
    if (b.kind === "matter") { if (run.runIn) runInAlone(); matter(cx, b.which); return }
    if (b.kind === "bib") { if (run.runIn) runInAlone(); bibliography(cx); return }
    if (b.kind === "letter") { if (run.runIn) runInAlone(); letter(b); return }
    if (b.kind === "float") { floatBlock(b); return }
    // a listing right after a run-in heading: its \everypar (then \lst@doendpe's) replaces the heading's, which never runs
    // (unless a top frame's paragraph runs it first: the heading goes in place there)
    if (b.kind === "listing") { const head = run.runIn; if (head) { run.runIn = null; run.noskipsec = true } listing(b, head); return }
    if (b.kind === "par") {
      // \label before the paragraph starts: the \write on the vertical list, and while \if@nobreak holds
      // the \nobreak of \protected@write and of \@esphack
      // likewise \vspace (\vskip skip \vskip\z@skip) and \hrule (after which no interline glue comes, § 1056)
      const lead = b.text.match(/^(?:\s*(?:\\label\{[A-Za-z0-9:._-]+\}|\\vspace\{[^{}]*\}|\\hrule(?![A-Za-z])))+\s*/)
      if (lead) {
        if (run.runIn) throw new Unsupported("\\label, \\vspace or \\hrule right after a run-in heading")
        for (const m of lead[0].matchAll(/\\label\{([^}]*)\}|\\vspace\{([^{}]*)\}|\\hrule/g)) {
          if (m[1] !== undefined) {
            v.nodes.push(labelWrite(refs, m[1]), ...esphackNobreaks(v.nobreak))
          } else if (m[2] !== undefined) {
            let g: GlueSpec
            try { g = parseGlue(m[2], bodyUnits) } catch { throw new Unsupported(`\\vspace{${m[2]}}`) }
            v.vskip(g); v.vskip(dimen(0))
          } else { v.nodes.push({ kind: "rule", width: null, height: 26214, depth: 0 }); v.prevDepth = IGNORE_DEPTH } // 0.4pt
        }
        b.text = b.text.slice(lead[0].length)
        if (!b.text) return
      }
      // counter commands in vertical mode make no paragraph
      if (!b.text.replace(COUNTER_COMMANDS, "").trim()) { counted(b.text); return }
      // a group that starts with \color before the paragraph does: the push goes on the vertical list
      const cg = /^\s*\{\\color(?![A-Za-z])/.test(b.text)
      if (cg) {
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
  const cx: Ctx = { pre, run, v, doc, decisions, toc, marks, mkboth, romanFont, roman, bodyUnits, outerParskip, epoch, typeset, tabular, counters, refs, headings, lastNode, counted, contentsWrites, noskipsecPar, colorSpec, esphackNobreaks }
  blocks.forEach(processBlock)

  /**
   * A float (latex.ltx \@float, \@xfloat, \@caption, the class's \@makecaption, \end@float) from
   * vertical mode: its box is built now, and a marker stands for \penalty-\@Miv\vbox{}\penalty-\@Miii,
   * where the output routine will place it.
   */
  /** listings' fonts from a size and font: a style's (font declarations and size commands), and the other encodings' */
  function lstFontsAt(size0: SizeCommand, attrs0: FontAttrs) {
    // a style: font declarations and size commands, from the font where the listing is
    const styleOf = (style: string) => {
      let size: SizeCommand = size0, a: FontAttrs = attrs0
      for (const m of style.replace(COLOR_CMD, "").matchAll(/\\([a-zA-Z]+)/g)) {
        if ((SIZE_COMMANDS as readonly string[]).includes(m[1])) { size = m[1] as SizeCommand; continue }
        const next = fontDeclaration(m[1], a, run.k, size, doc)
        if (!next) throw new Unsupported(`listings style \\${m[1]}`)
        a = next
      }
      return { size, a }
    }
    const fonts = {
      colors: (style: string) => styleColors(cx, style),
      font(style: string) { const { size, a } = styleOf(style); return { font: selectFont(run.k, size, a), tt: a.fam === "cmtt", bold: a.ser === "bx", italicShape: a.shape !== "n", size } },
      /** TS1 from the class's table; OML and OMS by omlcmm.fd and omscmsy.fd (bold: cmmib, cmbsy, 10pt from 10 up) */
      other(style: string, enc: "TS1" | "OML" | "OMS") {
        const { size, a } = styleOf(style)
        if (enc === "TS1") return selectFont(run.k, size, { ...a, enc: "TS1" })
        const at = run.k.sizes[size].font.at, pt = at / 65536
        // omlcmr.fd and omscmr.fd: cmr's bold to cmm/b and cmsy/b; no cmss family: \DeclareFontSubstitution's m series
        const bold = a.ser === "bx" && a.fam === "cmr"
        const step = pt < 6 ? 5 : pt < 7 ? 6 : pt < 8 ? 7 : pt < 9 ? 8 : pt < 10 ? 9 : enc === "OML" && !bold && pt >= 12 ? 12 : 10
        return fontAt((enc === "OML" ? (bold ? "cmmib" : "cmmi") : bold ? "cmbsy" : "cmsy") + step, at)
      },
    }
    return { styleOf, fonts }
  }

  function listing(b: Extract<Block, { kind: "listing" }>, runInHead: ((em?: number, parindent?: number) => Node[]) | null = null) {
    if (!usesListings) throw new Unsupported("lstlisting without \\usepackage{listings}")
    // right after a heading the listing's \everypar replaces \@afterheading's (which then never runs: \if@nobreak
    // stays true and \clubpenalty as it was), unless a top frame's paragraph runs it first
    if (t1) throw new Unsupported("listings with T1")
    let o: LstOptions
    try { o = lstOptions(listings[b.n].options, lstBase) } catch (e) { if (e instanceof LstUnsupported) throw new Unsupported(e.message); throw e }
    const { styleOf, fonts } = lstFontsAt("normalsize", { enc: "OT1", fam: "cmr", ser: "m", shape: "n" })
    const base = styleOf(o.basicstyle), baseFont = selectFont(run.k, base.size, base.a)
    // \lst@width: basewidth (0.6em, 0.45em for flexible columns) in the listing's font
    const width = parseDimen(o.columns === "fixed" ? "0.6em" : "0.45em", { em: baseFont.params[QUAD], ex: baseFont.params[X_HEIGHT] })
    const sz = run.k.sizes[base.size], hsize = run.k.dimens.columnwidth
    const units = { em: baseFont.params[QUAD], ex: baseFont.params[X_HEIGHT] }
    const dim = (key: keyof LstOptions) => { try { return parseDimen(o[key] as string, units) } catch { throw new Unsupported(`${key}=${o[key]}`) } }
    const xleft = dim("xleftmargin"), lw = hsize - xleft - dim("xrightmargin")
    let events
    try { events = lstScan({ width, lines: listings[b.n].lines, options: o, fonts, carry: lstCarry, breaks: { indent: dim("breakindent"), lineWidth: lw, left: xleft } }) } catch (e) { if (e instanceof LstUnsupported) throw new Unsupported(e.message); throw e }
    const smallskip = glue(196608, 65536, 0, 65536, 0), medskip = cls === "letter" ? dimen(medskipamount) : glue(393216, 131072, 0, 131072, 0)
    const vspace = (g: GlueSpec) => { v.vskip(g); v.vskip(dimen(0)) } // \vspace in vertical mode
    // \lst@Init: \par\penalty-50\relax\vspace\lst@aboveskip, \normalbaselines, \lst@MakeCaption t
    v.par()
    const clubOutside = v.club
    v.nodes.push(penalty(-50))
    vspace(medskip)
    v.nodes.push(penalty(0)) // \allowbreak
    // \@currentHref after it: \refstepcounter{lstlisting} (a caption) or \lst@HRefStepCounter (\lst@neglisting
    // goes down), then each line's \refstepcounter{lstnumber}
    let captioned = 0
    // hyperref: \hyper@refstepcounter's anchor (\baselineskip H.A) where the counter steps
    const lstAnchor = (name: string) => { if (hyper) v.nodes.push(...anchor(name, run.k.sizes.normalsize.baselineskip.width, "v", lastNode())) }
    if (o.caption !== null) {
      if (cls !== "article") throw new Unsupported("a listing caption outside article")
      const text = o.caption.replace(/\s+/g, " ").trim()
      if (/[\\{}$%&#^_~]/.test(text)) throw new Unsupported(`listing caption "${text}"`)
      const n = captioned = ++run.listingCount // \refstepcounter{lstlisting}
      refs.href = counters.href("lstlisting", n)
      lstAnchor(refs.href)
      if (o.label !== null) {
        if (!/^[A-Za-z0-9:._-]+$/.test(o.label)) throw new Unsupported(`listing label ${o.label}`)
        v.nodes.push(labelWrite(refs, o.label, String(n), counters.href("lstlisting", n), hyper ? labelName(text) : refs.name)) // nameref: the caption
        v.nodes.push(...esphackNobreaks(v.nobreak))
      }
      v.nodes.push({ kind: "whatsit", text: `\\write1{\\@writefile{lol}{\\protect \\contentsline {lstlisting}{\\protect \\numberline {${n}}${text}}{\\thepage }{${hyper ? refs.href : ""}}\\protected@file@percent }}` })
      if (v.nobreak) v.nodes.push(penalty(10000)) // \protected@write's \nobreak
      // in a group: \par\@parboxrestore\normalsize\normalfont, \@makecaption with \vskip as \nobreak\vskip…\nobreak
      v.nodes.push(penalty(10000)); v.vskip(smallskip); v.nodes.push(penalty(10000))
      const l: Node[] = [], state = { spaceFactor: 1000 }
      appendText(l, "Listing", romanFont, state, false)
      l.push(penalty(10000), glue(romanFont.params[SPACE], romanFont.params[SPACE_STRETCH], 0, romanFont.params[SPACE_SHRINK], 0)) // ~
      appendText(l, `${n}: ${text}`, romanFont, state, false)
      const cap = hpack(setgroup(l)) // \sbox
      if (cap.width > hsize) throw new Unsupported("a listing caption wider than the line")
      v.box(hpack([filGlue(), cap, filGlue()], { exactly: hsize }), run.k.sizes.normalsize.baselineskip)
      v.nodes.push(penalty(10000)); v.vskip(smallskip); v.nodes.push(penalty(10000))
    } else if (o.label !== null) throw new Unsupported("a listing label without a caption")
    // \lst@HRefStepCounter (\theHlstlisting: the chapter's, then the number); its \@currentHref is global
    else { run.negListing--; lstAnchor(counters.href("lstlisting", run.negListing)); if (hyper) refs.href = counters.href("lstlisting", run.negListing) }
    // the lineshape and frames aspects: \linewidth less xleftmargin and xrightmargin, \@totalleftmargin plus
    // xleftmargin, \lst@parshape (\parshape 1 for every paragraph); the frame's dimensions in the listing's font
    const parShape: [number, number][] = [[xleft, lw]]
    // breaklines: \pretolerance\@M, \rightskip\@flushglue, \parshape 2 with \lst@breakshape for the lines after the first
    const breaks = o.breaklines ? { pretolerance: 10000, rightSkip: paramGlue("rightskip", filGlue()) } : {}
    const shapes = lstFrameShapes(o.frame)
    // (the Init hook: fillcolor from backgroundcolor, rulesepcolor from fillcolor)
    const bkg = styleColors(cx, o.backgroundcolor), fill = o.fillcolor ? styleColors(cx, o.fillcolor) : bkg, rulesep = o.rulesepcolor ? styleColors(cx, o.rulesepcolor) : fill
    const fr: LstFrame = {
      tshape: shapes.t, bshape: shapes.b, lshape: shapes.l, rshape: shapes.r, rule: dim("framerule"), sep: dim("framesep"), rulesep: dim("rulesep"), xleft: dim("framexleftmargin"), xright: dim("framexrightmargin"),
      colors: { rule: styleColors(cx, o.rulecolor), bkg, fill, rulesep },
    }
    const frame = () => lstFrameBoxV(fr, lw, sz.strut.height, sz.strut.depth)
    let lineskip = run.k.glue.lineskip, lineskiplimit = run.k.dimens.lineskiplimit
    const frameParagraph = (box: BoxNode, end: Node[] = [], top = false) => {
      // the \everypar in force: a heading's, which resets \clubpenalty in the paragraph after its own
      const start: Node[] = [box]
      if (runInHead && top) { // a run-in heading's: \global\@noskipsecfalse, \clubpenalty\@M, the heading in place
        start.unshift(...runInHead(baseFont.params[QUAD], o.breaklines ? 0 : run.k.dimens.parindent)); runInHead = null; run.noskipsec = false; v.club = 10000 // (breaklines: \parindent\z@)
      } else if (v.nobreak) { v.nobreak = false; v.club = 10000 } // \@nobreakfalse\clubpenalty\@M (no indent box to take off)
      else if (v.afterheadingEverypar) { v.club = run.k.ints.clubpenalty; v.afterheadingEverypar = false }
      const p = paragraphInput("", run.k, "normalsize", doc, { start, parShape, ...breaks, amsmath, clubPenalty: v.club, end })
      const lb = lineBreak(p.list, p.params)
      decisions.push(...p.notes, lb.trace)
      v.paragraph(lb.vlist, dimen(0), sz.baselineskip, lineskip, lineskiplimit)
    }
    // \lst@frameInit's top: \par\lst@parshape, \vskip\@tempdima\vskip\lineskip if \@tempdima = \ht - \baselineskip is
    // negative (\prevdepth would count only from 256pt), \noindent\box\z@\par; then \lineskiplimit\maxdimen \lineskip\z@
    // \lsthk@Init: basicstyle (its \color pushes on the vertical list), … \lst@frameInit
    const basicColors = styleColors(cx, o.basicstyle)
    for (const c of basicColors) v.nodes.push(colorPush(c))
    const top = lstFrameH(fr, lw, "T")
    if (top) {
      const t = top.height - sz.baselineskip.width
      if (t < 0) { v.vskip(dimen(t)); v.vskip(run.k.glue.lineskip) }
      frameParagraph(top, [], true)
      lineskip = dimen(0); lineskiplimit = 1073741823
    }
    // line numbers: \everypar's \refstepcounter{lstnumber} and \lst@SkipOrPrintLabel (every \lst@stepnumber-th from
    // \lst@firstnumber), \lst@PlaceNumber: \llap{\normalfont numberstyle n \kern numbersep} (right: \rlap after \linewidth)
    // (the Init hook reads firstnumber=auto's \lst@lineno before InitVars resets it: the last listing's)
    const F = o.firstnumber ?? 1, S = o.stepnumber, F0 = o.firstnumber ?? run.lstLineno
    let lstnumber = F - 1, numberFirst = o.numberfirstline
    let skip = S > 0 ? F0 - Math.trunc(F0 / S) * S : 0
    if (S > 0 && skip > 0) skip -= S
    const sizes = [...o.basicstyle.matchAll(/\\(tiny|scriptsize|footnotesize|small|normalsize|large|Large)(?![a-zA-Z])/g)].map((m) => m[0]).join("")
    const numberStyle = styleOf(sizes + o.numberstyle), numberFont = selectFont(run.k, numberStyle.size, numberStyle.a)
    // (on the right the \kern comes before \lst@numberstyle: em and ex of \normalfont at the basic style's size)
    const sepFont = o.numbers === "right" ? selectFont(run.k, styleOf(sizes).size, { enc: "OT1", fam: "cmr", ser: "m", shape: "n" }) : numberFont
    let numbersep = 0
    try { numbersep = parseDimen(o.numbersep, { em: sepFont.params[QUAD], ex: sepFont.params[X_HEIGHT] }) } catch { throw new Unsupported(`numbersep=${o.numbersep}`) }
    const number = (empty: boolean): Node[] => {
      lstnumber++
      // hyperref: the \refstepcounter{lstnumber} anchor, in horizontal mode after the frame box
      const a = hyper ? anchor(`lstnumber.${captioned || run.negListing}.${lstnumber}`, sz.baselineskip.width, "h", undefined) : []
      if (o.numbers === "none" || S === 0) return a
      if (empty && !o.numberblanklines && skip === 0) skip -= S // \lsthk@OnEmptyLine
      let place = false
      if (skip === 0) { skip -= S; place = true; numberFirst = false } else if (numberFirst) { place = true; numberFirst = false }
      skip++
      if (!place) return a
      const digits: Node[] = []
      appendText(digits, String(lstnumber), numberFont, { spaceFactor: 1000 }, false)
      const hss = ssGlue()
      // numberstyle's \color: pushed in the box, popped after it (\aftergroup at the box's end)
      const nc = styleColors(cx, o.numberstyle), push = nc.map((c) => colorPush(c)), pops = nc.map(() => colorPop())
      return [...a, o.numbers === "left" ? hpack([hss, ...push, ...digits, kern(numbersep, true)], { exactly: 0 }) : hpack([kern(lw, true), kern(numbersep, true), ...push, ...digits, hss], { exactly: 0 }), ...pops]
    }
    // each line: \par\noindent (\everypar: \lst@parshape, the frame box, the number) \hbox{}, its boxes
    let line: Node[] | null = null, lineCount = 0
    const breakLine = (start: Node[], shape?: [number, number]) => {
      const p = paragraphInput("", run.k, "normalsize", doc, { start, parShape: shape ? [...parShape, shape] : parShape, ...breaks, amsmath, clubPenalty: v.club }) // (the listing's \everypar leaves \clubpenalty)
      const lb = lineBreak(p.list, p.params)
      decisions.push(...p.notes, lb.trace)
      return lb.vlist
    }
    let shape: [number, number] | undefined
    const endLine = () => { if (line) v.paragraph(breakLine(line, shape), dimen(0), sz.baselineskip, lineskip, lineskiplimit); line = null }
    for (const e of events) {
      // empty lines at the end are paragraphs in a \vbox that is thrown away, while the last line's is still open
      if ("newline" in e && e.discarded) { breakLine([frame(), ...number(!!e.empty), emptyBox("hlist", 0)], e.shape); lineCount++ }
      else if ("newline" in e) { endLine(); line = [frame(), ...number(!!e.empty), emptyBox("hlist", 0)]; shape = e.shape; lineCount++ }
      else if ("disc" in e) line!.push({ kind: "disc", pre: [], post: [hpack([ssGlue(), frame(), kern(e.indent, true), kern(-xleft, true)], { exactly: 0 })], replaceCount: 0 })
      else line!.push(e.node)
    }
    endLine()
    if (lineCount) refs.href = `lstnumber.${captioned || run.negListing}.${lstnumber}` // \theHlstnumber
    run.lstLineno = listings[b.n].lines.length
    // \lst@DeInit: \par\removelastskip, \par\penalty-50\vspace\lst@belowskip; \lst@doendpe
    const last = v.lastSkip
    if (last.width !== 0) v.vskip(negate(last))
    // \lst@frameExit: \everypar{}\par\lst@parshape\nointerlineskip\noindent\box\z@ (ended by the \par below)
    const bottom = lstFrameH(fr, lw, "B")
    // \lst@DeInit's \normalcolor: in the bottom frame's paragraph, which the \par below ends
    if (bottom) { v.prevDepth = IGNORE_DEPTH; frameParagraph(bottom, xcolor.on ? [colorPush()] : []) }
    else if (xcolor.on) v.nodes.push(colorPush())
    v.nodes.push(penalty(-50))
    vspace(medskip)
    if (xcolor.on) v.nodes.push(colorPop()) // the group's end
    for (const _ of basicColors) v.nodes.push(colorPop())
    v.club = clubOutside // (\clubpenalty set in the listing's group ends with it)
    v.endpePar = v.doendpe = v.endpeEverypar = true
    v.afterheadingEverypar = false // \lst@doendpe's \everypar replaces it
    v.nobreak = false // \end{lstlisting}: \@nobreakfalse
  }

  /**
   * \caption{text} in a float of type `env` at \hsize `hsize`: \refstepcounter, the lof/lot line, then in a group
   * \@parboxrestore\normalsize\@makecaption: \vskip\abovecaptionskip, the caption centered in an \hbox to \hsize
   * or, wider than that, a paragraph, then \vskip\belowcaptionskip. Its number and nameref's name come back.
   */
  function caption(env: "figure" | "table", source: string, hsize: number, out: { push(n: Node): void; box(b: BoxNode): void; paragraph(start: Node[], text: string): void }): { number: number; name: string } {
    const text = source.replace(/\s+/g, " ").trim()
    if (/[\\{}$%&#^_~]/.test(text)) throw new Unsupported(`caption "${text}"`)
    const number = ++counters[env]
    refs.href = counters.href(env, number) // global; \@currentlabel ends with the float's group
    const ext = env === "figure" ? "lof" : "lot"
    out.push({ kind: "whatsit", text: `\\write1{\\@writefile{${ext}}{\\protect \\contentsline {${env}}{\\protect \\numberline {${counters.the(number)}}{\\ignorespaces ${text}}}{\\thepage }{${hyper ? refs.href : ""}}\\protected@file@percent }}` })
    out.push(glue(run.k.dimens.abovecaptionskip))
    // \sbox\@tempboxa{\fnum@figure: text}: \figurename\nobreakspace\thefigure
    const l: Node[] = [], state = { spaceFactor: 1000 }
    appendText(l, env === "figure" ? "Figure" : "Table", romanFont, state, false)
    l.push(penalty(10000), glue(romanFont.params[SPACE], romanFont.params[SPACE_STRETCH], 0, romanFont.params[SPACE_SHRINK], 0)) // \nobreak\ 
    // hyperref: \hyper@@anchor (H.S H.R) before the text, after "n: "
    if (hyper) { appendText(l, `${counters.the(number)}: `, romanFont, state, false); l.push(...spotAnchor(refs.href, "h", l.at(-1))); appendText(l, text, romanFont, state, false) }
    else appendText(l, `${counters.the(number)}: ${text}`, romanFont, state, false)
    const cap = hpack(setgroup(l)) // \sbox
    if (cap.width > hsize) { // too wide for a line: #1: #2\par, a paragraph
      const start: Node[] = [hpack([])]
      appendText(start, env === "figure" ? "Figure" : "Table", romanFont, { spaceFactor: 1000 }, false)
      start.push(penalty(10000), glue(romanFont.params[SPACE], romanFont.params[SPACE_STRETCH], 0, romanFont.params[SPACE_SHRINK], 0))
      if (hyper) { appendText(start, `${counters.the(number)}: `, romanFont, { spaceFactor: 1000 }); start.push(...spotAnchor(refs.href, "h", start.at(-1))); out.paragraph(start, text) }
      else out.paragraph(start, `${counters.the(number)}: ${text}`)
    } else out.box(hpack([filGlue(), cap, filGlue()], { exactly: hsize }))
    out.push(glue(run.k.dimens.belowcaptionskip))
    return { number, name: labelName(text) } // (nameref drops a final period)
  }
  function floatBlock(b: Extract<Block, { kind: "float" }>) {
    if (b.inPar) throw new Unsupported("a float inside a paragraph")
    if (b.blank) v.par() // (after \@doendpe, its \par resets \clubpenalty)
    // the placement specifier as \@xfloat counts it: h, t (2), b (4), p (8), and 16 unless !
    let fps = 16
    for (const c of b.fps ?? "tbp") { // \fps@figure and \fps@table are tbp
      if (c === "h") { if (fps % 2 === 0) fps++ }
      else if (c === "t" || c === "b" || c === "p") { const bit = c === "t" ? 2 : c === "b" ? 4 : 8; if (Math.floor(fps / bit) % 2 === 0) fps += bit }
      else if (c === "!") { if (fps > 15) fps -= 16 }
      else throw new Unsupported(`float option ${c}`)
    }
    const content: Node[] = []
    let pd: number | null = IGNORE_DEPTH, number = 0, captionName = ""
    const hsize = run.k.dimens.columnwidth
    const fbody = b.body.trim()
    const tokens = [...fbody.matchAll(/\\centering\b|\\caption\s*\{(?:[^{}]|\{[^{}]*\})*\}|\\(?:label|vspace)\s*\{[^}]*\}|\\LXtabular\{\d+\}|\\LXminipage\{\d+\}|\S+/g)]
    const items = tokens.map((t) => t[0])
    let centered = false
    /** a paragraph in the float: \parindent is zero (\@parboxrestore), \sloppy (\tolerance 9999, \emergencystretch
     *  3em), and \centering's flush glue when it came before */
    const floatParagraph = (start: Node[], body: string, centering = centered) => {
      const flush = (p: string) => paramGlue(p, filGlue())
      // \centering's \finalhyphendemerits=\z@ outlasts \@parboxrestore, which resets only the skips
      const shape = centering ? { leftSkip: flush("leftskip"), rightSkip: flush("rightskip"), parFillSkip: paramGlue("parfillskip", glue(0)), finalHyphenDemerits: 0 } : centered ? { finalHyphenDemerits: 0 } : {}
      // (\clubpenalty is the one in force: \@parboxrestore leaves it, and \@setminipage's \everypar replaces \@afterheading's)
      const par = paragraphInput(body, run.k, "normalsize", doc, { ...shape, start, amsmath, tolerance: 9999, emergencyStretch: 3 * romanFont.params[QUAD], clubPenalty: v.club })
      const lb = lineBreak(par.list, par.params)
      decisions.push(...par.notes, lb.trace)
      // new_graf in internal vertical mode adds \parskip (zero here) only to a list that is not empty, and
      // so does LaTeX's restart of the paragraph
      if (content.length) content.push(paramGlue("parskip", glue(0)), paramGlue("parskip", glue(0)))
      for (const n of lb.vlist) {
        if (n.kind === "hlist") pd = appendToVlist(content, n, pd, run.k.sizes.normalsize.baselineskip, run.k.glue.lineskip, run.k.dimens.lineskiplimit)
        else content.push(n)
      }
    }
    run.captype = b.env
    try {
    for (let ii = 0; ii < items.length; ii++) {
      const it = items[ii]
      if (it === "\\centering") { centered = true; continue }
      // minipages start a paragraph (\leavevmode): with what joins them on the line (\hfill, \quad, ~), up to a blank line
      if (/^\\LXminipage\{\d+\}$/.test(it)) {
        let jj = ii
        while (jj + 1 < items.length && /^(?:\\LXminipage\{\d+\}|\\hfill|\\hfil|\\quad|\\qquad|~)$/.test(items[jj + 1]) && !/\n[ \t]*\n/.test(fbody.slice(tokens[jj].index! + items[jj].length, tokens[jj + 1].index!))) jj++
        floatParagraph([hpack([])], fbody.slice(tokens[ii].index!, tokens[jj].index! + items[jj].length))
        ii = jj
        continue
      }
      // a tabular starts a paragraph (\leavevmode): the \parindent box (zero after \@parboxrestore), then
      // the tabular's box, alone on its line; \centering sets \leftskip and \rightskip to \@flushglue
      const tab = it.match(/^\\LXtabular\{(\d+)\}$/)
      if (tab) {
        floatParagraph([hpack([]), doc.tabular!(Number(tab[1]), "normalsize", normalAttrs, undefined, { notes: decisions, club: v.club, widow: run.k.ints.widowpenalty, finalHyph: centered ? 0 : classParams(run.k).finalHyphenDemerits })], "")
        continue
      }
      // \vspace{skip} in vertical mode: \vskip skip \vskip\z@skip
      let m = it.match(/^\\vspace\s*\{([^}]*)\}$/)
      if (m) {
        let g: GlueSpec
        try { g = parseGlue(m[1], { em: romanFont.params[QUAD], ex: romanFont.params[X_HEIGHT] }) } catch { throw new Unsupported(`\\vspace{${m[1]}}`) }
        content.push(plain(g), glue(0))
        continue
      }
      m = it.match(/^\\caption\s*\{([^]*)\}$/)
      if (m) {
        ({ number, name: captionName } = caption(b.env, m[1], hsize, {
          push: (n) => content.push(n),
          box: (x) => { pd = appendToVlist(content, x, pd, run.k.sizes.normalsize.baselineskip, run.k.glue.lineskip, run.k.dimens.lineskiplimit) },
          paragraph: (start, text) => floatParagraph(start, text, false), // \@caption's \@parboxrestore undoes \centering
        }))
        continue
      }
      // \label after the caption: \protected@write\@auxout{}{\string\newlabel{key}{{n}{\thepage }{}{figure.n}{}}}
      m = it.match(/^\\label\s*\{([A-Za-z0-9:._-]+)\}$/)
      if (m && number) { content.push(labelWrite(refs, m[1], counters.the(number), refs.href, hyper ? captionName : refs.name)); continue } // nameref: the caption
      if (/^\\label\b/.test(it)) throw new Unsupported(m ? "\\label before the caption" : `${it} in a ${b.env}`)
      throw new Unsupported(`${it} in a ${b.env}`)
    }
    } finally { run.captype = null }
    content.push(glue(0)) // \@endfloatbox: \par\vskip\z@skip
    const box = vpack(xcolor.on ? [colorPush(), vpack(content), colorPop()] : [vpack(content)]) // \color@vbox\normalcolor\vbox{…}
    if (box.height > run.k.dimens.textheight) box.height = run.k.dimens.textheight // \@largefloatcheck
    const index = run.floats++
    v.nodes.push({ kind: "whatsit", text: "", float: { box, count: fps + 32 * (b.env === "figure" ? 1 : 2), nobreak: v.nobreak, index, here: !notHere.has(index) } satisfies Float }) // \ftype@figure 1, \ftype@table 2
    // placed here, the float ends \if@nobreak (\@addtocurcol's \nobreak\@nobreakfalse\everypar{});
    // elsewhere \nobreak alone, and the text after it is still right after the heading
    if (!notHere.has(index)) v.nobreak = false
  }

  /**
   * \tableofcontents: \section*{\contentsname} (report: \chapter*), then \@starttoc{toc}, which reads
   * the lines the run before wrote (\contentsline → \l@<name>) and ends with \@nobreakfalse
   */
  /**
   * letter.cls's letter environment: \newpage, \c@page\@ne, \interlinepenalty200. \opening (with a return
   * address): \thispagestyle{empty}, {\raggedleft\begin{tabular}{l@{}}\fromaddress\\*[2\parskip]\@date
   * \end{tabular}\par}, \vspace{2\parskip}, {\raggedright\toname\\\toaddress\par}, \vspace{2\parskip}, the
   * opening\par\nobreak; the body; \closing: \par\nobreak\vspace{\parskip}, \stopbreaks (\interlinepenalty\@M,
   * \par is \@@par\nobreak), \noindent\hspace*{\longindentation}\parbox{\indentedwidth}{\raggedright closing
   * \\[6\medskipamount] signature\strut}\par; \end{letter}'s \pagebreak
   */
  function letter(b: Extract<Block, { kind: "letter" }>) {
    if (cls !== "letter") throw new Unsupported(`a letter in ${cls}`)
    if (pagestyle === "headings") throw new Unsupported("letter's \\ps@headings") // To: name, date, Page n
    // letter.cls's \footnoterule and \@makefntext (a 5pt \hangindent) are its own
    if (/\\footnote\b/.test(JSON.stringify(b))) throw new Unsupported("a footnote in a letter")
    if (!letterInfo.address) throw new Unsupported("a letter without \\address (\\ps@firstpage)")
    if (run.k.ints.twoside) throw new Unsupported("a two-sided letter")
    const check = (t: string) => { if (/[\\{}$%&#^_~]/.test(t.replace(/\\\\/g, ""))) throw new Unsupported(`a letter's "${t}"`) }
    ;[letterInfo.address, b.to, letterInfo.signature ?? letterInfo.name ?? "", b.closing].forEach(check)
    const hook = (h: OutputHook): Node => ({ kind: "whatsit", text: "", hook: h })
    const sz = run.k.sizes.normalsize
    v.par()
    v.nodes.push(filGlue(), penalty(-10000), hook("page=1"))
    run.k = { ...run.k, ints: { ...run.k.ints, interlinepenalty: 200 } }
    const parskip = run.k.glue.parskip.width // letter.cls: 0.7em; 2\parskip is a dimension
    const vspace = (g: GlueSpec) => { v.vskip(g); v.vskip(dimen(0)) } // \vspace in vertical mode
    const flush = (p: string) => paramGlue(p, filGlue())
    const raggedleft = { leftSkip: flush("leftskip"), rightSkip: paramGlue("rightskip", glue(0)), parFillSkip: paramGlue("parfillskip", glue(0)), finalHyphenDemerits: 0 }
    const raggedright = { rightSkip: flush("rightskip"), finalHyphenDemerits: 0 }
    // \opening
    v.nodes.push(hook("empty"))
    const from = letterInfo.address.split(/\\\\/).map((x) => x.trim())
    const date = (title.date ?? "\\today").replace(/\\today\b\s*/g, today(epoch)).trim()
    check(date)
    const lines: TabLine[] = from.map((r, i) => ({ cells: [{ text: r }], ...(i === from.length - 1 ? { skip: 2 * parskip } : {}) }))
    lines.push({ cells: [{ text: date }] })
    typeset("", { ...raggedleft, start: [emptyBox("hlist", 0), tabular(lines, preamble("l@{}"), "normalsize", "c")] }, outerParskip)
    vspace(dimen(2 * parskip))
    b.to.split(/\\\\/).map((x) => x.trim()).forEach((line, i) => { // \@centercr between the lines
      if (i) v.addvspace(negate(outerParskip))
      typeset(line, { ...raggedright, start: [emptyBox("hlist", 0)] }, outerParskip)
    })
    vspace(dimen(2 * parskip))
    typeset(b.opening, {}, outerParskip)
    v.nodes.push(penalty(10000))
    b.blocks.forEach(processBlock)
    // \closing
    v.par()
    v.nodes.push(penalty(10000))
    vspace(run.k.glue.parskip)
    run.k = { ...run.k, ints: { ...run.k.ints, interlinepenalty: 10000 } }
    const longindentation = xnOverD(classTextwidth, 32768, 65536), width = classTextwidth - longindentation
    // the \parbox: \@parboxrestore (\parskip and \parindent zero), \raggedright, \\[6\medskipamount] (\@centercr)
    const pv = new VerticalList(run.k)
    pv.nodes = []; pv.prevDepth = IGNORE_DEPTH
    const inBox = (text: string, end: Node[]) => {
      const p = paragraphInput(text, run.k, "normalsize", doc, { ...raggedright, hsize: width, start: [emptyBox("hlist", 0)], amsmath })
      p.list.push(...end)
      const lb = lineBreak(p.list, p.params)
      decisions.push(...p.notes, lb.trace)
      return lb.vlist
    }
    pv.lines(inBox(b.closing, []))
    pv.addvspace(dimen(0))
    pv.vskip(dimen(6 * medskipamount))
    pv.paragraph(inBox(letterInfo.signature ?? letterInfo.name ?? "", [{ kind: "rule", width: 0, height: sz.strut.height, depth: sz.strut.depth }]), dimen(0)) // \strut
    const box = vpack(pv.nodes)
    const delta = box.height + box.depth // \vcenter (make_vcenter, § 736)
    box.height = mathEnv(run.k, "normalsize", amsmath).fonts[0][2]!.params[22] + (delta % 2 ? Math.trunc((delta + 1) / 2) : delta / 2)
    box.depth = delta - box.height
    const parbox: Node[] = [{ kind: "math", on: true, width: 0 }, box, { kind: "math", on: false, width: 0 }]
    // \noindent \hspace*: \vrule width\z@ \nobreak \hskip \hskip\z@skip
    typeset("", { start: [{ kind: "rule", width: 0, height: null, depth: null }, penalty(10000), glue(longindentation), glue(0), ...parbox] }, outerParskip)
    v.nodes.push(penalty(10000))
    for (let i = 0; i < b.pars; i++) v.nodes.push(penalty(10000)) // the \par of a blank line: \@@par\nobreak
    v.nodes.push(penalty(-10000)) // \end{letter}'s \pagebreak
  }

  /** a tabular's \hbox at a size, its entries in the font `attrs` (tabular.ts) */
  function tabular(lines: TabLine[], cols: TabCol[], size: SizeCommand, pos: "t" | "b" | "c", attrs: FontAttrs = normalAttrs, sfcodes?: Record<number, number>, outer?: TabularOuter): BoxNode {
    const font = selectFont(run.k, size, attrs)
    const sz = run.k.sizes[size]
    const env: TabularEnv = {
      strut: run.k.sizes[size].strut, tabcolsep: run.k.dimens.tabcolsep, arrayrulewidth: run.k.dimens.arrayrulewidth, doublerulesep: run.k.dimens.doublerulesep,
      lineskiplimit: run.k.dimens.lineskiplimit, axis: mathEnv(run.k, size, amsmath).fonts[0][2]!.params[22],
      cell: (text, state) => {
        if (/\\(?:footnote|label)(?![A-Za-z])/.test(text)) throw new Unsupported(`a tabular entry "${text.trim().slice(0, 40)}"`)
        try { return hlistInput(text, run.k, size, doc, attrs, sfcodes ? Object.assign(state, { sfcodes }) : state, amsmath) } catch (e) {
          if (e instanceof Error && e.message.startsWith("paragraph adapter")) throw new Unsupported(`a tabular entry "${text.trim().slice(0, 40)}"`)
          throw e
        }
      },
      skip: (text) => { try { return parseGlue(text, { em: font.params[QUAD], ex: font.params[X_HEIGHT] }).width } catch { throw new Unsupported(`\\\\[${text}] in a tabular`) } },
      // \vtop\bgroup \hsize width \@arrayparboxrestore (\parindent and \parskip zero, \leftskip and \rightskip zero,
      // \parfillskip \@flushglue, the normal \baselineskip, \lineskip and \lineskiplimit, \sloppy) \ignorespaces entry,
      // then \@finalstrut\@arstrutbox (\unskip, then \nobreak in a paragraph and \vskip-\baselineskip out of one, and
      // \vrule depth \dp\@arstrutbox) \par\egroup
      pbox: (text, width, cr) => {
        if (!outer) throw new Unsupported("a p{width} column here")
        if (/\\(?:footnote|label|par|newline|linebreak)(?![A-Za-z])|\n\s*\n/.test(text)) throw new Unsupported(`a p{width} entry "${text.trim().slice(0, 40)}"`)
        let hsize: number
        try { hsize = parseDimen(width, { em: font.params[QUAD], ex: font.params[X_HEIGHT], internal: widthRegisters(outer.lineWidth) }) } catch { throw new Unsupported(`p{${width}}`) }
        const list: Node[] = []
        const strut: Node = { kind: "rule", width: 0, height: 0, depth: sz.strut.depth }
        let end: Node[] = [...cr, penalty(10000), strut]
        // (an empty entry: the \vrule starts a paragraph after the \vskip, and new_graf and LaTeX's restart of it each
        // add \parskip, zero here)
        if (!text.trim() && !cr.length) { list.push(glue(-sz.baselineskip.width), paramGlue("parskip", glue(0)), paramGlue("parskip", glue(0))); end = [strut] }
        let p: ReturnType<typeof paragraphInput>
        try {
          p = paragraphInput(text, run.k, size, doc, { attrs, ...(sfcodes ? { sfcodes } : {}), hsize, start: [emptyBox("hlist", 0)], amsmath, tolerance: 9999, emergencyStretch: 3 * font.params[QUAD], clubPenalty: outer.club, widowPenalty: outer.widow, finalHyphenDemerits: outer.finalHyph, unskip: 1, end })
        } catch (e) {
          if (e instanceof Error && e.message.startsWith("paragraph adapter")) throw new Unsupported(`a p{width} entry "${text.trim().slice(0, 40)}"`)
          throw e
        }
        const lb = lineBreak(p.list, p.params)
        outer.notes.push(...p.notes, lb.trace)
        let pd: number | null = IGNORE_DEPTH
        for (const n of lb.vlist) {
          if (n.kind === "hlist") pd = appendToVlist(list, n, pd, sz.baselineskip, run.k.glue.lineskip, run.k.dimens.lineskiplimit)
          else list.push(n)
        }
        return vtop(list)
      },
      ...(booktabs ? { booktabs } : {}),
    }
    try { return tabularBox(lines, cols, env, pos) } catch (e) { if (e instanceof TabularUnsupported) throw new Unsupported(e.message); throw e }
  }

  if (run.runIn) runInAlone() // \end{document}'s \clearpage: \newpage's \if@noskipsec\leavevmode
  if (run.noskipsec) { v.par(); noskipsecPar("the end of the document") } // \@kernel@before@enddocument's \par, then \clearpage
  let built: ReturnType<typeof endDocument>
  try { built = endDocument(v.nodes, run.k, outerParskip) } catch (e) {
    if ((e as Error).message.startsWith("page builder: a float")) throw new Unsupported((e as Error).message.slice(14))
    if (e instanceof OutputUnsupported) throw new Unsupported(e.message)
    throw e
  }
  const { pages, pageTrace } = built
  const columns = makeColumns(pages, run.k, cls === "letter")
  const sl = selectFont(run.k, "normalsize", { enc: run.k.ints.T1 ? "T1" : "OT1", fam: "cmr", ser: "m", shape: "sl" } as FontAttrs)
  const heads = pageMarks(pages)
  const shipped = columns.map((c, i) => {
    const even = run.k.ints.twoside && pages[i].count % 2 === 0
    return outputPage(c.outputbox, pages[i].count, run.k, pages[i].special ?? pagestyle, hyper, markText(even ? heads[i].left : heads[i].right, sl), pages[i].thepage)
  })
  // \thepage in each toc line and \newlabel: the page its \write was shipped out on
  let written: Aux | null = null
  if (blocks.some((b) => b.kind === "toc") || /\\(?:page)?ref\{|\\cite\{/.test(body) || hyper) {
    const pageOf = new Map<Node, string>(), order = new Map<Node, number>()
    const walk = (n: Node, page: string) => { pageOf.set(n, page); order.set(n, order.size); if (n.kind === "hlist" || n.kind === "vlist") for (const c of n.list) walk(c, page) }
    shipped.forEach((b, i) => walk(b, pages[i].thepage))
    const page = (node: Node) => {
      const p = pageOf.get(node)
      if (p === undefined) throw new Error("a \\write that was not shipped out")
      return p
    }
    written = {
      toc: tocFile.written((n) => order.get(n)!, page),
      // the .aux file has them in the order they were shipped out, and the last \newlabel of a key wins
      labels: new Map(refs.writes.map((w) => ({ ...w, page: page(w.node) })).sort((x, y) => order.get(x.node)! - order.get(y.node)!).map((w) => [w.key, { label: w.label, page: w.page, href: w.href }])),
      bookmarks: bookmarks.written,
      // each thebibliography numbers its \bibitem from 1; the last \bibcite of a key wins
      cites: new Map(blocks.flatMap((b) => (b.kind === "bib" ? b.keys.map((key, i) => [key, String(i + 1)] as [string, string]) : []))),
    }
  }
  return {
    result: {
      trace: shipOut(shipped, undefined, pages.map((p) => p.count)),
      decisions,
      pages: pageTrace,
      columns: columns.map((c) => c.column && c.column.map(emitBoxes)),
      notes: [`${cls} [${option}], \\pagestyle{${pagestyle}}; ${blocks.length} block(s), ${pages.length} page(s)${toc ? `; ${toc.length} toc line(s)` : ""}`],
    },
    written,
  }
}
