// beamer (beamer.cls 3.77 and its base packages) as `latex` lays it out, with the
// dvips driver: its own pipeline, entered from document() for \documentclass{beamer}.
// Each frame is a page: its box (frame.ts) on the main vertical list, the .nav
// lines \beamer@writeslidentry writes, and the \clearpage after it; LaTeX's output
// routine (output.ts) ships each page through \@outputpage with beamer's head and
// foot (page.ts). LaTeX runs twice: the second run reads the .aux the first wrote
// (\inserttotalframenumber, hyperref's page labels). What the document body holds
// is read by the handlers in BODY, one per construct.

import { emitBoxes } from "../../emit/boxes"
import { shipOut, type PageMark } from "../../emit/trace"
import { emptyBox, filGlue, penalty, type BoxNode, type Node } from "../../layout/nodes"
import type { ParagraphTrace } from "../../trace/decisions"
import { anchor, documentStart, hyperDriver, pdfString } from "../hyperref"
import { endDocument, makeColumns, outputOptions } from "../output"
import type { LayoutResult } from "../result"
import type { DocumentSource } from "../source"
import { Unsupported } from "../unsupported"
import { VerticalList } from "../vlist"
import { colorPush, xcolor } from "../xcolor"
import { frameBox, framesOf, type FrameSource } from "./frame"
import { beamerPage } from "./page"
import { outerColors } from "./theme"
import { readBeamerPreamble, type BeamerPreamble } from "./preamble"

/** What a run writes to the .aux file for the next one: the frames (\inserttotalframenumber, in the .nav lines
 *  \AtEndDocument writes) and the pages (\HyPL@Entry, one per page) */
interface Aux { frames: number; pages: number }

/** What laying out the body needs: the preamble, the main vertical list, the paragraphs' traces, and per frame the
 *  index in `decisions` after its paragraphs (where its page's head paragraph goes) */
interface BeamerCtx { pre: BeamerPreamble; epoch: number; v: VerticalList; decisions: ParagraphTrace[]; frameEnds: number[]; frames: number; /** \inserttotalframenumber: the last run's count (1 before) */ totalFrames: number }

/** The body's constructs: frames (the environment and the \frame command) */
const BODY: Record<string, (cx: BeamerCtx, f: FrameSource) => void> = { frame: frame }

export function beamerDocument(prepared: DocumentSource, driver: "dvips" | "pdftex", epoch: number): LayoutResult {
  if (driver === "pdftex") throw new Unsupported("beamer with pdfTeX's driver")
  if (prepared.listings.length || prepared.tabulars.length || prepared.minipages.length || prepared.urls.length || prepared.graphics.length) throw new Unsupported("beamer: verbatim, tabular, minipage, url or graphics")
  const first = layout(prepared.src, null, epoch)
  return layout(prepared.src, first.written, epoch).result
}

/** \begin{document}: \normalcolor, LaTeX's \write, hyperref's \AtBeginDocument (the /DOCVIEW and Catalog pdfmarks, the
 *  Doc-Start anchor, the document information, the page labels the last run wrote), then beamerbasecolor.sty's
 *  \AtBeginDocument colors (four \color's at the outer level). (Not here: the PostScript header specials pgf's
 *  objects for the navigation symbols put after LaTeX's \write; whatsits before the first box, which nothing reads.) */
function documentBegin(pre: BeamerPreamble, prev: Aux | null): Node[] {
  const sdict = (s: string): Node => ({ kind: "whatsit", text: `\\special{ps:SDict begin ${s} end}` })
  const out: Node[] = [colorPush(), { kind: "whatsit", text: "\\write-{}" }, ...documentStart([])]
  out.push(...anchor("Doc-Start", pre.k.sizes.normalsize.baselineskip.width, "v", out.at(-1)))
  out.push(sdict(`[/Producer (dvips + Distiller)/Title (${pre.pdfTitle})/Subject ()/Creator (${pdfString("LaTeX with Beamer class")})/Author (${pre.pdfAuthor})/Keywords () /DOCINFO pdfmark`))
  if (prev) out.push(sdict(`[ {Catalog} <</PageLabels<</Nums[${Array.from({ length: prev.pages }, (_, i) => `${i}<</P(${pdfString(String(i + 1))})>>`).join("")}]>>>> /PUT pdfmark`))
  out.push(colorPush(), colorPush(), colorPush(), colorPush())
  return out
}

/**
 * A frame: its box, then \beamer@writeslidentry's two .nav lines (\addtocontents: \slideentry with the section,
 * subsection, \c@subsectionslide, the frame's first and last page, \lastsubsection and the part; \beamer@framepages)
 * and its \clearpage (\newpage's \vfil\penalty-\@M, then \write\m@ne{}\vbox{}\penalty-\@Mi)
 */
function frame(cx: BeamerCtx, f: FrameSource) {
  const { k } = cx.pre, page = ++cx.frames
  const box = frameBox({ k, theme: cx.pre.theme, info: cx.pre.info, epoch: cx.epoch, decisions: cx.decisions }, f, cx.pre.centered)
  cx.frameEnds.push(cx.decisions.length)
  const bs = k.sizes.normalsize.baselineskip
  cx.v.box(box, bs)
  const nav = (line: string): Node => ({ kind: "whatsit", text: `\\write1{\\@writefile{nav}{\\protect \\headcommand {\\protect ${line}}}}` })
  cx.v.nodes.push(nav(`\\slideentry {0}{0}{${page}}{${page}/${page}}{}{0}`), nav(`\\beamer@framepages {${page}}{${page}}`))
  cx.v.nodes.push(filGlue(), penalty(-10000), { kind: "whatsit", text: "\\write-{}" })
  cx.v.box(emptyBox("vlist"), bs)
  cx.v.nodes.push(penalty(-10001))
}

/** One LaTeX run: `prev` is what the run before wrote (null: none yet). */
function layout(src: string, prev: Aux | null, epoch: number): { result: LayoutResult; written: Aux } {
  const pre = readBeamerPreamble(src)
  const k = pre.k
  hyperDriver.pdftex = false
  xcolor.on = true; xcolor.normal = outerColors(pre.theme).fg; outputOptions.xcolor = true
  const v = new VerticalList(k)
  v.nodes = documentBegin(pre, prev)
  const cx: BeamerCtx = { pre, epoch, v, decisions: [], frameEnds: [], frames: 0, totalFrames: prev ? prev.frames : 1 }
  for (const f of framesOf(pre.body)) BODY.frame(cx, f)
  // \end{document}: beamerbasemisc.sty's \AtEndDocument \clearpage (its .nav lines are \immediate), then the kernel's
  v.nodes.push(filGlue(), penalty(-10000), { kind: "whatsit", text: "\\write-{}" })
  v.box(emptyBox("vlist"), k.sizes.normalsize.baselineskip)
  v.nodes.push(penalty(-10001))
  const { pages, pageTrace } = endDocument(v.nodes, k, k.glue.parskip)
  if (pages.length !== cx.frames || pages.some((p) => p.kind !== "text")) throw new Unsupported("a frame that is not one page")
  const columns = makeColumns(pages, k)
  // each page's head paragraph is broken as it ships, after its frame's paragraphs
  const decisions: ParagraphTrace[] = []
  const shipped: BoxNode[] = columns.map((c, i) => {
    const { box, trace } = beamerPage(c.outputbox, pages[i].count, k, pre.theme)
    decisions.push(...cx.decisions.slice(i ? cx.frameEnds[i - 1] : 0, cx.frameEnds[i]), trace)
    return box
  })
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
    written: { frames: cx.frames, pages: pages.length },
  }
}
