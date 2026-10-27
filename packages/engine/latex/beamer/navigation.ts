// beamer's navigation symbols (beamerbasenavigationsymbols.tex, beamerbasenavigation.sty) and what pgf puts
// on the pages around them, under dvips. Loading the class defines pgf objects (\pgfdefobject): the slide,
// frame, subsection, section, document and back/find/forward symbols' drawings and the button symbols, each
// a PostScript procedure /pgf<n> in a \special{! …} on the main vertical list (they reach the first page's
// column after LaTeX's \write). The default outer theme's template (beamerouterthemedefault.sty) puts in an
// \hbox, a space of the right sidebar's \Tiny font between them, an \hbox per symbol: a pgfpicture using the
// symbol's objects, \kern-20pt, and the links over it (\beamer@linkspace: \vbox to7.5pt{}\kern<width>) to
// the pages \beamer@setuplinks found in the last run's .nav (\dohead with \c@page the slide's page). Each
// page gets pgf's shipout/background box (\put at the paper's corner of what \pgfutil@insertatbegincurrentpage
// collected: the PostScript header, on the first page only), and the first page the driver's specials.

import type { ClassOptionData } from "../../layout/classdata"
import { spaceGlue } from "../../layout/hmode"
import { kern, ssGlue, type BoxNode, type Node } from "../../layout/nodes"
import { hpack, vpack } from "../../layout/pack"
import { DvipsDriver } from "../../pgf/drivers/dvips"
import { DVIPS_HEADER } from "../../pgf/drivers/dvipsheader"
import { pgfSetLineWidth } from "../../pgf/graphicstate"
import { pgfPathCircle, pgfPathRectangle } from "../../pgf/paths"
import { pgfPoint } from "../../pgf/points"
import { pgfPathQCurveTo, pgfPathQLineTo, pgfPathQMoveTo, pgfUsePathQFill, pgfUsePathQStroke } from "../../pgf/quick"
import { beginPgfPicture, endPgfPicture } from "../../pgf/scopes"
import { PgfState } from "../../pgf/state"
import { hyperFirstPage, linkBox, papersize } from "../hyperref"
import { firstPage, L3BACKEND_HEADER } from "../output"
import { fontAt } from "../paragraph"
import { Unsupported } from "../unsupported"
import { colorPop, colorPush } from "../xcolor"
import { navigationLink, type Sections } from "./sections"
import { outerColors, useColor, type ColorState, type Theme } from "./theme"

const INCH = 4736286

// ---- pgf objects (to be pgf/objects.ts's) ----

type ObjectCode = (s: PgfState, d: DvipsDriver) => void
/** \pgfsys@defobject (pgfsys-common-postscript.def 161–172): the object's code buffered into a protocol, defined as
 *  the PostScript procedure /pgf<n> */
function defineObject(s: PgfState, d: DvipsDriver, n: number, code: ObjectCode): Node {
  const outer = s.protocol, buffered = s.sw.buffered
  s.protocol = ""
  s.sw.buffered = true
  code(s, d)
  const text = `\\special{! /pgf${n}{gsave exec ${s.protocol} grestore} bind def}`
  s.sw.buffered = buffered
  s.protocol = outer
  return { kind: "whatsit", text }
}
/** \pgfuseobject (pgfcoreobjects.code.tex 71) with \pgfsys@useobject (pgfsys-common-postscript.def 174–183) */
function useObject(s: PgfState, d: DvipsDriver, n: number) {
  d.beginscope()
  d.flush()
  s.special(`ps:: pgf${n}`)
  d.endscope()
}

/** \pgfpathqmoveto and \pgfpathqlineto through a list of points: a move to the first, lines to the others */
function lines(s: PgfState, ...points: [string, string][]) {
  points.forEach(([x, y], i) => (i ? pgfPathQLineTo : pgfPathQMoveTo)(s, x, y))
}
/** the two arrow heads most symbols share: "<" at 2bp–4bp and ">" at 16bp–18bp */
function heads(s: PgfState) {
  lines(s, ["4bp", "0.5bp"], ["2bp", "2bp"], ["4bp", "3.5bp"])
  lines(s, ["16bp", "0.5bp"], ["18bp", "2bp"], ["16bp", "3.5bp"])
}
/** \pgfsetlinewidth{0.6pt}, then the lines (each from a move), stroked */
function strokes(s: PgfState, d: DvipsDriver, ...segments: [string, string, string, string][]) {
  pgfSetLineWidth(s, d, "0.6pt")
  for (const [x1, y1, x2, y2] of segments) lines(s, [x1, y1], [x2, y2])
  pgfUsePathQStroke(s, d)
}

/** the objects the class defines, in order (\pgf@objectcount from 1): beamerbasenavigationsymbols.tex, then
 *  beamerbasenavigation.sty's buttons */
const OBJECTS: [string, ObjectCode][] = [
  ["beamerslidenavlight", (s, d) => {
    lines(s, ["4bp", "0.5bp"], ["2bp", "2bp"], ["4bp", "3.5bp"])
    pgfUsePathQFill(s, d)
    lines(s, ["16bp", "0.5bp"], ["18bp", "2bp"], ["16bp", "3.5bp"])
    pgfUsePathQFill(s, d)
  }],
  ["beamerslidenavstrong", (s, d) => {
    pgfPathRectangle(s, () => pgfPoint(s, "8.3pt", "0.8pt"), () => pgfPoint(s, "3.4pt", "2.4pt"))
    pgfUsePathQStroke(s, d)
  }],
  ["beamerframenavlight", (s, d) => { heads(s); pgfUsePathQFill(s, d) }],
  ["beamerframenavstrong", (s, d) => {
    pgfPathRectangle(s, () => pgfPoint(s, "7pt", "0pt"), () => pgfPoint(s, "3.4pt", "2.4pt"))
    lines(s, ["7.8bp", "2.4bp"], ["7.8bp", "3.2bp"], ["11.2bp", "3.2bp"], ["11.2bp", ".8bp"], ["10.4bp", ".8bp"])
    lines(s, ["8.6bp", "3.2bp"], ["8.6bp", "4bp"], ["12bp", "4bp"], ["12bp", "1.6bp"], ["11.2bp", "1.6bp"])
    pgfUsePathQStroke(s, d)
  }],
  ["beamersubsectionnavlight", (s, d) => {
    heads(s)
    pgfUsePathQFill(s, d)
    strokes(s, d, ["8bp", "4bp", "11bp", "4bp"], ["9bp", "2bp", "12bp", "2bp"], ["8bp", "1bp", "11bp", "1bp"], ["9bp", "0bp", "12bp", "0bp"])
  }],
  ["beamersubsectionnavstrong", (s, d) => strokes(s, d, ["9bp", "3bp", "12bp", "3bp"])],
  ["beamersectionnavlight", (s, d) => {
    heads(s)
    pgfUsePathQFill(s, d)
    strokes(s, d, ["8bp", "1bp", "11bp", "1bp"], ["9bp", "0bp", "12bp", "0bp"])
  }],
  ["beamersectionnavstrong", (s, d) => strokes(s, d, ["8bp", "4bp", "11bp", "4bp"], ["9bp", "3bp", "12bp", "3bp"], ["9bp", "2bp", "12bp", "2bp"])],
  ["beamerdocnavlight", (s, d) => { lines(s, ["10bp", "-.5bp"], ["10bp", "4.5bp"]); pgfUsePathQStroke(s, d) }],
  ["beamerdocnavstrong", (s, d) => strokes(s, d, ["4bp", "4bp", "7bp", "4bp"], ["5bp", "3bp", "8bp", "3bp"], ["5bp", "2bp", "8bp", "2bp"], ["3bp", "1bp", "7bp", "1bp"],
    ["5bp", "0bp", "8bp", "0bp"], ["12bp", "3bp", "15bp", "3bp"], ["13bp", "2bp", "16bp", "2bp"], ["13bp", "1bp", "16bp", "1bp"])],
  ["beamerdocnavstrongsingle", (s, d) => strokes(s, d, ["8bp", "4bp", "11bp", "4bp"], ["9bp", "3bp", "12bp", "3bp"], ["9bp", "2bp", "12bp", "2bp"], ["8bp", "1bp", "11bp", "1bp"],
    ["9bp", "0bp", "12bp", "0bp"])],
  ["beamerbackfindforwardnav", (s, d) => {
    // the search symbol
    strokes(s, d, ["10.4bp", "1.6bp", "12bp", "0bp"])
    pgfSetLineWidth(s, d, "0.4pt")
    pgfPathCircle(s, () => pgfPoint(s, "9.5pt", "2.5pt"), "1.2pt")
    pgfUsePathQStroke(s, d)
    // the left arrow, then the right one
    d.cap("round")
    pgfPathQMoveTo(s, "4bp", "0bp")
    pgfPathQCurveTo(s, "5.1pt", "0pt", "6bp", "0.9bp", "6bp", "2bp")
    pgfPathQCurveTo(s, "6bp", "3.1bp", "5.1bp", "4bp", "4bp", "4bp")
    pgfPathQCurveTo(s, "2.9bp", "4bp", "2bp", "3.1bp", "2bp", "2bp")
    lines(s, ["3.2bp", "2.6bp"], ["2bp", "1.6bp"], ["0.8bp", "2.6bp"])
    pgfPathQMoveTo(s, "16bp", "0bp")
    pgfPathQCurveTo(s, "14.9bp", "0bp", "14bp", "0.9bp", "14bp", "2bp")
    pgfPathQCurveTo(s, "14bp", "3.1bp", "14.9bp", "4bp", "16bp", "4bp")
    pgfPathQCurveTo(s, "17.1bp", "4bp", "18bp", "3.1bp", "18bp", "2bp")
    lines(s, ["19.2bp", "2.6bp"], ["18bp", "1.6bp"], ["16.8bp", "2.6bp"])
    pgfUsePathQStroke(s, d)
  }],
  ["beamergotosymbol", (s, d) => { lines(s, ["1.5bp", "0.5bp"], ["3.5bp", "2bp"], ["1.5bp", "3.5bp"]); pgfUsePathQFill(s, d) }],
  ["beamerskipsymbol", (s, d) => {
    lines(s, ["1.5bp", "0.5bp"], ["3.5bp", "2bp"], ["1.5bp", "3.5bp"])
    lines(s, ["3.5bp", "0.5bp"], ["5.5bp", "2bp"], ["3.5bp", "3.5bp"])
    pgfUsePathQFill(s, d)
  }],
  ["beamerreturnsymbol", (s, d) => { lines(s, ["3.5bp", "0.5bp"], ["1.5bp", "2bp"], ["3.5bp", "3.5bp"]); pgfUsePathQFill(s, d) }],
]
/** each object's number (\csname name\endcsname) */
const NUMBER = new Map(OBJECTS.map(([name], i) => [name, i + 1]))

/** the class's \pgfdefobject's specials, as they reach the main vertical list */
export function navigationObjects(): Node[] {
  const s = new PgfState(), d = new DvipsDriver(s)
  return OBJECTS.map(([, code], i) => defineObject(s, d, i + 1, code))
}

// ---- the pages the links go to ----

/** a .nav line \beamer@setuplinks reads: \beamer@framepages, \beamer@subsectionpages, \beamer@sectionpages or
 *  \beamer@documentpages with its first and last page */
export interface NavLine { kind: "frame" | "subsection" | "section" | "document"; start: number; end: number }

const PAGES = /\\beamer@(frame|subsection|section)pages \{(\d+)\}\{(\d+)\}/

/** the lines a run writes, in the .nav's order: its \write's on the main vertical list `nodes` (each shipped in turn),
 *  then beamerbasemisc.sty's \AtEndDocument lines (the last subsection's, section's and the document's pages) */
export function navLines(nodes: Node[], st: Sections, pages: number): NavLine[] {
  const out: NavLine[] = []
  for (const n of nodes) {
    const m = n.kind === "whatsit" ? n.text.match(PAGES) : null
    if (m) out.push({ kind: m[1] as NavLine["kind"], start: Number(m[2]), end: Number(m[3]) })
  }
  out.push({ kind: "subsection", start: st.subsectionStart, end: pages }, { kind: "section", start: st.sectionStart, end: pages }, { kind: "document", start: pages, end: pages })
  return out
}

/** \beamer@startpageof…, \beamer@endpageof… (beamerbasemisc.sty: 1 before any line matches) */
export interface LinkPages { frame: [number, number]; subsection: [number, number]; section: [number, number]; document: number }

/** the link pages on each of `pages` pages: \dohead at \begin{document} (page 1) and at each slide, each line
 *  setting its pages (\gdef) when \c@page lies in them, \beamer@documentpages always */
export function linkPages(lines: NavLine[] | null, pages: number): LinkPages[] {
  const cur: LinkPages = { frame: [1, 1], subsection: [1, 1], section: [1, 1], document: 1 }
  const out: LinkPages[] = []
  for (let page = 1; page <= pages; page++) {
    for (const l of lines ?? []) {
      if (l.kind === "document") cur.document = l.end
      else if (page >= l.start && page <= l.end) cur[l.kind] = [l.start, l.end]
    }
    out.push({ frame: [...cur.frame], subsection: [...cur.subsection], section: [...cur.section], document: cur.document })
  }
  return out
}

// ---- the symbols ----

/** \beamer@linkspace{#1}: \vbox to7.5pt{}\kern#1 */
const linkspace = (w: number): Node[] => [vpack([], { exactly: 491520 }), kern(w, true)]
const PT = 65536

/**
 * \insert…navigationsymbol: the picture (old syntax, bounding box 0pt -1.5pt 20pt 5.5pt) using the strong object,
 * then in the dimmed color the light one, \kern-20pt and the links, each `[width in pt, target]`: a page, or an
 * \Acrobatmenu name
 */
function symbol(c: ColorState, dimmed: string, strong: string, light: string | null, links: [number, number | string][]): BoxNode {
  const s = new PgfState(), d = new DvipsDriver(s)
  beginPgfPicture(s, d, c.fg, ["0pt", "-1.5pt", "20pt", "5.5pt"])
  s.space() // (the end of the line)
  useObject(s, d, NUMBER.get(strong)!)
  if (light) {
    // \usebeamercolor[fg]{navigation symbols dimmed} (\color ignores the space after it), popped at the group's end
    s.out.push(colorPush(dimmed))
    useObject(s, d, NUMBER.get(light)!)
    s.out.push(colorPop())
  }
  endPgfPicture(s, d)
  const list: Node[] = [...s.out, kern(-20 * PT, true)]
  for (const [w, to] of links) {
    const space = linkspace(w * PT)
    if (typeof to === "number") list.push(...navigationLink(space, c.fg, to))
    // \Acrobatmenu (pdfmark.def): a named action, \@menucolor's border
    else list.push(...linkBox(space, c.fg, `[/H /N/Border [0 0 0]BorderArrayPatch/Color [1 0 0]/Action <</Subtype/Named/N/${to}>>/Subtype /Link H.B /ANN pdfmark`))
  }
  return hpack(list)
}

/**
 * The default "navigation symbols" template on page `page` (links to `at`'s pages), in the right sidebar's \Tiny
 * sans font with `c` (the template's colors) in force: \hbox{\hbox{slide}␣\hbox{frame}␣…\hbox{back/find/forward}}
 */
export function navigationSymbols(t: Theme, c: ColorState, page: number, at: LinkPages): BoxNode {
  // the dimmed color is the theme's at the outer level, where only the fg differs
  if (c.bg !== outerColors(t).bg) throw new Unsupported("beamer's navigation symbols on another background")
  const dimmed = useColor(t, "navigation symbols dimmed", outerColors(t)).fg
  // \beamer@prevpage, \beamer@nextpage
  const prev = (p: number) => (p > 1 ? p - 1 : p), next = (p: number) => Math.min(p + 1, at.document)
  const ranges = (r: [number, number]): [number, number][] => [[5, prev(r[0])], [5, r[0]], [5, r[1]], [5, next(r[1])]]
  const boxes = [
    symbol(c, dimmed, "beamerslidenavstrong", "beamerslidenavlight", [[6, prev(page)], [8, "GoToPage"], [6, next(page)]]),
    symbol(c, dimmed, "beamerframenavstrong", "beamerframenavlight", ranges(at.frame)),
    symbol(c, dimmed, "beamersubsectionnavstrong", "beamersubsectionnavlight", ranges(at.subsection)),
    symbol(c, dimmed, "beamersectionnavstrong", "beamersectionnavlight", ranges(at.section)),
    // (no appendix: \hyperlinkpresentationstart and …end)
    symbol(c, dimmed, "beamerdocnavstrongsingle", null, [[9, 1], [11, at.document]]),
    symbol(c, dimmed, "beamerbackfindforwardnav", null, [[7, "GoBack"], [6, "Find"], [7, "GoForward"]]),
  ]
  const space = spaceGlue(fontAt("cmss8", 4 * PT), 1000) // (\Tiny: OT1/cmss/m/n at 4pt)
  return hpack(boxes.flatMap((b, i) => (i ? [space, b] : [b])))
}

// ---- the pages ----

/**
 * pgf's shipout/background hook (pgfutil-latex.def) around a shipped page, by \__shipout_add_background_box:n:
 * \put(\hoffset-1in,\voffset-1in){…} at the paper's corner holding on the first page the PostScript header, in
 * \hbox{\kern-1in\vbox to0pt{\kern-1in\hbox{…}\vss}}, above the page's contents, then \kern\z@
 */
export function pgfBackground(page: BoxNode, first: boolean): BoxNode {
  const header: Node[] = first ? DVIPS_HEADER.map((h) => ({ kind: "whatsit", text: `\\special{! ${h}}` })) : []
  const put = hpack([kern(-INCH, true), ...header, ssGlue()], { exactly: 0 })
  put.shift = INCH
  const box = hpack([kern(-INCH, true), vpack([kern(-INCH, true), hpack([put]), ssGlue()], { exactly: 0 })])
  return vpack([box, ...page.list, kern(0, true)], { exactly: page.height + page.depth })
}

/** the first page's shipout/firstpage specials: hyperref's (its document information is beamer's, at
 *  \begin{document}), l3backend's header, geometry's and the graphics driver's paper size */
export function beamerFirstPage(page: BoxNode, k: ClassOptionData): BoxNode {
  const { paperwidth: w, paperheight: h } = k.dimens
  return firstPage(page, [...hyperFirstPage(w, h).filter((x) => !x.includes("/DOCINFO")), L3BACKEND_HEADER, papersize(w, h), papersize(w, h)])
}
