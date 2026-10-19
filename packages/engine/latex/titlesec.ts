// titlesec: the straight class's \section, \subsection and \subsubsection (\ttl@straight@i, \ttl@straight@ii)
// in the hang shape (\ttlh@hang), with the formats and spacing titlesec takes from \@startsection when it
// loads (\ttl@extract) or \titleformat sets, and \titlerule after the title.

import type { SizeCommand } from "../layout/classdata"
import { parseDimen, parseGlue } from "../layout/dimen"
import { loadFont, QUAD, X_HEIGHT } from "../layout/font"
import { appendText } from "../layout/hmode"
import { fillGlue, glue, kern, penalty, type Node } from "../layout/nodes"
import { hpack } from "../layout/pack"
import { type Block } from "./blocks"
import type { Ctx } from "./context"
import { dataFont } from "./data"
import { anchor, labelName } from "./hyperref"
import { Unsupported } from "./unsupported"
import { IGNORE_DEPTH, negate } from "./vlist"
import { setgroup } from "./xcolor"

/** \titleformat{\cmd}[hang]{format}{label}{sep}{before}[after], as far as it is modeled */
export interface TitleFormat {
  /** the format's font: its size command and \bfseries (from the font the heading starts in) */
  size: SizeCommand; bold: boolean
  /** "default": \@seccntformat (\the<name>\quad); "number": \the<name> alone; "none": empty */
  label: "default" | "number" | "none"
  /** the space after the label, read in the format's font */
  sep: string
  /** \titlerule as the after code */
  rule: boolean
}

export type TitleFormats = Record<1 | 2 | 3, TitleFormat>

const LEVELS: Record<string, 1 | 2 | 3> = { section: 1, subsection: 2, subsubsection: 3 }

/** What \ttl@extract reads from article's \@startsection: \normalfont, the size and \bfseries, and \@seccntformat */
export const titlesecDefaults = (): TitleFormats => ({
  1: { size: "Large", bold: true, label: "default", sep: "0pt", rule: false },
  2: { size: "large", bold: true, label: "default", sep: "0pt", rule: false },
  3: { size: "normalsize", bold: true, label: "default", sep: "0pt", rule: false },
})

/** The {…} arguments at the start of `s`, and what follows them. */
function args(s: string, n: number): [string[], string] | null {
  const out: string[] = []
  let i = 0
  for (; out.length < n; ) {
    while (s[i] === " ") i++
    if (s[i] !== "{") return null
    let depth = 0, j = i
    for (; j < s.length; j++) {
      if (s[j] === "\\") j++
      else if (s[j] === "{") depth++
      else if (s[j] === "}" && --depth === 0) break
    }
    if (j >= s.length) return null
    out.push(s.slice(i + 1, j)); i = j + 1
  }
  return [out, s.slice(i)]
}

/** \titleformat{\cmd}[shape]{format}{label}{sep}{before}[after] in the preamble; false if the line is not one */
export function titleformat(formats: TitleFormats, line: string): boolean {
  const m = line.match(/^\\titleformat\{\\([a-z]+)\}(?:\[([a-z]+)\])?(.*)$/)
  if (!m) return false
  const level = LEVELS[m[1]]
  if (!level) throw new Unsupported(`\\titleformat{\\${m[1]}}`)
  if (m[2] && m[2] !== "hang") throw new Unsupported(`titlesec's ${m[2]} shape`)
  const a = args(m[3], 4)
  if (!a) throw new Unsupported(`preamble: ${line}`)
  const [[format, label, sep, before], rest] = a
  const code = rest.trim().match(/^(?:\[(.*)\])?$/)
  if (!code || (code[1] ?? "").trim() && code[1].trim() !== "\\titlerule") throw new Unsupported(`titlesec's after code ${rest.trim()}`)
  if (before.trim()) throw new Unsupported(`\\titleformat's before code ${before.trim()}`)
  // the format runs in the font the heading starts in: the document's \normalfont \normalsize
  let size: SizeCommand = "normalsize", bold = false
  for (const t of format.match(/\\[a-zA-Z]+|\S/g) ?? []) {
    if (t === "\\normalfont") bold = false
    else if (t === "\\bfseries") bold = true
    else if (["\\normalsize", "\\large", "\\Large", "\\LARGE", "\\huge", "\\Huge", "\\small", "\\footnotesize"].includes(t)) size = t.slice(1) as SizeCommand
    else throw new Unsupported(`titlesec format ${format.trim()}`)
  }
  const lb = label.trim()
  const kind = lb === "" ? "none" : lb === `\\the${m[1]}` ? "number" : lb === `\\the${m[1]}\\quad` || lb === `\\@seccntformat{${m[1]}}` ? "default" : null
  if (!kind) throw new Unsupported(`titlesec label ${lb}`)
  formats[level] = { size, bold, label: kind, sep: sep.trim() || "0pt", rule: code[1]?.trim() === "\\titlerule" }
  return true
}

/**
 * \ttl@straight@i and \ttl@straight@ii: \par, \refstepcounter, \addpenalty{\@secpenalty} and \addvspace{before}
 * unless \if@nobreak (where the aftersep default gobbles the space), then \ttl@select's group: \everypar
 * {\setbox\z@\lastbox\strut} and \ttlh@hang's paragraph (\leftskip and \rightskip 0pt, \interlinepenalty\@M;
 * the label in a box the title hangs from, the title, \kern\z@\strut\@@par), \nobreak and the after code;
 * \ttl@finmarks (the toc line and its \nobreak), and \par\nobreak\vspace{after}\@afterheading.
 */
export function titlesecHeading(cx: Ctx, heading: Extract<Block, { kind: "heading" }>) {
  const formats = cx.pre.titlesec!
  const { hyper } = cx.pre
  const { bodyUnits, contentsWrites, counted, counters, headings, lastNode, noskipsecPar, outerParskip, refs, run, typeset, v } = cx
  if (heading.level < 1 || heading.level > 3) throw new Unsupported(`a titlesec ${["\\part", "", "", "", "\\paragraph", "\\subparagraph"][heading.level]}`)
  if (headings) throw new Unsupported("titlesec with running heads")
  const level = heading.level as 1 | 2 | 3
  const f = formats[level]
  const b = { ...heading, title: counted(heading.title) }
  // \ttl@extract: \titlespacing*{\cmd}{indent}{-beforeskip}{afterskip}, \the of each at load time (which
  // scans back to the same skip)
  const units = bodyUnits
  const before = parseGlue(level === 1 ? "3.5ex plus 1ex minus .2ex" : "3.25ex plus 1ex minus .2ex", units)
  const after = parseGlue(level === 1 ? "2.3ex plus .2ex" : "1.5ex plus .2ex", units)
  noskipsecPar("a heading") // \if@noskipsec \leavevmode \fi
  v.par()
  const afterHeading = v.nobreak
  // the title's paragraph runs \ttl@select's \everypar, not \@afterheading's: the \clubpenalty in force holds
  const club = v.club
  const numbered = !b.star && level <= run.k.ints.secnumdepth
  let number = ""
  if (!b.star) { counters.stepSectional(level); number = counters.theSectional(level) }
  if (numbered) {
    const type = ["", "section", "subsection", "subsubsection"][level]
    refs.label = number; refs.href = `${type}.${number}`
    if (refs.cleveref) refs.cleveref.current = { type, arabic: counters.sectional[level], prefix: counters.crefPrefix(type), label: number }
  }
  // hyperref loaded first: titlesec's \AtBeginDocument lets \ttl@Hy@refstepcounter be hyperref's \refstepcounter,
  // its anchor on the vertical list now; a starred title has none (\ttl@Hy@steplink is \@gobble)
  if (hyper && numbered) v.nodes.push(...anchor(refs.href, run.k.sizes.normalsize.baselineskip.width, "v", lastNode()))
  // \ttl@straight@i: \def\@currentlabelname{#2}, the optional title (empty for a starred one), which \label writes with or
  // without hyperref (nameref's \label@hook drops a final period)
  refs.name = b.star ? "" : labelName(heading.source ?? heading.title, hyper)
  if (!afterHeading) { v.addpenalty(-300); v.addvspace(before) } // (\bottomtitlespace is negative: bottomtitles)
  v.afterindent = false // \titlespacing*: \@afterindentfalse
  const font = f.bold ? run.k.sizes[f.size].bold : run.k.sizes[f.size].font
  const tf = loadFont(dataFont(font.name), font.at)
  const { height, depth } = run.k.sizes[f.size].strut
  const strut = (): Node => ({ kind: "rule", width: 0, height, depth })
  // \everypar's \strut, then (label on) \noindent's box: the label, \strut, \hspace{sep}
  const start: Node[] = [strut()]
  let hang = 0
  if (numbered) {
    const label: Node[] = []
    if (f.label !== "none") appendText(label, number, tf, { spaceFactor: 1000 }, false)
    if (f.label === "default") label.push(glue(tf.params[QUAD]))
    label.push(strut(), glue(parseDimen(f.sep, { em: tf.params[QUAD], ex: tf.params[X_HEIGHT] })))
    const box = hpack(setgroup(label)) // \sbox: \color@setgroup
    hang = box.width
    start.push(box)
  }
  typeset(b.title, { start, font, hangIndent: hang, interLinePenalty: 10000, clubPenalty: club, end: [...(heading.end ?? []), kern(0, true), strut()] }, outerParskip, f.size)
  v.nodes.push(penalty(10000))
  if (f.rule) titlerule(cx)
  // \ttl@write (unstarred): \sectionmark, \addcontentsline (\protected@write, \nobreak while \if@nobreak) and its \nobreak
  if (!b.star) v.nodes.push(...contentsWrites(level, numbered ? number : null, b.title, numbered ? refs.href : "", afterHeading), penalty(10000))
  v.nodes.push(penalty(10000)) // \par\nobreak
  v.vskip(after); v.vskip(parseGlue("0pt", units)) // \vspace: \vskip after \vskip\z@skip
  v.nobreak = true
  v.afterheadingEverypar = true
}

/**
 * \titlerule in vertical mode: \titleline{\leaders\hrule height .4pt\hfill\kern\z@}, that is \vskip\topskip
 * \hrule height\z@ \nobreak \vskip-\topskip, the line as \@makebox[\hsize][s] (an \hbox on the vertical list,
 * the left and right spaces 0pt around it), and \hrule height\z@ \nobreak
 */
function titlerule(cx: Ctx) {
  const { run, v } = cx
  const topskip = run.k.glue.topskip
  const hrule = (): Node => ({ kind: "rule", width: null, height: 0, depth: 0 })
  v.vskip(topskip); v.nodes.push(hrule(), penalty(10000)); v.vskip(negate(topskip))
  const line = [glue(0), { ...fillGlue(), leaders: { kind: "leaders" as const, box: { kind: "rule" as const, width: null, height: 26214, depth: 0 } } }, kern(0, true), glue(0)]
  v.nodes.push(hpack(line, { exactly: run.k.dimens.textwidth }), hrule(), penalty(10000))
  v.prevDepth = IGNORE_DEPTH
}
