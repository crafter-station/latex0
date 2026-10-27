// Front and back matter: \maketitle (article's \@maketitle, report's titlepage), \tableofcontents
// and its lines (\l@section, \l@chapter, \@dottedtocline), and thebibliography's heading.

import { dataFont } from "./data"
import { loadFont, QUAD, SPACE, SPACE_SHRINK, SPACE_STRETCH, X_HEIGHT, type Font } from "../layout/font"
import { Scanner, type GlueSpec } from "../layout/dimen"
import { appendText, sourceText, withoutTextCommands } from "./encodings"
import { lineBreak } from "../layout/linebreak"
import { emptyBox, FIL, glue, kern, penalty, type BoxNode, type Node, filGlue, fillGlue, ssGlue } from "../layout/nodes"
import { mathGlue } from "../mathlayout/mlist"
import { hpack } from "../layout/pack"
import { xnOverD } from "../layout/arith"
import { markboth, markValue } from "./marks"
import { type ListFile, type TocEntry } from "./toc"
import type { Ctx } from "./context"
import { centering as centeringShape } from "./kernel"
import { tabular } from "./boxes"
import { chapter, heading } from "./sectioning"
import { Unsupported } from "./unsupported"
import { addGlue, dimen, LOW_PENALTY, negate } from "./vlist"
import { type OutputHook } from "./output"
import { tocLink } from "./hyperref"
import { colorPop, colorPush, setgroup, xcolor } from "./xcolor"
import { preamble, tabularLines } from "./tabular"
import { mathEnv, paragraphInput, spec, squeeze, thanksInsert } from "./paragraph"
import { ALIGNMENTS, topDeclarations, verticalMaterial } from "./vmode"
import { babelToday, isSpanish, type Babel } from "./babel"

/** article's \maketitle and \@maketitle: \newpage, \null, \vskip 2em, a center environment with
 *  {\LARGE title\par}, \vskip 1.5em, {\large \lineskip .5em author tabulars\par}, \vskip 1em,
 *  {\large date}, then \vskip 1.5em */
export function maketitle(cx: Ctx) {
  const { amsmath, cls } = cx.pre
  // (\let\footnote\thanks)
  const title = Object.fromEntries(Object.entries(cx.pre.title).map(([k, x]) => [k, x?.replace(/\\footnote(?![A-Za-z])/g, "\\thanks")])) as typeof cx.pre.title
  const { decisions, doc, epoch, outerParskip, romanFont, run, typeset, v } = cx
  if (!title.title) throw new Unsupported("\\maketitle without \\title")
  const em = (n: string, f: Font) => new Scanner(n, { em: f.params[QUAD], ex: f.params[X_HEIGHT] }).scanDimen().value
  // report: the titlepage environment (\newpage, \thispagestyle{empty}, \setcounter{page}\@ne), then
  // \null\vfil\vskip60\p@; article: \newpage, \global\@topnum\z@ (no float at the top of this page), and
  // \@maketitle's \newpage, \null, \vskip2em
  const titlepage = cls !== "article"
  // \thanks (and \footnote): marks in \@fnsymbol, texts at \@thanks (report's titlepage: \small, no \footnoterule: not here)
  if (/\\(?:thanks|footnote)(?![A-Za-z])/.test(`${title.title}${title.author ?? ""}${title.date ?? ""}`) && (titlepage || cx.pre.hyper)) throw new Unsupported(`\\thanks in ${titlepage ? cls : "hyperref"}'s \\maketitle`)
  doc.thanks = []
  v.par()
  v.nobreak = false
  const hook = (h: OutputHook): Node => ({ kind: "whatsit", text: "", hook: h })
  if (titlepage) {
    v.nodes.push(filGlue(), penalty(-10000), hook("empty"), hook("page=1"))
    v.box(hpack([]), run.k.sizes.normalsize.baselineskip)
    v.vskip({ width: 0, stretch: 65536, stretchOrder: FIL, shrink: 0, shrinkOrder: 0 })
    v.vskip(dimen(60 * 65536))
  } else {
    v.nodes.push(filGlue(), penalty(-10000), hook("notop"), filGlue(), penalty(-10000))
    v.box(hpack([]), run.k.sizes.normalsize.baselineskip) // \null
    v.vskip(dimen(em("2em", romanFont)))
  }
  // \begin{center}: \trivlist (\parsep\parskip, \labelwidth\z@, \leftmargin\z@), \centering, \item\relax
  const topsepadd = addGlue(run.k.glue.topsep, run.k.glue.partopsep)
  v.addpenalty(-LOW_PENALTY); v.addvspace(addGlue(topsepadd, outerParskip)); v.addvspace(negate(outerParskip))
  const labelsep = run.k.dimens.labelsep
  const labels = hpack([glue(0), glue(0), glue(-labelsep), hpack(setgroup([]), { exactly: 0 }), glue(labelsep)])
  const centering = centeringShape()
  // (in center, \\ is \@centercr: the title may be paragraphs, each with \LARGE's \baselineskip or the size declared)
  if (!title.title.trim()) throw new Unsupported("an empty \\title")
  verticalMaterial(cx, title.title, { size: "LARGE", attrs: cx.normalAttrs, align: "centering" }, false, { first: [labels, penalty(0)], club: run.k.ints.clubpenalty })
  v.vskip(dimen(em(titlepage ? "3em" : "1.5em", romanFont)))
  // {\large \lineskip .5em (report: .75em) \begin{tabular}[t]{c}\@author\end{tabular}\par}, \and between tabulars
  const large = loadFont(dataFont(run.k.sizes.large.font.name), run.k.sizes.large.font.at)
  const author = title.author ?? ""
  if (/&|\\(?:hline|cline|multicolumn)(?![A-Za-z])/.test(author)) throw new Unsupported(`\\author{${author}}`)
  const authors = author.split(/\\and(?![A-Za-z])/).map((a) => tabularLines(a))
  const start: Node[] = [hpack([])] // \parindent is zero in center
  authors.forEach((rows, i) => {
    if (i) start.push(glue(em("1em", large), xnOverD(65536, 11141, 65536), FIL)) // \hskip 1em \@plus.17fil
    start.push(tabular(cx, rows, preamble("c"), "large", "t"))
  })
  const authorPar = paragraphInput("", run.k, "large", doc, { ...centering, start, clubPenalty: run.k.ints.clubpenalty, amsmath })
  const ab = lineBreak(authorPar.list, authorPar.params)
  decisions.push(ab.trace)
  v.paragraph(ab.vlist, outerParskip, run.k.sizes.large.baselineskip, dimen(em(titlepage ? ".75em" : ".5em", large)))
  v.vskip(dimen(em(titlepage ? "1.5em" : "1em", romanFont)))
  // {\large \@date}: its paragraph ends at \end{center}, with the normal size's \baselineskip (report:
  // {\large \@date \par}, with \large's)
  // (article: its \par is \endtrivlist's, after the group, with the normal size's \baselineskip)
  const date = squeeze((title.date ?? "\\today").replace(/\\today(?![A-Za-z])\s*/g, today(epoch, cx.pre.babel)))
  // (report: a group in vertical mode that ends its paragraphs, \\ as \@centercr)
  if (date && titlepage) verticalMaterial(cx, date, { size: "large", attrs: cx.normalAttrs, align: "centering" }, false, { club: run.k.ints.clubpenalty })
  else if (date) {
    const dp = paragraphInput(cx.counted(date, true), run.k, "large", doc, { ...centering, start: [hpack([])], clubPenalty: run.k.ints.clubpenalty, amsmath, groups: true, topDecls: true, centercr: true })
    const db = lineBreak(dp.list, dp.params)
    decisions.push(...dp.notes, db.trace)
    if (topDeclarations(date).some((d) => (ALIGNMENTS as readonly string[]).includes(d))) throw new Unsupported(`\\date{${date}}`)
    v.paragraph(db.vlist, outerParskip, run.k.sizes.normalsize.baselineskip)
  }
  v.endtrivlist(outerParskip, outerParskip, topsepadd)
  if (titlepage) {
    // \par\@thanks\vfil\null, \end{titlepage}: \newpage and, one-sided, \setcounter{page}\@ne
    v.vskip({ width: 0, stretch: 65536, stretchOrder: FIL, shrink: 0, shrinkOrder: 0 })
    v.box(hpack([]), run.k.sizes.normalsize.baselineskip)
    v.nodes.push(filGlue(), penalty(-10000))
    if (!run.k.ints.twoside) v.nodes.push(hook("page=1"))
  } else {
    // \endtrivlist; then \par \vskip 1.5em, \thispagestyle{plain}, \@thanks: \footnotetext[n]{text} in vertical mode
    v.vskip(dimen(em("1.5em", romanFont)))
    v.nodes.push(hook("plain"))
    for (const t of doc.thanks) {
      const { ins, trace } = thanksInsert(t.src, t.n, run.k, doc, v.club, amsmath)
      v.nodes.push(ins)
      decisions.push(trace)
    }
  }
  delete doc.thanks
  doc.footnote = 0 // \setcounter{footnote}{0}
}

export function tableOfContents(cx: Ctx) {
  const { cls } = cx.pre
  const { marks, mkboth, toc, v } = cx
  const source = "\\contentsname \\@mkboth{\\MakeUppercase\\contentsname}{\\MakeUppercase\\contentsname}"
  // with running heads, \@mkboth is \markboth: its marks in the title's line, which they leave (§ 655)
  const name = cx.pre.names.contentsname
  const contents = markValue([{ text: name }], true)
  const end = mkboth ? marks.insert(markboth(contents, contents), false) : undefined
  if (cls === "article") heading(cx, { kind: "heading", level: 1, star: true, title: name, source, end })
  else chapter(cx, { kind: "heading", level: 0, star: true, title: name, source, end })
  // parskip.sty's \@starttoc: \vskip-\lastskip \vskip(\lastskip plus \parskip), and \parskip zero for the lines (tocskip)
  const last = v.nodes.at(-1)
  if (cx.pre.parskip) {
    if (last?.kind !== "glue") throw new Unsupported("parskip's \\@starttoc after no skip")
    const g = { width: last.width, stretch: last.stretch, stretchOrder: last.stretchOrder, shrink: last.shrink, shrinkOrder: last.shrinkOrder }
    v.vskip(negate(g)); v.vskip(addGlue(g, cx.outerParskip))
  }
  const tocdepth = cls === "article" ? 3 : 2
  for (const e of toc ?? []) if (e.level <= tocdepth) tocLine(cx, e, cx.pre.parskip ? dimen(0) : cx.outerParskip)
  v.nobreak = false
}

/**
 * \listoffigures and \listoftables: \section*{\listfigurename} (report, book: \chapter*), then \@mkboth, \@starttoc{lof}:
 * each line \l@figure (\@dottedtocline{1}{1.5em}{2.3em}), and report's \addvspace{10\p@} at each chapter
 */
export function listOf(cx: Ctx, file: ListFile) {
  const { cls } = cx.pre
  const { lists, marks, mkboth, v } = cx
  const [name, macro] = file === "lof" ? [cx.pre.names.listfigurename, "listfigurename"] : [cx.pre.names.listtablename, "listtablename"]
  if (cls === "article") heading(cx, { kind: "heading", level: 1, star: true, title: name, source: `\\${macro}` })
  else chapter(cx, { kind: "heading", level: 0, star: true, title: name, source: `\\${macro}` })
  // (\@mkboth after the heading, in vertical mode: not in its title as \tableofcontents has it)
  const value = markValue([{ text: name }], true)
  if (mkboth) v.nodes.push(...marks.insert(markboth(value, value), v.nobreak))
  for (const e of lists?.[file] ?? []) {
    if ("vspace" in e) { v.addvspace(dimen(10 * 65536)); continue }
    // ({\ignorespaces title}: a group the line's text is in, no space at its end)
    if (/\s$/.test(e.title)) throw new Unsupported(`a ${file} line "${e.title}" ending in a space`)
    tocLine(cx, { level: cls === "article" ? 2 : 1, number: e.number, title: e.title.trimStart(), page: e.page, anchor: e.anchor }, cx.pre.parskip ? dimen(0) : cx.outerParskip)
  }
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
export function tocLine(cx: Ctx, e: TocEntry, parskip: GlueSpec) {
  const { amsmath, cls, hyper } = cx.pre
  const { bodyUnits, decisions, doc, outerParskip, roman, run, v } = cx
  const top = cls === "article" ? 1 : 0
  const dims = (x: string, units = bodyUnits) => new Scanner(x, units).scanDimen().value
  const bold = run.k.sizes.normalsize.bold
  const font = e.level === top ? bold : roman
  const f = loadFont(dataFont(font.name), font.at)
  const fUnits = { em: f.params[QUAD], ex: f.params[X_HEIGHT] }
  // \numberline{n}: \hb@xt@\@tempdima{n\hfil} (spanish.ldf's layout: n.)
  const numberline = (width: number): Node[] => {
    if (e.number === null) return []
    const l: Node[] = []
    appendText(l, e.number + (isSpanish(cx.pre.babel) && e.number !== "" ? "." : ""), f, { spaceFactor: 1000 }, false)
    return [hpack([...l, filGlue()], { exactly: width })]
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
    tail = [penalty(10000), filGlue(), penalty(10000), pageBox(ssGlue())]
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
    tail = [penalty(10000), { ...fillGlue(), leaders: { kind: "leaders", box: leader } }, penalty(10000), pageBox(filGlue(), true), ...(xcolor.on ? [colorPop()] : [])] // (\aftergroup: after the box)
    params = { leftSkip: spec("leftskip", dimen(indent + numwidth)), rightSkip: spec("rightskip", dimen(rmarg)), parFillSkip: spec("parfillskip", dimen(-rmarg)), interLinePenalty: 10000 }
  }
  // hyperref (linktoc=section): the number and the title in a link to the heading's anchor
  let body = e.title
  if (hyper && e.anchor) {
    const title = paragraphInput(e.title, run.k, "normalsize", doc, { start: [], font, amsmath }).list
    start.push(...tocLink([...nl, ...title], e.anchor, run.k.sizes.normalsize.baselineskip.width))
    body = ""
  } else start.push(...nl)
  const { list, params: ps, notes } = paragraphInput(body, run.k, "normalsize", doc, { ...params, start, font, clubPenalty: club, amsmath })
  list.push(...tail)
  const lb = lineBreak(list, ps)
  decisions.push(...notes, lb.trace)
  v.paragraph(lb.vlist, parskip)
  if (e.level === top && cls !== "article") v.nodes.push(penalty(301)) // \penalty\@highpenalty
}

/** \thebibliography's start: \section*{\refname} (report, book: \chapter*{\bibname}), then \@mkboth */
export function bibliography(cx: Ctx) {
  const { cls, hyper } = cx.pre
  const { marks, mkboth, v } = cx
  const [name, macro] = cls === "article" ? [cx.pre.names.refname, "refname"] : [cx.pre.names.bibname, "bibname"]
  if (cls === "article") heading(cx, { kind: "heading", level: 1, star: true, title: name, source: `\\${macro}` })
  else chapter(cx, { kind: "heading", level: 0, star: true, title: name, source: `\\${macro}` })
  const value = markValue([{ text: name }], true)
  if (mkboth) v.nodes.push(...marks.insert(markboth(value, value), v.nobreak))
}

/** \today: "January 1, 2025", or babel's main language's (LaTeX source: ~ is \nobreakspace) */
export function today(epoch: number, babel: Babel | null = null): string {
  return babelToday(babel, new Date(epoch * 1000))
}
