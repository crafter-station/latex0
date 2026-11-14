// The amsart class (amscls/amsart.cls, v2.20.6): what it does its own way. Its page styles: \ps@plain's
// foot and \ps@headings's running heads in \normalfont\scriptsize, \ps@firstpage (\maketitle's) with
// \@serieslogo\hss as its head.

import { xnOverD } from "../layout/arith"
import type { ClassOptionData } from "../layout/classdata"
import { roundDecimals, Scanner, type GlueSpec } from "../layout/dimen"
import { loadFont, QUAD, SPACE, SPACE_SHRINK, SPACE_STRETCH, X_HEIGHT, type Font } from "../layout/font"
import { interwordGlue, sfCode, spaceGlue } from "../layout/hmode"
import { lineBreak } from "../layout/linebreak"
import { filGlue, glue, kern, penalty, ssGlue, type Node } from "../layout/nodes"
import { hpack } from "../layout/pack"
import type { Block, ListBlock } from "./blocks"
import type { Ctx } from "./context"
import { dataFont } from "./data"
import { appendText } from "./encodings"
import { today } from "./frontmatter"
import { centering } from "./kernel"
import { list, topCtx } from "./lists"
import { markboth, type MarkValue } from "./marks"
import type { OutputHook } from "./output"
import { amsAdminFootnote, hlistInput, paragraphInput, selectFont, type FontAttrs } from "./paragraph"
import { vtop } from "./tabular"
import { Unsupported } from "./unsupported"
import { addGlue, IGNORE_DEPTH, LOW_PENALTY as LOW, negate, VerticalList } from "./vlist"

/**
 * \@thehead and \@thefoot of a page in amsart's page style `style`: \ps@empty, \ps@plain (\@oddfoot{\normalfont
 * \scriptsize\hfil\thepage\hfil}), \ps@firstpage (plain's, \@oddhead{\@serieslogo\hss}, the logo empty) and
 * \ps@headings (\@evenhead{\normalfont\scriptsize\rlap{\thepage}\hfil\leftmark{}{}\hfil}, \@oddhead{\normalfont
 * \scriptsize\hfil\rightmark{}{}\hfil\llap{\thepage}}); `marks`: \leftmark's (the page's \topmark) and \rightmark's
 * (its \botmark)
 */
export function amsHeadFoot(k: ClassOptionData, style: string, even: boolean, thepage: string, marks: { left: MarkValue | undefined; right: MarkValue | undefined }): { head: Node[]; foot: Node[] } {
  const f = k.sizes.scriptsize.font, font = loadFont(dataFont(f.name), f.at)
  const number = () => { const l: Node[] = []; appendText(l, thepage, font, { spaceFactor: 1000 }, false); return l }
  if (style === "empty") return { head: [], foot: [] }
  if (style === "plain") return { head: [], foot: [filGlue(), ...number(), filGlue()] }
  if (style === "firstpage") return { head: [ssGlue()], foot: [filGlue(), ...number(), filGlue()] }
  // (\rlap: \hb@xt@\z@{…\hss}; \llap: \hb@xt@\z@{\hss…})
  if (style !== "headings") throw new Unsupported(`\\pagestyle{${style}} in amsart`)
  if (even) return { head: [hpack([...number(), ssGlue()], { exactly: 0 }), filGlue(), ...amsMarkText(k, marks.left), filGlue()], foot: [] }
  return { head: [filGlue(), ...amsMarkText(k, marks.right), filGlue(), hpack([ssGlue(), ...number()], { exactly: 0 })], foot: [] }
}

/** the space factor after a horizontal list (§ 1034: a character's \sfcode, 1000 after a box or a formula) */
function spaceFactorAfter(list: Node[]): number {
  let sf = 1000
  for (const n of list) {
    if (n.kind === "char") {
      for (const c of n.ligature ? [...n.text].map((x) => x.charCodeAt(0)) : [n.char]) {
        const s = sfCode(c)
        if (s === 1000) sf = 1000; else if (s < 1000) { if (s > 0) sf = s } else sf = sf < 1000 ? 1000 : s
      }
    } else if (n.kind === "hlist" || n.kind === "vlist" || n.kind === "rule" || (n.kind === "math" && !n.on)) sf = 1000
  }
  return sf
}

/** amsart's sectioning commands: \@startsection{name}{level}{\z@}{beforeskip}{afterskip}{style} */
const AMS_SECTIONS: Record<number, { before: string; after: string; shape: "sc" | "n" | "it"; ser: "m" | "bx" }> = {
  1: { before: ".7\\linespacing plus\\linespacing", after: ".5\\linespacing", shape: "sc", ser: "m" },
  2: { before: ".5\\linespacing plus.7\\linespacing", after: "-.5em", shape: "n", ser: "bx" },
  3: { before: ".5\\linespacing plus.7\\linespacing", after: "-.5em", shape: "it", ser: "m" },
  4: { before: "0pt", after: "-\\fontdimen2", shape: "n", ser: "m" },
  5: { before: "0pt", after: "-\\fontdimen2", shape: "n", ser: "m" },
}

/**
 * amsart's \@startsection and \@sect. \section: {.7\linespacing\@plus\linespacing}{.5\linespacing}{\normalfont\scshape
 * \centering}, the title hanging from \@svsec (\textup{\mdseries\thesection.\enspace}: no \enspace for an empty title);
 * \subsection (\bfseries), \subsubsection (\itshape): {.5\linespacing\@plus.7\linespacing}{-.5em}, run in: \@svsechd puts
 * \@svsec, the title, \unskip\@addpunct. and the toc line in place of the next paragraph's indentation, then \hskip.5em;
 * \paragraph and \subparagraph (\normalfont): {\z@}{-\fontdimen2\font}. Starred: no number, still the toc line
 * (\@tocwrite, \tocsection{}{}{title}). No marks: amsart's \sectionmark is \@gobble
 */
export function amsHeading(cx: Ctx, heading: Extract<Block, { kind: "heading" }>) {
  const { counted, counters, noskipsecPar, outerParskip, romanFont, run, typeset, v } = cx
  if (heading.level === 0) throw new Unsupported("\\part in amsart")
  if (cx.pre.hyper) throw new Unsupported("hyperref with amsart")
  const def = AMS_SECTIONS[heading.level]
  const linespacing = run.k.sizes.normalsize.baselineskip.width // (\linespacing: the \normalsize \baselineskip as the class loads)
  const units = { em: romanFont.params[QUAD], ex: romanFont.params[X_HEIGHT] }
  const skip = (x: string) => new Scanner(x, { ...units, internal: (n) => (n === "linespacing" ? { level: "dimen", value: linespacing } : undefined) }).scanGlue()
  noskipsecPar("a heading")
  run.noskipsec = false
  v.par()
  if (run.runIn) throw new Unsupported("two run-in headings in a row")
  const afterHeading = v.nobreak
  if (afterHeading) v.afterheadingEverypar = false // \if@nobreak \everypar{}
  else { v.addpenalty(-300); v.addvspace(skip(def.before)) } // \@secpenalty
  v.afterindent = true
  const numbered = !heading.star && heading.level <= run.k.ints.secnumdepth
  let number = ""
  // (\refstepcounter: \@currentlabel, \@currentHref)
  if (numbered) { counters.stepSectional(heading.level); number = counters.theSectional(heading.level); cx.refs.label = number; cx.refs.href = `${counters.anchorType(heading.level)}.${counters.theHSectional(heading.level)}` }
  const T1 = run.k.ints.T1 ? "T1" : "OT1"
  const attrs: FontAttrs = { ...cx.normalAttrs, enc: T1, ser: def.ser, shape: def.shape }
  /** \@svsec in the heading's font: \textup{\@secnumfont number punct} (\@secnumfont \mdseries, \bfseries for an empty
   *  \subsection title), punct .\enspace, or . for an empty title */
  const svsec = (title: string): Node[] => {
    if (!numbered) return []
    // (\def\@secnumfont{\bfseries} for an empty \subsection title, which the later headings keep: no group ends it)
    if (heading.level === 2 && !title) run.amsSecnumBold = true
    const f = selectFont(run.k, "normalsize", { ...attrs, shape: "n", ser: run.amsSecnumBold ? "bx" : "m" })
    const l: Node[] = []
    appendText(l, `${number}${title || def.after.startsWith("-") ? "." : ""}`, f, { spaceFactor: 1000 }, false)
    if (title) l.push(kern(new Scanner(".5em", { em: f.params[QUAD], ex: 0 }).scanDimen().value, true))
    // (\textup's \check@icr after the number, in an upright heading font: \/)
    else if (def.shape !== "it") { const last = l[l.length - 1]; if (last?.kind === "char") l.push(kern(f.chars.get(last.char)?.italic ?? 0, true)) }
    return l
  }
  const toc = (title: string, nobreak: boolean) => [cx.tocFile.writeAms(heading.level as 1, numbered ? number : "", title), ...(nobreak ? [penalty(10000)] : [])]
  if (!def.after.startsWith("-")) {
    const b = { ...heading, title: counted(heading.title) }
    const headingClub = v.afterheadingEverypar ? run.k.ints.clubpenalty : v.club
    const box = hpack([glue(0), ...svsec(b.title.trim())]) // \@hangfrom{\hskip #3\relax\@svsec}
    typeset(b.title, { start: [box], attrs, ...centering(), hangIndent: box.width, interLinePenalty: 10000, clubPenalty: headingClub, ...(heading.end ? { end: heading.end } : {}) }, outerParskip)
    v.nodes.push(...toc(b.title, afterHeading))
    // \@xsect: \par \nobreak \vskip afterskip \@afterheading
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
    const head = paragraphInput(title, run.k, "normalsize", cx.doc, { start: [glue(0), ...svsec(title)], attrs, amsmath: cx.pre.amsmath }).list
    if (head[head.length - 1]?.kind === "glue") head.pop() // \unskip
    if (title && spaceFactorAfter(head) <= 1000) appendText(head, ".", selectFont(run.k, "normalsize", attrs), { spaceFactor: 1000 }, false) // \@addpunct.
    head.push(...toc(title, false))
    // \unskip \@tempskipa #5 \hskip -\@tempskipa, in the paragraph's font
    head.push(heading.level >= 4 ? glue(romanFont.params[SPACE]) : glue(new Scanner(".5em", { em, ex: 0 }).scanDimen().value))
    return head
  }
}

/** amsart's top matter, as \title, \author, \address … and \maketitle read it */
export interface AmsTop {
  /** \title[short]{title} (\shorttitle the title when not given) */
  title: { short: string; text: string } | null
  /** \author[short]{name}, in order */
  authors: { short: string; name: string }[]
  /** \addresses: \address, \curraddr, \email, \urladdr [opt]{text}, and before each author but the first, his \author{} */
  addresses: ({ kind: "author" } | { kind: "address" | "curraddr" | "email" | "urladdr"; opt: string; text: string })[]
  date: string | null
  subjclass: { edition: string; text: string } | null
  keywords: string | null
  thanks: string[]
}

export const AMS_TOP_COMMANDS = ["title", "author", "address", "curraddr", "email", "urladdr", "date", "subjclass", "keywords", "thanks", "dedicatory", "translator", "contrib", "commby"]

/** the braced group at `i` (after spaces), and the index after it */
function braced(s: string, i: number): [string, number] | null {
  while (s[i] === " " || s[i] === "\t" || s[i] === "\n") i++
  if (s[i] !== "{") return null
  let depth = 0
  for (let j = i; j < s.length; j++) {
    if (s[j] === "\\") { j++; continue }
    if (s[j] === "{") depth++
    else if (s[j] === "}" && --depth === 0) return [s.slice(i + 1, j), j + 1]
  }
  return null
}

/**
 * The top-matter commands in `s` (the preamble, or the body before \maketitle) taken out into `top`: each where it
 * is a line of its own and, in the body, where vertical mode reads it (after a blank line, the document's start or
 * another). Returns the rest.
 */
export function amsTopMatter(s: string, top: AmsTop, body: boolean): string {
  const re = new RegExp(`(^|\\n)([ \\t]*)\\\\(${AMS_TOP_COMMANDS.join("|")})(?![A-Za-z])`, "g")
  let out = "", at = 0, vertical = false
  for (let m = re.exec(s); m; m = re.exec(s)) {
    const start = m.index + m[1].length
    // (in the body: vertical mode, after a blank line or another top-matter line)
    const before = s.slice(0, start)
    if (body && !(/^\s*$/.test(before) || (vertical && /^\s*$/.test(s.slice(at, start))) || /\n[ \t]*\n\s*$/.test(before))) { out += s.slice(at, re.lastIndex); at = re.lastIndex; vertical = false; continue }
    const cmd = m[3]
    let i = re.lastIndex, opt: string | null = null
    while (s[i] === " " || s[i] === "\t") i++
    if (s[i] === "[") { const j = s.indexOf("]", i); if (j < 0) throw new Unsupported(`\\${cmd}[`); opt = s.slice(i + 1, j); i = j + 1 }
    const arg = braced(s, i)
    if (!arg) throw new Unsupported(`\\${cmd} without its argument`)
    const [text0, end] = arg
    const rest = s.slice(end).match(/^[ \t]*(?:%[^\n]*)?(\n|$)/)
    if (!rest) throw new Unsupported(`\\${cmd}{…} with more on its line`)
    if (/\n[ \t]*\n/.test(text0)) throw new Unsupported(`a blank line in \\${cmd}`)
    const text = text0.replace(/\s*\n\s*/g, " ").trim()
    if (cmd === "title") top.title = { short: opt ?? text, text }
    else if (cmd === "author") { if (top.authors.length) top.addresses.push({ kind: "author" }); top.authors.push({ short: opt ?? text, name: text }) }
    else if (cmd === "address" || cmd === "curraddr" || cmd === "email" || cmd === "urladdr") top.addresses.push({ kind: cmd, opt: opt ?? "", text })
    else if (cmd === "date") top.date = text
    else if (cmd === "subjclass") { if (opt !== null && !["1991", "2000", "2010", "2020"].includes(opt)) throw new Unsupported(`\\subjclass[${opt}]`); top.subjclass = { edition: opt ?? "2020", text } }
    else if (cmd === "keywords") top.keywords = text
    else if (cmd === "thanks") { if (text) top.thanks.push(text) }
    else throw new Unsupported(`\\${cmd} in amsart`)
    out += s.slice(at, start)
    at = end + rest[0].length - rest[1].length
    vertical = true
  }
  return out + s.slice(at)
}

/** the top matter's text as the engine reads it: plain text and ~ (a command or a formula there is not modeled) */
function plainTop(what: string, text: string): string {
  if (/[\\$&#^_%{}]/.test(text) || /[^\x20-\x7e]/.test(text)) throw new Unsupported(`amsart's ${what} "${text}"`)
  return text.replace(/\s+/g, " ").trim()
}

/** \@upprep's \spaceskip: 1.3\fontdimen2\font plus1.3\fontdimen3\font (\xspaceskip zero) */
function upprep(f: { params: number[] }) {
  const x13 = (v: number) => v + xnOverD(v, roundDecimals([3]), 65536)
  return { space: { width: x13(f.params[SPACE]), stretch: x13(f.params[SPACE_STRETCH]), stretchOrder: 0 as const, shrink: 0, shrinkOrder: 0 as const }, xspace: ZERO }
}
const ZERO = { width: 0, stretch: 0, stretchOrder: 0 as const, shrink: 0, shrinkOrder: 0 as const }

/** words and ~ (amsart's \nonbreakingspace: \unskip\nobreak\ \ignorespaces) into a horizontal list, spaces with \spaceskip when set */
function words(text: string, font: Font, spaceSkips?: { space: GlueSpec; xspace: GlueSpec }): Node[] {
  const out: Node[] = [], state = { spaceFactor: 1000, ...(spaceSkips ? { spaceSkips } : {}) }
  text.split(/( |~)/).forEach((w) => {
    if (w === " ") out.push(interwordGlue(font, state))
    else if (w === "~") out.push(penalty(10000), glue(font.params[SPACE], font.params[SPACE_STRETCH], 0, font.params[SPACE_SHRINK], 0))
    else if (w) appendText(out, w, font, state, false)
  })
  return out
}

/** the authors as \author@andify (in the title) or \andify (\shortauthors) joins them */
function andify(names: string[]): string {
  if (names.length > 2) throw new Unsupported("three or more authors in amsart")
  return names.join(" and~")
}

/**
 * amsart's abstract: \global\setbox\abstractbox\vtop{\normalfont\Small\list{}{\labelwidth\z@ \leftmargin3pc \rightmargin
 * \leftmargin \listparindent\normalparindent \itemindent\z@ \parsep\z@\@plus\p@}\item[\hskip\labelsep\scshape\abstractname.]
 * text\endlist}: read where it stands, put in place by \maketitle's \@setabstract
 */
export function amsAbstract(cx: Ctx, b: ListBlock) {
  const { run } = cx
  if (run.amsTitled) throw new Unsupported("an abstract after \\maketitle in amsart")
  if (run.amsAbstract) throw new Unsupported("two abstracts in amsart")
  if (run.runIn || run.noskipsec) throw new Unsupported("an abstract right after a run-in heading")
  if (cx.v.nobreak) throw new Unsupported("an abstract right after a heading")
  const main = cx.v
  const v = cx.v = new VerticalList(run.k)
  v.nodes = []; v.prevDepth = IGNORE_DEPTH
  try { list(cx, { kind: "list", env: "quotation", amsAbstract: true, items: b.items, inPar: false, blank: false }, { ...topCtx(cx), size: "footnotesize" }) } finally { cx.v = main }
  run.amsAbstract = vtop(v.nodes)
}

/**
 * amsart's \maketitle at the start of the document: \@topnum\z@, \thispagestyle{firstpage}, then \@maketitle:
 * \@adminfootnotes (the date, \subjclass and \keywords as footnotes without marks), \@mkboth{\@nx\shortauthors}{\@nx
 * \shorttitle} (amsart's \mark), \global\topskip42\p@, \@settitle (center, \baselineskip14\p@ \bfseries, the title in
 * capitals with \@upprep's spaces), \@setauthors (a trivlist with \@topsep30\p@ less \footnotesize's \baselineskip, the
 * authors \MakeUppercase'd), \@setabstract (\vskip 20pt less \lastskip and \baselineskip, \box\abstractbox,
 * \prevdepth\z@), \vskip(34pt less \baselineskip); then \markboth{\MakeUppercase{\shortauthors}}{\shorttitle} (the
 * kernel's marks)
 */
export function amsMaketitle(cx: Ctx) {
  const { decisions, doc, epoch, marks, outerParskip, run, v } = cx
  const top = cx.pre.amsTop!
  if (run.amsTitled) throw new Unsupported("\\maketitle twice in amsart")
  if (!top.title) throw new Unsupported("amsart's \\maketitle without \\title")
  if (top.thanks.length) throw new Unsupported("\\thanks in amsart")
  if (run.k.ints.twocolumn) throw new Unsupported("amsart's \\maketitle in two columns")
  if (run.runIn || run.noskipsec) throw new Unsupported("\\maketitle right after a run-in heading")
  v.par()
  // (its \global\topskip is for the page it starts: here the first)
  if (v.nodes.some((n) => n.kind === "hlist" || n.kind === "vlist" || n.kind === "rule")) throw new Unsupported("amsart's \\maketitle after text")
  const k = run.k
  run.amsTitled = true
  const hook = (h: OutputHook): Node => ({ kind: "whatsit", text: "", hook: h })
  v.nodes.push(hook("notop"), hook("firstpage"))
  // \@adminfootnotes: \@setdate (\datename\ \@date\@addpunct.), \@setsubjclass ({\itshape\subjclassname.}\enspace
  // \@subjclass\@addpunct.), \@setkeywords ({\itshape \keywordsname.}\enspace \@keywords\@addpunct.)
  const punct = (t: string) => (/[.?!:;,]\)*$/.test(t) && !/[A-Z][.?!:;,]\)*$/.test(t) ? t : `${t}.`)
  const admin: string[] = []
  if (top.date !== null) { const d = plainTop("\\date", top.date.replace(/\\today(?![A-Za-z])\s*/g, today(epoch, null))); if (d) admin.push(`\\textit{Date}:\\ ${punct(d)}`) }
  if (top.subjclass) admin.push(`{\\itshape \\textup{${top.subjclass.edition}} Mathematics Subject Classification.}\\enspace ${punct(plainTop("\\subjclass", top.subjclass.text))}`)
  if (top.keywords !== null) admin.push(`{\\itshape Key words and phrases.}\\enspace ${punct(plainTop("\\keywords", top.keywords))}`)
  for (const src of admin) {
    const { ins, trace } = amsAdminFootnote(src, k, doc, v.club)
    v.nodes.push(ins)
    decisions.push(trace)
  }
  // \@mkboth: amsart's \markboth under \ps@headings (as the class or the preamble set it), else \@gobbletwo
  if (cx.pre.pagestyle === "headings") v.nodes.push({ kind: "whatsit", text: "\\mark{{\\@nx \\shortauthors }{\\@nx \\shorttitle }}" })
  v.nodes.push(hook(`topskip=${42 * 65536}`))
  const title = plainTop("\\title", top.title.text).toUpperCase()
  const labelsep = k.dimens.labelsep
  const labels = () => hpack([glue(0), glue(0), glue(-labelsep), hpack([], { exactly: 0 }), glue(labelsep)])
  const topsepadd = addGlue(k.glue.topsep, k.glue.partopsep) // (\trivlist in vertical mode)
  // \@settitle: \begin{center} (\@topsep: \topsep and \parskip), \baselineskip14\p@ \bfseries
  v.addpenalty(-LOW); v.addvspace(addGlue(topsepadd, outerParskip)); v.addvspace(negate(outerParskip))
  const bf = selectFont(k, "normalsize", { ...cx.normalAttrs, ser: "bx" })
  const tp = paragraphInput("", k, "normalsize", doc, { ...centering(), start: [labels(), penalty(0), ...words(title, bf, upprep(bf))], clubPenalty: v.club, amsmath: true })
  const tb = lineBreak(tp.list, tp.params)
  decisions.push(tb.trace)
  v.paragraph(tb.vlist, outerParskip, { width: 14 * 65536, stretch: 0, stretchOrder: 0, shrink: 0, shrinkOrder: 0 })
  v.endtrivlist(outerParskip, outerParskip, topsepadd)
  // \@setauthors: \trivlist \centering\footnotesize \@topsep30\p@ \advance\@topsep-\baselineskip \item\relax
  if (top.authors.length) {
    const fs = k.sizes.footnotesize
    v.addpenalty(-LOW); v.addvspace({ width: 30 * 65536 - fs.baselineskip.width, stretch: 0, stretchOrder: 0, shrink: 0, shrinkOrder: 0 }); v.addvspace(negate(outerParskip))
    const rm = selectFont(k, "footnotesize", cx.normalAttrs)
    const authors = andify(top.authors.map((a) => plainTop("\\author", a.name))).toUpperCase()
    const ap = paragraphInput("", k, "footnotesize", doc, { ...centering(), start: [labels(), penalty(0), ...words(authors, rm)], clubPenalty: v.club, amsmath: true })
    const ab = lineBreak(ap.list, ap.params)
    decisions.push(ab.trace)
    v.paragraph(ab.vlist, outerParskip, fs.baselineskip)
    v.endtrivlist(outerParskip, outerParskip, topsepadd)
  }
  // \@setabstract
  const bs = k.sizes.normalsize.baselineskip
  if (run.amsAbstract) {
    v.vskip(addGlue(addGlue({ width: 20 * 65536, stretch: 0, stretchOrder: 0, shrink: 0, shrinkOrder: 0 }, negate(v.lastSkip)), negate(bs)))
    v.box(run.amsAbstract, bs)
    v.prevDepth = 0
  }
  v.vskip({ width: 34 * 65536 - bs.width, stretch: 0, stretchOrder: 0, shrink: 0, shrinkOrder: 0 })
  // the kernel's \markboth (it took amsart's place at \begin{document})
  const shortAuthors = andify(top.authors.map((a) => plainTop("\\author", a.short)))
  const shortTitle = plainTop("\\title", top.title.short).toUpperCase()
  const left: MarkValue = { print: `\\def \\\\{ \\ignorespaces }\\MakeUppercase    []{${(shortAuthors || shortTitle).replace(/ and~/, "\\unskip {} and\\protect \\nonbreakingspace ")}}`, parts: [], upper: false, ams: { text: (shortAuthors || shortTitle).toUpperCase(), upprep: false } }
  const right: MarkValue = { print: `{\\protect \\@upprep ${shortTitle}}`, parts: [], upper: false, ams: { text: shortTitle, upprep: true } }
  v.nodes.push(...marks.insert(markboth(left, right), v.nobreak))
  // (\c@footnote\z@: no footnote comes before it here)
}

/** what amsart's running heads typeset for a mark: its text in \normalfont\scriptsize (the title's with \@upprep's spaces) */
export function amsMarkText(k: ClassOptionData, m: MarkValue | undefined): Node[] {
  if (!m) return []
  if (!m.ams) throw new Unsupported("a running head in amsart from a mark not \\maketitle's")
  const f = k.sizes.scriptsize.font, font = loadFont(dataFont(f.name), f.at)
  return words(m.ams.text, font, m.ams.upprep ? upprep(font) : undefined)
}

/**
 * amsart's \AtEndDocument{\enddoc@text}: \@setaddresses, \par\nobreak and in a \footnotesize group with \interlinepenalty
 * \@M and \\ as \unskip, \ignorespaces: each address \par\addvspace\bigskipamount\indent(opt) {\scshape address}\par, each
 * \email \nobreak\indent{\itshape Email address}\/:\space\ttfamily address\par, each later author's \author{}
 * \nobreak\addvspace\bigskipamount
 */
export function amsAddresses(cx: Ctx) {
  const top = cx.pre.amsTop
  if (!top?.addresses.length) return
  const { outerParskip, run, typeset, v } = cx
  const k = run.k, fs = k.sizes.footnotesize
  v.par()
  v.nodes.push(penalty(10000))
  // (\footnotesize, \Small: \@adjustvertspacing's \bigskipamount .7\baselineskip plus.7\baselineskip)
  const b7 = xnOverD(fs.baselineskip.width, roundDecimals([7]), 65536)
  const big = { width: b7, stretch: b7, stretchOrder: 0 as const, shrink: 0, shrinkOrder: 0 as const }
  const indent = () => [hpack([], { exactly: AMS_NORMALPARINDENT })]
  const opts = { interLinePenalty: 10000 }
  const text = (what: string, t: string) => { const x = t.replace(/\s*\\\\\s*/g, ", ").replace(/\s+/g, " ").trim(); if (/[\\$&#^_%{}]/.test(x)) throw new Unsupported(`amsart's ${what} "${t}"`); return x }
  for (const a of top.addresses) {
    if (a.kind === "author") { v.nodes.push(penalty(10000)); v.addvspace(big); continue }
    if (!a.text) continue // (\@ifnotempty)
    if (a.kind === "address") {
      if (a.opt) throw new Unsupported("\\address[…] in amsart")
      v.addvspace(big)
      typeset(text("\\address", a.text), { start: indent(), attrs: { ...cx.normalAttrs, shape: "sc" }, ...opts }, outerParskip, "footnotesize")
      continue
    }
    if (a.opt || a.kind === "curraddr") throw new Unsupported(`\\${a.kind}${a.opt ? "[…]" : ""} in amsart`)
    // \curraddrname, \emailaddrname, \urladdrname: {\itshape …}, then \/:\space
    v.nodes.push(penalty(10000))
    const it = selectFont(k, "footnotesize", { ...cx.normalAttrs, shape: "it" }), rm = selectFont(k, "footnotesize", cx.normalAttrs)
    const start: Node[] = indent()
    appendText(start, a.kind === "email" ? "Email address" : "URL", it, { spaceFactor: 1000 }, false)
    const last = start[start.length - 1]
    if (last.kind === "char") start.push(kern(it.chars.get(last.char)?.italic ?? 0, true)) // \/
    const st = { spaceFactor: 1000 }
    appendText(start, ":", rm, st, false)
    start.push(spaceGlue(rm, st.spaceFactor))
    typeset(text(`\\${a.kind}`, a.text), { start, attrs: { ...cx.normalAttrs, fam: "cmtt" }, ...opts }, outerParskip, "footnotesize")
  }
}
/** amsart's \normalparindent */
const AMS_NORMALPARINDENT = 12 * 65536

/** amsart's \AtBeginDocument{\settoheight{\footnotesep}{\footnotesize M$^1$}} in the document's fonts (the data has it in
 *  OT1's Computer Modern): the difference */
export function withAmsFootnotesep(k: ClassOptionData, base: ClassOptionData): ClassOptionData {
  const attrs = (kk: ClassOptionData): FontAttrs => ({ enc: kk.ints.T1 ? "T1" : "OT1", fam: "cmr", ser: "m", shape: "n" })
  const height = (kk: ClassOptionData) => hpack(hlistInput("M$^1$", kk, "footnotesize", { footnote: 0 }, attrs(kk), { spaceFactor: 1000 }, true)).height
  const d = height(k) - height(base)
  return d ? { ...k, dimens: { ...k.dimens, footnotesep: k.dimens.footnotesep + d } } : k
}
