// A whole document laid out as pdflatex lays it out, end to end. document()
// runs LaTeX's two passes (the second reads the .toc and .aux the first wrote);
// each pass, layout(), reads the preamble, builds the run's context (Ctx), puts
// the body's blocks on the main vertical list (body.ts and the parts it calls:
// sectioning, lists, displays, floats, boxes, listings, front matter, letter),
// then builds the pages (output.ts), ships them out with their running heads,
// and collects what the next pass reads. Anything not modeled throws
// Unsupported, and the document is reported as not laid out yet.

import { dataFont } from "./data"
import { emitBoxes } from "../emit/boxes"
import { shipOut } from "../emit/trace"
import { type SizeCommand } from "../layout/classdata"
import type { GlueSpec } from "../layout/dimen"
import { loadFont, QUAD, X_HEIGHT } from "../layout/font"
import { parseDimen } from "../layout/dimen"
import { lineBreak } from "../layout/linebreak"
import { penalty, type Node } from "../layout/nodes"
import type { ParagraphTrace } from "../trace/decisions"
import type { LayoutResult } from "./result"
import { blocksOf } from "./blocks"
import { prepareSource, type DocumentSource } from "./source"
import { Counters } from "./counters"
import { markText, MarkWriter, pageMarks } from "./marks"
import { TocWriter, type TocEntry } from "./toc"
import { readPreamble } from "./preamble"
import { runState } from "./run"
import type { Ctx } from "./context"
import { Unsupported } from "./unsupported"
import { VerticalList } from "./vlist"
import { endDocument, outputOptions, makeColumns, outputPage, NobreakFloat } from "./output"
import { anchor, Bookmarks, documentStart, type Bookmark } from "./hyperref"
import { Colors, colorPush, xcolor } from "./xcolor"
import { paragraphInput, selectFont, type DocState, type FontAttrs, type Refs } from "./paragraph"
import { minipageAt, tabularAt } from "./boxes"
import { lstinlineAt } from "./lstlisting"
import { hrefAt, urlAt } from "./url"
import { boundingBox, graphicAt, type BoundingBox } from "./graphics"
import { processBlock, runInAlone } from "./body"

export interface DocumentOptions {
  /** the date \today prints, in seconds since 1970 (SOURCE_DATE_EPOCH); now by default */
  epoch?: number
  /** graphics files' bounding boxes, by file name (a filecontents* environment in the source also gives one) */
  images?: Record<string, BoundingBox>
}

export function document(source: string, { epoch = Math.floor(Date.now() / 1000), images: given = {} }: DocumentOptions = {}): LayoutResult {
  const prepared = prepareSource(source)
  // the graphics files' bounding boxes: the options', then the files the source writes
  const images = new Map(Object.entries(given))
  for (const [name, contents] of prepared.files) { const bb = boundingBox(contents); if (bb) images.set(name, bb) }
  // Whether a float right after a heading goes here decides \if@nobreak for the text after it,
  // which is laid out before the output routine places the float: the document is laid out again,
  // with the float not placed here, until every such guess holds.
  const run = (aux: Aux | null) => {
    const notHere = new Set<number>()
    for (;;) {
      try { return layout(prepared, notHere, aux, epoch, images) } catch (e) {
        if (!(e instanceof NobreakFloat) || notHere.has(e.index)) throw e
        notHere.add(e.index)
      }
    }
  }
  // the oracle runs LaTeX twice: the second run reads the .toc and .aux files the first one wrote
  const first = run(null)
  return first.written ? run(first.written).result : first.result
}

/** The commands that read what the run before wrote to the .aux file: with one, LaTeX runs twice. */
const READS_AUX = /\\(?:ref|pageref|eqref|cite)\{/

/** What a run writes for the next one: the .toc file's lines and the .aux file's \newlabel values. */
interface Aux { toc: TocEntry[]; labels: Map<string, { label: string; page: string; href: string }>; /** hyperref's .out file */ bookmarks: Bookmark[]; /** \bibcite: key → number */ cites: Map<string, string> }

/**
 * The document laid out once, as one LaTeX run: `prev` is what the run before wrote (null: none
 * yet). `written` is what this run writes, when the document reads it (a \tableofcontents, a \ref).
 */
function layout({ src, listings, tabulars, minipages, urls, graphics }: DocumentSource, notHere: Set<number>, prev: Aux | null, epoch: number, images: Map<string, BoundingBox>): { result: LayoutResult; written: Aux | null } {
  const toc = prev ? prev.toc : null
  const pre = readPreamble(src)
  const { cls, option, usesXcolor, amsmath, hyper, t1, booktabsT1, colorDefs, pagestyle, newCounters, body } = pre
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
  for (const [n, m, x] of colorDefs) colors.define(n, m, x)
  const colorSpec = (spec: string, model?: string) => {
    if (!usesXcolor) throw new Unsupported("a color without xcolor")
    return colors.spec(spec, model)
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
  // booktabs's dimensions, set as it loads, in the class's \normalsize roman (.08em, .05em, .03em, .65ex, .4ex, .5em)
  const booktabs = booktabsT1 === null ? null : (() => {
    const f = selectFont(run.k, "normalsize", { enc: booktabsT1 ? "T1" : "OT1", fam: "cmr", ser: "m", shape: "n" })
    const d = (x: string) => parseDimen(x, { em: f.params[QUAD], ex: f.params[X_HEIGHT] })
    return { heavyrulewidth: d(".08em"), lightrulewidth: d(".05em"), cmidrulewidth: d(".03em"), belowrulesep: d(".65ex"), belowbottomsep: 0, aboverulesep: d(".4ex"), abovetopsep: 0, cmidrulesep: run.k.dimens.doublerulesep, cmidrulekern: d(".5em"), defaultaddspace: d(".5em") }
  })()
  const normalAttrs: FontAttrs = { enc: t1 ? "T1" : "OT1", fam: "cmr", ser: "m", shape: "n" }

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

  doc.tabular = (...a) => tabularAt(cx, ...a)
  doc.minipage = (...a) => minipageAt(cx, ...a)
  doc.lstinline = (...a) => lstinlineAt(cx, ...a)
  doc.url = (...a) => urlAt(cx, ...a)
  doc.href = (...a) => hrefAt(cx, ...a)
  doc.graphic = (...a) => graphicAt(cx, ...a)
  const cx: Ctx = { pre, run, v, doc, decisions, toc, marks, mkboth, romanFont, roman, bodyUnits, outerParskip, epoch, typeset, counters, refs, headings, lastNode, counted, contentsWrites, noskipsecPar, colorSpec, esphackNobreaks, listings, tabulars, minipages, urls, graphics, images, notHere, normalAttrs, booktabs }
  blocks.forEach((x, i, all) => processBlock(cx, x, i, all))

  if (run.runIn) runInAlone(cx) // \end{document}'s \clearpage: \newpage's \if@noskipsec\leavevmode
  if (run.noskipsec) { v.par(); noskipsecPar("the end of the document") } // \@kernel@before@enddocument's \par, then \clearpage
  let built: ReturnType<typeof endDocument>
  try { built = endDocument(v.nodes, run.k, outerParskip) } catch (e) {
    if ((e as Error).message.startsWith("page builder: a float")) throw new Unsupported((e as Error).message.slice(14))
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
  if (blocks.some((b) => b.kind === "toc") || READS_AUX.test(body) || hyper) {
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
