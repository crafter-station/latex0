// Sectioning: \@startsection's displayed headings (\@sect, \@xsect, \@afterheading), run-in headings
// (\paragraph, \subparagraph: \@noskipsec and \everypar), report and book's \chapter (\@makechapterhead),
// \clearpage and \cleardoublepage, and book's \frontmatter, \mainmatter and \backmatter.

import { dataFont } from "./data"
import { loadFont, QUAD } from "../layout/font"
import { Scanner, type GlueSpec } from "../layout/dimen"
import { appendText } from "./encodings"
import { emptyBox, glue, penalty, type Node, filGlue } from "../layout/nodes"
import { hpack } from "../layout/pack"
import { type Block } from "./blocks"
import { EMPTY_MARK, markboth, markright, markValue, sectionMarks } from "./marks"
import type { Ctx } from "./context"
import { raggedright } from "./kernel"
import { Unsupported } from "./unsupported"
import { addGlue, dimen, negate } from "./vlist"
import { type OutputHook } from "./output"
import { anchor, labelName, sectionAnchorBox } from "./hyperref"
import { appendToVlist, paragraphInput } from "./paragraph"
import { titlesecHeading } from "./titlesec"
import { isSpanish } from "./babel"

/**
 * report's \chapter: \clearpage, \thispagestyle{plain}, \global\@topnum\z@, \@afterindentfalse; then
 * \@chapter (\refstepcounter, which resets the sections, equations, figures, tables and footnotes; the
 * toc line; \addvspace{10pt} in the lof and lot) or \@schapter, and \@makechapterhead: \vspace*{50pt},
 * {\parindent\z@ \raggedright \normalfont \huge\bfseries \@chapapp\space\thechapter \par\nobreak \vskip20pt
 * \interlinepenalty\@M \Huge\bfseries title\par\nobreak \vskip40pt}, then \@afterheading
 */
/** \clearpage: \newpage (which ends \if@nobreak), \write\m@ne{}, \vbox{}, \penalty-\@Mi */
export function clearpage(cx: Ctx) {
  const { noskipsecPar, run, v } = cx
  noskipsecPar("a page break"); run.noskipsec = false // \newpage: \leavevmode, \global\@noskipsecfalse
  if (v.nobreak) { v.nobreak = false; v.afterheadingEverypar = false }
  v.nodes.push(filGlue(), penalty(-10000), { kind: "whatsit", text: "\\write-{}" })
  v.box(emptyBox("vlist"), run.k.sizes.normalsize.baselineskip)
  v.nodes.push(penalty(-10001))
}

/** \cleardoublepage: \clearpage, then, two-sided, \ifodd\c@page\else\hbox{}\newpage\fi (the output decides) */
export function cleardoublepage(cx: Ctx) {
  const { run, v } = cx
  clearpage(cx)
  if (!run.k.ints.twoside) return
  const extra: Node[] = []
  appendToVlist(extra, hpack([]), v.prevDepth, run.k.sizes.normalsize.baselineskip, run.k.glue.lineskip, run.k.dimens.lineskiplimit)
  extra.push(filGlue(), penalty(-10000))
  v.nodes.push({ kind: "whatsit", text: "", hook: { cleardouble: extra } satisfies OutputHook })
}

/** book's \frontmatter (\cleardoublepage, \@mainmatterfalse, \pagenumbering{roman}), \mainmatter, \backmatter */
export function matter(cx: Ctx, which: "front" | "main" | "back") {
  const { cls } = cx.pre
  const { run, v } = cx
  if (cls !== "book") throw new Unsupported(`\\${which}matter in ${cls}`)
  if (which === "front" && isSpanish(cx.pre.babel)) throw new Unsupported("\\frontmatter with spanish.ldf (its \\@roman page numbers in small capitals)")
  v.par()
  cleardoublepage(cx) // \backmatter's when openright, as book is
  run.mainmatter = which === "main"
  if (which !== "back") v.nodes.push({ kind: "whatsit", text: "", hook: which === "front" ? "roman" : "arabic" })
}

export function chapter(cx: Ctx, b: Extract<Block, { kind: "heading" }>) {
  const { cls, hyper, nameref } = cx.pre
  const { contentsWrites, counters, doc, headings, lastNode, marks, outerParskip, refs, run, typeset, v } = cx
  if (cls !== "report" && cls !== "book") throw new Unsupported(`\\chapter in ${cls}`)
  v.par()
  if (cls === "book") cleardoublepage(cx) // openright
  else clearpage(cx)
  // \thispagestyle{plain}, \global\@topnum\z@
  v.nodes.push({ kind: "whatsit", text: "", hook: "plain" satisfies OutputHook }, { kind: "whatsit", text: "", hook: "notop" satisfies OutputHook })
  // book's \@chapter numbers only in the main matter
  const numbered = !b.star && (cls !== "book" || run.mainmatter)
  if (!b.star) {
    if (numbered) {
      counters.stepSectional(0)
      refs.label = counters.theSectional(0); refs.href = `chapter.${refs.label}`
      if (refs.cleveref) refs.cleveref.current = { type: "chapter", arabic: counters.sectional[0], prefix: counters.crefPrefix("chapter"), label: refs.label }
      doc.footnote = 0
    } else if (hyper) refs.href = `chapter*.${++run.linkcounter}` // hyperref's \@chapter: \Hy@MakeCurrentHrefAuto
    // hyperref: the anchor, then \addcontentsline's bookmark and toc line
    if (nameref) refs.name = labelName(b.title) // (nameref's \@chapter)
    if (hyper) v.nodes.push(...anchor(refs.href, run.k.sizes.normalsize.baselineskip.width, "v", lastNode()))
    v.nodes.push(...contentsWrites(0, numbered ? String(counters.sectional[0]) : null, b.title, refs.href, false))
    // \chaptermark: \MakeUppercase{\@chapapp\ \thechapter. \ title}, to both marks when two-sided
    if (headings) {
      const cv = markValue(numbered ? [{ text: cx.pre.names.chaptername }, { ctrl: true }, { text: `${counters.sectional[0]}. ` }, { ctrl: true }, { text: b.title }] : [{ text: b.title }], true)
      v.nodes.push(...marks.insert(run.k.ints.twoside ? markboth(cv, EMPTY_MARK) : markright(cv), false))
    }
    for (const ext of ["lof", "lot"]) v.nodes.push({ kind: "whatsit", text: `\\write1{\\@writefile{${ext}}{\\protect \\addvspace {10\\p@ }}}` })
  } else {
    if (nameref) refs.name = labelName(b.source ?? b.title) // (nameref's \@schapter)
    if (hyper) { // \@schapter: \Hy@MakeCurrentHrefAuto{chapter*} and its anchor
      refs.href = `chapter*.${++run.linkcounter}`
      v.nodes.push(...anchor(refs.href, run.k.sizes.normalsize.baselineskip.width, "v", lastNode()))
    }
  }
  // \vspace*{50pt}: \hrule height0pt \nobreak \vskip50pt \vskip\z@skip, keeping \prevdepth
  const pd = v.prevDepth
  const top: Node = { kind: "rule", width: null, height: 0, depth: 0 }
  v.nodes.push(top, penalty(10000), glue(50 * 65536), glue(0))
  v.prevDepth = pd
  // the head's first paragraph runs an \@afterheading \everypar still pending, which sets \@clubpenalty
  // (in the head's group)
  const club = v.afterheadingEverypar ? run.k.ints.clubpenalty : v.club
  const ragged = () => ({ start: [hpack([])], ...raggedright(), clubPenalty: club }) // \parindent\z@ \raggedright
  if (numbered) {
    typeset(`${cx.pre.names.chaptername} ${counters.sectional[0]}`, { ...ragged(), font: run.k.sizes.huge.bold }, outerParskip, "huge")
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
export function runInHeading(cx: Ctx, b: Extract<Block, { kind: "heading" }>) {
  const { amsmath, hyper, nameref } = cx.pre
  const { bodyUnits, contentsWrites, counted, doc, noskipsecPar, refs, romanFont, run, v } = cx
  const name = b.level === 4 ? "paragraph" : "subparagraph"
  const before = new Scanner("3.25ex plus1ex minus.2ex", bodyUnits).scanGlue()
  noskipsecPar("a heading")
  run.noskipsec = false // (\@xsect: \@noskipsectrue, with its own \everypar)
  v.par()
  if (run.runIn) throw new Unsupported("two run-in headings in a row")
  if (v.nobreak) v.afterheadingEverypar = false // \everypar{}
  else { v.addpenalty(-300); v.addvspace(lessParskip(cx, before)) }
  v.afterindent = true
  if (!b.star && b.level <= run.k.ints.secnumdepth) throw new Unsupported(`numbered \\${name}`)
  v.nobreak = false // \@nobreakfalse
  // hyperref: \Hy@MakeCurrentHrefAuto now, its anchor box at the start of the title
  const anchorName = hyper ? `section*.${++run.linkcounter}` : ""
  if (hyper) refs.href = anchorName
  if (nameref) refs.name = labelName(b.title) // (nameref's \@ssect)
  // (hyperref's \setlength{\Hy@SectionHShift}{#1}: the indent now)
  const shift = b.level === 5 ? run.k.dimens.parindent : 0
  // \@svsechd is a \def: its title (and the toc line's) is expanded when the paragraph puts it in place
  run.runIn = (em = romanFont.params[QUAD], parindent = run.k.dimens.parindent) => {
    const title = counted(b.title)
    const indent = b.level === 5 ? parindent : 0 // (\hskip #3, read where it is put in place)
    const start: Node[] = [glue(indent), ...(hyper ? [sectionAnchorBox(anchorName, shift, run.k.sizes.normalsize.baselineskip.width)] : [])]
    const head = paragraphInput(title, run.k, "normalsize", doc, { start, font: run.k.sizes.normalsize.bold, amsmath }).list
    if (!b.star) head.push(...contentsWrites(b.level, null, title, refs.href, false)) // (\@currentHref when the paragraph starts)
    if (head[head.length - 1]?.kind === "glue") head.pop() // \unskip
    head.push(glue(em)) // \hskip -\@tempskipa
    return head
  }
}

/** \@startsection{name}{level}{\z@}{beforeskip}{afterskip}{\normalfont<size>\bfseries} and its starred form */
export function heading(cx: Ctx, heading: Extract<Block, { kind: "heading" }>) {
  const { cls, hyper } = cx.pre
  const { bodyUnits, contentsWrites, counted, counters, headings, lastNode, marks, noskipsecPar, outerParskip, refs, run, typeset, v } = cx
  if (cx.pre.titlesec) return titlesecHeading(cx, heading)
  if (heading.level >= 4) return runInHeading(cx, heading)
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
  if (!v.nobreak) { v.addpenalty(-300); v.addvspace(lessParskip(cx, before)) } // \@secpenalty
  // \@sect: the number and the space after it (\@seccntformat: \the<name>\quad) in a box the title hangs from
  const numbered = !b.star && b.level <= run.k.ints.secnumdepth
  let number = ""
  if (!b.star) {
    counters.stepSectional(b.level)
    number = counters.theSectional(b.level)
  }
  if (numbered) { // \refstepcounter
    const type = ["", "section", "subsection", "subsubsection"][b.level]
    refs.label = number; refs.href = `${type}.${number}`
    if (refs.cleveref) refs.cleveref.current = { type, arabic: counters.sectional[b.level], prefix: counters.crefPrefix(type), label: number }
  }
  // hyperref: \refstepcounter's anchor on the vertical list; an unnumbered heading's (\Hy@MakeCurrentHrefAuto)
  // in an \hbox to 0pt at the start of its title; nameref's \@currentlabelname is the title (its \@sect and \@ssect)
  let anchorName = ""
  if (hyper) {
    if (numbered) { anchorName = refs.href; v.nodes.push(...anchor(anchorName, run.k.sizes.normalsize.baselineskip.width, "v", lastNode())) }
    else { anchorName = `section*.${++run.linkcounter}`; refs.href = anchorName }
  }
  if (cx.pre.nameref) refs.name = labelName(heading.source ?? heading.title)
  const bold = run.k.sizes[size].bold
  const bf = loadFont(dataFont(bold.name), bold.at)
  const label: Node[] = [glue(0)] // \hskip #3 (\z@)
  // (spanish.ldf's layout: \@seccntformat is \csname the#1\endcsname.\quad)
  if (numbered) { appendText(label, number + (isSpanish(cx.pre.babel) ? "." : ""), bf, { spaceFactor: 1000 }, false); label.push(glue(bf.params[QUAD])) }
  const box = hpack(label)
  const start = hyper && !numbered ? [box, sectionAnchorBox(anchorName, 0, run.k.sizes[size].baselineskip.width)] : [box]
  typeset(b.title, { start, font: bold, hangIndent: box.width, interLinePenalty: 10000, clubPenalty: headingClub, ...(heading.end ? { end: heading.end } : {}) }, outerParskip, size)
  // \@sect: \sectionmark, then \addcontentsline{toc}: \protected@write, a \write after the heading's lines,
  // with \nobreak after it while \if@nobreak holds (a heading right after a heading)
  if (numbered && headings) v.nodes.push(...marks.insert(sectionMarks(cls, !!run.k.ints.twoside, b.level, number, b.title, headings), afterHeading))
  if (!b.star) v.nodes.push(...contentsWrites(b.level, numbered ? number : null, b.title, anchorName, afterHeading))
  // \@xsect: \par \nobreak \vskip afterskip \@afterheading
  v.nodes.push(penalty(10000))
  v.vskip(lessParskip(cx, after))
  v.nobreak = true
  v.afterheadingEverypar = true
}

/** parskip.sty's patches of \@startsection and \@xsect: \advance\@tempskipa-\parskip before the skip */
const lessParskip = (cx: Ctx, g: GlueSpec): GlueSpec => (cx.pre.parskip ? addGlue(g, negate(cx.outerParskip)) : g)
