// Front and back matter: \maketitle (article's \@maketitle, report's titlepage), \tableofcontents
// and its lines (\l@section, \l@chapter, \@dottedtocline), and thebibliography's heading.

import { dataFont } from "./data"
import { loadFont, QUAD, X_HEIGHT, type Font } from "../layout/font"
import { Scanner } from "../layout/dimen"
import { appendText } from "../layout/hmode"
import { lineBreak } from "../layout/linebreak"
import { emptyBox, FIL, FILL, glue, kern, paramGlue, penalty, type BoxNode, type Node } from "../layout/nodes"
import { mathGlue } from "../mathlayout/mlist"
import { hpack } from "../layout/pack"
import { xnOverD } from "../layout/arith"
import { markboth, markValue } from "./marks"
import { type TocEntry } from "./toc"
import type { Ctx } from "./context"
import { chapter, heading } from "./sectioning"
import { Unsupported } from "./unsupported"
import { addGlue, dimen, LOW_PENALTY, negate } from "./vlist"
import { type OutputHook } from "./output"
import { tocLink } from "./hyperref"
import { colorPop, colorPush, setgroup, xcolor } from "./xcolor"
import { preamble } from "./tabular"
import { mathEnv, paragraphInput, spec } from "./paragraph"

/** article's \maketitle and \@maketitle: \newpage, \null, \vskip 2em, a center environment with
 *  {\LARGE title\par}, \vskip 1.5em, {\large \lineskip .5em author tabulars\par}, \vskip 1em,
 *  {\large date}, then \vskip 1.5em */
export function maketitle(cx: Ctx) {
  const { amsmath, cls, title } = cx.pre
  const { decisions, doc, epoch, outerParskip, romanFont, run, tabular, typeset, v } = cx
  if (!title.title) throw new Unsupported("\\maketitle without \\title")
  const em = (n: string, f: Font) => new Scanner(n, { em: f.params[QUAD], ex: f.params[X_HEIGHT] }).scanDimen().value
  // report: the titlepage environment (\newpage, \thispagestyle{empty}, \setcounter{page}\@ne), then
  // \null\vfil\vskip60\p@; article: \newpage, \global\@topnum\z@ (no float at the top of this page), and
  // \@maketitle's \newpage, \null, \vskip2em
  const titlepage = cls !== "article"
  v.par()
  v.nobreak = false
  const hook = (h: OutputHook): Node => ({ kind: "whatsit", text: "", hook: h })
  if (titlepage) {
    v.nodes.push(glue(0, 65536, FIL), penalty(-10000), hook("empty"), hook("page=1"))
    v.box(hpack([]), run.k.sizes.normalsize.baselineskip)
    v.vskip({ width: 0, stretch: 65536, stretchOrder: FIL, shrink: 0, shrinkOrder: 0 })
    v.vskip(dimen(60 * 65536))
  } else {
    v.nodes.push(glue(0, 65536, FIL), penalty(-10000), hook("notop"), glue(0, 65536, FIL), penalty(-10000))
    v.box(hpack([]), run.k.sizes.normalsize.baselineskip) // \null
    v.vskip(dimen(em("2em", romanFont)))
  }
  // \begin{center}: \trivlist (\parsep\parskip, \labelwidth\z@, \leftmargin\z@), \centering, \item\relax
  const topsepadd = addGlue(run.k.glue.topsep, run.k.glue.partopsep)
  v.addpenalty(-LOW_PENALTY); v.addvspace(addGlue(topsepadd, outerParskip)); v.addvspace(negate(outerParskip))
  const labelsep = run.k.dimens.labelsep
  const labels = hpack([glue(0), glue(0), glue(-labelsep), hpack(setgroup([]), { exactly: 0 }), glue(labelsep)])
  const flush = (p: string) => paramGlue(p, glue(0, 65536, FIL))
  const centering = { leftSkip: flush("leftskip"), rightSkip: flush("rightskip"), parFillSkip: paramGlue("parfillskip", glue(0)), finalHyphenDemerits: 0 }
  const check = (t: string, what: string) => { if (/[\\{}%&#^_~$]/.test(t.replace(/\\[#%&$]/g, ""))) throw new Unsupported(`${what} "${t}"`) }
  check(title.title, "\\title")
  typeset(title.title, { ...centering, start: [labels, penalty(0)], clubPenalty: run.k.ints.clubpenalty }, outerParskip, "LARGE")
  v.vskip(dimen(em(titlepage ? "3em" : "1.5em", romanFont)))
  // {\large \lineskip .5em (report: .75em) \begin{tabular}[t]{c}\@author\end{tabular}\par}, \and between tabulars
  const large = loadFont(dataFont(run.k.sizes.large.font.name), run.k.sizes.large.font.at)
  const authors = (title.author ?? "").split(/\\and\b/).map((a) => a.split(/\\\\/).map((r) => r.trim()))
  authors.flat().forEach((r) => check(r, "\\author"))
  const start: Node[] = [hpack([])] // \parindent is zero in center
  authors.forEach((rows, i) => {
    if (i) start.push(glue(em("1em", large), xnOverD(65536, 11141, 65536), FIL)) // \hskip 1em \@plus.17fil
    start.push(tabular(rows.map((r) => ({ cells: [{ text: r }] })), preamble("c"), "large", "t"))
  })
  const authorPar = paragraphInput("", run.k, "large", doc, { ...centering, start, clubPenalty: run.k.ints.clubpenalty, amsmath })
  const ab = lineBreak(authorPar.list, authorPar.params)
  decisions.push(ab.trace)
  v.paragraph(ab.vlist, outerParskip, run.k.sizes.large.baselineskip, dimen(em(titlepage ? ".75em" : ".5em", large)))
  v.vskip(dimen(em(titlepage ? "1.5em" : "1em", romanFont)))
  // {\large \@date}: its paragraph ends at \end{center}, with the normal size's \baselineskip (report:
  // {\large \@date \par}, with \large's)
  const date = (title.date ?? "\\today").replace(/\\today\b\s*/g, today(epoch))
  check(date, "\\date")
  if (date) {
    const dp = paragraphInput("", run.k, "large", doc, { ...centering, start: [hpack([])], clubPenalty: run.k.ints.clubpenalty, amsmath })
    appendText(dp.list, date, large, { spaceFactor: 1000 })
    const db = lineBreak(dp.list, dp.params)
    decisions.push(db.trace)
    v.paragraph(db.vlist, outerParskip, titlepage ? run.k.sizes.large.baselineskip : run.k.sizes.normalsize.baselineskip)
  }
  v.endtrivlist(outerParskip, outerParskip, topsepadd)
  if (titlepage) {
    // \par\@thanks\vfil\null, \end{titlepage}: \newpage and, one-sided, \setcounter{page}\@ne
    v.vskip({ width: 0, stretch: 65536, stretchOrder: FIL, shrink: 0, shrinkOrder: 0 })
    v.box(hpack([]), run.k.sizes.normalsize.baselineskip)
    v.nodes.push(glue(0, 65536, FIL), penalty(-10000))
    if (!run.k.ints.twoside) v.nodes.push(hook("page=1"))
  } else {
    // \endtrivlist; then \par \vskip 1.5em, \thispagestyle{plain}
    v.vskip(dimen(em("1.5em", romanFont)))
    v.nodes.push(hook("plain"))
  }
  doc.footnote = 0 // \setcounter{footnote}{0}
}

export function tableOfContents(cx: Ctx) {
  const { cls } = cx.pre
  const { marks, mkboth, toc, v } = cx
  const source = "\\contentsname \\@mkboth{\\MakeUppercase\\contentsname}{\\MakeUppercase\\contentsname}"
  // with running heads, \@mkboth is \markboth: its marks in the title's line, which they leave (§ 655)
  const contents = markValue([{ text: "Contents" }], true)
  const end = mkboth ? marks.insert(markboth(contents, contents), false) : undefined
  if (cls === "article") heading(cx, { kind: "heading", level: 1, star: true, title: "Contents", source, end })
  else chapter(cx, { kind: "heading", level: 0, star: true, title: "Contents", source, end })
  const tocdepth = cls === "article" ? 3 : 2
  for (const e of toc ?? []) if (e.level <= tocdepth) tocLine(cx, e)
  v.nobreak = false
}

/**
 * One toc line. The top level (article's \l@section, report's \l@chapter): \addpenalty, the skip,
 * then in a group \parindent\z@ \rightskip\@pnumwidth \parfillskip-\@pnumwidth \leavevmode\bfseries
 * \advance\leftskip\@tempdima \hskip-\leftskip #1\nobreak\hfil\nobreak\hb@xt@\@pnumwidth{\hss #2\kern-\p@\kern\p@}\par.
 * Below it, \@dottedtocline{level}{indent}{numwidth}: \vskip\z@\@plus.2\p@, and in a group \leftskip
 * indent, \rightskip\@tocrmarg, \parfillskip-\rightskip, \parindent indent, \@afterindenttrue,
 * \interlinepenalty\@M, \leavevmode \advance\leftskip numwidth \null\nobreak\hskip-\leftskip {#4}\nobreak
 * \leaders\hbox{$\m@th\mkern\@dotsep mu\hbox{.}\mkern\@dotsep mu$}\hfill\nobreak
 * \hb@xt@\@pnumwidth{\hfil\normalfont\normalcolor #5\kern-\p@\kern\p@}\par
 */
export function tocLine(cx: Ctx, e: TocEntry) {
  const { amsmath, cls, hyper } = cx.pre
  const { bodyUnits, decisions, doc, outerParskip, roman, run, v } = cx
  const top = cls === "article" ? 1 : 0
  const dims = (x: string, units = bodyUnits) => new Scanner(x, units).scanDimen().value
  const bold = run.k.sizes.normalsize.bold
  const font = e.level === top ? bold : roman
  const f = loadFont(dataFont(font.name), font.at)
  const fUnits = { em: f.params[QUAD], ex: f.params[X_HEIGHT] }
  // \numberline{n}: \hb@xt@\@tempdima{n\hfil}
  const numberline = (width: number): Node[] => {
    if (e.number === null) return []
    const l: Node[] = []
    appendText(l, e.number, f, { spaceFactor: 1000 }, false)
    return [hpack([...l, glue(0, 65536, FIL)], { exactly: width })]
  }
  // the page number: \hb@xt@\@pnumwidth (in the line's font) {\hss or \hfil, #2, \kern-\p@\kern\p@}
  const pageBox = (fill: Node, normalcolor = false): BoxNode => {
    const l: Node[] = [fill]
    if (normalcolor && xcolor.on) l.push(colorPush()) // \@dottedtocline's \normalcolor
    appendText(l, String(e.page), f, { spaceFactor: 1000 }, false)
    l.push(kern(-65536, true), kern(65536, true))
    return hpack(l, { exactly: dims("1.55em", fUnits) })
  }
  if (e.level === top) {
    if (cls === "article") { v.addpenalty(-300); v.addvspace({ width: dims("1.0em"), stretch: 65536, stretchOrder: 0, shrink: 0, shrinkOrder: 0 }) }
    else { v.addpenalty(-301); v.vskip({ width: dims("1.0em"), stretch: 65536, stretchOrder: 0, shrink: 0, shrinkOrder: 0 }) } // \@highpenalty
  } else v.vskip({ width: 0, stretch: 13107, stretchOrder: 0, shrink: 0, shrinkOrder: 0 })
  // the paragraph's \everypar: \@afterheading's, which is reset only inside the line's group
  let club = v.club, keepIndent = true
  if (v.afterheadingEverypar) {
    if (v.nobreak) { v.nobreak = false; club = 10000; keepIndent = e.level !== top || v.afterindent }
    else club = run.k.ints.clubpenalty
  }
  let start: Node[], nl: Node[], tail: Node[], params: Parameters<typeof paragraphInput>[4]
  if (e.level === top) {
    const tempdima = dims("1.5em"), pnum = dims("1.55em")
    start = [...(keepIndent ? [emptyBox("hlist", 0)] : []), glue(-tempdima)]
    nl = numberline(tempdima)
    tail = [penalty(10000), glue(0, 65536, FIL), penalty(10000), pageBox(glue(0, 65536, FIL, 65536, FIL))]
    params = { leftSkip: spec("leftskip", dimen(tempdima)), rightSkip: spec("rightskip", dimen(pnum)), parFillSkip: spec("parfillskip", dimen(-pnum)) }
  } else {
    const [indent, numwidth] = (cls === "article" ? [["", ""], ["", ""], ["1.5em", "2.3em"], ["3.8em", "3.2em"]] : [["", ""], ["1.5em", "2.3em"], ["3.8em", "3.2em"]])[e.level].map((x) => dims(x))
    const rmarg = dims("2.55em")
    // \mkern\@dotsep mu: math_kern (§ 717) in the text size's mu
    const mu = Math.trunc(mathEnv(run.k, "normalsize", amsmath).fonts[0][2]!.params[6] / 18)
    const mk = mathGlue(dimen(dims("4.5pt")), mu).width
    const dot: Node[] = []
    appendText(dot, ".", f, { spaceFactor: 1000 }, false)
    const leader = hpack([{ kind: "math", on: true, width: 0 }, kern(mk, true), hpack(dot), kern(mk, true), { kind: "math", on: false, width: 0 }])
    start = [emptyBox("hlist", indent), hpack([]), penalty(10000), glue(-(indent + numwidth))]
    nl = numberline(numwidth)
    tail = [penalty(10000), { ...glue(0, 65536, FILL), leaders: { kind: "leaders", box: leader } }, penalty(10000), pageBox(glue(0, 65536, FIL), true), ...(xcolor.on ? [colorPop()] : [])] // (\aftergroup: after the box)
    params = { leftSkip: spec("leftskip", dimen(indent + numwidth)), rightSkip: spec("rightskip", dimen(rmarg)), parFillSkip: spec("parfillskip", dimen(-rmarg)), interLinePenalty: 10000 }
  }
  // hyperref (linktoc=section): the number and the title in a link to the heading's anchor
  let body = e.title
  if (hyper && e.anchor) {
    const title = paragraphInput(e.title, run.k, "normalsize", doc, { start: [], font, amsmath }).list
    start.push(tocLink([...nl, ...title], e.anchor, run.k.sizes.normalsize.baselineskip.width))
    body = ""
  } else start.push(...nl)
  const { list, params: ps, notes } = paragraphInput(body, run.k, "normalsize", doc, { ...params, start, font, clubPenalty: club, amsmath })
  list.push(...tail)
  const lb = lineBreak(list, ps)
  decisions.push(...notes, lb.trace)
  v.paragraph(lb.vlist, outerParskip)
  if (e.level === top && cls !== "article") v.nodes.push(penalty(301)) // \penalty\@highpenalty
}

/** \thebibliography's start: \section*{\refname} (report, book: \chapter*{\bibname}), then \@mkboth */
export function bibliography(cx: Ctx) {
  const { cls, hyper } = cx.pre
  const { marks, mkboth, v } = cx
  if (hyper) throw new Unsupported("thebibliography with hyperref")
  const [name, macro] = cls === "article" ? ["References", "refname"] : ["Bibliography", "bibname"]
  if (cls === "article") heading(cx, { kind: "heading", level: 1, star: true, title: name, source: `\\${macro}` })
  else chapter(cx, { kind: "heading", level: 0, star: true, title: name, source: `\\${macro}` })
  const value = markValue([{ text: name }], true)
  if (mkboth) v.nodes.push(...marks.insert(markboth(value, value), v.nobreak))
}

/** \today: "January 1, 2025" */
export function today(epoch: number): string {
  const d = new Date(epoch * 1000)
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}
