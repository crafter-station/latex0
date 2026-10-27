// The footline (beamerbaseframecomponents.sty's \beamer@typesetheadorfoot{footline}):
// the template in a \vbox \paperwidth wide, with \parskip zero and \offinterlineskip,
// typeset when \beamer@calculateheadfoot measures it (at \begin{document} and at each
// frame's start) and when the page is shipped. The default outer theme's is empty;
// the infolines outer theme's (beamerouterthemeinfolines.sty) is a paragraph holding,
// in an \hbox, three beamercolorboxes a third of the paper wide: the short author
// (with the short institute in parentheses), the short title (a link to the last page
// on the first page, to the first one on the others), and the short date with the
// frame number "n / total". Each box's paragraph and the template's own are traced
// where TeX breaks them: inside out, as each \par comes.

import type { ClassOptionData } from "../../layout/classdata"
import { parseDimen } from "../../layout/dimen"
import { QUAD, X_HEIGHT, type Font } from "../../layout/font"
import { appendText, spaceGlue } from "../../layout/hmode"
import { lineBreak } from "../../layout/linebreak"
import { emptyBox, fillGlue, glue, kern, paramGlue, penalty, ssGlue, type Node } from "../../layout/nodes"
import { hpack } from "../../layout/pack"
import type { ParagraphTrace } from "../../trace/decisions"
import { today } from "../frontmatter"
import { linkBox } from "../hyperref"
import { sloppy } from "../kernel"
import { appendToVlist, classParams, selectFont, spec } from "../paragraph"
import { Unsupported } from "../unsupported"
import { colorPop, colorPush } from "../xcolor"
import { beamercolorbox, colorboxOptions, lengthEnv, type ColorboxBody } from "./colorbox"
import { SANS } from "./frame"
import type { TitleInfo } from "./preamble"
import { fontSize, outerColors, useColor, type ColorState, type Theme } from "./theme"

/** Where the footline is typeset: the frame number (\c@framenumber), \inserttotalframenumber, the page number
 *  (\c@page), the last page (\beamer@endpageofdocument, from the last run's .nav) and the date \today prints */
export interface FootlineAt { frame: number; total: number; page: number; lastPage: number; epoch: number }

/** whether the theme's outer theme is infolines */
export const infolines = (t: Theme): boolean => t.data.preamble.includes("\\useoutertheme{infolines}")

const ZERO = { width: 0, stretch: 0, stretchOrder: 0, shrink: 0, shrinkOrder: 0 } as const

/**
 * \usebeamertemplate***{footline}'s list in the \vbox: normal text's and footline's fg pushed, the template, both
 * popped. The paragraphs' traces go to `decisions`.
 */
export function footlineTemplate(k: ClassOptionData, t: Theme, info: TitleInfo, at: FootlineAt, decisions: ParagraphTrace[]): Node[] {
  const outer = outerColors(t), colors = useColor(t, "footline", outer)
  const list: Node[] = [colorPush(outer.fg), colorPush(colors.fg)]
  if (infolines(t)) {
    // \leavevmode (new_graf: \parskip, then LaTeX's zero \parskip), \hbox{the three boxes}, \vskip0pt (\par): one line,
    // \hsize the paper's width, \parindent, \leftskip and \rightskip zero (\@parboxrestore's, beamer's \parindent)
    const boxes = hpack(infolinesBoxes(k, t, info, at, colors, decisions))
    const { vlist, trace } = lineBreak([emptyBox("hlist", 0), boxes], { ...classParams(k), hsize: k.dimens.paperwidth, leftSkip: spec("leftskip", ZERO), rightSkip: spec("rightskip", ZERO) })
    decisions.push(trace)
    list.push(paramGlue("parskip", glue(0)), paramGlue("parskip", glue(0)))
    let prevDepth: number | null = null
    for (const n of vlist) if (n.kind === "hlist") prevDepth = appendToVlist(list, n, prevDepth, ZERO, ZERO, 0); else list.push(n)
    list.push(glue(0))
  }
  list.push(colorPop(), colorPop())
  return list
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
      const dest = `Navigation${at.page === 1 ? at.lastPage : 1}`
      par(b, linkBox([shortBox(plain(info.short.title), f)], inner.fg, `[/Color [.5 .5 .5]/H /N/Border [0 0 0]BorderArrayPatch/Subtype /Link/Dest (${dest}) cvn H.B /ANN pdfmark`))
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
