// The footline and the headline (beamerbaseframecomponents.sty's \beamer@typesetheadorfoot):
// the template in a \vbox \paperwidth wide, with \parskip zero and \offinterlineskip,
// typeset when \beamer@calculateheadfoot measures it (at \begin{document} and at each
// frame's start) and when the page is shipped. The default outer theme's is empty;
// the infolines outer theme's (beamerouterthemeinfolines.sty) is a paragraph holding,
// in an \hbox, three beamercolorboxes a third of the paper wide: the short author
// (with the short institute in parentheses), the short title (a link to the last page
// on the first page, to the first one on the others), and the short date with the
// frame number "n / total". Each box's paragraph and the template's own are traced
// where TeX breaks them: inside out, as each \par comes. The infolines headline is
// two such boxes half the paper wide: the section's head (a link to the page the
// section began on) and the subsection's. The split outer theme's are two boxes half
// the paper wide too: in the headline, the sections and the current section's
// subsections the last run's .nav lists (headnav.ts), the headline's height from how
// many there are; in the footline, the short author and the short title.

import type { ClassOptionData, SizeCommand } from "../../layout/classdata"
import { parseDimen } from "../../layout/dimen"
import { QUAD, X_HEIGHT, type Font } from "../../layout/font"
import { appendText, spaceGlue } from "../../layout/hmode"
import { lineBreak } from "../../layout/linebreak"
import { emptyBox, filGlue, fillGlue, glue, kern, paramGlue, penalty, ssGlue, type BoxNode, type Node } from "../../layout/nodes"
import { hpack, vpack } from "../../layout/pack"
import type { ParagraphTrace } from "../../trace/decisions"
import { today } from "../frontmatter"
import { sloppy } from "../kernel"
import { appendToVlist, classParams, selectFont, spec } from "../paragraph"
import { Unsupported } from "../unsupported"
import { colorPop, colorPush, Colors } from "../xcolor"
import { beamercolorbox, colorboxOptions, lengthEnv, type ColorboxBody } from "./colorbox"
import { SANS } from "./frame"
import type { TitleInfo } from "./preamble"
import { navMax, type NavHead } from "./headnav"
import { navigationLink, type Head } from "./sections"
import { fontSize, outerColors, useColor, type ColorState, type Theme } from "./theme"

/** Where the footline is typeset: the frame number (\c@framenumber), \inserttotalframenumber, the page number
 *  (\c@page), the last page (\beamer@endpageofdocument, from the last run's .nav) and the date \today prints */
export interface FootlineAt { frame: number; total: number; page: number; lastPage: number; epoch: number
  /** \insertsectionhead and \insertsubsectionhead, the sectioning counters */
  heads: Heads
  /** the last run's .nav entries */
  nav: NavHead[] }

export interface Heads { section: Head | null; subsection: Head | null
  /** \c@section, \c@subsection and \c@subsectionslide */
  counters: { section: number; subsection: number; slide: number } }


const ZERO = { width: 0, stretch: 0, stretchOrder: 0, shrink: 0, shrinkOrder: 0 } as const

/**
 * \usebeamertemplate***{footline}'s list in the \vbox: normal text's and footline's fg pushed, the template, both
 * popped. The paragraphs' traces go to `decisions`.
 */
export function footlineTemplate(k: ClassOptionData, t: Theme, info: TitleInfo, at: FootlineAt, decisions: ParagraphTrace[]): Node[] {
  const outer = outerColors(t), colors = useColor(t, "footline", outer)
  const list: Node[] = [colorPush(outer.fg), colorPush(colors.fg)]
  if (t.outer === "infolines") boxesLine(k, list, infolinesBoxes(k, t, info, at, colors, decisions), decisions)
  else if (t.outer === "split") boxesLine(k, list, splitFootBoxes(k, t, info, at, colors, decisions), decisions)
  list.push(colorPop(), colorPop())
  return list
}

/** \usebeamertemplate***{headline}'s list in the \vbox, as the footline's */
export function headlineTemplate(k: ClassOptionData, t: Theme, at: FootlineAt, decisions: ParagraphTrace[]): Node[] {
  const outer = outerColors(t), colors = useColor(t, "headline", outer)
  const list: Node[] = [colorPush(outer.fg), colorPush(colors.fg)]
  if (t.headline === "infolines") boxesLine(k, list, infolinesHeadBoxes(k, t, at, colors, decisions), decisions)
  else if (t.headline === "split") {
    // \leavevmode, then the boxes in a group: no \par, so the paragraph (one line) ends with the template's pops, at
    // the \vbox's end
    const { vlist, trace } = lineBreak([emptyBox("hlist", 0), ...splitHeadBoxes(k, t, at, colors, decisions), colorPop(), colorPop()], { ...classParams(k), hsize: k.dimens.paperwidth, leftSkip: spec("leftskip", ZERO), rightSkip: spec("rightskip", ZERO) })
    decisions.push(trace)
    list.push(paramGlue("parskip", glue(0)), paramGlue("parskip", glue(0)))
    let prevDepth: number | null = null
    for (const n of vlist) if (n.kind === "hlist") prevDepth = appendToVlist(list, n, prevDepth, ZERO, ZERO, 0); else list.push(n)
    return list
  }
  list.push(colorPop(), colorPop())
  return list
}

/** \leavevmode (new_graf: \parskip, then LaTeX's zero \parskip), \hbox{boxes}, \vskip0pt (\par): one line, \hsize the
 *  paper's width, \parindent, \leftskip and \rightskip zero (\@parboxrestore's, beamer's \parindent), onto `list` */
function boxesLine(k: ClassOptionData, list: Node[], boxes: Node[], decisions: ParagraphTrace[]) {
  const { vlist, trace } = lineBreak([emptyBox("hlist", 0), hpack(boxes)], { ...classParams(k), hsize: k.dimens.paperwidth, leftSkip: spec("leftskip", ZERO), rightSkip: spec("rightskip", ZERO) })
  decisions.push(trace)
  list.push(paramGlue("parskip", glue(0)), paramGlue("parskip", glue(0)))
  let prevDepth: number | null = null
  for (const n of vlist) if (n.kind === "hlist") prevDepth = appendToVlist(list, n, prevDepth, ZERO, ZERO, 0); else list.push(n)
  list.push(glue(0))
}

/** A beamercolorbox in a head or foot line: `size` the font its options' lengths are in, `colors` the template's; the
 *  body's list, in the font of size `bodySize` and the box's colors, set as a paragraph of its own */
function headFootBox(k: ClassOptionData, t: Theme, size: SizeCommand, bodySize: SizeCommand, colors: ColorState, decisions: ParagraphTrace[], options: string, name: string,
  body: (f: Font, inner: ColorState) => { list: Node[]; after?: Node[] }) {
  const font = selectFont(k, size, SANS)
  const env = lengthEnv(k, font.params[QUAD], font.params[X_HEIGHT])
  const f = selectFont(k, bodySize, SANS)
  return beamercolorbox(k, t, name, colorboxOptions(options, k, env), colors, (b) => {
    const { list, after } = body(f, useColor(t, name, colors))
    // \@arrayparboxrestore (\parindent zero, \sloppy in the box's font), the box's skips
    const { vlist, trace } = lineBreak([emptyBox("hlist", 0), ...list], { ...classParams(k), hsize: b.hsize, leftSkip: spec("leftskip", b.leftskip), rightSkip: spec("rightskip", b.rightskip), ...sloppy(f.params[QUAD]) })
    decisions.push(trace)
    b.v.lines(vlist, k.sizes[bodySize].baselineskip)
    return after
  })
}

/** \hspace*{2ex}: \vrule width0pt, \nobreak, \hskip 2ex, \hskip\z@skip */
const hspaceStar = (f: Font): Node[] => [{ kind: "rule", width: 0, height: null, depth: null }, penalty(10000), glue(parseDimen("2ex", { em: f.params[QUAD], ex: f.params[X_HEIGHT] })), glue(0)]

/** \insertsectionhead or \insertsubsectionhead: \hyperlink{Navigation<page>}{short title}, nothing when empty */
function headLink(head: Head | null, f: Font, color: string): Node[] {
  if (!head) return []
  const text: Node[] = []
  appendText(text, plain(head.short), f, { spaceFactor: 1000 }, false)
  return navigationLink(text, color, head.page)
}

/** the infolines headline's two boxes, half the paper wide each, in section in head/foot's font: the section's head
 *  right-aligned then \hspace*{2ex}, \hspace*{2ex} then the subsection's head left-aligned (each line's last space
 *  taken off by \par) */
function infolinesHeadBoxes(k: ClassOptionData, t: Theme, at: FootlineAt, colors: ColorState, decisions: ParagraphTrace[]): Node[] {
  const size = fontSize(t, k, "section in head/foot", fontSize(t, k, "headline", "normalsize"))
  const half = "wd=.5\\paperwidth,ht=2.65ex,dp=1.5ex"
  // (each box's font: headline's, then its own)
  const sized = (name: string) => fontSize(t, k, name, fontSize(t, k, "headline", size))
  return [
    headFootBox(k, t, size, sized("section in head/foot"), colors, decisions, `${half},right`, "section in head/foot", (f, inner) => ({ list: [...headLink(at.heads.section, f, inner.fg), ...hspaceStar(f), spaceGlue(f, 1000)] })),
    headFootBox(k, t, size, sized("subsection in head/foot"), colors, decisions, `${half},left`, "subsection in head/foot", (f, inner) => ({ list: [...hspaceStar(f), ...headLink(at.heads.subsection, f, inner.fg), spaceGlue(f, 1000)] })),
  ]
}

/** Text the head and foot lines print as it is: no commands, braces or special characters */
function plain(text: string): string {
  if (/[\\{}$&#^_~%]/.test(text)) throw new Unsupported(`beamer: commands in the footline's text: ${text}`)
  return text.trim().replace(/\s+/g, " ")
}

/** \beamer@insertshort: the text in an \hbox */
function shortBox(text: string, font: Font) {
  const list: Node[] = []
  appendText(list, text, font, { spaceFactor: 1000 }, false)
  return hpack(list)
}

/** the three beamercolorboxes, in the footline's font (\usebeamerfont*{footline}) and colors (`colors`) */
function infolinesBoxes(k: ClassOptionData, t: Theme, info: TitleInfo, at: FootlineAt, colors: ColorState, decisions: ParagraphTrace[]): Node[] {
  const size = fontSize(t, k, "footline", "normalsize")
  const font = selectFont(k, size, SANS)
  const env = lengthEnv(k, font.params[QUAD], font.params[X_HEIGHT])
  // (each box is narrower than \textwidth, the paper's width there: none is squeezed into the margins)
  // each box's paragraph: \@arrayparboxrestore (\parindent zero, \sloppy in the footline's font), the box's skips
  const par = (b: ColorboxBody, list: Node[]) => {
    const { vlist, trace } = lineBreak([emptyBox("hlist", 0), ...list], { ...classParams(k), hsize: b.hsize, leftSkip: spec("leftskip", b.leftskip), rightSkip: spec("rightskip", b.rightskip), ...sloppy(font.params[QUAD]) })
    decisions.push(trace)
    b.v.lines(vlist, k.sizes[size].baselineskip)
  }
  const box = (options: string, name: string, body: (b: ColorboxBody, f: Font, inner: ColorState) => Node[] | void) =>
    beamercolorbox(k, t, name, colorboxOptions(options, k, env), colors, (b) => body(b, selectFont(k, fontSize(t, k, name, size), SANS), useColor(t, name, colors)))
  const third = "wd=.333333\\paperwidth,ht=2.25ex,dp=1ex"
  return [
    // \insertshortauthor (\and: \unskip, ), then ~~(\insertshortinstitute) unless the short institute is blank
    box(`${third},center`, "author in head/foot", (b, f) => {
      const list: Node[] = [shortBox(plain(info.short.author.replace(/\s*\\and(?![A-Za-z])\s*/g, ", ")), f)]
      if (info.short.institute.trim()) {
        list.push(penalty(10000), spaceGlue(f, 1000), penalty(10000), spaceGlue(f, 1000))
        appendText(list, "(", f, { spaceFactor: 1000 })
        list.push(shortBox(plain(info.short.institute), f))
        appendText(list, ")", f, { spaceFactor: 1000 })
      }
      par(b, list)
    }),
    // \insertshorttitle: \hyperlinkpresentationend on the first page (\hyperlink{Navigation<last page>}), else
    // \hyperlinkpresentationstart (\hyperlink{Navigation1}), around the short title's \hbox
    box(`${third},center`, "title in head/foot", (b, f, inner) => {
      par(b, navigationLink([shortBox(plain(info.short.title), f)], inner.fg, at.page === 1 ? at.lastPage : 1))
    }),
    // \hfill\insertshortdate{}\hfill, then in page number in head/foot's color the totalframenumber template:
    // \makebox[the width of "total\,/\,total"][r]{\insertframenumber\,/\,\inserttotalframenumber}
    box(`${third},leftskip=2ex,rightskip=2ex,sep=0pt`, "date in head/foot", (b, f, inner) => {
      const date = shortBox(plain(info.short.date.replace(/\\today(?![A-Za-z])\s*/g, today(at.epoch))), f)
      const pageColor = useColor(t, "page number in head/foot", inner)
      const pf = selectFont(k, fontSize(t, k, "page number in head/foot", size), SANS)
      // \, (amsmath's, which beamer loads: \tmspace+\thinmuskip{.1667em})
      const thin = parseDimen(".1667em", { em: pf.params[QUAD], ex: pf.params[X_HEIGHT] })
      const numbers = (n: number) => {
        const list: Node[] = []
        appendText(list, String(n), pf, { spaceFactor: 1000 }, false)
        list.push(kern(thin, true))
        appendText(list, "/", pf, { spaceFactor: 1000 }, false)
        list.push(kern(thin, true))
        appendText(list, String(at.total), pf, { spaceFactor: 1000 }, false)
        return list
      }
      const width = hpack(numbers(at.total)).width
      par(b, [fillGlue(), date, fillGlue(), colorPush(pageColor.fg), hpack([ssGlue(), ...numbers(at.frame)], { exactly: width })])
      return [colorPop()]
    }),
  ]
}

/** a beamer color's fg and bg as xcolor's fg and bg, for mixing (fg!50!bg) */
function mixer(c: ColorState): Colors {
  const mix = new Colors()
  for (const [n, spec] of [["fg", c.fg], ["bg", c.bg]]) { const [model, ...x] = spec.split(" "); mix.define(n, model, x.join(",")) }
  return mix
}

/** the text of a section's or subsection's short title in the font `f` */
function titleText(text: string, f: Font): Node[] {
  const list: Node[] = []
  appendText(list, plain(text), f, { spaceFactor: 1000 }, false)
  return list
}

/**
 * \insertsectionnavigation{width} (beamerbasenavigation.sty), in the font `f` of size `size` and the colors `c`
 * (section in head/foot's): \hbox to width{\vbox{in its fg, \vskip0.5625ex, per section of the .nav \hbox{\hyperlink
 * {Navigation<page>}{\hbox to width{\hskip0.3cm the template\hskip0.3cm}}} (\ht 1.6875ex, \dp .75ex), \vskip0.5625ex}\hfil};
 * the split theme's template: \hfill and the short title, shaded (\color{fg!50!bg}) but the current section's. The
 * subsections' (`sub`): the slide entries of the current section, one per subsection, each linked to its frame
 * (\beamer@link), the default templates (the title, after \hskip0.3cm, then \hfil).
 */
function sectionNavigation(k: ClassOptionData, at: FootlineAt, sub: boolean, size: SizeCommand, c: ColorState, width: number): BoxNode {
  const f = selectFont(k, size, SANS)
  const ex = (x: string) => parseDimen(x, { em: f.params[QUAD], ex: f.params[X_HEIGHT] })
  const cm = parseDimen("0.3cm", { em: 0, ex: 0 })
  const shaded = (text: string): Node[] => [colorPush(mixer(c).spec("fg!50!bg")), ...titleText(text, f), colorPop()]
  const entry = (content: Node[], page: number): BoxNode => {
    const b = hpack(navigationLink([hpack(content, { exactly: width })], c.fg, page))
    b.height = ex("1.6875ex"); b.depth = ex(".75ex")
    return b
  }
  const boxes: BoxNode[] = []
  const now = at.heads.counters
  if (!sub) {
    for (const h of at.nav) if (h.kind === "section") boxes.push(entry([glue(cm), fillGlue(), ...(h.section === now.section ? titleText(h.short, f) : shaded(h.short)), glue(cm)], h.page))
  } else {
    let current = 0
    for (const h of at.nav) {
      if (h.kind !== "slide" || h.section !== now.section || h.subsection <= current) continue
      current = h.subsection
      // \beamer@link(first/last): the frame's last page from its first up to the one before the last
      const page = at.page >= h.first && at.page < h.last ? h.last : h.first
      boxes.push(entry([glue(cm), ...(h.subsection === now.subsection ? titleText(h.lastSubsection, f) : shaded(h.lastSubsection)), filGlue(), glue(cm)], page))
    }
  }
  // (\offinterlineskip's \baselineskip set back by \usebeamerfont; beamer's \lineskip 1pt)
  const list: Node[] = [colorPush(c.fg), glue(ex("0.5625ex"))]
  let prevDepth: number | null = null
  for (const b of boxes) prevDepth = appendToVlist(list, b, prevDepth, k.sizes[size].baselineskip, { ...ZERO, width: 65536 }, 0)
  // (beamer's \reset@color: the pop before the skip that ends the list)
  list.push(colorPop(), glue(ex("0.5625ex")))
  return hpack([vpack(list), filGlue()], { exactly: width })
}

/**
 * The split outer theme's headline (beamerouterthemesplit.sty, not compressed), in section in head/foot's font: where
 * the .nav has sections, \@tempdimb = 2.4375ex times the most sections or subsections, plus 1.825ex; two boxes
 * [wd=.5\paperwidth,ht=\@tempdimb], section in head/foot's and subsection in head/foot's, each holding \vbox to\@tempdimb
 * {\vfil the navigation\vfil}
 */
function splitHeadBoxes(k: ClassOptionData, t: Theme, at: FootlineAt, colors: ColorState, decisions: ParagraphTrace[]): Node[] {
  const size = fontSize(t, k, "section in head/foot", fontSize(t, k, "headline", "normalsize"))
  const f = selectFont(k, size, SANS)
  const max = navMax(at.nav)
  const height = parseDimen("2.4375ex", { em: f.params[QUAD], ex: f.params[X_HEIGHT] }) * Math.max(max.sections, max.subsections)
  if (height <= 0) return []
  const ht = height + parseDimen("1.825ex", { em: f.params[QUAD], ex: f.params[X_HEIGHT] })
  const half = parseDimen(".5\\paperwidth", lengthEnv(k, f.params[QUAD], f.params[X_HEIGHT]))
  const box = (name: string, sub: boolean) => {
    const navSize = fontSize(t, k, name, size)
    return headFootBox(k, t, size, size, colors, decisions, `wd=.5\\paperwidth,ht=${ht}sp`, name, (_f, inner) =>
      ({ list: [vpack([filGlue(), sectionNavigation(k, at, sub, navSize, inner, half), filGlue()], { exactly: ht })] }))
  }
  return [box("section in head/foot", false), box("subsection in head/foot", true)]
}

/** The split outer theme's footline: two boxes half the paper wide, the short author's (right-aligned: \leftskip .3cm
 *  plus1fill, \rightskip .3cm) and the short title's (a link, as infolines'), then \nobreak\hfill and the page number
 *  template (empty) in page number in head/foot's fg */
function splitFootBoxes(k: ClassOptionData, t: Theme, info: TitleInfo, at: FootlineAt, colors: ColorState, decisions: ParagraphTrace[]): Node[] {
  const size = fontSize(t, k, "footline", "normalsize")
  const opts = "wd=.5\\paperwidth,ht=2.5ex,dp=1.125ex"
  return [
    headFootBox(k, t, size, fontSize(t, k, "author in head/foot", size), colors, decisions, `${opts},leftskip=.3cm plus1fill,rightskip=.3cm`, "author in head/foot", (f) =>
      ({ list: [shortBox(plain(info.short.author.replace(/\s*\\and(?![A-Za-z])\s*/g, ", ")), f), spaceGlue(f, 1000)] })),
    headFootBox(k, t, size, fontSize(t, k, "title in head/foot", size), colors, decisions, `${opts},leftskip=.3cm,rightskip=.3cm plus1fil`, "title in head/foot", (f, inner) => {
      const pageColor = useColor(t, "page number in head/foot", inner)
      return { list: [...navigationLink([shortBox(plain(info.short.title), f)], inner.fg, at.page === 1 ? at.lastPage : 1), penalty(10000), fillGlue(), colorPush(pageColor.fg), spaceGlue(f, 1000)], after: [colorPop()] }
    }),
  ]
}
