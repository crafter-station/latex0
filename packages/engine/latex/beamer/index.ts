// beamer (beamer.cls 3.77 and its base packages) as `latex` lays it out, with the
// dvips driver, or `pdflatex` (pdfTeX's color stack, \pdfdest and \pdfstartlink, pgf's
// \pdfliteral, no pdfmark specials): its own pipeline, entered from document() for
// \documentclass{beamer}.
// Each frame is a page: its box (frame.ts) on the main vertical list, the .nav
// lines \beamer@writeslidentry writes, and the \clearpage after it; LaTeX's output
// routine (output.ts) ships each page through \@outputpage with beamer's head and
// foot (page.ts). LaTeX runs twice: the second run reads the .aux the first wrote
// (\inserttotalframenumber, hyperref's page labels). What the document body holds
// is read by the handlers in BODY, one per construct.

import { emitBoxes } from "../../emit/boxes"
import { shipOut, type PageMark } from "../../emit/trace"
import { emptyBox, filGlue, penalty, type BoxNode, type Node } from "../../layout/nodes"
import { hpack } from "../../layout/pack"
import type { ClassOptionData } from "../../layout/classdata"
import type { ParagraphTrace } from "../../trace/decisions"
import { anchor, documentStart, hyperDriver, pdfString, type Bookmark } from "../hyperref"
import { endDocument, makeColumns, outputOptions } from "../output"
import { pdftexColors } from "../pdftex"
import { MATH_ALPHABETS, mathFonts } from "../paragraph"
import type { LayoutResult } from "../result"
import type { DocumentSource } from "../source"
import { Unsupported } from "../unsupported"
import { VerticalList } from "../vlist"
import { colorPush, xcolor } from "../xcolor"
import { footlineTemplate, headlineTemplate, type FootlineAt, type Heads } from "./footline"
import { newOverlay } from "./overlays"
import { bodyOf, frameBox, type BodyItem, type FrameSource, type SectionSource } from "./frame"
import { Sections, sectionNodes, type TocEntry } from "./sections"
import { navHeads, type NavHead } from "./headnav"
import { beamerPage, headOrFoot } from "./page"
import { beamerFirstPage, linkPages, navigationPgf, navigationSymbols, navLines, pgfBackground, type NavLine } from "./navigation"
import { BeamerPgf } from "./pgf"
import { outerColors, useColor } from "./theme"
import { readBeamerPreamble, type BeamerPreamble } from "./preamble"

/** What a run writes for the next one: the frames (\inserttotalframenumber, in the .nav lines \AtEndDocument writes),
 *  the pages (\beamer@documentpages) and their labels, the frame numbers (\HyPL@Entry where one changes, in the .aux),
 *  the .toc lines and the bookmarks (the .out file) */
interface Aux { frames: number; pages: number; pageFrames: number[]; toc: TocEntry[]; bookmarks: Bookmark[]; nav: NavLine[]
  /** the .nav's section, slide and subsection entries */
  heads: NavHead[] }

/** What laying out the body needs: the preamble, the main vertical list, the paragraphs' traces, and per page the
 *  index in `decisions` after its slide's paragraphs (where its head paragraph goes) and its frame's number */
interface BeamerCtx { pre: BeamerPreamble; epoch: number; v: VerticalList; decisions: ParagraphTrace[]; pageEnds: number[]; pageFrames: number[]
  /** per page, the section and subsection heads where it is shipped (the frame's) */
  pageHeads: Heads[]
  /** the last run's .nav entries (none before) */
  nav: NavHead[]
  frames: number; /** \inserttotalframenumber: the last run's count (1 before) */ totalFrames: number
  /** \beamer@endpageofdocument: the last run's page count (1 before) */ lastPage: number
  /** the sectioning state, and the .toc lines the last run wrote */
  sections: Sections; toc: TocEntry[]
  /** \c@equation and \c@footnote */
  equations: { n: number }; footnotes: { n: number }
  /** pgf's state in the run */
  pgf: BeamerPgf }

/** The body's constructs: frames (the environment and the \frame command), \section and \subsection */
const BODY: { [K in BodyItem["kind"]]: (cx: BeamerCtx, item: Extract<BodyItem, { kind: K }>) => void } = { frame, section, subsection: section }

/** \section or \subsection: its writes and anchor on the main vertical list, before the next frame's page; then what
 *  \AtBeginSection (\AtBeginSubsection) gave it, for \section or for \section*: frames */
function section(cx: BeamerCtx, s: SectionSource) {
  cx.v.nodes.push(...sectionNodes(cx.sections, s, cx.pageFrames.length + 1, cx.pre.k))
  const h = cx.pre.hooks
  const hook = s.kind === "section" ? (s.star ? h.sectionStar : h.section) : s.star ? h.subsectionStar : h.subsection
  for (const item of bodyOf(hook)) {
    if (item.kind !== "frame") throw new Unsupported(`beamer: \\${item.kind} at the beginning of a section`)
    frame(cx, item)
  }
}

export function beamerDocument(prepared: DocumentSource, driver: "dvips" | "pdftex", epoch: number): LayoutResult {
  if (prepared.listings.length || prepared.tabulars.length || prepared.minipages.length || prepared.urls.length || prepared.graphics.length) throw new Unsupported("beamer: verbatim, tabular, minipage, url or graphics")
  const first = layout(prepared.src, null, epoch, driver)
  return layout(prepared.src, first.written, epoch, driver).result
}

/** \begin{document}: \normalcolor, LaTeX's \write, hyperref's \AtBeginDocument (the /DOCVIEW and Catalog pdfmarks, the
 *  Doc-Start anchor, the document information, the page labels (frame numbers) the last run wrote), then beamerbasecolor.sty's
 *  \AtBeginDocument colors (four \color's at the outer level). The class's pgf objects (navigation.ts) come after
 *  LaTeX's \write. */
function documentBegin(pre: BeamerPreamble, prev: Aux | null, objects: Node[]): Node[] {
  const sdict = (s: string): Node => ({ kind: "whatsit", text: `\\special{ps:SDict begin ${s} end}` })
  // (\normalcolor: xcolor's \default@color, black; normal text's fg is only set by beamerbasecolor.sty's \AtBeginDocument)
  const out: Node[] = [colorPush("gray 0"), { kind: "whatsit", text: "\\write-{}" }, ...objects, ...documentStart(prev ? prev.bookmarks : [], true)]
  out.push(...anchor("Doc-Start", pre.k.sizes.normalsize.baselineskip.width, "v", out.at(-1)))
  // (with pdfTeX the document information and the page labels are \pdfinfo and \pdfcatalog: no nodes)
  if (hyperDriver.pdftex) { out.push(colorPush(), colorPush(), colorPush(), colorPush()); return out }
  out.push(sdict(`[/Producer (dvips + Distiller)/Title (${pre.pdfTitle})/Subject ()/Creator (${pdfString("LaTeX with Beamer class")})/Author (${pre.pdfAuthor})/Keywords () /DOCINFO pdfmark`))
  if (prev) {
    const labels = prev.pageFrames.map((f, i) => (i && prev.pageFrames[i - 1] === f ? "" : `${i}<</P(${pdfString(String(f))})>>`))
    out.push(sdict(`[ {Catalog} <</PageLabels<</Nums[${labels.join("")}]>>>> /PUT pdfmark`))
  }
  out.push(colorPush(), colorPush(), colorPush(), colorPush())
  return out
}

/**
 * A frame (beamerbaseframe.sty's \beamer@doseveralframes): each slide's box, the slides after the first each after a
 * \clearpage, until no overlay specification names a later slide; then \beamer@writeslidentry's two .nav lines
 * (\addtocontents: \slideentry with the section, subsection, \c@subsectionslide, the frame's first and last page,
 * \lastsubsection and the part; \beamer@framepages) and its \clearpage
 */
function frame(cx: BeamerCtx, f: FrameSource) {
  const { k } = cx.pre, number = ++cx.frames
  // \beamer@calculateheadfoot (\c@framenumber stepped already)
  // (before beamer@frameslide steps \c@subsectionslide)
  frameHeadFoot(cx, number, cx.pageFrames.length + 1)
  const bs = k.sizes.normalsize.baselineskip
  const first = cx.pageFrames.length + 1, equations = cx.equations.n, footnotes = cx.footnotes.n
  for (let slide = 1; ; slide++) {
    if (slide > 1) clearpage(cx)
    const overlay = newOverlay(slide)
    // (\resetcounteronoverlays{equation}: each slide starts the counter where the frame does)
    cx.equations.n = equations; cx.footnotes.n = footnotes
    const box = frameBox({ k, theme: cx.pre.theme, info: cx.pre.info, epoch: cx.epoch, decisions: cx.decisions, toc: cx.toc, section: cx.sections.section, overlay, smuggled: [], equations: cx.equations,
      footnotes: cx.footnotes, footins: [], pgf: cx.pgf }, f, cx.pre.centered)
    cx.pageEnds.push(cx.decisions.length)
    cx.pageFrames.push(number)
    cx.pageHeads.push(heads(cx, 1))
    cx.v.box(box, bs)
    if (!overlay.another) break
  }
  const last = cx.pageFrames.length
  const nav = (line: string): Node => ({ kind: "whatsit", text: `\\write1{\\@writefile{nav}{\\protect \\headcommand {\\protect ${line}}}}` })
  const st = cx.sections
  st.subsectionSlide++
  cx.v.nodes.push(nav(`\\slideentry {${st.section}}{${st.subsection}}{${st.subsectionSlide}}{${first}/${last}}{${st.lastSubsection}}{0}`), nav(`\\beamer@framepages {${first}}{${last}}`))
  clearpage(cx)
}

/** \clearpage: \newpage's \vfil\penalty-\@M, then \write\m@ne{}\vbox{}\penalty-\@Mi */
function clearpage(cx: BeamerCtx) {
  cx.v.nodes.push(filGlue(), penalty(-10000), { kind: "whatsit", text: "\\write-{}" })
  cx.v.box(emptyBox("vlist"), cx.pre.k.sizes.normalsize.baselineskip)
  cx.v.nodes.push(penalty(-10001))
}

/** The head and foot lines' counters, the date and the section heads (`h`: the current ones) for frame `frame` on page
 *  `page` */
const footlineAt = (cx: BeamerCtx, frame: number, page: number, h = heads(cx, 0)): FootlineAt => ({ frame, total: cx.totalFrames, page, lastPage: cx.lastPage, epoch: cx.epoch, heads: h, nav: cx.nav, pgf: cx.pgf })
/** the heads and counters now; `step`: what the frame begun steps \c@subsectionslide by (the engine counts it at its end) */
const heads = (cx: BeamerCtx, step: number): Heads => {
  const st = cx.sections
  return { section: st.sectionHead, subsection: st.subsectionHead, counters: { section: st.section, subsection: st.subsection, slide: st.subsectionSlide + step } }
}

/** the sizes \beamer@calculateheadfoot sets */
const HEADFOOT = ["footheight", "footskip", "headheight", "headdp", "sidebarheight", "textheight"] as const

/** \beamer@calculateheadfoot: the footline and the headline typeset (their paragraphs traced) and measured, the sizes
 *  that come from them */
function calculateHeadFoot(cx: BeamerCtx, frame: number, page: number): Record<(typeof HEADFOOT)[number], number> {
  const { k, theme, info } = cx.pre, d = k.dimens
  const at = footlineAt(cx, frame, page)
  const foot = hpack(headOrFoot(k, footlineTemplate(k, theme, info, at, cx.decisions)))
  const head = hpack(headOrFoot(k, headlineTemplate(k, theme, info, at, cx.decisions)))
  const footheight = foot.height + foot.depth + 4 * 65536, headheight = head.height + head.depth
  return { footheight, footskip: footheight, headheight, headdp: head.depth, sidebarheight: d.paperheight - headheight + head.depth - footheight + 4 * 65536,
    textheight: d.paperheight - footheight - headheight }
}

/** \beamer@calculateheadfoot at a frame's start: the sizes the document began with (a head or foot line that changes
 *  its height would change the pages after it) */
function frameHeadFoot(cx: BeamerCtx, frame: number, page: number) {
  const sizes = calculateHeadFoot(cx, frame, page)
  if (HEADFOOT.some((n) => sizes[n] !== cx.pre.k.dimens[n])) throw new Unsupported("beamer: a headline or footline that changes its height")
}

/** One LaTeX run: `prev` is what the run before wrote (null: none yet). */
function layout(src: string, prev: Aux | null, epoch: number, driver: "dvips" | "pdftex"): { result: LayoutResult; written: Aux } {
  const pre = readBeamerPreamble(src)
  hyperDriver.pdftex = driver === "pdftex"
  // beamerbasefont.sty's \AtBeginDocument (sans serif math): the Latin letters from pureletters, cmss italic
  mathFonts.letters = MATH_ALPHABETS.mathit
  xcolor.on = true; xcolor.normal = outerColors(pre.theme).fg; outputOptions.xcolor = true
  const pgf = navigationPgf(driver)
  const cx: BeamerCtx = { pre, epoch, v: new VerticalList(pre.k), decisions: [], pageEnds: [], pageFrames: [], pageHeads: [], nav: prev ? prev.heads : [], frames: 0, totalFrames: prev ? prev.frames : 1,
    lastPage: prev ? prev.pages : 1, sections: new Sections(), toc: prev ? prev.toc : [], equations: { n: 0 }, footnotes: { n: 0 }, pgf: new BeamerPgf(pgf.s, pgf.d) }
  // beamerbasemisc.sty's \AtBeginDocument \beamer@calculateheadfoot (no frame yet, page 1), after the .nav is read:
  // the sizes the theme data has, but for a headline that shows the .nav's sections
  const sizes = calculateHeadFoot(cx, 0, 1)
  if (!prev && HEADFOOT.some((n) => sizes[n] !== pre.k.dimens[n])) throw new Error(`beamer: the head and foot lines' sizes are not the theme data's`)
  const k: ClassOptionData = pre.k = { ...pre.k, dimens: { ...pre.k.dimens, ...sizes } }
  const v = cx.v = new VerticalList(k)
  v.nodes = documentBegin(pre, prev, pgf.nodes)
  for (const item of bodyOf(pre.body)) (BODY[item.kind] as (cx: BeamerCtx, item: BodyItem) => void)(cx, item)
  // \end{document}: beamerbasemisc.sty's \AtEndDocument \clearpage (its .nav lines are \immediate), then the kernel's
  clearpage(cx)
  const { pages, pageTrace } = endDocument(v.nodes, k, k.glue.parskip)
  if (pages.length !== cx.pageFrames.length || pages.some((p) => p.kind !== "text")) throw new Unsupported("a slide that is not one page")
  const columns = makeColumns(pages, k)
  // each page's head paragraph and then its footline's are broken as it ships, after its frame's paragraphs
  const decisions: ParagraphTrace[] = []
  // (the navigation symbols' links: to the pages the last run's .nav gives)
  const links = linkPages(prev ? prev.nav : null, pages.length)
  const symbolColors = useColor(pre.theme, "navigation symbols", outerColors(pre.theme))
  const shipped: BoxNode[] = columns.map((c, i) => {
    const foot: ParagraphTrace[] = []
    const page = pages[i].count
    const symbols = pre.navigationSymbols ? [navigationSymbols(pgf, pre.theme, symbolColors, page, links[page - 1])] : []
    const at = footlineAt(cx, cx.pageFrames[i], page, cx.pageHeads[i])
    const { box, traces } = beamerPage(c.outputbox, page, k, pre.theme, (traces) => headlineTemplate(k, pre.theme, pre.info, at, traces), () => footlineTemplate(k, pre.theme, pre.info, at, foot), symbols)
    decisions.push(...cx.decisions.slice(i ? cx.pageEnds[i - 1] : 0, cx.pageEnds[i]), ...traces, ...foot)
    const shown = pgfBackground(box, i === 0)
    return i === 0 ? beamerFirstPage(shown, k) : shown
  })
  // (pdfTeX: the color specials as its color stack's nodes, in the columns too, which are inside the pages)
  if (hyperDriver.pdftex) shipped.forEach(pdftexColors)
  const drawn: PageMark[][] = []
  const trace = shipOut(shipped, undefined, pages.map((p) => p.count), drawn)
  const { paperwidth, paperheight, hoffset, voffset } = k.dimens
  const INCH = 4736286
  return {
    result: {
      trace,
      view: { paper: { width: paperwidth, height: paperheight }, origin: { h: INCH + hoffset, v: INCH + voffset }, marks: drawn },
      decisions,
      pages: pageTrace,
      columns: columns.map((c) => c.column && c.column.map(emitBoxes)),
      notes: [`beamer [${pre.option}]; ${cx.frames} frame(s), ${pages.length} page(s)`],
    },
    written: { frames: cx.frames, pages: pages.length, pageFrames: cx.pageFrames, toc: cx.sections.toc, bookmarks: cx.sections.bookmarks.written,
      nav: navLines(v.nodes, cx.sections, pages.length), heads: navHeads(v.nodes) },
  }
}
