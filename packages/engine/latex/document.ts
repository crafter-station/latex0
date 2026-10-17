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
import { loadFont, QUAD, SPACE, SPACE_SHRINK, SPACE_STRETCH, X_HEIGHT, type Font } from "../layout/font"
import { parseDimen, parseGlue, Scanner } from "../layout/dimen"
import { appendText, spaceGlue } from "../layout/hmode"
import { lineBreak } from "../layout/linebreak"
import { emptyBox, FIL, FILL, glue, kern, paramGlue, penalty, type BoxNode, type CharNode, type GlueNode, type Node } from "../layout/nodes"
import { displayLine, finishDisplay, preDisplaySize } from "../layout/display"
import { DISPLAY as DISPLAY_STYLE, groupField, mlistToHlist, OPEN as OPEN_NOAD, ORD as ORD_NOAD, TEXT as TEXT_STYLE, type MItem } from "../mathlayout/mlist"
import { parseMath } from "../mathlayout/parse"
import { hpack, vpack } from "../layout/pack"
import { halign } from "../layout/align"
import { xnOverD } from "../layout/arith"
import type { ParagraphTrace } from "../trace/decisions"
import type { LayoutResult } from "./result"
import { blocksOf, displaySegments, type Block, type Display, type ListBlock, type Part } from "./blocks"
import { prepareSource, type Listing, type MinipageSource, type TabularSource } from "./source"
import { COUNTER_COMMANDS, Counters } from "./counters"
import { EMPTY_MARK, markboth, markright, markText, markValue, MarkWriter, pageMarks, sectionMarks } from "./marks"
import { TocWriter, type TocEntry } from "./toc"
import { readPreamble } from "./preamble"
import { runState } from "./run"
import type { Ctx } from "./context"
import { Unsupported } from "./unsupported"
import { addGlue, dimen, IGNORE_DEPTH, LOW_PENALTY, negate, plain, VerticalList } from "./vlist"
import { endDocument, outputOptions, makeColumns, outputPage, NobreakFloat, OutputUnsupported, type Float, type OutputHook } from "./output"
import { anchor, Bookmarks, dest, documentStart, HA, HS, labelName, sectionAnchorBox, spotAnchor, type Bookmark } from "./hyperref"
import { Colors, ColorUnsupported, COLOR_CMD, colorPop, colorPush, setgroup, xcolor } from "./xcolor"
import { preamble, tabularBox, tabularLines, TabularUnsupported, vtop, type TabCol, type TabLine, type TabularEnv } from "./tabular"
import { lstFrameBoxV, lstFrameH, lstFrameShapes, lstOptions, lstScan, LstUnsupported, type LstFrame, type LstOptions } from "./listings"
import { classParams, fontAt, fontDeclaration, hlistInput, squeeze, appendToVlist, labelWrite, mathData, mathEnv, paragraphInput, selectFont, spec, type DocState, type FontAttrs, type Refs, type TabularOuter } from "./paragraph"
import { bibliography, maketitle, tableOfContents, today } from "./frontmatter"

/** a paragraph that a tabular starts: it starts in \begin{tabular}'s group (\leavevmode), where \everypar's assignments stay */
const tabularStart = (text: string) => /^\s*\\LX(?:tabular|minipage)\{/.test(text)

/** How many groups are open at the end of `src` (braces not escaped). */
const depthOf = (src: string) => { let d = 0; for (const m of src.matchAll(/\\.|[{}]/g)) d += m[0] === "{" ? 1 : m[0] === "}" ? -1 : 0; return d }

const TEXTBULLET = 136 // \textbullet in TS1

/** What an environment inherits: \@listdepth, the itemize and enumerate depths, \@totalleftmargin and
 *  \linewidth, \parskip, \topsep and \partopsep in force, the size, \@rightskip and \finalhyphendemerits */
interface EnvCtx { depth: number; itemDepth: number; enumDepth: number; totalLeft: number; lineWidth: number; parskip: GlueSpec; parsep: GlueSpec; itemsep: GlueSpec; topsep: GlueSpec; partopsep: GlueSpec; labelwidth: number; size: SizeCommand; atRightskip: GlueNode | null; finalHyph: number | undefined; /** the enclosing enumerate counters (\p@enumii …) */ enums: number[]
  /** in an enclosing list: the \clubpenalty in force where this one begins */ club?: number }

function charBox(f: Font, c: number): CharNode {
  const m = f.chars.get(c)
  if (!m) throw new Error(`${f.name} has no character ${c}`)
  return { kind: "char", font: f.name, size: f.size, char: c, width: m.width, height: m.height, depth: m.depth, text: String.fromCharCode(c) }
}
const hss = () => glue(0, 65536, FIL, 65536, FIL)

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
  const { cls, option, classTextwidth, medskipamount, lstBase, usesListings, usesXcolor, amsmath, enumitem, hyper, t1, booktabsT1, thmDefs, colorDefs, pagestyle, title, letterInfo, newCounters, body } = pre
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
    const flush = (p: string) => paramGlue(p, glue(0, 65536, FIL))
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
        list.push(labelWrite(refs, lm[1], the(cap.number), refs.href, hyper ? cap.name : refs.name)) // nameref: the caption
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
    const basicColors = styleColors(o.basicstyle) // basicstyle in \lst@Init: its pushes before the tokens
    nodes.unshift(...basicColors.map((c) => colorPush(c)))
    if (xcolor.on) nodes.push(colorPush()) // \lst@DeInit's \normalcolor; then the group's end pops them all
    nodes.push(...basicColors.map(() => colorPop()), ...(xcolor.on ? [colorPop()] : []))
    return nodes
  }
  const counters = new Counters(cls, newCounters, () => doc.footnote)
  const href = (counter: string, n: number) => counters.href(counter, n)
  const the = (n: number) => counters.the(n)
  /** counter commands in text: a \refstepcounter outside text sets \@currentlabel and \@currentHref (and hyperref's anchor) */
  const counted = (text: string, inText = false): string => counters.counted(text, inText, (label, h) => {
    refs.label = label; refs.href = h
    if (hyper) v.nodes.push(...anchor(refs.href, run.k.sizes.normalsize.baselineskip.width, "v", lastNode())) // hyperref's anchor
  })
  const topCtx = (): EnvCtx => ({ depth: 0, itemDepth: 0, enumDepth: 0, totalLeft: 0, lineWidth: run.k.dimens.textwidth, parskip: outerParskip, parsep: run.k.glue.parsep, itemsep: run.k.glue.itemsep, topsep: run.k.glue.topsep, partopsep: run.k.glue.partopsep, labelwidth: run.k.dimens.labelwidth, size: "normalsize", atRightskip: null, finalHyph: undefined, enums: [] })
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
    if (run.runIn && b.kind === "list") { const club = v.club; runInAlone(); list({ ...b, inPar: true, blank: false }, topCtx()); v.club = club; v.afterheadingEverypar = false; v.endpePar = true; return }
    if (run.runIn && !(b.kind === "par" || b.kind === "heading" || b.kind === "float" || b.kind === "toc" || b.kind === "matter" || b.kind === "bib" || b.kind === "listing")) throw new Unsupported(`a ${b.kind} right after a run-in heading`)
    if (b.kind === "heading") { if (b.blank && !run.runIn) v.par(); if (run.runIn) runInAlone(); if (b.level === 0) chapter(b); else heading(b); return }
    if (run.noskipsec && (b.kind === "maketitle" || b.kind === "toc" || b.kind === "matter" || b.kind === "bib" || b.kind === "letter")) throw new Unsupported(`a ${b.kind} after a run-in heading lost to a listing`)
    if (b.kind === "maketitle") { maketitle(cx); return }
    if (b.kind === "toc") { if (run.runIn) runInAlone(); tableOfContents(cx); return }
    if (b.kind === "matter") { if (run.runIn) runInAlone(); matter(b.which); return }
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
        b.text = leadingColor(b.text)
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
        if (cg) paragraphWithDisplays(text, false, outer, outer, start, b.unskip, outer, 10000)
        else paragraphWithDisplays(text, false, grouped ? outer : 10000, grouped ? outer : 10000, start, b.unskip, 10000)
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
        if (next?.kind === "list" && next.inPar) paragraphWithDisplays(text, noindent, noteClub, run.k.ints.clubpenalty, undefined, b.unskip)
        else { v.par(); paragraphWithDisplays(text, noindent, noteClub, v.club, undefined, b.unskip) }
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
      paragraphWithDisplays(text, noindent, v.club, v.club, undefined, b.unskip, v.club, cg || tabularStart(text) ? leadNoteClub : undefined)
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
    list(b, topCtx())
    // the list's group ends (its \clubpenalty and \everypar settings with it); \end then runs \@doendpe, except
    // after amsthm's environments (\@endpefalse): the \everypar and \clubpenalty from before them are back
    if (b.env === "LXtheorem" || b.env === "proof") { v.club = before.club; v.afterheadingEverypar = before.afterheading; return }
    v.afterheadingEverypar = false
    v.endpePar = v.doendpe = v.endpeEverypar = true
  }
  const cx: Ctx = { pre, run, v, doc, decisions, toc, marks, mkboth, romanFont, roman, bodyUnits, outerParskip, epoch, typeset, tabular, heading, chapter }
  blocks.forEach(processBlock)

  /**
   * A paragraph that may hold displays (§§ 1145–1206). The text before each display is broken
   * with \displaywidowpenalty; the display goes on the vertical list; the paragraph resumes after
   * it with prev_graf+3, no indentation and no \parskip. `club` is \clubpenalty while the
   * paragraph is read and `parClub` the one its final \par sees.
   */
  function paragraphWithDisplays(text: string, noindent: boolean, club: number, parClub: number, start?: Node[], unskip = 0, firstClub = club, leadNoteClub?: number) {
    const segs = displaySegments(text)
    const quad = romanFont.params[QUAD]
    let prevGraf = 0
    segs.forEach((seg, i) => {
      if (typeof seg !== "string") return
      const first = i === 0, last = i === segs.length - 1
      const t = squeeze(seg) // a display ends with \ignorespaces
      const next = segs[i + 1] as Display | undefined
      let justBox: BoxNode | null = null, nlines = 0
      let params: ReturnType<typeof paragraphInput>["params"] | null = null
      const opts = {
        clubPenalty: last ? parClub : first ? firstClub : club, noteClubPenalty: first ? firstClub : club, prevGraf,
        ...(first && leadNoteClub !== undefined ? { leadGroupNoteClubPenalty: leadNoteClub } : {}),
        ...(last ? (unskip ? { unskip } : {}) : { widowPenalty: run.k.ints.displaywidowpenalty }),
        ...(first ? (start ? { start } : {}) : { start: [] as Node[] }),
      }
      if (first && !t) {
        // the display starts the paragraph: $$ (and amsmath's \[) from vertical mode starts it with the
        // indent box; LaTeX's own \[ first sets \nointerlineskip\makebox[.6\linewidth]{}
        if (next!.kind === "bracket" && !amsmath || next!.kind === "displaymath" && !amsmath) {
          v.prevDepth = IGNORE_DEPTH
          const lw = run.k.dimens.textwidth
          const mb = hpack([hss(), hss()], { exactly: xnOverD(lw, 39322, 65536) })
          const r = typesetList([...(start ?? (noindent ? [] : [emptyBox("hlist", run.k.dimens.parindent)])), mb], opts, true)
          justBox = r.just; params = r.params; nlines = r.lines
        } else if (!noindent || start) { // a run-in heading takes the indent box's place
          const r = typesetList(start ?? [emptyBox("hlist", run.k.dimens.parindent)], opts, true)
          justBox = r.just; params = r.params; nlines = r.lines
        } else v.nodes.push(spec("parskip", outerParskip), paramGlue("parskip", glue(0))) // \noindent$$: an empty paragraph
      } else if (t || !last) {
        const { list, params: ps, notes } = paragraphInput((first && noindent ? "\\noindent " : "") + t, run.k, "normalsize", doc, { ...opts, amsmath })
        if (list.length || first) {
          const lb = lineBreak(list, ps)
          decisions.push(...notes, lb.trace)
          if (first) v.paragraph(lb.vlist, outerParskip); else v.lines(lb.vlist)
          justBox = lb.lines[lb.lines.length - 1] ?? null
          params = ps; nlines = lb.lines.length
        }
      }
      prevGraf += nlines
      if (!next) return
      // the display
      const ps = params ?? paragraphInput("", run.k, "normalsize", doc, { amsmath }).params
      const line = displayLine(prevGraf, ps.hsize, ps.hangIndent, ps.hangAfter, ps.parShape)
      if (next.kind === "align" || next.kind === "align*") {
        if (!amsmath) throw new Unsupported(`${next.kind} without amsmath`)
        alignDisplay(next, line, ps)
        prevGraf += 3
        return
      }
      // \label{key}: \protected@write\@auxout{}{\string\newlabel{key}{{\@currentlabel}{\thepage }{}{\@currentHref}{}}}.
      // amsmath keeps it for after the tag (\label@in@display); LaTeX writes it where it stands
      const labels = [...next.src.matchAll(/\\label\s*\{([^{}]*)\}/g)]
      if (labels.length && next.kind !== "equation") throw new Unsupported(`\\label in ${next.kind}`)
      if (labels.length > 1) throw new Unsupported("several \\label in an equation")
      const label = labels[0]
      if (label && !/^[A-Za-z0-9:._-]+$/.test(label[1])) throw new Unsupported(`\\label{${label[1]}}`)
      const parse = (f: string) => { try { return parseMath(f.replace(/\s+/g, " "), mathData(), { amsmath }) } catch (e) { throw new Unsupported((e as Error).message) } }
      if (next.kind === "equation") { counters.equation++; refs.href = href("equation", counters.equation) } // \refstepcounter, or amsmath's \incr@eqnum
      const newlabel: Node | null = label ? labelWrite(refs, label[1], the(counters.equation)) : null
      let mlist: MItem[]
      if (!label) mlist = parse(next.src)
      else {
        const before = next.src.slice(0, label.index), after = next.src.slice(label.index! + label[0].length)
        if (amsmath) mlist = parse(before + after)
        else if (depthOf(before) !== 0) throw new Unsupported("\\label inside a group in an equation")
        else mlist = [...parse(before), newlabel!, ...parse(after)]
      }
      const env = mathEnv(run.k, "normalsize", amsmath)
      if (next.kind === "equation*" && !amsmath) throw new Unsupported("equation* without amsmath")
      let eqno: BoxNode | null = null
      if (next.kind === "equation" && amsmath) { // \mathopen{} after \incr@eqnum, and \veqno \tagform@\theequation: \hbox{\normalfont (1\/)}, then the \label
        mlist.unshift({ noad: OPEN_NOAD, nucleus: groupField([]), sup: null, sub: null })
        // hyperref: \refstepcounter's anchor in a math group before it (an ord noad)
        if (hyper) mlist.unshift({ noad: ORD_NOAD, nucleus: { kind: "mlist", list: [HS(), HA(run.k.sizes.normalsize.baselineskip.width), dest(refs.href)] }, sup: null, sub: null })
        const l: Node[] = []
        appendText(l, `(${the(counters.equation)}`, romanFont, { spaceFactor: 1000 }, false)
        l.push(kern(romanFont.chars.get((l[l.length - 1] as CharNode).char)!.italic, true)) // \@@italiccorr
        appendText(l, ")", romanFont, { spaceFactor: 1000 }, false)
        eqno = hpack(newlabel ? [hpack(l), newlabel] : [hpack(l)]); eqno.display = true
      } else if (next.kind === "equation") { // \eqno \hbox{\@eqnnum}: {\normalfont (\theequation)}
        // hyperref's \equation: \mathopen{\hyper@anchorstart} at the start, \hyper@anchorend (and \nobreak) at the end
        if (hyper) {
          mlist.unshift({ noad: OPEN_NOAD, nucleus: { kind: "mlist", list: [HS()] }, sup: null, sub: null })
          mlist.push(HA(run.k.sizes.normalsize.baselineskip.width), dest(refs.href), penalty(10000))
        }
        const l: Node[] = []
        appendText(l, `(${the(counters.equation)})`, romanFont, { spaceFactor: 1000 }, false)
        eqno = hpack([hpack(setgroup(l))]); eqno.display = true // {\normalfont\normalcolor (n)}
      }
      const sz = run.k.sizes.normalsize
      const items = finishDisplay(mlistToHlist(mlist, env, DISPLAY_STYLE, false), eqno, {
        width: line.width, indent: line.indent, preSize: preDisplaySize(justBox, quad), mathQuad: env.fonts[0][2]!.params[QUAD],
        preDisplayPenalty: run.k.ints.predisplaypenalty, postDisplayPenalty: run.k.ints.postdisplaypenalty,
        aboveDisplaySkip: sz.abovedisplayskip, belowDisplaySkip: sz.belowdisplayskip, aboveDisplayShortSkip: sz.abovedisplayshortskip, belowDisplayShortSkip: sz.belowdisplayshortskip,
      })
      for (const it of items) { if ("box" in it) v.box(it.box, sz.baselineskip); else v.nodes.push(it.node) }
      prevGraf += 3
    })
  }
  /**
   * amsmath's align and align* (\start@align\@ne, \align@, \measure@, \calc@shift@align,
   * \math@cr@@@align, \place@tag): fields alternate right- and left-aligned, the whole is centred
   * by \eqnshift@ with \alignsep@ between column pairs, and each row's number is set off at the
   * right edge. TeX finishes it as an alignment in a display (§ 1206).
   */
  function alignDisplay(d: Display, line: { width: number; indent: number }, _ps: unknown) {
    const starred = d.kind === "align*"
    let src = d.src.trim()
    if (/\\\\\s*$/.test(src)) throw new Unsupported("align ending with \\\\")
    if (/\\(label|tag|intertext|shortintertext)\b/.test(src)) throw new Unsupported("\\label, \\tag or \\intertext in align")
    const env = mathEnv(run.k, "normalsize", true)
    const mathBox = (items: MItem[]) => hpack([{ kind: "math", on: true, width: 0 }, ...mlistToHlist([{ kind: "style", style: DISPLAY_STYLE }, ...items], env, TEXT_STYLE, false), { kind: "math", on: false, width: 0 }])
    const parse = (f: string) => { try { return parseMath(f.replace(/\s+/g, " "), mathData(), { amsmath }) } catch (e) { throw new Unsupported((e as Error).message) } }
    const rows = src.split(/\\\\/).map((r) => {
      const numbered = !starred && !/\\(nonumber|notag)\b/.test(r)
      const fields = r.replace(/\\(nonumber|notag)\b/g, "").split("&").map((f, j) => {
        const items = parse(f)
        // \setboxz@h{\@lign$\m@th\displaystyle{##}$} and {{}##} for the left-aligned fields
        return mathBox([{ noad: ORD_NOAD, nucleus: groupField(j % 2 ? [{ noad: ORD_NOAD, nucleus: { kind: "mlist", list: [] }, sup: null, sub: null }, ...items] : items), sup: null, sub: null }])
      })
      return { fields, numbered }
    })
    const z = line.width
    const sz = run.k.sizes.normalsize, strut = sz.strut
    const strutBox = () => hpack([vpack([kern(-run.k.dimens.normallineskiplimit, true), hpack([{ kind: "rule", width: 0, height: strut.height, depth: strut.depth }])])]) // \strut@
    // tags: \strut@ and (n) in \maketag@@@, numbered in row order
    const tags = rows.map((r) => {
      if (!r.numbered) return hpack([strutBox()])
      counters.equation++
      refs.href = href("equation", counters.equation)
      const l: Node[] = []
      appendText(l, `(${the(counters.equation)}`, romanFont, { spaceFactor: 1000 }, false)
      const last = l[l.length - 1] as CharNode
      l.push(kern(romanFont.chars.get(last.char)!.italic, true)) // \@@italiccorr
      appendText(l, ")", romanFont, { spaceFactor: 1000 }, false)
      // hyperref: the anchor between the strut and the number, at \baselineskip plus \jot
      if (hyper) { const s = strutBox(); return hpack([s, ...anchor(href("equation", counters.equation), sz.baselineskip.width + run.k.dimens.jot, "h", s), hpack(l)]) }
      return hpack([strutBox(), hpack(l)])
    })
    // \measure@
    let maxfields = Math.max(...rows.map((r) => r.fields.length))
    if (maxfields % 2) maxfields++
    const colW = Array.from({ length: maxfields }, (_, j) => Math.max(0, ...rows.map((r) => r.fields[j]?.width ?? 0)))
    const totwidth = colW.reduce((a, b) => a + b, 0)
    const div = (a: number, b: number) => Math.trunc(a / b)
    const minalignsep = 655360
    const mintagsep = xnOverD(env.fonts[0][2]!.params[QUAD], 32768, 65536)
    let tempcntb = maxfields / 2, tempcnta = tempcntb
    tempcntb -= 1; tempcnta += 1
    let eqnshift = div(z - totwidth, tempcnta), alignsep = eqnshift
    if (alignsep < minalignsep) { alignsep = minalignsep; if (eqnshift > 0) eqnshift = div(z - totwidth - tempcntb * alignsep, 2) }
    if (eqnshift < 0) eqnshift = 0
    // \calc@shift@align (tags on the right, not fleqn), last row first; a tag that does not fit beside its
    // row is shifted below it (\saveshift@1)
    const shifted = rows.map(() => false)
    for (let r = rows.length - 1; r >= 0; r--) {
      const tw = tags[r].width
      if (!(tw > 0)) continue
      let dimb = 0, dimc = 0
      rows[r].fields.forEach((f, i) => { // \x@rcalc@width
        const col = i + 1, a = f.width
        if (a > 0) { dimc += dimb; if (col % 2) { dimc += colW[i]; dimb = 0 } else { dimc += a; dimb = colW[i] - a } }
        else dimb += colW[i]
      })
      let cnta = tempcnta, cntb = tempcntb
      const column = div(rows[r].fields.length - 1, 2)
      if (cntb > column) { cnta -= cntb; cnta += column; cntb = column }
      const dima = dimc + tw
      let dimen = minalignsep * cntb + mintagsep + mintagsep + dima
      if (dimen > z) { shifted[r] = true; continue }
      dimen = eqnshift + dima + cntb * alignsep + tw
      if (dimen > z) {
        dimen = div(z - dima, cnta)
        if (dimen < minalignsep) { alignsep = minalignsep; eqnshift = div(z - dima - cntb * alignsep, 2) }
        else {
          if (dimen < eqnshift) eqnshift = dimen < 0 ? 0 : dimen
          if (dimen < alignsep) alignsep = dimen
        }
      }
    }
    const tagshift = totwidth + tempcntb * alignsep + eqnshift - z
    // the main \halign: cells, then the \omit column with \kern-\alignsep@ and \place@tag
    const hfil = () => glue(0, 65536, FIL)
    const cells = rows.map((r, ri) => {
      const row: Node[][] = []
      for (let j = 0; j < maxfields; j++) {
        const f = r.fields[j]
        if (!f) { row.push(j % 2 ? [hfil()] : [hfil(), strutBox()]); continue } // \add@amps: empty fields
        row.push(j % 2 ? [f, hfil()] : [hfil(), strutBox(), f])
      }
      const tagCol: Node[] = [kern(-alignsep, true)]
      if (r.numbered && shifted[ri]) {
        // \place@tag: \llap{\vtop{\normalbaselines \setbox\@ne\null \dp\@ne\lineht@ \box\@ne \boxz@}}, \lineht@
        // the deepest field of the row (\set@field; \math@cr@@@align resets it after each row)
        // (\measure@'s rows never reset it: the first row starts from the deepest field of them all)
        const lineht = Math.max(0, ...(ri === 0 ? rows.flatMap((x) => x.fields) : r.fields).map((f) => f.depth))
        const nul = hpack([]); nul.depth = lineht
        const list: Node[] = [nul]
        appendToVlist(list, tags[ri], lineht, run.k.sizes.normalsize.baselineskip, run.k.glue.normallineskip, run.k.dimens.normallineskiplimit)
        const vt = vpack(list)
        vt.depth = vt.height + vt.depth; vt.height = 0 // \vtop: the first box's height (§ 1087)
        tagCol.push(kern(-tagshift, true), hpack([hss(), vt], { exactly: 0 }))
      } else if (r.numbered) tagCol.push(kern(-tagshift, true), hpack([hss(), tags[ri]], { exactly: 0 }))
      row.push(tagCol)
      return row
    })
    const tabskip = [paramGlue("tabskip", glue(eqnshift))]
    for (let j = 0; j <= maxfields; j++) tabskip.push(paramGlue("tabskip", glue(j % 2 ? alignsep : 0)))
    const rowBoxes = halign(cells.map((r) => r.map((c) => c)), tabskip, { additional: 0 })
    // § 1206, with \openup\jot and amsmath's \everycr
    v.nodes.push(penalty(run.k.ints.predisplaypenalty), spec("abovedisplayskip", sz.abovedisplayskip))
    const jot = 196608
    v.nodes.push(glue(-(run.k.dimens.lineskiplimit + jot)), glue(run.k.dimens.normallineskiplimit))
    const bs = addGlue(sz.baselineskip, dimen(jot)), ls = addGlue(run.k.glue.lineskip, dimen(jot))
    for (const rb of rowBoxes) {
      rb.display = true; rb.shift = line.indent
      v.prevDepth = appendToVlist(v.nodes, rb, v.prevDepth, bs, ls, run.k.dimens.lineskiplimit + jot)
      v.nodes.push(penalty(10000), glue(0)) // \interdisplaylinepenalty is \@M in amsmath; \\ adds \vskip\z@
    }
    // \black@\totwidth@ after the last row: an align wider than the display shows its width in a
    // \noalign{\nointerlineskip \vskip-\ht\strutbox@ \vskip-\dp\strutbox@ \vbox{\noindent
    // \hbox to\displaywidth{\hbox to\totwidth@{\strut@\hfill}}} \prevdepth restored}
    // (\totwidth@ by then has \minalignsep for each space between column pairs)
    const blackWidth = totwidth + tempcntb * minalignsep
    if (blackWidth > z) {
      const wide = hpack([hpack([strutBox(), glue(0, 65536, FILL)], { exactly: blackWidth })], { exactly: z })
      const par = paragraphInput("", run.k, "normalsize", doc, { start: [wide], amsmath })
      const lb = lineBreak(par.list, par.params)
      decisions.push(lb.trace)
      v.nodes.push(glue(-strut.height), glue(-strut.depth), vpack(lb.vlist))
    }
    v.nodes.push(penalty(run.k.ints.postdisplaypenalty), spec("belowdisplayskip", sz.belowdisplayskip))
  }

  /** a paragraph from a ready horizontal list (the display's opening line) */
  /**
   * A list-like environment. \list at a depth (\@listi … \@listvi, the first at the size in force):
   * \@trivlist (\@topsep from \topsep, \partopsep when it starts in vertical mode, and the enclosing
   * \parskip), \parskip\parsep, \parindent\listparindent, \parshape 1 \@totalleftmargin \linewidth, with
   * each environment's settings (description, quote, quotation, verse); \trivlist (center, flushleft,
   * flushright) keeps the enclosing \topsep and margins, with \parsep\parskip and no label. Each \item
   * (\@item) puts \box\@labels — \hskip\itemindent \hskip-\labelwidth \hskip-\labelsep, \makelabel in
   * \labelwidth, \hskip\labelsep — in place of the first paragraph's indentation; later paragraphs are
   * indented by \parindent; a nested environment starts in the item's paragraph (\unskip\par) and the
   * text after it is not indented (\@doendpe); \\ in center, flushleft, flushright and verse is
   * \@centercr (\par\addvspace{-\parskip}). Then \endtrivlist and \@endparenv.
   */
  function list(b: ListBlock, ctx: EnvCtx) {
    if (b.env === "abstract") return abstract(b, ctx)
    const outerLabel = refs.label // \@currentlabel is local to the environment
    const amsthm = b.env === "LXtheorem" || b.env === "proof"
    const trivial = b.env === "center" || b.env === "flushleft" || b.env === "flushright" || amsthm
    const sizeFont = loadFont(dataFont(run.k.sizes[ctx.size].font.name), run.k.sizes[ctx.size].font.at)
    const ems = (x: string) => new Scanner(x, { em: sizeFont.params[QUAD], ex: sizeFont.params[X_HEIGHT] }).scanDimen().value
    let depth = ctx.depth, leftmargin = 0, labelwidth = 0, itemindent = 0, listparindent = 0, rightmargin = 0
    // \trivlist: \parsep\parskip; \list: \@listi … \@listvi set some parameters, the others stay as they are
    let topsep = ctx.topsep, partopsep = ctx.partopsep, parsep = trivial ? ctx.parskip : ctx.parsep, itemsep = ctx.itemsep
    labelwidth = trivial ? 0 : ctx.labelwidth
    // enumitem's \trivlist: \parsep\parskip, then \@list<depth> again (inside a list), then \@trivlist; its
    // paragraphs keep the enclosing \parskip, and a list inside it inherits the new \parsep
    let childParsep = parsep
    // what \@list<depth> sets: article, report and book \@listi–iii \topsep \parsep \itemsep, \@listiii also
    // \partopsep; letter \@listI \parsep \topsep \itemsep, \@listii none of them, \@listiii \topsep \itemsep
    const listSets = (d: number): string[] => cls === "letter" ? (d === 1 ? ["topsep", "parsep", "itemsep"] : d === 3 ? ["topsep", "itemsep"] : [])
      : d <= 2 ? ["topsep", "parsep", "itemsep"] : d === 3 ? ["topsep", "parsep", "itemsep", "partopsep"] : []
    if (trivial && enumitem && ctx.depth >= 1) {
      const d = ctx.depth, L = (p: string) => run.k.glue[d === 1 ? `list1${p}@${ctx.size}` : `list${d}${p}`]
      for (const p of listSets(d)) { if (p === "topsep") topsep = L(p); else if (p === "parsep") childParsep = L(p); else if (p === "itemsep") itemsep = L(p); else partopsep = L(p) }
    }
    if (!trivial) {
      depth++
      if (depth > 6) throw new Unsupported("lists nested more than six deep") // LaTeX: Too deeply nested
      const L = (p: string) => run.k.glue[depth === 1 ? `list1${p}@${ctx.size}` : `list${depth}${p}`]
      const D = (p: string) => run.k.dimens[depth === 1 ? `list1${p}@${ctx.size}` : `list${depth}${p}`]
      leftmargin = D("leftmargin")
      for (const p of listSets(depth)) { if (p === "topsep") topsep = L(p); else if (p === "parsep") parsep = L(p); else if (p === "itemsep") itemsep = L(p); else partopsep = L(p) }
      if (depth >= 2) labelwidth = D("labelwidth")
      // \labelwidth\z@ \itemindent-\leftmargin (enumitem: \labelindent zero, so \itemindent\labelsep-\leftmargin)
      if (b.env === "description") { labelwidth = 0; itemindent = (enumitem ? run.k.dimens.labelsep : 0) - leftmargin }
      else if (b.env === "quote") rightmargin = leftmargin
      // (letter.cls: quotation keeps \parsep, verse indents 15pt)
      else if (b.env === "quotation") { listparindent = ems("1.5em"); itemindent = listparindent; rightmargin = leftmargin; if (cls !== "letter") parsep = { width: 0, stretch: 65536, stretchOrder: 0, shrink: 0, shrinkOrder: 0 } }
      else if (b.env === "verse") { const ind = cls === "letter" ? 15 * 65536 : ems("1.5em"); itemsep = dimen(0); itemindent = -ind; listparindent = itemindent; rightmargin = leftmargin; leftmargin += ind }
      else if (b.env === "thebibliography") { // \settowidth\labelwidth{\@biblabel{widest}} \leftmargin\labelwidth \advance\leftmargin\labelsep
        const w: Node[] = []
        appendText(w, `[${b.widest}]`, sizeFont, { spaceFactor: 1000 }, false)
        labelwidth = hpack(w).width; leftmargin = labelwidth + run.k.dimens.labelsep
      }
    }
    // enumitem's options: nosep, noitemsep, leftmargin=* (the label's width and \labelsep) or leftmargin=<dim>
    if (b.options !== undefined) {
      if (!enumitem) throw new Unsupported(`\\begin{${b.env}}[${b.options}] without enumitem`)
      for (const o of b.options.split(",").map((x) => x.trim()).filter(Boolean)) {
        if (o === "nosep") { topsep = partopsep = parsep = itemsep = dimen(0) }
        else if (o === "noitemsep") { itemsep = parsep = dimen(0) }
        else if (o === "leftmargin=*" && b.env === "itemize") {
          const lvl = ctx.itemDepth + 1
          const f = lvl === 2 ? loadFont(dataFont(run.k.sizes[ctx.size].bold.name), run.k.sizes[ctx.size].bold.at) : loadFont(dataFont(run.k.sizes[ctx.size].companion.name), run.k.sizes[ctx.size].companion.at)
          labelwidth = f.chars.get(lvl === 2 ? (run.k.ints.T1 ? 21 : 123) : [TEXTBULLET, 0, 42, 183][lvl - 1])!.width
          leftmargin = labelwidth + run.k.dimens.labelsep
        } else if (o.startsWith("leftmargin=") && o !== "leftmargin=*") {
          try { leftmargin = parseGlue(o.slice(11), { em: sizeFont.params[QUAD], ex: sizeFont.params[X_HEIGHT] }).width } catch { throw new Unsupported(`enumitem ${o}`) }
        } else throw new Unsupported(`enumitem option ${o}`)
      }
    }
    // amsthm's proof: \topsep6\p@\@plus6\p@ before \trivlist
    if (b.env === "proof") topsep = { width: 6 * 65536, stretch: 6 * 65536, stretchOrder: 0, shrink: 0, shrinkOrder: 0 }
    let topsepadd = b.inPar ? topsep : addGlue(topsep, partopsep) // \partopsep only from vertical mode
    let topsepAll = addGlue(topsepadd, ctx.parskip) // \advance\@topsep\parskip, the enclosing \parskip
    // amsthm's theorem: \@topsep \thm@preskip and \@topsepadd \thm@postskip, \topsep (half of it for remark)
    const thmDef = b.thm ? thmDefs.get(b.thm.name)! : null
    if (thmDef) {
      const half = (g: GlueSpec): GlueSpec => ({ ...g, width: Math.trunc(g.width / 2), stretch: Math.trunc(g.stretch / 2), shrink: Math.trunc(g.shrink / 2) }) // \divide…\tw@
      topsepAll = topsepadd = thmDef.style === "remark" ? half(ctx.topsep) : ctx.topsep
      if (b.items.some((it) => it.parts.some((p) => p.kind === "list"))) throw new Unsupported("a list in a theorem")
      if (hyper) throw new Unsupported("amsthm with hyperref")
    }
    // \refstepcounter{counter}: \the<counter> (the section's number first, when within it)
    let thmNumber: string | null = null
    if (thmDef?.counter) {
      thmNumber = counters.stepNumbered(thmDef.counter)
      refs.label = thmNumber; refs.href = `${thmDef.counter}.${thmNumber}`
    }
    // the body's font: \itshape for plain theorems
    const bodyAttrs: FontAttrs | undefined = thmDef?.style === "plain" ? { enc: run.k.ints.T1 ? "T1" : "OT1", fam: "cmr", ser: "m", shape: "it" } : undefined
    /** \@begintheorem's head, \sbox'ed into \@labels and \unhbox'ed by \dth@everypar: \normalfont, the head font
     *  (\bfseries, remark \itshape), the name, \@upn{number} (\textup's italic corrections before and after it),
     *  ( note) in \fontseries\mddefault\upshape, the punctuation, \hskip\thm@headsep (5pt plus1pt minus1pt) */
    const thmHead = (): Node[] => {
      const T1 = run.k.ints.T1 ? "T1" : "OT1"
      const hf = selectFont(run.k, ctx.size, thmDef!.style === "remark" ? { enc: T1, fam: "cmr", ser: "m", shape: "it" } : { enc: T1, fam: "cmr", ser: "bx", shape: "n" })
      const up = selectFont(run.k, ctx.size, thmDef!.style === "remark" ? { enc: T1, fam: "cmr", ser: "m", shape: "n" } : { enc: T1, fam: "cmr", ser: "bx", shape: "n" })
      const note = selectFont(run.k, ctx.size, { enc: T1, fam: "cmr", ser: "m", shape: "n" })
      const l: Node[] = [], st = { spaceFactor: 1000 }
      const italic = (f: Font) => { const last = l.at(-1); return last?.kind === "char" ? (f.chars.get(last.char)?.italic ?? 0) : 0 }
      appendText(l, thmDef!.title, hf, st, false)
      if (thmNumber !== null) {
        const sp = spaceGlue(hf, st.spaceFactor); st.spaceFactor = 1000
        l.push(kern(italic(hf), true), sp) // \sw@slant: the skip off, \/, the skip back
        appendText(l, thmNumber, up, st, false)
        if (thmDef!.style !== "remark") l.push(kern(italic(up), true)) // \check@icr: only when the head's font is upright
      }
      if (b.thm!.note !== null) {
        if (/[\\{}$%&#^_~]/.test(b.thm!.note)) throw new Unsupported(`theorem note "${b.thm!.note}"`)
        l.push(spaceGlue(hf, st.spaceFactor)); st.spaceFactor = 1000
        appendText(l, `(${b.thm!.note})`, note, st, false)
      }
      appendText(l, ".", hf, st, false)
      l.push(glue(5 * 65536, 65536, 0, 65536, 0))
      return setgroup(l)
    }
    const totalLeft = ctx.totalLeft + leftmargin, lineWidth = ctx.lineWidth - leftmargin - rightmargin
    const parShape: [number, number][] | undefined = depth > 0 ? [[totalLeft, lineWidth]] : undefined
    // paragraph settings: \@trivlist's \leftskip\z@skip \rightskip\@rightskip \parfillskip\@flushglue, then
    // \centering, \raggedright or \raggedleft (\parindent\z@)
    const flush = (n: string) => paramGlue(n, glue(0, 65536, FIL))
    let atRightskip = ctx.atRightskip, finalHyph = ctx.finalHyph
    let align: { leftSkip?: GlueNode; rightSkip?: GlueNode; parFillSkip?: GlueNode } = atRightskip ? { rightSkip: paramGlue("rightskip", atRightskip) } : {}
    let parindent = amsthm ? run.k.dimens.parindent : listparindent
    if (b.env === "center") { align = { leftSkip: flush("leftskip"), rightSkip: flush("rightskip"), parFillSkip: paramGlue("parfillskip", glue(0)) }; finalHyph = 0; parindent = 0 }
    else if (b.env === "flushleft") { atRightskip = glue(0, 65536, FIL); align = { rightSkip: flush("rightskip") }; finalHyph = 0; parindent = 0 }
    else if (b.env === "flushright") { align = { leftSkip: flush("leftskip"), parFillSkip: paramGlue("parfillskip", glue(0)) }; finalHyph = 0; parindent = 0 }
    // thebibliography: \sloppy \clubpenalty4000 \@clubpenalty\clubpenalty \widowpenalty4000 \sfcode`\.\@m
    const bib = b.env === "thebibliography" ? { tolerance: 9999, emergencyStretch: 3 * romanFont.params[QUAD], clubPenalty: 4000, widowPenalty: 4000, noteWidowPenalty: 4000, sfcodes: { 46: 1000 } } : {}
    const shape = { ...align, ...(parShape ? { parShape } : {}), ...(finalHyph !== undefined ? { finalHyphenDemerits: finalHyph } : {}), ...bib }
    const itemDepth = ctx.itemDepth + (b.env === "itemize" ? 1 : 0), enumDepth = ctx.enumDepth + (b.env === "enumerate" ? 1 : 0)
    const level = b.env === "itemize" ? itemDepth : enumDepth
    if (level > 4) throw new Unsupported(`${b.env} nested more than four deep`)
    const font = sizeFont
    const bold = loadFont(dataFont(run.k.sizes[ctx.size].bold.name), run.k.sizes[ctx.size].bold.at)
    const companion = loadFont(dataFont(run.k.sizes[ctx.size].companion.name), run.k.sizes[ctx.size].companion.at)
    let counter = 0 // \c@enum…: an item with its own label does not step it
    const alph = (n: number) => (n > 0 && n <= 26 ? String.fromCharCode(96 + n) : "") // \@alph: \ifcase (\@ctrerr past z)
    const roman = (n: number) => { // \@roman (TeX's \romannumeral)
      let out = ""
      for (const [v, r] of [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]] as const) while (n >= v) { out += r; n -= v }
      return out
    }
    const ls = run.k.dimens.labelsep
    /** the proof's \qed at its end: \leavevmode\unskip\penalty9999 \hbox{}\nobreak\hfill\quad\hbox{\qedsymbol}, \openbox
     *  (\hbox to.77778em{\hfil\vrule\vbox to.675em{\hrule width.6em\vfil\hrule}\vrule\hfil}) in the body's font */
    const lastPart = b.items.at(-1)?.parts.at(-1)
    if (b.env === "proof" && (!lastPart || lastPart.kind !== "text" || !lastPart.text)) throw new Unsupported("a proof that does not end with text")
    const qedAt = (p: Part) => b.env === "proof" && p === lastPart
    const qed = (): Node[] => {
      const frac = (d: string) => new Scanner(d, { em: sizeFont.params[QUAD], ex: sizeFont.params[X_HEIGHT] }).scanDimen().value
      const vrule = (): Node => ({ kind: "rule", width: 26214, height: null, depth: null })
      const vb = vpack([{ kind: "rule", width: frac(".6em"), height: 26214, depth: 0 }, glue(0, 65536, FIL), { kind: "rule", width: null, height: 26214, depth: 0 }], { exactly: frac(".675em") })
      const box = hpack([glue(0, 65536, FIL), vrule(), vb, vrule(), glue(0, 65536, FIL)], { exactly: frac(".77778em") })
      return [penalty(9999), hpack([]), penalty(10000), glue(0, 65536, FILL), glue(sizeFont.params[QUAD]), hpack([box])]
    }
    // the \clubpenalty in force when an item's paragraph starts in a group (where \@item's \everypar sets its own):
    // thebibliography's, the outer one before the first item, then what the last item's \everypar set
    let groupClub = b.env === "thebibliography" ? 4000 : ctx.club ?? (depth <= 1 ? v.club : run.k.ints.clubpenalty)
    b.items.forEach(({ label: given, parts }, i) => {
      // \@item: before the first item \@beginparpenalty, \@topsep and -\parskip (right after a heading,
      // \@nbitem: \@outerparskip-\parskip); then \@itempenalty and \itemsep
      let club: number | undefined
      if (i === 0 && v.nobreak) { v.addvspace(addGlue(ctx.parskip, negate(parsep))); v.nobreak = false; club = 10000 }
      else if (i === 0) { v.addpenalty(-LOW_PENALTY); v.addvspace(topsepAll); v.addvspace(negate(parsep)) }
      else { v.addpenalty(-LOW_PENALTY); v.addvspace(itemsep) }
      // \sbox\@tempboxa{\makelabel{label}}
      let content: Node[]
      if (b.env === "itemize" || b.env === "enumerate") {
        const l: Node[] = []
        if (given !== null) appendText(l, given.replace(/\s+/g, " "), font, { spaceFactor: 1000 }, false)
        else if (b.env === "itemize") { // \labelitemi … iv: \textbullet, \bfseries\textendash, \textasteriskcentered, \textperiodcentered
          if (level === 2) l.push(charBox(bold, run.k.ints.T1 ? 21 : 123)) // \textendash in OT1 and T1
          else l.push(charBox(companion, [TEXTBULLET, 0, 42, 183][level - 1]))
        } else { // \labelenumi … iv: 1. (a) i. A.
          const n = ++counter
          // \refstepcounter{enum…}: \p@enum… \theenum… (1, 1a, 1(a)i, 1(a)iA), and \@currentHref enum….n
          const [v1, v2, v3] = [...ctx.enums, n]
          refs.label = [`${n}`, `${v1}${alph(n)}`, `${v1}(${alph(v2)})${roman(n)}`, `${v1}(${alph(v2)})${roman(v3)}${alph(n).toUpperCase()}`][level - 1]
          refs.href = `enum${["i", "ii", "iii", "iv"][level - 1]}.${n}`
          // hyperref: \refstepcounter's anchor (Item.n, a counter of its own) on the vertical list before the item
          if (hyper) { refs.href = `Item.${++run.items}`; v.nodes.push(...anchor(refs.href, run.k.sizes[ctx.size].baselineskip.width, "v", lastNode())) }
          if ((level === 2 || level === 4) && n > 26) throw new Unsupported("\\alph counter past z") // LaTeX: Counter too large
          appendText(l, level === 1 ? `${n}.` : level === 2 ? `(${alph(n)})` : level === 3 ? `${roman(n)}.` : `${alph(n).toUpperCase()}.`, font, { spaceFactor: 1000 }, false)
        }
        content = [...(enumitem ? [penalty(10000)] : []), hss(), hpack([hss(), ...l], { exactly: 0 })] // \hss\llap{#1}; enumitem's \nobreak first
      } else if (b.env === "description") { // \descriptionlabel: \hspace\labelsep\normalfont\bfseries #1 (enumitem: \hskip\z@\nobreak, the label, \hfil)
        content = enumitem ? [glue(0), penalty(10000)] : [glue(ls)]
        if (given) appendText(content, given.replace(/\s+/g, " "), bold, { spaceFactor: 1000 }, false)
        if (enumitem) content.push(glue(0, 65536, FIL))
      } else if (b.env === "proof") { // \item[\hskip\labelsep\itshape title\@addpunct{.}]
        const title = (b.proofTitle ?? "Proof").replace(/\s+/g, " ").trim()
        if (/[{}$%&#^_]/.test(title.replace(/\\ref\{[A-Za-z0-9:._-]+\}/g, "")) || /\\(?!ref\{)/.test(title)) throw new Unsupported(`proof title "${title}"`)
        if (hyper && /\\ref/.test(title)) throw new Unsupported("a \\ref in a proof title with hyperref")
        const it = selectFont(run.k, ctx.size, { enc: run.k.ints.T1 ? "T1" : "OT1", fam: "cmr", ser: "m", shape: "it" })
        content = [glue(ls)]
        const st = { spaceFactor: 1000 }
        // text, ~ (\nobreak\ ) and \ref{key} (the label's text and \null; ?? in bold when not known)
        for (const piece of title.split(/(~|\\ref\{[^}]*\})/)) {
          if (piece === "~") { content.push(penalty(10000), spaceGlue(it, st.spaceFactor)); continue }
          const ref = piece.match(/^\\ref\{([^}]*)\}$/)
          if (!ref) { appendText(content, piece, it, st, false); continue }
          const known = prev?.labels.get(ref[1])
          if (known) { appendText(content, known.label, it, st, false); content.push(hpack([])) }
          else { const q: Node[] = []; appendText(q, "??", selectFont(run.k, ctx.size, { enc: run.k.ints.T1 ? "T1" : "OT1", fam: "cmr", ser: "bx", shape: "n" }), { spaceFactor: 1000 }, false); content.push(hpack(q)) }
          st.spaceFactor = 1000
        }
        if (st.spaceFactor <= 1000) appendText(content, ".", it, st, false) // \@addpunct: a period unless the title ends in punctuation
      } else if (trivial) content = given ? (() => { const l: Node[] = []; appendText(l, given, font, { spaceFactor: 1000 }, false); return l })() : [] // \makelabel##1{##1}
      else { // \@mklab: \hfil #1 (thebibliography's label: \@biblabel{n}, [n])
        content = [glue(0, 65536, FIL)]
        const l = b.env === "thebibliography" ? `[${i + 1}]` : given
        if (l) appendText(content, l, font, { spaceFactor: 1000 }, false)
        if (b.env === "thebibliography") { refs.label = String(i + 1); refs.href = `enumiv.${i + 1}` } // \refstepcounter{enumiv}
      }
      const temp = hpack(setgroup(content.slice()))
      const boxed = temp.width > labelwidth ? temp : hpack(setgroup(content.slice()), { exactly: labelwidth })
      const labels = hpack([glue(itemindent), glue(-labelwidth), glue(-ls), boxed, glue(ls)])
      // \clubpenalty in the item: \@M from its first paragraph right after a heading, until a later paragraph's
      // \everypar (still \@item's) or \@doendpe's \par sets \@clubpenalty
      let itemClub = club
      let started = false // a paragraph has started in the item (its \everypar has run)
      parts.forEach((p) => {
        if (p.kind === "list") {
          if (p.blank) v.par()
          if (run.noskipsec && !p.inPar) throw new Unsupported("a nested list after a run-in heading lost to a listing")
          // (the \clubpenalty in force: what the item's \everypar left, or before its first paragraph what was there)
          const inForce = started ? itemClub ?? (b.env === "thebibliography" ? 4000 : run.k.ints.clubpenalty) : groupClub
          return list(p, { depth, itemDepth, enumDepth, totalLeft, lineWidth, parskip: parsep, parsep: trivial ? childParsep : parsep, itemsep, topsep, partopsep, labelwidth, size: ctx.size, atRightskip, finalHyph, enums: b.env === "enumerate" ? [...ctx.enums, counter] : ctx.enums, club: inForce })
        }
        if (p.text.trim()) started = true
        // \everypar: the indent box gives way to \box\@labels \penalty\z@; after a nested environment, \@doendpe
        // drops it; later paragraphs are indented by \parindent
        const un = p.unskip ? { unskip: p.unskip } : {}
        // a \label before a theorem's text: its write on the vertical list, before a color group's push (\nobreak's while \if@nobreak holds)
        if (thmDef && p.start === "label") {
          const lead = p.text.match(/^(?:\s*\\label\{[A-Za-z0-9:._-]+\})+\s*/)
          if (lead) {
            // (\if@nobreak still holds right after a heading: \@nbitem leaves it, the paragraph's \everypar ends it)
            for (const m of lead[0].matchAll(/\\label\{([^}]*)\}/g)) v.nodes.push(labelWrite(refs, m[1]), ...esphackNobreaks(club !== undefined))
            p.text = p.text.slice(lead[0].length)
          }
        }
        // a {\color …} group that starts the paragraph: its push on the vertical list (the paragraph starts in the group)
        const colorStart = /^\s*\{\\color(?![A-Za-z])/.test(p.text)
        if (colorStart && club && p.start !== "label" && p.start !== "doendpe") throw new Unsupported("a color group starting an item's paragraph here")
        // (after a nested list, \@doendpe's \everypar runs in the group, and its \par clears all it set; after \\ the
        // push comes after \@centercr's skip, below)
        if (colorStart && (p.start === "label" || p.start === "doendpe")) p.text = leadingColor(p.text)
        // (so does a tabular: \begin{tabular}'s group, then \leavevmode)
        const groupStart = colorStart || tabularStart(p.text)
        if (groupStart && !colorStart && (p.start !== "label" || (club && depth > 1))) throw new Unsupported("a tabular starting an item's paragraph here")
        // (in a {\color …} group the \everypar's \clubpenalty\@clubpenalty ends with the group: the one in force stays,
        // the outer one for a first item, else what the item before set)
        // a theorem: \dth@everypar takes the indent box off and \unhbox'es the head (no \penalty\z@)
        const start = thmDef ? [...thmHead(), ...(p.nodes ?? [])] : [labels, penalty(0), ...(p.nodes ?? [])]
        const body = { ...(bodyAttrs ? { attrs: bodyAttrs } : {}), ...(qedAt(p) ? { end: qed() } : {}) }
        if (p.start === "label") {
          // (footnotes read in a color group, and a leading tabular's p{width} entries, see what \@item's \everypar set
          // there; after it, the one from before)
          const everyparClub = club ?? (b.env === "thebibliography" ? 4000 : run.k.ints.clubpenalty)
          typeset(p.text, { start, ...shape, ...un, ...body, ...(club && !groupStart ? { clubPenalty: club } : groupStart ? { clubPenalty: groupClub, noteClubPenalty: groupClub, ...{ leadGroupNoteClubPenalty: everyparClub } } : {}) }, parsep, ctx.size)
          if (!groupStart) groupClub = club ?? (b.env === "thebibliography" ? 4000 : run.k.ints.clubpenalty)
          // (\@item's \everypar ran in the group: after it, \clubpenalty is the one from before, and \everypar still \@item's)
          else itemClub = groupClub
        }
        // the nested list's group is over: its footnotes see the item's \clubpenalty (\@M right after a
        // heading); \@doendpe's \par sets \@clubpenalty for the lines
        else if (p.start === "doendpe") { typeset("\\noindent " + p.text, { ...shape, ...un, ...body, noteClubPenalty: itemClub ?? run.k.ints.clubpenalty }, parsep, ctx.size); itemClub = undefined }
        else {
          // a paragraph's \everypar resets \clubpenalty; after \\ with no text (a list next) none starts
          if (p.text) itemClub = undefined
          if (p.start === "cr") { // \@centercr: \par, (\nobreak), \addvspace{-\parskip}, (\vskip)
            if (p.crStar) v.nodes.push(penalty(10000))
            v.addvspace(negate(parsep))
            if (p.crSkip !== undefined) { try { v.vskip(parseGlue(p.crSkip, { em: sizeFont.params[QUAD], ex: sizeFont.params[X_HEIGHT] })) } catch { throw new Unsupported(`\\\\[${p.crSkip}]`) } }
          }
          if (colorStart) p.text = leadingColor(p.text) // (after the \@centercr skip)
          if (p.text) typeset(p.text, { start: [emptyBox("hlist", parindent)], ...shape, ...un, ...body }, parsep, ctx.size)
        }
      })
    })
    // \endtrivlist: the last item's \par, then \@endparenv
    v.endtrivlist(parsep, ctx.parskip, topsepadd)
    refs.label = outerLabel
  }

  /**
   * article's abstract (one column, no title page): \small, \begin{center}{\bfseries \abstractname
   * \vspace{-.5em}\vspace{\z@}}\end{center}, then the text in a quotation
   */
  function abstract(b: ListBlock, ctx: EnvCtx) {
    if (cls !== "article") throw new Unsupported(`abstract in ${cls}`)
    const small = { ...ctx, size: "small" as SizeCommand }
    const bf = loadFont(dataFont(run.k.sizes.small.bold.name), run.k.sizes.small.bold.at)
    const head: Node[] = []
    appendText(head, "Abstract", bf, { spaceFactor: 1000 }, false)
    const em = bf.params[QUAD]
    // \vspace in a paragraph: \vadjust{\vskip#1\vskip\z@skip}
    head.push({ kind: "adjust", list: [glue(-xnOverD(em, 32768, 65536)), glue(0)] }, { kind: "adjust", list: [glue(0), glue(0)] })
    list({ kind: "list", env: "center", items: [{ label: null, parts: [{ kind: "text", text: "", start: "label", nodes: head }] }], inPar: b.inPar, blank: false }, small)
    v.afterheadingEverypar = false
    list({ kind: "list", env: "quotation", items: b.items, inPar: false, blank: false }, small)
  }

  function typesetList(list: Node[], opts: Parameters<typeof paragraphInput>[4], withParskip: boolean) {
    const { params } = paragraphInput("", run.k, "normalsize", doc, { ...opts, amsmath })
    const lb = lineBreak(list, params)
    decisions.push(lb.trace)
    if (withParskip) v.paragraph(lb.vlist, outerParskip); else v.lines(lb.vlist)
    return { just: lb.lines[lb.lines.length - 1] ?? null, params, lines: lb.lines.length }
  }

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
      colors: (style: string) => styleColors(style),
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
  /** a listings style's \color commands, as their \special texts */
  /** a group that starts with \color before its paragraph does: the push on the vertical list, and the text that knows it */
  function leadingColor(text: string): string {
    const m = text.match(/^\s*\{\\color(?![A-Za-z])\s*(?:\[([^\]{}]*)\])?\s*\{([^{}]*)\}/)!
    v.nodes.push(colorPush(colorSpec(m[2], m[1])))
    return text.replace(/^(\s*\{\\)color/, "$1LXcolorpushed")
  }
  function styleColors(style: string) { return [...style.matchAll(COLOR_CMD)].map((m) => colorSpec(m[2], m[1])) }

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
      refs.href = href("lstlisting", n)
      lstAnchor(refs.href)
      if (o.label !== null) {
        if (!/^[A-Za-z0-9:._-]+$/.test(o.label)) throw new Unsupported(`listing label ${o.label}`)
        v.nodes.push(labelWrite(refs, o.label, String(n), href("lstlisting", n), hyper ? labelName(text) : refs.name)) // nameref: the caption
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
      v.box(hpack([glue(0, 65536, FIL), cap, glue(0, 65536, FIL)], { exactly: hsize }), run.k.sizes.normalsize.baselineskip)
      v.nodes.push(penalty(10000)); v.vskip(smallskip); v.nodes.push(penalty(10000))
    } else if (o.label !== null) throw new Unsupported("a listing label without a caption")
    // \lst@HRefStepCounter (\theHlstlisting: the chapter's, then the number); its \@currentHref is global
    else { run.negListing--; lstAnchor(href("lstlisting", run.negListing)); if (hyper) refs.href = href("lstlisting", run.negListing) }
    // the lineshape and frames aspects: \linewidth less xleftmargin and xrightmargin, \@totalleftmargin plus
    // xleftmargin, \lst@parshape (\parshape 1 for every paragraph); the frame's dimensions in the listing's font
    const parShape: [number, number][] = [[xleft, lw]]
    // breaklines: \pretolerance\@M, \rightskip\@flushglue, \parshape 2 with \lst@breakshape for the lines after the first
    const breaks = o.breaklines ? { pretolerance: 10000, rightSkip: paramGlue("rightskip", glue(0, 65536, FIL)) } : {}
    const shapes = lstFrameShapes(o.frame)
    // (the Init hook: fillcolor from backgroundcolor, rulesepcolor from fillcolor)
    const bkg = styleColors(o.backgroundcolor), fill = o.fillcolor ? styleColors(o.fillcolor) : bkg, rulesep = o.rulesepcolor ? styleColors(o.rulesepcolor) : fill
    const fr: LstFrame = {
      tshape: shapes.t, bshape: shapes.b, lshape: shapes.l, rshape: shapes.r, rule: dim("framerule"), sep: dim("framesep"), rulesep: dim("rulesep"), xleft: dim("framexleftmargin"), xright: dim("framexrightmargin"),
      colors: { rule: styleColors(o.rulecolor), bkg, fill, rulesep },
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
    const basicColors = styleColors(o.basicstyle)
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
      const hss = glue(0, 65536, FIL, 65536, FIL)
      // numberstyle's \color: pushed in the box, popped after it (\aftergroup at the box's end)
      const nc = styleColors(o.numberstyle), push = nc.map((c) => colorPush(c)), pops = nc.map(() => colorPop())
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
      else if ("disc" in e) line!.push({ kind: "disc", pre: [], post: [hpack([glue(0, 65536, FIL, 65536, FIL), frame(), kern(e.indent, true), kern(-xleft, true)], { exactly: 0 })], replaceCount: 0 })
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
    refs.href = href(env, number) // global; \@currentlabel ends with the float's group
    const ext = env === "figure" ? "lof" : "lot"
    out.push({ kind: "whatsit", text: `\\write1{\\@writefile{${ext}}{\\protect \\contentsline {${env}}{\\protect \\numberline {${the(number)}}{\\ignorespaces ${text}}}{\\thepage }{${hyper ? refs.href : ""}}\\protected@file@percent }}` })
    out.push(glue(run.k.dimens.abovecaptionskip))
    // \sbox\@tempboxa{\fnum@figure: text}: \figurename\nobreakspace\thefigure
    const l: Node[] = [], state = { spaceFactor: 1000 }
    appendText(l, env === "figure" ? "Figure" : "Table", romanFont, state, false)
    l.push(penalty(10000), glue(romanFont.params[SPACE], romanFont.params[SPACE_STRETCH], 0, romanFont.params[SPACE_SHRINK], 0)) // \nobreak\ 
    // hyperref: \hyper@@anchor (H.S H.R) before the text, after "n: "
    if (hyper) { appendText(l, `${the(number)}: `, romanFont, state, false); l.push(...spotAnchor(refs.href, "h", l.at(-1))); appendText(l, text, romanFont, state, false) }
    else appendText(l, `${the(number)}: ${text}`, romanFont, state, false)
    const cap = hpack(setgroup(l)) // \sbox
    if (cap.width > hsize) { // too wide for a line: #1: #2\par, a paragraph
      const start: Node[] = [hpack([])]
      appendText(start, env === "figure" ? "Figure" : "Table", romanFont, { spaceFactor: 1000 }, false)
      start.push(penalty(10000), glue(romanFont.params[SPACE], romanFont.params[SPACE_STRETCH], 0, romanFont.params[SPACE_SHRINK], 0))
      if (hyper) { appendText(start, `${the(number)}: `, romanFont, { spaceFactor: 1000 }); start.push(...spotAnchor(refs.href, "h", start.at(-1))); out.paragraph(start, text) }
      else out.paragraph(start, `${the(number)}: ${text}`)
    } else out.box(hpack([glue(0, 65536, FIL), cap, glue(0, 65536, FIL)], { exactly: hsize }))
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
      const flush = (p: string) => paramGlue(p, glue(0, 65536, FIL))
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
      if (m && number) { content.push(labelWrite(refs, m[1], the(number), refs.href, hyper ? captionName : refs.name)); continue } // nameref: the caption
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
    v.nodes.push(glue(0, 65536, FIL), penalty(-10000), hook("page=1"))
    run.k = { ...run.k, ints: { ...run.k.ints, interlinepenalty: 200 } }
    const parskip = run.k.glue.parskip.width // letter.cls: 0.7em; 2\parskip is a dimension
    const vspace = (g: GlueSpec) => { v.vskip(g); v.vskip(dimen(0)) } // \vspace in vertical mode
    const flush = (p: string) => paramGlue(p, glue(0, 65536, FIL))
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

  /**
   * report's \chapter: \clearpage, \thispagestyle{plain}, \global\@topnum\z@, \@afterindentfalse; then
   * \@chapter (\refstepcounter, which resets the sections, equations, figures, tables and footnotes; the
   * toc line; \addvspace{10pt} in the lof and lot) or \@schapter, and \@makechapterhead: \vspace*{50pt},
   * {\parindent\z@ \raggedright \normalfont \huge\bfseries \@chapapp\space\thechapter \par\nobreak \vskip20pt
   * \interlinepenalty\@M \Huge\bfseries title\par\nobreak \vskip40pt}, then \@afterheading
   */
  /** \clearpage: \newpage (which ends \if@nobreak), \write\m@ne{}, \vbox{}, \penalty-\@Mi */
  function clearpage() {
    noskipsecPar("a page break"); run.noskipsec = false // \newpage: \leavevmode, \global\@noskipsecfalse
    if (v.nobreak) { v.nobreak = false; v.afterheadingEverypar = false }
    v.nodes.push(glue(0, 65536, FIL), penalty(-10000), { kind: "whatsit", text: "\\write-{}" })
    v.box(emptyBox("vlist"), run.k.sizes.normalsize.baselineskip)
    v.nodes.push(penalty(-10001))
  }
  /** \cleardoublepage: \clearpage, then, two-sided, \ifodd\c@page\else\hbox{}\newpage\fi (the output decides) */
  function cleardoublepage() {
    clearpage()
    if (!run.k.ints.twoside) return
    const extra: Node[] = []
    appendToVlist(extra, hpack([]), v.prevDepth, run.k.sizes.normalsize.baselineskip, run.k.glue.lineskip, run.k.dimens.lineskiplimit)
    extra.push(glue(0, 65536, FIL), penalty(-10000))
    v.nodes.push({ kind: "whatsit", text: "", hook: { cleardouble: extra } satisfies OutputHook })
  }
  /** book's \frontmatter (\cleardoublepage, \@mainmatterfalse, \pagenumbering{roman}), \mainmatter, \backmatter */
  function matter(which: "front" | "main" | "back") {
    if (cls !== "book") throw new Unsupported(`\\${which}matter in ${cls}`)
    v.par()
    cleardoublepage() // \backmatter's when openright, as book is
    run.mainmatter = which === "main"
    if (which !== "back") v.nodes.push({ kind: "whatsit", text: "", hook: which === "front" ? "roman" : "arabic" })
  }

  function chapter(b: Extract<Block, { kind: "heading" }>) {
    if (cls !== "report" && cls !== "book") throw new Unsupported(`\\chapter in ${cls}`)
    v.par()
    if (cls === "book") cleardoublepage() // openright
    else clearpage()
    // \thispagestyle{plain}, \global\@topnum\z@
    v.nodes.push({ kind: "whatsit", text: "", hook: "plain" satisfies OutputHook }, { kind: "whatsit", text: "", hook: "notop" satisfies OutputHook })
    // book's \@chapter numbers only in the main matter
    const numbered = !b.star && (cls !== "book" || run.mainmatter)
    if (!b.star) {
      if (numbered) {
        counters.stepSectional(0)
        refs.label = counters.theSectional(0); refs.href = `chapter.${refs.label}`
        doc.footnote = 0
      } else if (hyper) refs.href = `chapter*.${++run.linkcounter}` // hyperref's \@chapter: \Hy@MakeCurrentHrefAuto
      // hyperref: the anchor, then \addcontentsline's bookmark and toc line
      if (hyper) { refs.name = labelName(b.title); v.nodes.push(...anchor(refs.href, run.k.sizes.normalsize.baselineskip.width, "v", lastNode())) }
      v.nodes.push(...contentsWrites(0, numbered ? String(counters.sectional[0]) : null, b.title, refs.href, false))
      // \chaptermark: \MakeUppercase{\@chapapp\ \thechapter. \ title}, to both marks when two-sided
      if (headings) {
        const cv = markValue(numbered ? [{ text: "Chapter" }, { ctrl: true }, { text: `${counters.sectional[0]}. ` }, { ctrl: true }, { text: b.title }] : [{ text: b.title }], true)
        v.nodes.push(...marks.insert(run.k.ints.twoside ? markboth(cv, EMPTY_MARK) : markright(cv), false))
      }
      for (const ext of ["lof", "lot"]) v.nodes.push({ kind: "whatsit", text: `\\write1{\\@writefile{${ext}}{\\protect \\addvspace {10\\p@ }}}` })
    } else if (hyper) { // \@schapter: \Hy@MakeCurrentHrefAuto{chapter*} and its anchor
      refs.href = `chapter*.${++run.linkcounter}`; refs.name = labelName(b.source ?? b.title)
      v.nodes.push(...anchor(refs.href, run.k.sizes.normalsize.baselineskip.width, "v", lastNode()))
    }
    // \vspace*{50pt}: \hrule height0pt \nobreak \vskip50pt \vskip\z@skip, keeping \prevdepth
    const pd = v.prevDepth
    const top: Node = { kind: "rule", width: null, height: 0, depth: 0 }
    v.nodes.push(top, penalty(10000), glue(50 * 65536), glue(0))
    v.prevDepth = pd
    // the head's first paragraph runs an \@afterheading \everypar still pending, which sets \@clubpenalty
    // (in the head's group)
    const club = v.afterheadingEverypar ? run.k.ints.clubpenalty : v.club
    const ragged = () => ({ start: [hpack([])], rightSkip: paramGlue("rightskip", glue(0, 65536, FIL)), finalHyphenDemerits: 0, clubPenalty: club }) // \parindent\z@ \raggedright
    if (numbered) {
      typeset(`Chapter ${counters.sectional[0]}`, { ...ragged(), font: run.k.sizes.huge.bold }, outerParskip, "huge")
      v.nodes.push(penalty(10000))
      v.vskip(dimen(20 * 65536))
    }
    typeset(b.title, { ...ragged(), font: run.k.sizes.Huge.bold, interLinePenalty: 10000, ...(b.end ? { end: b.end } : {}) }, outerParskip, "Huge")
    v.nodes.push(penalty(10000))
    v.vskip(dimen(40 * 65536))
    v.nobreak = true
    v.afterheadingEverypar = true
    v.afterindent = false
  }

  /**
   * \paragraph and \subparagraph: \@startsection with a negative afterskip (-1em). Before it, \par and
   * \@secpenalty with the beforeskip (3.25ex plus1ex minus.2ex), or \everypar{} right after a heading;
   * the heading waits (\@svsechd) for the next paragraph, whose \everypar puts it in place of the indent
   * box: {\normalfont\normalsize\bfseries\hskip #3 title}, the toc line, \unskip\hskip 1em
   */
  function runInHeading(b: Extract<Block, { kind: "heading" }>) {
    const name = b.level === 4 ? "paragraph" : "subparagraph"
    const before = new Scanner("3.25ex plus1ex minus.2ex", bodyUnits).scanGlue()
    noskipsecPar("a heading")
    run.noskipsec = false // (\@xsect: \@noskipsectrue, with its own \everypar)
    v.par()
    if (run.runIn) throw new Unsupported("two run-in headings in a row")
    if (v.nobreak) v.afterheadingEverypar = false // \everypar{}
    else { v.addpenalty(-300); v.addvspace(before) }
    v.afterindent = true
    if (!b.star && b.level <= run.k.ints.secnumdepth) throw new Unsupported(`numbered \\${name}`)
    v.nobreak = false // \@nobreakfalse
    // hyperref: \Hy@MakeCurrentHrefAuto now, its anchor box at the start of the title
    const anchorName = hyper ? `section*.${++run.linkcounter}` : ""
    if (hyper) { refs.href = anchorName; refs.name = labelName(b.title) }
    // \@svsechd is a \def: its title (and the toc line's) is expanded when the paragraph puts it in place
    run.runIn = (em = romanFont.params[QUAD], parindent = run.k.dimens.parindent) => {
      const title = counted(b.title)
      const indent = b.level === 5 ? parindent : 0 // (\hskip #3, read where it is put in place)
      const start: Node[] = [glue(indent), ...(hyper ? [sectionAnchorBox(anchorName, indent, run.k.sizes.normalsize.baselineskip.width)] : [])]
      const head = paragraphInput(title, run.k, "normalsize", doc, { start, font: run.k.sizes.normalsize.bold, amsmath }).list
      if (!b.star) head.push(...contentsWrites(b.level, null, title, refs.href, false)) // (\@currentHref when the paragraph starts)
      if (head[head.length - 1]?.kind === "glue") head.pop() // \unskip
      head.push(glue(em)) // \hskip -\@tempskipa
      return head
    }
  }

  /** \@startsection{name}{level}{\z@}{beforeskip}{afterskip}{\normalfont<size>\bfseries} and its starred form */
  function heading(heading: Extract<Block, { kind: "heading" }>) {
    if (heading.level >= 4) return runInHeading(heading)
    const b = { ...heading, title: counted(heading.title) } // as \protected@edef and the typesetting see it
    const size = (["normalsize", "Large", "large", "normalsize"] as const)[b.level as 0 | 1 | 2 | 3]
    const glueOf = (x: string) => new Scanner(x, bodyUnits).scanGlue()
    let before = glueOf(b.level === 1 ? "-3.5ex plus -1ex minus -.2ex" : "-3.25ex plus -1ex minus -.2ex")
    const after = glueOf(b.level === 1 ? "2.3ex plus .2ex" : "1.5ex plus .2ex")
    noskipsecPar("a heading") // \@startsection's \if@noskipsec\leavevmode
    v.par() // \@startsection's \par
    const afterHeading = v.nobreak
    if (afterHeading) v.afterheadingEverypar = false // \if@nobreak \everypar{}
    // the heading's \noindent starts its paragraph in the heading's group: an \@afterheading \everypar
    // still in force sets \@clubpenalty there (locally); otherwise the \clubpenalty in force holds
    const headingClub = v.afterheadingEverypar ? run.k.ints.clubpenalty : v.club
    v.afterindent = true
    if (before.width < 0) { before = negate(before); v.afterindent = false }
    if (!v.nobreak) { v.addpenalty(-300); v.addvspace(before) } // \@secpenalty
    // \@sect: the number and the space after it (\@seccntformat: \the<name>\quad) in a box the title hangs from
    const numbered = !b.star && b.level <= run.k.ints.secnumdepth
    let number = ""
    if (!b.star) {
      counters.stepSectional(b.level)
      number = counters.theSectional(b.level)
    }
    if (numbered) { refs.label = number; refs.href = `${["", "section", "subsection", "subsubsection"][b.level]}.${number}` } // \refstepcounter
    // hyperref: \refstepcounter's anchor on the vertical list; an unnumbered heading's (\Hy@MakeCurrentHrefAuto)
    // in an \hbox to 0pt at the start of its title; nameref's \@currentlabelname is the title
    let anchorName = ""
    if (hyper) {
      if (numbered) { anchorName = refs.href; v.nodes.push(...anchor(anchorName, run.k.sizes.normalsize.baselineskip.width, "v", lastNode())) }
      else { anchorName = `section*.${++run.linkcounter}`; refs.href = anchorName }
      refs.name = labelName(heading.source ?? heading.title)
    }
    const bold = run.k.sizes[size].bold
    const bf = loadFont(dataFont(bold.name), bold.at)
    const label: Node[] = [glue(0)] // \hskip #3 (\z@)
    if (numbered) { appendText(label, number, bf, { spaceFactor: 1000 }, false); label.push(glue(bf.params[QUAD])) }
    const box = hpack(label)
    const start = hyper && !numbered ? [box, sectionAnchorBox(anchorName, 0, run.k.sizes[size].baselineskip.width)] : [box]
    typeset(b.title, { start, font: bold, hangIndent: box.width, interLinePenalty: 10000, clubPenalty: headingClub, ...(heading.end ? { end: heading.end } : {}) }, outerParskip, size)
    // \@sect: \sectionmark, then \addcontentsline{toc}: \protected@write, a \write after the heading's lines,
    // with \nobreak after it while \if@nobreak holds (a heading right after a heading)
    if (numbered && headings) v.nodes.push(...marks.insert(sectionMarks(cls, !!run.k.ints.twoside, b.level, number, b.title), afterHeading))
    if (!b.star) v.nodes.push(...contentsWrites(b.level, numbered ? number : null, b.title, anchorName, afterHeading))
    // \@xsect: \par \nobreak \vskip afterskip \@afterheading
    v.nodes.push(penalty(10000))
    v.vskip(after)
    v.nobreak = true
    v.afterheadingEverypar = true
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
