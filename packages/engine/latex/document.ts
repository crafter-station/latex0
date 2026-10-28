// A whole document laid out as pdflatex lays it out, end to end. document()
// runs LaTeX's two passes (the second reads the .toc and .aux the first wrote);
// each pass, layout(), reads the preamble, builds the run's context (Ctx), puts
// the body's blocks on the main vertical list (body.ts and the parts it calls:
// sectioning, lists, displays, floats, boxes, listings, front matter, letter),
// then builds the pages (output.ts), ships them out with their running heads,
// and collects what the next pass reads. Anything not modeled throws
// Unsupported, and the document is reported as not laid out yet.

import { dataFont } from "./data"
import { fancyPage } from "./fancyhdr"
import { pdftexColors } from "./pdftex"
import { emitBoxes } from "../emit/boxes"
import { shipOut, type PageMark } from "../emit/trace"
import { type SizeCommand } from "../layout/classdata"
import type { GlueSpec } from "../layout/dimen"
import { loadFont, QUAD, X_HEIGHT } from "../layout/font"
import { parseDimen } from "../layout/dimen"
import { lineBreak } from "../layout/linebreak"
import { penalty, type Node } from "../layout/nodes"
import type { ParagraphTrace } from "../trace/decisions"
import type { LayoutResult } from "./result"
import { blocksOf, displaySegments } from "./blocks"
import { listParagraphWithDisplays } from "./displays"
import { prepareSource, type DocumentSource } from "./source"
import { Counters } from "./counters"
import { markLanguage, markText, MarkWriter, pageMarks } from "./marks"
import { babelAux, babelBegin, babelState, babelFrenchspacing, isSpanish, languageCaptions, selectInGroups } from "./babel"
import { markAccentHyphens, spanishLayout, spanishText } from "./spanish"
import { germanT1, isGerman } from "./german"
import { accentHyphens, babelUmlauts, sourceText } from "./encodings"
import { spacing } from "../layout/hmode"
import { TocWriter, type ListEntry, type ListFile, type TocEntry } from "./toc"
import { readPreamble } from "./preamble"
import { runState } from "./run"
import type { Ctx } from "./context"
import { Unsupported } from "./unsupported"
import { VerticalList } from "./vlist"
import { endDocument, firstPage, L3BACKEND_HEADER, outputOptions, makeColumns, outputPage, NobreakFloat } from "./output"
import { anchor, Bookmarks, documentStart, hyperDriver, hyperFirstPage, pageLabels, papersize, putPageLabels, type Bookmark } from "./hyperref"
import { COLOR_STY, Colors, colorPush, xcolor } from "./xcolor"
import { fontAt, mathFonts, paragraphInput, selectFont, type DocState, type FontAttrs, type NewLabel, type Refs } from "./paragraph"
import { minipageAt, parboxAt, tabularAt, widthRegisters } from "./boxes"
import { lstinlineAt } from "./lstlisting"
import { hrefAt, urlAt } from "./url"
import { boundingBox, graphicAt, type BoundingBox } from "./graphics"
import { pgfCompatObjects, pgfShipoutBackground, tikzAt } from "./tikz"
import type { Image } from "./images"
import { getpen, processBlock, runInAlone } from "./body"
import { CrefSetup, fillCrefWrites, type CrefEntry } from "./cleveref"
import { documentClass } from "./classes"
import { beamerDocument } from "./beamer"
import { unbraced } from "./enumitem"
import { today } from "./frontmatter"

export interface DocumentOptions {
  /** the date \today prints, in seconds since 1970 (SOURCE_DATE_EPOCH); now by default */
  epoch?: number
  /** graphics files' bounding boxes, by file name (a filecontents* environment in the source also gives one) */
  images?: Record<string, BoundingBox | Image>
  /** the output driver: pdfTeX's own (`pdflatex`, the default, what most documents are compiled with: PNG, JPEG
   *  and PDF images) or dvips (`latex`: EPS images) */
  driver?: "dvips" | "pdftex"
}

export function document(source: string, { epoch = Math.floor(Date.now() / 1000), images: given = {}, driver = "pdftex" }: DocumentOptions = {}): LayoutResult {
  const prepared = prepareSource(source)
  // beamer has a pipeline of its own
  if (documentClass(prepared.src).cls === "beamer") return beamerDocument(prepared, driver, epoch)
  // the graphics files' bounding boxes: the options', then the files the source writes
  const images = new Map<string, BoundingBox | Image>(Object.entries(given))
  for (const [name, contents] of prepared.files) { const bb = boundingBox(contents); if (bb) images.set(name, bb) }
  // Whether a float right after a heading goes here decides \if@nobreak for the text after it,
  // which is laid out before the output routine places the float: the document is laid out again,
  // with the float not placed here, until every such guess holds.
  const run = (aux: Aux | null) => {
    const notHere = new Set<number>()
    for (;;) {
      try { return layout(prepared, notHere, aux, epoch, images, driver) } catch (e) {
        if (!(e instanceof NobreakFloat) || notHere.has(e.index)) throw e
        notHere.add(e.index)
      } finally { spacing.french = false; markLanguage.name = null; accentHyphens.on = spanishLayout.on = spanishText.on = false; babelUmlauts.mode = null; babelBegin(null) } // (babel's, for this document only)
    }
  }
  // the oracle runs LaTeX twice: the second run reads the .toc and .aux files the first one wrote
  const first = run(null)
  return first.written ? run(first.written).result : first.result
}

/** The commands that read what the run before wrote to the .aux file: with one, LaTeX runs twice. */
const READS_AUX = /\\(?:ref|pageref|eqref|cite|[cC](?:page)?ref(?:range)?\*?|autoref\*?|nameref\*?|Nameref)\{/

/** What a run writes for the next one: the .toc file's lines and the .aux file's \newlabel values. */
interface Aux { toc: TocEntry[]; labels: Map<string, NewLabel>; /** hyperref's .out file */ bookmarks: Bookmark[]; /** hyperref's \HyPL@Entry lines */ pageLabels: string; /** the .lof and .lot files */ lists: Record<ListFile, ListEntry[]>; /** \bibcite: key → number */ cites: Map<string, string>; /** cleveref's \newlabel{key@cref} */ crefs: Map<string, CrefEntry> }

/**
 * The document laid out once, as one LaTeX run: `prev` is what the run before wrote (null: none
 * yet). `written` is what this run writes, when the document reads it (a \tableofcontents, a \ref).
 */
function layout({ src, listings: listings0, tabulars: tabulars0, minipages: minipages0, urls, graphics, tikz }: DocumentSource, notHere: Set<number>, prev: Aux | null, epoch: number, images: Map<string, BoundingBox | Image>, driver: "dvips" | "pdftex"): { result: LayoutResult; written: Aux | null } {
  const toc = prev ? prev.toc : null
  const pre = readPreamble(src)
  // spanish.ldf's accents in what was taken out of the source: tabulars, minipages, listings' options (captions)
  const es = isSpanish(pre.babel)
  const tabulars = es ? tabulars0.map((t) => ({ ...t, body: markAccentHyphens(t.body) })) : tabulars0
  const minipages = es ? minipages0.map((m) => ({ ...m, body: markAccentHyphens(m.body) })) : minipages0
  const listings = es ? listings0.map((l) => ({ ...l, options: markAccentHyphens(l.options) })) : listings0
  // (listings prints % with \%, which spanish.ldf's \es@sppercent makes $\,$%)
  if (es && listings0.some((l) => l.lines.some((x) => x.includes("%")))) throw new Unsupported("% in a listing with spanish.ldf")
  const { cls, option, usesXcolor, amsmath, hyper, hyperNotes, t1, booktabsFont, colorDefs, pagestyle, newCounters, body } = pre
  hyperDriver.pdftex = driver === "pdftex"
  mathFonts.letters = null
  const run = runState(pre.k)
  // \today: the date's characters (the spaces after the control word go, and its line's end, unless a blank line follows)
  // (in the main language: with babel's language commands, the one selected there is not modeled)
  if (pre.babel && /\\today(?![A-Za-z])/.test(body) && /\\(?:selectlanguage|foreignlanguage)(?![A-Za-z])|\\begin\s*\{otherlanguage/.test(body)) throw new Unsupported("\\today with babel's language commands")
  const dated = body.replace(/\\today(?![A-Za-z])[ \t]*(?:\n[ \t]*(?=[^\s]))?/g, () => today(epoch, pre.babel))
  if (pre.babel) { selectInGroups(dated); for (const x of [...tabulars0, ...minipages0]) selectInGroups(x.body, true) }
  const blocks = blocksOf(isSpanish(pre.babel) ? markAccentHyphens(dated) : dated)
  spanishLayout.on = isSpanish(pre.babel)
  germanT1.on = !!run.k.ints.T1

  const v = new VerticalList(run.k)
  // (spanish.ldf's layout, french.ldf's \bbl@frenchindent: \@afterindentfalse is \@afterindenttrue)
  v.alwaysIndent = isSpanish(pre.babel) || pre.babel?.main === "french"
  // a color package: xcolor, or the color package siunitx or hyperref's colorlinks loads at \begin{document} (its
  // default color named Black)
  const colorlinks = hyper && pre.hyperOpts.colorlinks
  const usesColor = usesXcolor || pre.usesSiunitx || colorlinks
  xcolor.on = usesColor
  xcolor.normal = usesXcolor ? "gray 0" : " Black"
  outputOptions.xcolor = usesColor
  // \begin{document}'s \normalcolor (\relax still when siunitx loads color, in its \AtBeginDocument after it)
  if (usesXcolor) v.nodes.push(colorPush())
  // pgf.sty's compatibility arrows (after xcolor, which tikz loads first): objects whose dvips header specials the
  // preamble puts on the main vertical list
  if (pre.tikz && driver !== "pdftex") v.nodes.push(...pgfCompatObjects())
  const refs: Refs = { label: "", href: hyper ? "Doc-Start" : "", name: "", prev: prev ? prev.labels : null, writes: [], hyper, hyperNotes, nameref: pre.nameref, cites: prev?.cites }
  // a name macro in a label's name (\tableofcontents's \contentsname \@mkboth{…}{…}, \listoftables's \listtablename) means
  // what it means where \nameref reads it: the document's caption names (no language switch changes them), \@mkboth
  // the page style's (\@gobbletwo in plain, empty and myheadings; headings and fancy's \markboth would set marks); a
  // document counter's \the<counter> its value there (not known when the paragraph's own text also changes counters)
  let countersInText = false
  refs.nameMacros = (name) => {
    const counter = counters.counted(name, true, () => {})
    if (counter !== name && countersInText) throw new Unsupported(`\\nameref to "${name}" in a paragraph that changes a counter`)
    return counter.replace(/\\(contentsname|listfigurename|listtablename|refname|bibname|indexname)(?![A-Za-z])\s*(\\@mkboth\s*\{(?:[^{}]|\{[^{}]*\})*\}\s*\{(?:[^{}]|\{[^{}]*\})*\})?/g, (all, macro: keyof typeof pre.names, mkboth) => {
      if (/\\(?:selectlanguage|LXotherlanguage)\b/.test(pre.body)) throw new Unsupported(`\\nameref to "${all}" with a language switch`)
      if (mkboth && !["plain", "empty", "myheadings"].includes(pre.pagestyle)) throw new Unsupported(`\\nameref to "${all}" with \\pagestyle{${pre.pagestyle}}`)
      return pre.names[macro]
    })
  }
  /** \Hy@writebookmark's state */
  // (its .out file is \write3, or \write4 after pgf's \newwrite\w@pgf@writea: pgfsys.code.tex 67)
  const bookmarks = new Bookmarks(pre.tikz ? 4 : 3, pre.hyperOpts.bookmarksOpen ? "" : "-")
  /** the main vertical list's last node, as \lastskip and \lastnodetype see it (a hook is no node) */
  const lastNode = () => v.nodes.findLast((x) => !(x.kind === "whatsit" && x.hook))
  // babel's \AtBeginDocument: \selectlanguage of the main language, its \write to the .aux file (before or after
  // hyperref's, as the packages were loaded)
  const babelStart = () => { if (pre.babel) v.nodes.push({ kind: "whatsit", text: babelAux(pre.babel.main) }) }
  if (pre.babel?.beforeHyperref) babelStart()
  if (hyper) {
    // \AtBeginDocument: the outlines, /DOCVIEW, the Catalog; the Doc-Start anchor
    v.nodes.push(...documentStart(prev ? prev.bookmarks : [], pre.hyperOpts.bookmarksOpen))
    v.nodes.push(...anchor("Doc-Start", run.k.sizes.normalsize.baselineskip.width, "v", lastNode()))
    if (prev?.pageLabels && !hyperDriver.pdftex) v.nodes.push(putPageLabels(prev.pageLabels))
  }
  if (pre.babel && !pre.babel.beforeHyperref) babelStart()
  // the language selected's extras: spanish.ldf's \textspanish (\frenchspacing, its accents and umlauts), \mathspanish
  // and shorthands; the marks' \foreignlanguage
  const extras = (lang: string | null) => {
    accentHyphens.on = spanishText.on = lang === "spanish"
    babelUmlauts.mode = lang === null ? null : lang === "spanish" ? "spanish" : isGerman(lang) ? "german" : "high"
    // (amsgen's \frenchspacing: amsmath's, amsthm's or siunitx's amstext)
    spacing.french = lang !== null && babelFrenchspacing(lang) ? (pre.amsmath || pre.usesAmsthm || pre.usesSiunitx ? "ams" : "latex") : false
    markLanguage.name = lang
  }
  extras(pre.babel?.main ?? null)
  // babel's language commands select a language's captions and extras
  babelBegin(pre.babel, (lang) => {
    // (caption.sty's names, set after babel's at \begin{document}, are its own until \captions<lang> sets them again)
    if (pre.caption && Object.keys(pre.caption.keys.names).length) throw new Unsupported("caption.sty's names with babel's language commands")
    Object.assign(pre.names, languageCaptions(lang, cls === "report" || cls === "book")); extras(lang)
  }, body)
  if (colorDefs.length && !usesXcolor) throw new Unsupported("\\definecolor without xcolor")
  const colors = new Colors()
  for (const [n, m, x] of colorDefs) colors.define(n, m, x)
  const colorSpec = (spec: string, model?: string) => {
    if (!usesXcolor) throw new Unsupported("a color without xcolor")
    return colors.spec(spec, model)
  }
  // hyperref's \@pdfborder, and with colorlinks each link type's color (xcolor's, or color.sty's named ones)
  hyperDriver.border = colorlinks ? "0 0 0" : pre.hyperOpts.border
  hyperDriver.colors = null
  if (colorlinks) {
    const c = pre.hyperOpts.colors, spec = (x: string) => (usesXcolor ? colors.spec(x) : COLOR_STY[x] ?? colorSpec(x))
    hyperDriver.colors = { link: spec(c.link), anchor: spec(c.anchor), cite: spec(c.cite), file: spec(c.file), url: spec(c.url) }
  }
  const doc: DocState = { footnote: 0, refs, ...(pre.babel ? { babel: pre.babel } : {}), xcolor: usesColor, siunitx: pre.usesSiunitx ? pre.siOptions : undefined, subcaption: pre.usesSubcaption, color: colorSpec, ...(pre.natbib ? { natbib: prev ? pre.natbib.later : pre.natbib.first } : {}) }
  const decisions: ParagraphTrace[] = []
  // where each paragraph was broken: the length of the main vertical list then (its material so far)
  const brokenAt: number[] = []
  // (a trace taken back keeps its place for what is pushed next: a paragraph whose line breaking float.sty's [H]
  // put after its box's, all of them read before the material that has been added since)
  let held: number | undefined
  decisions.push = (...xs: ParagraphTrace[]) => { const at = held ?? v.nodes.length; held = undefined; for (const _ of xs) brokenAt.push(at); return Array.prototype.push.apply(decisions, xs) }
  decisions.pop = () => { held = brokenAt.pop(); return Array.prototype.pop.call(decisions) as ParagraphTrace | undefined }
  const outerParskip = run.k.glue.parskip
  const typeset = (text: string, opts: Parameters<typeof paragraphInput>[4], parskip: GlueSpec, size: SizeCommand = "normalsize") => {
    if (displaySegments(text).length > 1) return listParagraphWithDisplays(cx, text, opts ?? {}, parskip, size)
    const { list, params, notes } = paragraphInput(counted(text, true), run.k, size, doc, { ...opts, amsmath })
    const { vlist, trace } = lineBreak(list, params)
    decisions.push(...notes, trace)
    v.paragraph(vlist, parskip, run.k.sizes[opts?.parSize ?? size].baselineskip)
  }
  const roman = run.k.sizes.normalsize.font
  // skips in ex are read in the body font (\@startsection evaluates them before the heading's font)
  const romanFont = loadFont(dataFont(roman.name), roman.at)
  const bodyUnits = { em: romanFont.params[QUAD], ex: romanFont.params[X_HEIGHT] }
  const tocFile = new TocWriter()
  const marks = new MarkWriter()
  const headings = pre.markDefs, mkboth = pagestyle === "headings" || pagestyle === "fancy"
  /** hyperref's \addcontentsline: the bookmark line (to the depth of \c@tocdepth), then the toc line; each
   *  \protected@write adds \nobreak while \if@nobreak holds */
  const contentsWrites = (level: TocEntry["level"], number: string | null, title: string, anchorName: string, nobreak: boolean, vertical = false): Node[] => {
    const out: Node[] = []
    if (hyper && level <= (cls === "article" ? 3 : 2)) {
      // \@@writetorep: a bookmark whose anchor is its parent's gets a new one, \phantomsection's (\Hy@MakeCurrentHrefAuto,
      // in vertical mode the anchor itself), which the bookmark and the toc line then point to
      let written = anchorName
      if (bookmarks.parentOf(level) === anchorName) {
        if (!vertical) throw new Unsupported("a bookmark whose anchor is its parent's")
        written = refs.href = `section*.${++run.linkcounter}`
        out.push(...anchor(written, run.k.sizes.normalsize.baselineskip.width, "v", lastNode()))
      }
      const bm = bookmarks.add(level, anchorName, title, written)
      anchorName = written
      if (!bm) throw new Unsupported(`a bookmark for "${title}"`)
      out.push(bm)
      if (nobreak) out.push(penalty(10000))
    }
    out.push(tocFile.write(level, number, title, hyper ? anchorName : "", babelState.written))
    if (nobreak) out.push(penalty(10000))
    return out
  }
  // booktabs's dimensions, set as it loads, in the class's \normalsize roman (.08em, .05em, .03em, .65ex, .4ex, .5em)
  const booktabs = booktabsFont === null ? null : (() => {
    const f = fontAt(booktabsFont.name, booktabsFont.at)
    const d = (x: string) => parseDimen(x, { em: f.params[QUAD], ex: f.params[X_HEIGHT] })
    return { heavyrulewidth: d(".08em"), lightrulewidth: d(".05em"), cmidrulewidth: d(".03em"), belowrulesep: d(".65ex"), belowbottomsep: 0, aboverulesep: d(".4ex"), abovetopsep: 0, cmidrulesep: run.k.dimens.doublerulesep, cmidrulekern: d(".5em"), defaultaddspace: d(".5em") }
  })()
  const normalAttrs: FontAttrs = { enc: t1 ? "T1" : "OT1", fam: "cmr", ser: "m", shape: "n" }

  // (french.ldf with hyperref, natbib, cleveref, caption.sty, TikZ or in a letter: its names, active punctuation and layout there
  // are not modeled)
  if (pre.babel?.languages.includes("french") && (hyper || pre.natbib || pre.cleveref || pre.usesCaption || pre.tikz || cls === "letter")) throw new Unsupported(`french.ldf with ${hyper ? "hyperref" : pre.natbib ? "natbib" : pre.cleveref ? "cleveref" : pre.usesCaption ? "caption.sty" : pre.tikz ? "TikZ" : "the letter class"}`)
  // (babel-german with hyperref: its shorthands in the bookmarks are not modeled; listings with babel-german's active " or
  // french's ; : ! ?, neither)
  if (hyper && pre.babel?.languages.some(isGerman)) throw new Unsupported("babel-german with hyperref")
  if (pre.usesListings && pre.babel?.languages.some((l) => isGerman(l) || l === "french")) throw new Unsupported("listings with babel-german or french")
  const counters = new Counters(cls, newCounters, () => doc.footnote)
  // (cleveref's language options among the class's, with babel: its brazilian not modeled; its english and spanish also
  // \crefname in babel's \extras<lang>, over the preamble's)
  if (pre.cleveref && pre.babel?.global.some((o) => o === "brazilian" || isGerman(o))) throw new Unsupported(`cleveref's ${pre.babel.global} option`)
  if (pre.cleveref && pre.crefNames.length && pre.babel?.global.some((o) => o === "english" || o === "spanish")) throw new Unsupported(`\\crefname with cleveref's ${pre.babel.global} option`)
  // (cleveref's spanish option, the class's: its names, with spanish.ldf's accents)
  const crefSpanish = isSpanish(pre.babel) && pre.babel!.global.includes("spanish") ? (n: string) => sourceText(markAccentHyphens(n)) : undefined
  if (pre.cleveref) refs.cleveref = { current: null, byHref: counters.crefs, writes: [], prev: prev ? prev.crefs : null, at: () => v.nodes.length, setup: new CrefSetup(pre.crefOptions, pre.thmDefs, pre.crefNames, crefSpanish) }
  /** counter commands in text: a \refstepcounter outside text sets \@currentlabel and \@currentHref (and hyperref's anchor) */
  const counted = (text: string, inText = false): string => (countersInText = inText && /\\(?:set|addto|step|refstep)counter\b/.test(text), counters.counted(text, inText, (label, h) => {
    refs.label = label; refs.href = h
    if (refs.cleveref) refs.cleveref.current = counters.crefs.get(h)!
    if (hyper) v.nodes.push(...anchor(refs.href, run.k.sizes.normalsize.baselineskip.width, "v", lastNode())) // hyperref's anchor
  }))
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
  doc.widths = (lineWidth) => widthRegisters(cx, lineWidth)
  doc.getpen = (n) => getpen(cx, n)
  if (usesXcolor) doc.xcolorFbox = true
  doc.parbox = (...a) => parboxAt(cx, ...a)
  if (pre.tikz) doc.tikz = (...a) => tikzAt(cx, colors, ...a)
  const cx: Ctx = { pre, run, v, doc, decisions, toc, lists: prev ? prev.lists : null, tocFile, marks, mkboth, romanFont, roman, bodyUnits, outerParskip, epoch, typeset, counters, refs, headings, lastNode, counted, contentsWrites, noskipsecPar, colorSpec, esphackNobreaks, listings, tabulars, minipages, urls, graphics, tikz, images, driver, notHere, normalAttrs, booktabs }
  blocks.forEach((x, i, all) => processBlock(cx, x, i, all))

  if (run.runIn) runInAlone(cx) // \end{document}'s \clearpage: \newpage's \if@noskipsec\leavevmode
  if (run.noskipsec) { v.par(); noskipsecPar("the end of the document") } // \@kernel@before@enddocument's \par, then \clearpage
  let built: ReturnType<typeof endDocument>
  try { built = endDocument(v.nodes, run.k, outerParskip, v.prevDepth) } catch (e) {
    if ((e as Error).message.startsWith("page builder: a float")) throw new Unsupported((e as Error).message.slice(14))
    throw e
  }
  const { pages, pageTrace } = built
  // (the glue after a listing caption's paragraph is a breakpoint: a page fired there is output inside its group)
  if (pages.some((p) => run.lstCaptions.some(([a, b]) => p.reached >= a && p.reached < b))) throw new Unsupported("a page output inside a listing's caption")
  if (refs.cleveref) fillCrefWrites(refs.cleveref.writes, pages, (at) => (v.nodes[at] as { param?: string } | undefined)?.param === "parskip", (from, to) => v.nodes.slice(from + 1, to).flatMap((n) => (n.kind === "whatsit" && n.hook ? [n.hook] : [])))
  const columns = makeColumns(pages, run.k, cls === "letter")
  const sl = selectFont(run.k, "normalsize", { enc: run.k.ints.T1 ? "T1" : "OT1", fam: "cmr", ser: "m", shape: "sl" } as FontAttrs)
  const heads = pageMarks(pages)
  // fancyhdr's fields are paragraphs TeX breaks as it ships each page: their traces go where the page builder had
  // read to then, before the paragraphs broken after the node it fired at was contributed. A node appended right
  // after a trace was contributed after that paragraph was read (a float's marker after its contents), except a
  // paragraph's \parskip, which new_graf contributes (and lets the page builder see) before reading it
  const pageTraces: { at: number; traces: ParagraphTrace[] }[] = []
  const shipped = columns.map((c, i) => {
    const even = !!run.k.ints.twoside && pages[i].count % 2 === 0
    const style = pages[i].special ?? pagestyle
    const fancy = style === "fancy" ? fancyPage(cx, pre.fancy!, even, pages[i].thepage, heads[i]) : undefined
    if (fancy) pageTraces.push({ at: pages[i].reached, traces: fancy.traces })
    return outputPage(c.outputbox, pages[i].count, run.k, style, hyper, markText(even ? heads[i].left : heads[i].right, sl), pages[i].thepage, fancy)
  })
  // pgf's shipout/background hook on every page, its PostScript header on the first under dvips
  if (pre.tikz) shipped.forEach((p, i) => { shipped[i] = pgfShipoutBackground(p, i === 0 && driver !== "pdftex", run.k) })
  if (driver === "pdftex") shipped.forEach(pdftexColors) // (the columns are inside the shipped pages)
  // shipout/firstpage under dvips, by label: hyperref's, l3backend-dvips.def's PostScript header, then the \AtBeginDvi of
  // geometry and of the graphics driver (dvips.def), both at \begin{document}
  // (pdfTeX's drivers put nothing there)
  else if (shipped.length) {
    const { paperwidth: pw, paperheight: ph } = run.k.dimens
    shipped[0] = firstPage(shipped[0], [
      ...(hyper ? hyperFirstPage(pw, ph, pre.hyperOpts.info) : []),
      L3BACKEND_HEADER,
      ...(pre.geometry ? [papersize(pw, ph), ...(pre.geometry.landscape ? ["\\special{! /landplus90 true store}"] : [])] : []),
      ...(pre.graphicsDriver || colorlinks ? [papersize(pw, ph)] : []), // (colorlinks loads color)
    ])
  }
  if (pageTraces.length) {
    const merged: ParagraphTrace[] = []
    let next = 0
    decisions.forEach((d, i) => {
      const before = (at: number) => at < brokenAt[i] || (at === brokenAt[i] && (v.nodes[at] as { param?: string } | undefined)?.param === "parskip")
      while (next < pageTraces.length && before(pageTraces[next].at)) merged.push(...pageTraces[next++].traces)
      merged.push(d)
    })
    while (next < pageTraces.length) merged.push(...pageTraces[next++].traces)
    decisions.length = 0
    Array.prototype.push.apply(decisions, merged)
  }
  // \thepage in each toc line and \newlabel: the page its \write was shipped out on
  let written: Aux | null = null
  if (blocks.some((b) => b.kind === "toc" || b.kind === "lof") || READS_AUX.test(body) || hyper || pre.natbib) { // (natbib: the .aux's \bibstyle)
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
      lists: { lof: tocFile.writtenList("lof", (n) => order.get(n)!, page), lot: tocFile.writtenList("lot", (n) => order.get(n)!, page) },
      // the .aux file has them in the order they were shipped out, and the last \newlabel of a key wins
      labels: new Map(refs.writes.map((w) => ({ ...w, page: page(w.node) })).sort((x, y) => order.get(x.node)! - order.get(y.node)!).map((w) => [w.key, { label: unbraced(w.label), page: w.page, name: w.name, href: w.href }])), // (braces around a label: groups, enumitem's)
      bookmarks: bookmarks.written,
      pageLabels: hyper ? pageLabels(pages) : "",
      // each thebibliography numbers its \bibitem from 1; the last \bibcite of a key wins
      cites: new Map(blocks.flatMap((b) => (b.kind === "bib" ? b.keys.map((key, i) => [key, String(i + 1)] as [string, string]) : []))),
      crefs: new Map((refs.cleveref?.writes ?? []).sort((x, y) => order.get(x.node)! - order.get(y.node)!).map((w) => [w.key, { cref: w.cref, page: { ...w.page!, label: page(w.node) } }])),
    }
  }
  const drawn: PageMark[][] = []
  const trace = shipOut(shipped, undefined, pages.map((p) => p.count), drawn)
  const { paperwidth, paperheight, hoffset, voffset } = run.k.dimens
  const INCH = 4736286
  return {
    result: {
      trace,
      view: { paper: { width: paperwidth, height: paperheight }, origin: { h: INCH + hoffset, v: INCH + voffset }, marks: drawn },
      decisions,
      pages: pageTrace,
      columns: columns.map((c) => c.column && c.column.map(emitBoxes)),
      notes: [`${cls} [${option}], \\pagestyle{${pagestyle}}; ${blocks.length} block(s), ${pages.length} page(s)${toc ? `; ${toc.length} toc line(s)` : ""}`],
    },
    written,
  }
}
