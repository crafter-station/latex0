// The memoir class (memoir.cls 2025): what it does its own way, for what is laid out. Its page layout commands
// (\setlrmarginsandblock, \setulmarginsandblock, \checkandfixthelayout: \setfillsize, \checkthelayout, \fixthelayout),
// its page styles (\makepagestyle: three \parbox fields in the head and in the foot), its chapters (\chapterstyle,
// \@makechapterhead), its sections (\M@sect) and \epigraph.

import type { ClassOptionData } from "../layout/classdata"
import { parseDimen, Scanner, times, type GlueSpec } from "../layout/dimen"
import { lineBreak } from "../layout/linebreak"
import { emptyBox, filGlue, fillGlue, glue, paramGlue, penalty, ssGlue, type BoxNode, type Node } from "../layout/nodes"
import { hpack, vpack } from "../layout/pack"
import type { ParagraphTrace } from "../trace/decisions"
import { withTextHeight } from "./classes"
import { inParagraph, type Block, type ListBlock } from "./blocks"
import type { Ctx } from "./context"
import { appendText, TEXT_LETTERS } from "./encodings"
import { centering, raggedleft, raggedright, sloppy, zeroskip } from "./kernel"
import { list, topCtx } from "./lists"
import { EMPTY_MARK, markboth, markright, markValue, type MarkValue } from "./marks"
import type { OutputHook } from "./output"
import { appendToVlist, closingBrace, mathEnv, paragraphInput, selectFont, TEXT_SYMBOLS, type FontAttrs } from "./paragraph"
import { clearpage } from "./sectioning"
import { dataFont } from "./data"
import { singleSpaced } from "./setspace"
import { SYMBOL_COMMANDS } from "./textsymbols"
import { Unsupported } from "./unsupported"
import { dimen, IGNORE_DEPTH, LOW_PENALTY, negate, plain } from "./vlist"
import { setgroup } from "./xcolor"
import { loadFont, QUAD, X_HEIGHT } from "../layout/font"

export const isMemoir = (cls: string) => cls === "memoir"

/** The chapter styles laid out (\makechapterstyle) */
export const CHAPTER_STYLES = ["default", "bianchi"] as const
export type ChapterStyle = typeof CHAPTER_STYLES[number]

/** What the preamble sets: \chapterstyle, the class's openany option, and the layout commands in order (with the font
 *  selected at each: the em and ex of its lengths) */
export interface Memoir {
  chapterstyle: ChapterStyle
  openany: boolean
  /** the em and ex of the class's own \normalsize roman (before fontenc or a font package): its skips' in ex, set as it loads */
  units?: { em: number; ex: number }
  layout: { cmd: string; args: string[]; font: unknown }[]
}

/** {a}{b}{c} after a command, null when the line is not exactly that */
function braced(line: string, cmd: string, n: number): string[] | null {
  const m = line.match(new RegExp(`^\\\\${cmd}${"\\s*\\{([^{}]*)\\}".repeat(n)}$`))
  return m ? m.slice(1).map((x) => x.trim()) : null
}

/** A preamble line of memoir's that is read: \chapterstyle and the layout commands */
export function memoirCommand(m: Memoir, line: string, font: unknown): boolean {
  const cs = braced(line, "chapterstyle", 1)
  if (cs) {
    if (!(CHAPTER_STYLES as readonly string[]).includes(cs[0])) throw new Unsupported(`memoir's \\chapterstyle{${cs[0]}}`)
    m.chapterstyle = cs[0] as ChapterStyle
    return true
  }
  for (const cmd of ["setlrmarginsandblock", "setulmarginsandblock"]) {
    const a = braced(line, cmd, 3)
    if (a) { m.layout.push({ cmd, args: a, font }); return true }
  }
  const fix = line.match(/^\\checkandfixthelayout\s*(?:\[([^\]]*)\])?$/)
  if (fix) {
    const alg = (fix[1] ?? "classic").trim()
    if (!["classic", "lines", "nearest", "fixed"].includes(alg)) throw new Unsupported(`memoir's ${line}`) // (an error in LaTeX)
    m.layout.push({ cmd: "checkandfixthelayout", args: [alg], font })
    return true
  }
  return false
}

/** \@settopoint: \divide#1\p@ \multiply#1\p@ */
const toPoint = (x: number) => Math.trunc(x / 65536) * 65536

const INCH = 4736286

/**
 * The layout commands, applied to the class's lengths.
 * \setlrmarginsandblock{spine}{edge}{ratio}: \setfillsize{\paperwidth less \binding}{*}{#1}{#2}{#3}, which gives
 * \textwidth, \spinemargin (plus \binding) and \foremargin; \setulmarginsandblock the same for \paperheight:
 * \textheight, \uppermargin, \lowermargin. \setfillsize with the block `*`: both margins given, the block is what is
 * left; one of them `*`, it is the other (times the ratio, when that is not `*`); both `*`, an error.
 * \checkandfixthelayout[alg]: \checkthelayout (the \textheight a whole number of lines: classic, lines, nearest; fixed
 * leaves it), \setulmargins{\uppermargin}{*}{*} (the lower margin: what is left), then \fixthelayout: \topmargin,
 * \oddsidemargin, \evensidemargin from the margins, the trims and the stock; \textwidth and the side margins whole points.
 */
export function memoirLayout(k: ClassOptionData, m: Memoir, units: (font: unknown) => { em: number; ex: number }): ClassOptionData {
  if (!m.layout.length) return k
  const d = { ...k.dimens }
  const star = (x: string) => x === "*"
  for (const { cmd, args, font } of m.layout) {
    const dim = (x: string) => { try { return parseDimen(x, units(font)) } catch { throw new Unsupported(`memoir's \\${cmd}{${args.join("}{")}}`) } }
    const factor = (f: string, x: number) => { if (!/^\d*\.?\d+$/.test(f)) throw new Unsupported(`memoir's \\${cmd}{${args.join("}{")}}`); return times(f, x) }
    if (cmd === "setlrmarginsandblock" || cmd === "setulmarginsandblock") {
      const lr = cmd === "setlrmarginsandblock"
      const [L, R, r] = args
      const total = lr ? d.paperwidth - d.binding : d.paperheight
      let a: number, b: number
      if (star(L) && star(R)) throw new Unsupported(`memoir's \\${cmd}{*}{*}{${r}}`) // (ambiguous: an error, the lengths zero)
      else if (star(L)) { b = dim(R); a = star(r) ? b : factor(r, b) }
      else if (star(R)) { a = dim(L); b = star(r) ? a : factor(r, a) }
      else { a = dim(L); b = dim(R) }
      const c = total - a - b
      if (lr) { d.textwidth = c; d.spinemargin = a + d.binding; d.foremargin = b }
      else { d.textheight = c; d.uppermargin = a; d.lowermargin = b }
      continue
    }
    // \checkthelayout: \divide\@tempdima\baselineskip, \@tempcnta=\@tempdima, \textheight \@tempcnta\baselineskip plus \topskip
    const bs = k.glue.baselineskip.width, topskip = k.glue.topskip.width
    const lines = (h: number) => Math.trunc(h / bs) * bs + topskip
    if (args[0] === "classic") d.textheight = lines(d.textheight)
    else if (args[0] === "lines") d.textheight = lines(d.textheight - bs)
    else if (args[0] === "nearest") d.textheight = lines(d.textheight - topskip + times("0.5", bs))
    // \setulmargins{\uppermargin}{*}{*}
    d.lowermargin = d.paperheight - d.textheight - d.uppermargin
    // (its errors: lengths too large for the stock or the page by more than 1pt, a foot below the page)
    if (d.stockwidth - d.trimedge - d.paperwidth < -65536 || d.paperwidth - d.foremargin - d.textwidth - d.spinemargin < -65536 || d.stockheight - d.trimtop - d.paperheight < -65536
      || d.paperheight - d.uppermargin - d.textheight - d.lowermargin < -65536 || d.uppermargin - d.headheight - d.headsep < -65536 || d.lowermargin - d.footskip < 0) throw new Unsupported("memoir's \\checkandfixthelayout: a layout that does not fit")
    // \fixthelayout
    d.topmargin = d.trimtop + d.uppermargin - d.headsep - d.headheight - INCH
    d.oddsidemargin = toPoint(d.stockwidth - d.trimedge - d.paperwidth + d.spinemargin - INCH)
    d.evensidemargin = toPoint(d.trimedge + d.foremargin - INCH)
    d.textwidth = toPoint(d.textwidth)
  }
  // (margins that leave no type block: LaTeX goes on with lengths that make no page)
  if (d.textwidth <= 0 || d.textheight <= k.glue.topskip.width) throw new Unsupported("memoir's margins: no type block left")
  // \begin{document}: \columnwidth\textwidth (two columns are not laid out)
  d.columnwidth = d.textwidth
  return withTextHeight({ ...k, dimens: d })
}

/** The page styles laid out (\makepagestyle): empty, plain (and chapter, its alias) and headings */
export const MEMOIR_PAGESTYLES = ["empty", "plain", "headings"]

/**
 * \@thehead and \@thefoot of one of memoir's page styles (\mem@ps@HLH), and the paragraphs their fields make at
 * shipout: \hss \hb@xt@<runwidth>{\m@mhe@dreset (\normalsize, \baselinestretch 1) \vbox{…}} \hss, the \vbox an
 * \hbox{\rlap{left}\hfill centre\hfill\llap{right}} of three \parbox[b]{<runwidth>} (\raggedright, \centering,
 * \raggedleft: \strut, the field, \strut; no struts in the empty style, whose boxes are then empty), with the head
 * rule after it (\hrule of \textwidth, 0pt high, \vskip-0pt) or the foot rule before it (\vskip-\footruleskip
 * \vskip-0pt, the \hrule, \vskip\footruleskip: .3\normalbaselineskip). plain: \thepage in the foot's centre;
 * headings: {\slshape\rightmark} left and \thepage right in the head, on even pages two-sided \thepage left and
 * {\slshape\leftmark} right
 */
export function memoirPage(cx: Ctx, style: string, even: boolean, thepage: string, marks: { left?: MarkValue; right?: MarkValue }): { head: Node[]; foot: Node[]; traces: ParagraphTrace[] } {
  if (!MEMOIR_PAGESTYLES.includes(style)) throw new Unsupported(`memoir's page style ${style}`)
  const traces: ParagraphTrace[] = []
  if (style === "empty") return { head: [], foot: [], traces }
  const k = singleSpaced(cx.run.k), sz = k.sizes.normalsize
  const width = k.dimens.textwidth
  const markSource = (m: MarkValue | undefined) => (m?.parts ?? []).map((p) => ("text" in p ? (m!.upper ? p.text.toUpperCase() : p.text) : "quad" in p ? "\\quad " : "\\ ")).join("")
  const slanted: FontAttrs = { ...cx.normalAttrs, shape: "sl" }
  const strut = (): Node => ({ kind: "rule", width: 0, height: sz.strut.height, depth: sz.strut.depth }) // \unhcopy\strutbox
  const field = (text: string, h: "l" | "c" | "r", attrs: FontAttrs = cx.normalAttrs): BoxNode => {
    const shape = h === "l" ? raggedright() : h === "c" ? centering() : raggedleft()
    const p = paragraphInput(text, k, "normalsize", cx.doc, { attrs, hsize: width, start: [emptyBox("hlist", 0), strut()], end: [strut()], amsmath: cx.pre.amsmath, ...sloppy(cx.romanFont.params[QUAD]), ...shape })
    const lb = lineBreak(p.list, p.params)
    traces.push(...p.notes, lb.trace)
    const list: Node[] = []
    let pd: number | null = IGNORE_DEPTH
    for (const x of lb.vlist) { if (x.kind === "hlist") pd = appendToVlist(list, x, pd, sz.baselineskip, k.glue.lineskip, k.dimens.lineskiplimit); else list.push(x) }
    return vpack(list)
  }
  type Field = [text: string, attrs?: FontAttrs]
  const fields = (l: Field, c: Field, r: Field) => {
    const lb = field(l[0], "l", l[1]), cb = field(c[0], "c", c[1]), rb = field(r[0], "r", r[1])
    return hpack([hpack([lb, ssGlue()], { exactly: 0 }), fillGlue(), cb, fillGlue(), hpack([ssGlue(), rb], { exactly: 0 })])
  }
  const none: Field = [""]
  const mark = (m: MarkValue | undefined): Field => [markSource(m), slanted]
  const headFields = style !== "headings" ? fields(none, none, none) : even ? fields([thepage], none, mark(marks.left)) : fields(mark(marks.right), none, [thepage])
  const footFields = style === "plain" ? fields(none, [thepage], none) : fields(none, none, none)
  const rule = (): Node => ({ kind: "rule", width, height: 0, depth: 0 })
  const placed = (b: BoxNode): Node[] => [ssGlue(), hpack([b], { exactly: width }), ssGlue()]
  const head = vpack([headFields, rule(), glue(0)])
  const skip = times("0.3", sz.baselineskip.width)
  const foot = vpack([glue(-skip), glue(0), rule(), glue(skip), footFields])
  return { head: placed(head), foot: placed(foot), traces }
}

/** the commands of a paragraph that memoir leaves the kernel's (the fonts' and the symbols'): the others are its own,
 *  or untried with it */
const MEMOIR_TEXT = new Set(["textbf", "textmd", "textit", "textsl", "textsc", "textup", "textrm", "textsf", "texttt", "textnormal", "emph", "noindent", "quad", "qquad", "enspace", "thinspace", "relax", "mbox",
  ...Object.keys(TEXT_LETTERS), ...Object.keys(TEXT_SYMBOLS), ...SYMBOL_COMMANDS])

/** Text in a memoir document: only what the class leaves alone (no footnotes, floats, boxes, references or displays) */
export function memoirText(text: string): void {
  if (/\$\$|\\\[|\\begin\s*\{/.test(text)) throw new Unsupported("a display or an environment in a paragraph in memoir")
  for (const m of text.matchAll(/\\([A-Za-z]+)/g)) if (!MEMOIR_TEXT.has(m[1])) throw new Unsupported(`\\${m[1]} in memoir`)
}

/** A block of a memoir document: paragraphs, headings, quote, page breaks and \thispagestyle; the rest is memoir's own
 *  (its floats and captions, contents, title, bibliography, lists, verse …), not laid out */
export function memoirBlock(b: Block): void {
  if (b.kind === "par") { if (b.floats) throw new Unsupported("a float in memoir"); memoirText(b.text); return }
  if (b.kind === "heading") { memoirText(b.title); return }
  if (b.kind === "list") {
    if (b.env !== "quote") throw new Unsupported(`${b.env} in memoir`)
    for (const it of b.items) for (const p of it.parts) { if (p.kind === "list") throw new Unsupported("a list in a quote in memoir"); memoirText(p.text) }
    return
  }
  // (memoir's \cleardoublepage is its \cleartorecto or \cleartoverso, the blank page in the cleared style: untried here)
  if (b.kind === "newpage" && b.cmd === "cleardoublepage") throw new Unsupported("\\cleardoublepage in memoir")
  if (b.kind === "newpage" || b.kind === "pagebreak" || b.kind === "epigraph") return
  if (b.kind === "pagestyle" && b.cmd === "thispagestyle" && (b.style === "plain" || b.style === "empty")) return
  throw new Unsupported(b.kind === "pagestyle" ? `\\${b.cmd}{${b.style}} in memoir` : `a ${b.kind} in memoir`)
}

/** \@chapapp: \chaptername (\appendix is not laid out in memoir) */
const chapapp = (cx: Ctx) => cx.pre.names.chaptername

/**
 * memoir's \chapter: \clearforchapter (openright, the default: \cleartorecto, \clearpage and two-sided on an even page
 * \hbox{}\thispagestyle{cleared}\newpage; openany: \clearpage), \thispagestyle{chapter} (plain's alias), \global\@topnum\z@,
 * \@afterindentfalse. \@chapter: \refstepcounter{chapter} (\c@secnumdepth > -1 in the main matter), \chaptermark
 * (\ps@headings's \createmark{chapter}: \markright one-sided, \markboth{…}{} two-sided, of \MakeUppercase{\@chapapp\
 * \thechapter. \ title}), \insertchapterspace (\addvspace{10pt} in the lof and lot), \@makechapterhead, \@afterheading,
 * then the toc line (\nobreak after its \write: \if@nobreak holds). \chapter*: \@makeschapterhead and \@afterheading.
 *
 * \@makechapterhead: \chapterheadstart (\vspace*{\beforechapskip}), then in a group \parskip\z@ \parindent\z@
 * \raggedright \normalfont, \printchaptername \chapternamenum \printchapternum \afterchapternum (\par\nobreak
 * \vskip\midchapskip), \interlinepenalty\@M, \printchaptertitle{title}, \afterchaptertitle (\par\nobreak\vskip
 * \afterchapskip); \@makeschapterhead has \printchapternonum in place of the name and number.
 * The default style: name and number \normalfont\huge\bfseries with \space between, the title \normalfont\Huge\bfseries.
 * bianchi: the name \normalfont\Large\sffamily\itshape\centering, the number \normalfont\huge \textit{…}; the title
 * \hrule \vskip\onelineskip \centering \normalfont\Huge\sffamily\textbf{title}\par, then \vskip\onelineskip \hrule
 * \vskip\afterchapskip (no \nobreak); with no number, \vphantom{\normalfont\huge\textit{9}} (a paragraph of its own)
 * and \afterchapternum.
 */
export function memoirChapter(cx: Ctx, b: Extract<Block, { kind: "heading" }>) {
  const m = cx.pre.memoir!
  const { contentsWrites, counters, doc, headings, marks, refs, run, typeset, v } = cx
  if (b.end) throw new Unsupported("a \\label in a chapter title in memoir")
  const k = run.k
  v.par()
  if (k.ints.twoside && !m.openany) cleartorecto(cx)
  else clearpage(cx)
  v.nodes.push({ kind: "whatsit", text: "", hook: "plain" satisfies OutputHook }, { kind: "whatsit", text: "", hook: "notop" satisfies OutputHook })
  const numbered = !b.star
  if (numbered) {
    counters.stepSectional(0)
    refs.label = counters.theSectional(0)
    doc.footnote = 0
    if (headings) {
      const cv = markValue([{ text: chapapp(cx) }, { ctrl: true }, { text: `${counters.theSectional(0)}. ` }, { ctrl: true }, { text: b.title }], true)
      v.nodes.push(...marks.insert(k.ints.twoside ? markboth(cv, EMPTY_MARK) : markright(cv), false))
    }
    // \insertchapterspace: \addtocontents{lof}{\protect\addvspace{10pt}}
    for (const f of ["lof", "lot"] as const) { const w = cx.tocFile.listSpace(f); if (w.kind === "whatsit") w.text = w.text.replace("{10\\p@ }", "{10pt}"); v.nodes.push(w) }
  }
  const zero = dimen(0)
  const sp = (n: number): GlueSpec => dimen(n)
  // \vspace*{\beforechapskip}: \hrule height0pt \nobreak \vskip \vskip\z@skip, keeping \prevdepth
  const pd = v.prevDepth
  v.nodes.push({ kind: "rule", width: null, height: 0, depth: 0 }, penalty(10000), plain(k.glue.beforechapskip), glue(0))
  v.prevDepth = pd
  // the head's first paragraph runs an \@afterheading \everypar still pending, which sets \@clubpenalty (in the head's group)
  const club = v.afterheadingEverypar ? k.ints.clubpenalty : v.club
  const hrule = () => { v.nodes.push({ kind: "rule", width: null, height: 26214, depth: 0 }); v.prevDepth = IGNORE_DEPTH } // \hrule: 0.4pt
  const number = numbered ? counters.theSectional(0) : ""
  if (m.chapterstyle === "default") {
    const ragged = () => ({ start: [hpack([])], ...raggedright(), clubPenalty: club })
    if (numbered) {
      typeset(`${chapapp(cx)} ${number}`, { ...ragged(), font: k.sizes.huge.bold }, zero, "huge")
      v.nodes.push(penalty(10000))
      v.vskip(k.glue.midchapskip)
    }
    typeset(b.title, { ...ragged(), font: k.sizes.Huge.bold, interLinePenalty: 10000 }, zero, "Huge")
    v.nodes.push(penalty(10000))
    v.vskip(k.glue.afterchapskip)
  } else {
    const sans: FontAttrs = { ...cx.normalAttrs, fam: "cmss" }
    const centred = () => ({ start: [hpack([])], ...centering(), clubPenalty: club })
    if (numbered) {
      // (\chapternamenum's \space in the name's font; the \par in \huge)
      typeset(`${chapapp(cx)} \\normalfont\\huge \\textit{${number}}`, { ...centred(), attrs: { ...sans, shape: "it" }, groups: true, topDecls: true, parSize: "huge" }, zero, "Large")
    } else {
      // \vphantom{\chapnumfont \textit{9}}: an \hbox of no width, as high and deep as the digit, in a paragraph of its
      // own (\leavevmode), ragged right, in the normal size
      const it = selectFont(k, "huge", { ...cx.normalAttrs, shape: "it" })
      const digit: Node[] = []
      appendText(digit, "9", it, { spaceFactor: 1000 }, false)
      const nine = hpack(digit)
      const box = hpack([])
      box.height = nine.height; box.depth = nine.depth
      typeset("", { start: [hpack([]), box], ...raggedright(), clubPenalty: club }, zero, "normalsize")
    }
    v.nodes.push(penalty(10000))
    v.vskip(k.glue.midchapskip)
    hrule()
    v.vskip(sp(k.dimens.onelineskip))
    typeset(`\\textbf{${b.title}}`, { ...centred(), attrs: sans, interLinePenalty: 10000 }, zero, "Huge")
    v.vskip(sp(k.dimens.onelineskip))
    hrule()
    v.vskip(k.glue.afterchapskip)
  }
  v.nobreak = true
  v.afterheadingEverypar = true
  v.afterindent = false
  // \addcontentsline{toc}{chapter}{\protect\chapternumberline{\thechapter}title}
  if (numbered) for (const w of contentsWrites(0, number, b.title, "", true)) { if (w.kind === "whatsit") w.text = w.text.replace("\\protect \\numberline {", "\\protect \\chapternumberline {"); v.nodes.push(w) }
}

/** \cleartorecto: \clearpage, then two-sided \ifodd\c@page\else \hbox{}\thispagestyle{cleared}\newpage\fi (cleared: empty's alias) */
function cleartorecto(cx: Ctx) {
  const { run, v } = cx
  clearpage(cx)
  const extra: Node[] = []
  appendToVlist(extra, hpack([]), v.prevDepth, run.k.sizes.normalsize.baselineskip, run.k.glue.lineskip, run.k.dimens.lineskiplimit)
  extra.push({ kind: "whatsit", text: "", hook: "empty" satisfies OutputHook }, filGlue(), penalty(-10000))
  v.nodes.push({ kind: "whatsit", text: "", hook: { cleardouble: extra } satisfies OutputHook })
}

/**
 * memoir's \section, \subsection and \subsubsection: its \@startsection (the kernel's, with \addvspace{-\parskip}
 * after the skip before, which adds nothing while \parskip has no natural width) and \M@sect, the kernel's \@sect
 * (numbered to \c@secnumdepth, section by default: \refstepcounter only then), then \@xsect with \vskip-\parskip
 * after the skip after. The styles: \normalfont\Large\bfseries\raggedright (\large, \normalsize), the skips
 * -3.5ex plus -1ex minus -.2ex and 2.3ex plus .2ex (-3.25ex … and 1.5ex plus .2ex), registers set as the class
 * loads: their ex is its own \normalsize roman's. \sectionmark: two-sided \ps@headings's \markright{\MakeUppercase{
 * \thesection. \ title}} (\c@secnumdepth > 0); one-sided, and the others, nothing.
 */
export function memoirHeading(cx: Ctx, heading: Extract<Block, { kind: "heading" }>) {
  const m = cx.pre.memoir!
  const { contentsWrites, counted, counters, headings, marks, noskipsecPar, outerParskip, refs, run, typeset, v } = cx
  if (heading.level >= 4) throw new Unsupported("\\paragraph or \\subparagraph in memoir")
  if (heading.end) throw new Unsupported("a \\label in a heading in memoir")
  if (outerParskip.width !== 0) throw new Unsupported("memoir's headings with a \\parskip of some width")
  const k = run.k
  const b = { ...heading, title: counted(heading.title) }
  const size = (["normalsize", "Large", "large", "normalsize"] as const)[b.level as 0 | 1 | 2 | 3]
  const glueOf = (x: string) => new Scanner(x, m.units!).scanGlue()
  let before = glueOf(b.level === 1 ? "-3.5ex plus -1ex minus -.2ex" : "-3.25ex plus -1ex minus -.2ex")
  const after = glueOf(b.level === 1 ? "2.3ex plus .2ex" : "1.5ex plus .2ex")
  noskipsecPar("a heading")
  v.par()
  const afterHeading = v.nobreak
  if (afterHeading) v.afterheadingEverypar = false // \if@nobreak \everypar{}
  const headingClub = v.afterheadingEverypar ? k.ints.clubpenalty : v.club
  v.afterindent = true
  if (before.width < 0) { before = negate(before); v.afterindent = false }
  if (!v.nobreak) { v.addpenalty(-300); v.addvspace(before) } // \@secpenalty (\addvspace{-\parskip}: nothing, the skip before is there)
  const numbered = !b.star && b.level <= k.ints.secnumdepth
  let number = ""
  if (numbered) { counters.stepSectional(b.level); number = counters.theSectional(b.level); refs.label = number }
  const bold = k.sizes[size].bold
  const bf = loadFont(dataFont(bold.name), bold.at)
  const label: Node[] = [glue(0)] // \hskip #3 (\secindent: \z@)
  if (numbered) { appendText(label, number, bf, { spaceFactor: 1000 }, false); label.push(glue(bf.params[QUAD])) } // \@seccntformat: \the<name>\quad
  const box = hpack(label)
  typeset(b.title, { start: [box], font: bold, ...raggedright(), hangIndent: box.width, interLinePenalty: 10000, clubPenalty: headingClub }, outerParskip, size)
  if (numbered && headings && b.level === 1 && k.ints.twoside) v.nodes.push(...marks.insert(markright(markValue([{ text: `${number}. ` }, { ctrl: true }, { text: b.title }], true)), afterHeading))
  if (!b.star) v.nodes.push(...contentsWrites(b.level, numbered ? number : null, b.title, "", afterHeading))
  // \@xsect: \par \nobreak \vskip afterskip \vskip-\parskip \@afterheading
  v.nodes.push(penalty(10000))
  v.vskip(after)
  v.vskip(negate(outerParskip))
  v.nobreak = true
  v.afterheadingEverypar = true
}

/**
 * The body as blocks, with memoir's \epigraph{text}{source} in vertical mode (after a blank line or a heading) a block
 * of its own: it ends no paragraph and starts none, so the text before it and after it is read apart.
 */
export function memoirBlocks(body: string, blocksOf: (body: string, afterList?: boolean) => Block[]): Block[] {
  const out: Block[] = []
  let rest = body, after = false
  for (let m = rest.match(/\\epigraph(?![A-Za-z])\s*/); m; m = rest.match(/\\epigraph(?![A-Za-z])\s*/)) {
    const before = rest.slice(0, m.index!)
    if (/(^|[^\\])%[^\n]*$/.test(before)) throw new Unsupported("\\epigraph in a comment's line")
    let at = m.index! + m[0].length
    const args: string[] = []
    for (let n = 0; n < 2; n++) {
      if (rest[at] !== "{") throw new Unsupported("\\epigraph without its {text}{source}")
      const close = closingBrace(rest, at)
      args.push(rest.slice(at + 1, close))
      at = close + 1
      if (n === 0) while (/\s/.test(rest[at] ?? "")) { if (/^\n[ \t]*\n/.test(rest.slice(at))) throw new Unsupported("\\epigraph without its {text}{source}"); at++ }
    }
    if (inParagraph(before)) throw new Unsupported("\\epigraph in a paragraph")
    out.push(...blocksOf(before, after), { kind: "epigraph", text: args[0], source: args[1], blank: /\n[ \t]*\n\s*$/.test(before) })
    rest = rest.slice(at)
    after = true // (\end{flushright}'s \@doendpe)
  }
  out.push(...blocksOf(rest, after))
  return out
}

/**
 * memoir's \epigraph{text}{source} in vertical mode: \vspace{\beforeepigraphskip}, then in a group \epigraphsize
 * (\small), \begin{flushright} with a minipage of \epigraphwidth (.4\textwidth as the class loaded) holding
 * \@epitext{text}\\ \@episource{source}, \end{flushright}, \vspace{\afterepigraphskip} (both .5\baselineskip as the
 * class loaded). \@epitext: a minipage of \epigraphwidth with \begin{flushleft} text\par \rule[.5ex]{\epigraphwidth}
 * {\epigraphrule} \end{flushleft}; \@episource: one with \begin{flushright} source\par \end{flushright}. Each minipage
 * is centred on the axis ($\vcenter$), its paragraphs \sloppy; the inner ones' \clubpenalty is \@clubpenalty
 * (\if@nobreak is false in a minipage), the outer one's what the flushright's \everypar set. \end{flushright}'s
 * \@doendpe holds after the group: text right after the epigraph, with no blank line, is not indented.
 */
export function epigraph(cx: Ctx, b: Extract<Block, { kind: "epigraph" }>) {
  const { decisions, doc, run, v } = cx
  const k = run.k
  if (run.runIn || run.noskipsec) throw new Unsupported("\\epigraph right after a run-in heading")
  for (const t of [b.text, b.source]) {
    if (/\n[ \t]*\n|\\par(?![A-Za-z])|\\\\/.test(t)) throw new Unsupported("an \\epigraph of more than one paragraph or line")
    memoirText(t)
  }
  if (k.dimens.epigraphrule <= 0) throw new Unsupported("an \\epigraph with no rule")
  if (b.blank) v.par()
  const vspace = (g: GlueSpec) => { v.vskip(g); v.vskip(dimen(0)) } // \vspace in vertical mode: \vskip, \vskip\z@skip
  vspace(k.glue.beforeepigraphskip)
  const size = "small" as const, sz = k.sizes[size]
  const font = selectFont(k, size, cx.normalAttrs)
  const units = { em: font.params[QUAD], ex: font.params[X_HEIGHT] }
  const w = k.dimens.epigraphwidth, labelsep = k.dimens.labelsep
  const squeezed = (t: string) => t.replace(/\s+/g, " ").trim()
  /** \box\@labels of a trivlist's \item: \hskip\itemindent \hskip-\labelwidth \hskip-\labelsep, the empty label in \labelwidth, \hskip\labelsep; \penalty\z@ */
  const label = (): Node[] => [hpack([glue(0), glue(0), glue(-labelsep), hpack(setgroup([]), { exactly: 0 }), glue(labelsep)]), penalty(0)]
  /** a minipage's \vbox, centred on the axis: make_vcenter (§ 736) in \small's math fonts, between math nodes */
  const vcenter = (list: Node[]): Node[] => {
    const box = vpack(list)
    const delta = box.height + box.depth
    box.height = mathEnv(k, size, cx.pre.amsmath).fonts[0][2]!.params[22] + (delta % 2 ? Math.trunc((delta + 1) / 2) : delta / 2)
    box.depth = delta - box.height
    return [{ kind: "math", on: true, width: 0 }, box, { kind: "math", on: false, width: 0 }]
  }
  /** a paragraph of a minipage: \@parboxrestore's \sloppy, \parindent and \parskip zero */
  const inner = (list: Node[], pd: number | null, text: string, start: Node[], shape: object, club: number): number | null => {
    // new_graf in internal vertical mode adds \parskip only to a list that is not empty, and so does LaTeX's restart
    if (list.length) list.push(paramGlue("parskip", glue(0)), paramGlue("parskip", glue(0)))
    const p = paragraphInput(text, k, size, doc, { attrs: cx.normalAttrs, hsize: w, start, amsmath: cx.pre.amsmath, groups: true, ...sloppy(units.em), clubPenalty: club, ...shape })
    const lb = lineBreak(p.list, p.params)
    decisions.push(...p.notes, lb.trace)
    for (const x of lb.vlist) { if (x.kind === "hlist") pd = appendToVlist(list, x, pd, sz.baselineskip, k.glue.lineskip, k.dimens.lineskiplimit); else list.push(x) }
    return pd
  }
  const justified = { leftSkip: zeroskip("leftskip"), rightSkip: zeroskip("rightskip") }
  // \@epitext: the text ragged right, then the rule in a paragraph of its own; \end{flushleft}'s \@endparpenalty (the
  // skip after it is \end{minipage}'s \unskip's)
  const textList: Node[] = []
  let pd = inner(textList, IGNORE_DEPTH, squeezed(b.text), label(), raggedright(), k.ints.clubpenalty)
  const lift = parseDimen(".5ex", units)
  inner(textList, pd, "", [hpack([]), hpack([{ kind: "rule", width: w, height: k.dimens.epigraphrule + lift, depth: -lift }])], raggedright(), k.ints.clubpenalty)
  textList.push(penalty(-LOW_PENALTY))
  // \@episource: the source ragged left
  const sourceList: Node[] = []
  inner(sourceList, IGNORE_DEPTH, squeezed(b.source), label(), raggedleft(), k.ints.clubpenalty)
  sourceList.push(penalty(-LOW_PENALTY))
  // the minipage around them: one paragraph, the text's box, \\ (\nobreak\hfil\break), the source's box
  const outerClub = v.nobreak ? 10000 : k.ints.clubpenalty
  const outerList: Node[] = []
  const textBox = vcenter(textList)
  // (the source's paragraph is broken before the one it stands in ends)
  const sourceBox = vcenter(sourceList)
  inner(outerList, IGNORE_DEPTH, "", [hpack([]), ...textBox, penalty(10000), filGlue(), penalty(-10000), ...sourceBox], justified, outerClub)
  const flushright: ListBlock = { kind: "list", env: "flushright", items: [{ label: null, parts: [{ kind: "text", text: "", start: "label", nodes: vcenter(outerList) }] }], inPar: false, blank: false }
  list(cx, flushright, { ...topCtx(cx), size })
  // \end{flushright}'s \@doendpe: its \par and \everypar outlast the group (text right after is not indented)
  v.afterheadingEverypar = false
  v.endpePar = v.doendpe = v.endpeEverypar = true
  vspace(k.glue.afterepigraphskip)
}
