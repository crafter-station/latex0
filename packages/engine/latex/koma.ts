// The KOMA-Script classes scrartcl and scrreprt (koma-script 3.x): what they do their own way. Their sectioning
// (\DeclareSectionCommand's \scr@startsection: the headings in \sectfont, \normalcolor\sffamily\bfseries, ragged
// right, the number followed by \enskip).

import { xnOverD } from "../layout/arith"
import type { SizeCommand } from "../layout/classdata"
import { Scanner } from "../layout/dimen"
import { QUAD, X_HEIGHT } from "../layout/font"
import { lineBreak } from "../layout/linebreak"
import { FIL, filGlue, glue, paramGlue, penalty, type Node } from "../layout/nodes"
import { hpack } from "../layout/pack"
import type { Block } from "./blocks"
import { tabular } from "./boxes"
import type { Ctx } from "./context"
import { appendText } from "./encodings"
import { labelName } from "./hyperref"
import { today } from "./frontmatter"
import { centering, raggedright } from "./kernel"
import type { OutputHook } from "./output"
import { paragraphInput, selectFont, type FontAttrs } from "./paragraph"
import { clearpage } from "./sectioning"
import { preamble, tabularLines } from "./tabular"
import { Unsupported } from "./unsupported"
import { addGlue, dimen, LOW_PENALTY } from "./vlist"
import { verticalMaterial } from "./vmode"
import { setgroup } from "./xcolor"

/** \DeclareSectionCommand's settings (scrartcl.cls): the size (\size@<name>, headings=normal), indent, beforeskip, afterskip */
const KOMA_SECTIONS: Record<number, { size: "Large" | "large" | "normalsize"; before: string; after: string; indent: boolean }> = {
  1: { size: "Large", before: "-3.5ex plus -1ex minus -.2ex", after: "2.3ex plus.2ex", indent: false },
  2: { size: "large", before: "-3.25ex plus -1ex minus -.2ex", after: "1.5ex plus .2ex", indent: false },
  3: { size: "normalsize", before: "-3.25ex plus -1ex minus -.2ex", after: "1.5ex plus .2ex", indent: false },
  4: { size: "normalsize", before: "3.25ex plus1ex minus.2ex", after: "-1em", indent: false },
  5: { size: "normalsize", before: "3.25ex plus1ex minus .2ex", after: "-1em", indent: true },
}

/**
 * KOMA-Script's \scr@startsection and \@sect: \par, \@secpenalty and the beforeskip (negative: no indentation after);
 * a displayed heading is #6{\nobreak\interlinepenalty\@M \sectionlinesformat{name}{indent}{\@svsec}{title}\@@par} with #6
 * \raggedsection\normalfont\sectfont\nobreak\size@<name> (two \nobreak in vertical mode before it), \sectionlinesformat
 * \@hangfrom{\hskip indent\@svsec}, \@svsec \the<name>\autodot\enskip; then the toc line (none for the starred form)
 * and \scr@xsect: \par\nobreak\vskip afterskip\@afterheading. A run-in heading (\paragraph, \subparagraph, afterskip
 * -1em) goes in place of its paragraph's indentation: the two \nobreak, \hskip indent (\subparagraph's \scr@parindent,
 * 1em of the heading's font), the title, the toc line (\nonumberline when not numbered), then \hskip 1em
 */
export function komaHeading(cx: Ctx, heading: Extract<Block, { kind: "heading" }>) {
  const { bodyUnits, contentsWrites, counted, counters, noskipsecPar, outerParskip, refs, romanFont, run, typeset, v } = cx
  if (heading.level === 0) throw new Unsupported("\\chapter or \\part in KOMA-Script")
  if (cx.pre.hyper) throw new Unsupported("hyperref with KOMA-Script")
  const def = KOMA_SECTIONS[heading.level]
  const skip = (x: string) => new Scanner(x, bodyUnits).scanGlue()
  noskipsecPar("a heading")
  run.noskipsec = false
  v.par()
  if (run.runIn) throw new Unsupported("two run-in headings in a row")
  const afterHeading = v.nobreak
  if (afterHeading) v.afterheadingEverypar = false // \if@nobreak \everypar{}
  let before = skip(def.before)
  v.afterindent = true
  if (before.width < 0) { before = { ...before, width: -before.width, stretch: -before.stretch, shrink: -before.shrink }; v.afterindent = false }
  if (!afterHeading) { v.addpenalty(-300); v.addvspace(before) }
  // (the reference key: \@currentlabelname, the title \detokenize'd)
  if (!heading.star) refs.name = labelName(counted(heading.title).trim(), false)
  const numbered = !heading.star && heading.level <= run.k.ints.secnumdepth
  if (!numbered) counters.resetWithin(heading.level) // (\@stpelt over \cl@<name>, since KOMA-Script 3.31)
  let number = ""
  if (numbered) { counters.stepSectional(heading.level); number = counters.theSectional(heading.level); refs.label = number; refs.href = `${counters.anchorType(heading.level)}.${counters.theHSectional(heading.level)}` }
  const T1 = run.k.ints.T1 ? "T1" : "OT1"
  const attrs: FontAttrs = { ...cx.normalAttrs, enc: T1, fam: "cmss", ser: "bx", shape: "n" }
  const font = selectFont(run.k, def.size, attrs)
  /** \@svsec: \the<name>\autodot\enskip (\hskip.5em) in the heading's font */
  const svsec = (): Node[] => {
    if (!numbered) return []
    const l: Node[] = []
    appendText(l, number, font, { spaceFactor: 1000 }, false)
    l.push(glue(new Scanner(".5em", { em: font.params[QUAD], ex: 0 }).scanDimen().value))
    return l
  }
  // (\scr@parindent: the paragraph indentation \setparsizes was given, 1em, or 0pt with parskip=)
  const indent = def.indent && run.k.dimens.parindent !== 0 ? new Scanner("1em", { em: font.params[QUAD], ex: font.params[X_HEIGHT] }).scanDimen().value : 0
  if (!def.after.startsWith("-")) {
    const title = counted(heading.title)
    const headingClub = v.afterheadingEverypar ? run.k.ints.clubpenalty : v.club
    v.nodes.push(penalty(10000), penalty(10000))
    const box = hpack([glue(indent), ...svsec()]) // \@hangfrom{\hskip #2#3}
    typeset(title, { start: [box], attrs, ...raggedright(), parFillSkip: paramGlue("parfillskip", filGlue()), hangIndent: box.width, interLinePenalty: 10000, clubPenalty: headingClub, ...(heading.end ? { end: heading.end } : {}) }, outerParskip, def.size)
    if (!heading.star) v.nodes.push(...contentsWrites(heading.level, numbered ? number : null, title, "", afterHeading))
    v.nodes.push(penalty(10000))
    v.vskip(skip(def.after))
    v.nobreak = true
    v.afterheadingEverypar = true
    return
  }
  // run in: \@nobreakfalse \global\@noskipsectrue, and \everypar's heading
  v.nobreak = false
  run.runIn = (em = romanFont.params[QUAD]) => {
    const title = counted(heading.title).trim()
    const head = paragraphInput(title, run.k, def.size, cx.doc, { start: [penalty(10000), penalty(10000), glue(indent), ...svsec()], attrs, amsmath: cx.pre.amsmath }).list
    if (!heading.star) head.push(cx.tocFile.write(heading.level as 4, numbered ? number : null, numbered ? title : `\\protect \\nonumberline ${title}`))
    head.push(glue(em)) // \hskip -\@tempskipa
    return head
  }
}

/** KOMA-Script's title data beside \title, \author and \date: \subject, \subtitle, \publishers */
export interface KomaTitle { subject?: string; subtitle?: string; publishers?: string }

/**
 * KOMA-Script's \maketitle with titlepage=false: in a group, \next@tdpage (\clearpage, \setparsizes{\z@}{\z@}{\z@\@plus
 * 1fil}, \thispagestyle{empty}), \@maketitle: \global\@topnum\z@, \null, \vskip 2em, a center environment with
 * {\usekomafont{subject}{subject\par}}\vskip1.5em (\normalfont\bfseries\Large), {\usekomafont{title}{\huge title\par}}
 * (\sectfont), \vskip.5em, {\usekomafont{subtitle} subtitle\par} (\sectfont\large), \vskip1em, {\Large \lineskip.5em
 * tabulars of the authors\par}, \vskip1em, {\Large date\par}, \vskip\z@\@plus1em, {\Large publishers\par}; \par
 * \vskip2em; then \thispagestyle{\titlepagestyle} (plain), \setcounter{footnote}{0}
 */
export function komaMaketitle(cx: Ctx) {
  const { decisions, doc, epoch, romanFont, run } = cx
  const title = cx.pre.title, koma = cx.pre.komaTitle
  if (!title.title) throw new Unsupported("\\maketitle without \\title")
  if (/\\(?:thanks|footnote)(?![A-Za-z])/.test(`${title.title}${title.author ?? ""}${title.date ?? ""}${Object.values(koma).join("")}`)) throw new Unsupported("\\thanks in KOMA-Script's \\maketitle")
  if (run.k.ints.twocolumn || run.k.ints.twoside) throw new Unsupported(`KOMA-Script's \\maketitle ${run.k.ints.twocolumn ? "in two columns" : "two-sided"}`)
  if (run.runIn || run.noskipsec) throw new Unsupported("\\maketitle right after a run-in heading")
  const hook = (h: OutputHook): Node => ({ kind: "whatsit", text: "", hook: h })
  const em = (n: string, f = romanFont) => new Scanner(n, { em: f.params[QUAD], ex: f.params[X_HEIGHT] }).scanDimen().value
  const v = cx.v
  v.par()
  v.nobreak = false
  clearpage(cx) // (\next@tdpage's \thispagestyle{empty} gives way to \titlepagestyle's plain, below)
  // \setparsizes{\z@}{\z@}{\z@\@plus 1fil} in the group (the center's \centering sets \parindent\z@ again)
  const outerParskip = cx.outerParskip
  cx.outerParskip = dimen(0)
  try {
    v.nodes.push(hook("notop"))
    v.box(hpack([]), run.k.sizes.normalsize.baselineskip) // \null
    v.vskip(dimen(em("2em")))
    // \begin{center}: \trivlist, \centering, \item\relax
    const topsepadd = addGlue(run.k.glue.topsep, run.k.glue.partopsep)
    v.addpenalty(-LOW_PENALTY); v.addvspace(topsepadd); v.addvspace(dimen(0))
    const labelsep = run.k.dimens.labelsep
    let first: Node[] | undefined = [hpack([glue(0), glue(0), glue(-labelsep), hpack(setgroup([]), { exactly: 0 }), glue(labelsep)]), penalty(0)]
    const club = run.k.ints.clubpenalty
    const par = (src: string, size: SizeCommand, attrs: FontAttrs) => {
      verticalMaterial(cx, src, { size, attrs, align: "centering" }, { ...(first ? { first } : {}), club })
      first = undefined
    }
    const sf: FontAttrs = { ...cx.normalAttrs, fam: "cmss", ser: "bx" }
    if (koma.subject) { par(koma.subject, "Large", { ...cx.normalAttrs, ser: "bx" }); v.vskip(dimen(em("1.5em"))) }
    par(title.title, "huge", sf)
    v.vskip(dimen(em(".5em")))
    if (koma.subtitle) par(koma.subtitle, "large", sf)
    v.vskip(dimen(em("1em")))
    // {\Large \lineskip .5em \begin{tabular}[t]{c}\@author\end{tabular}\par}, \and: \end{tabular}\hskip 1em \@plus.17fil\begin{tabular}[t]{c}
    const large = selectFont(run.k, "Large", cx.normalAttrs)
    const author = title.author ?? ""
    if (/&|\\(?:hline|cline|multicolumn)(?![A-Za-z])/.test(author)) throw new Unsupported(`\\author{${author}}`)
    const start: Node[] = [...(first ?? [hpack([])])]
    first = undefined
    author.split(/\\and(?![A-Za-z])/).map((a) => tabularLines(a)).forEach((rows, i) => {
      if (i) start.push(glue(em("1em", large), xnOverD(65536, 11141, 65536), FIL))
      start.push(tabular(cx, rows, preamble("c"), "Large", "t"))
    })
    const ap = paragraphInput("", run.k, "Large", doc, { ...centering(), start, clubPenalty: club, amsmath: cx.pre.amsmath })
    const ab = lineBreak(ap.list, ap.params)
    decisions.push(ab.trace)
    v.paragraph(ab.vlist, cx.outerParskip, run.k.sizes.Large.baselineskip, dimen(em(".5em", large)))
    v.vskip(dimen(em("1em")))
    const date = (title.date ?? "\\today").replace(/\\today(?![A-Za-z])\s*/g, today(epoch, cx.pre.babel)).trim()
    if (date) par(date, "Large", cx.normalAttrs)
    v.vskip({ width: 0, stretch: em("1em"), stretchOrder: 0, shrink: 0, shrinkOrder: 0 })
    if (koma.publishers) par(koma.publishers, "Large", cx.normalAttrs)
    v.endtrivlist(cx.outerParskip, cx.outerParskip, topsepadd)
    v.vskip(dimen(em("2em")))
  } finally { cx.outerParskip = outerParskip }
  v.nodes.push(hook("plain")) // \thispagestyle{\titlepagestyle}
  doc.footnote = 0
}
