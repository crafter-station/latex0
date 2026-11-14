// titlesec: the straight class's \section, \subsection and \subsubsection (\ttl@straight@i, \ttl@straight@ii)
// in the hang shape (\ttlh@hang), with the formats and spacing titlesec takes from \@startsection when it
// loads (\ttl@extract) or \titleformat sets, and \titlerule after the title.

import type { SizeCommand } from "../layout/classdata"
import { parseDimen, parseGlue } from "../layout/dimen"
import { loadFont, QUAD, X_HEIGHT } from "../layout/font"
import { appendText } from "./encodings"
import { fillGlue, glue, kern, penalty, type Node } from "../layout/nodes"
import { hpack } from "../layout/pack"
import { type Block } from "./blocks"
import type { Ctx } from "./context"
import { dataFont } from "./data"
import { anchor, labelName } from "./hyperref"
import { isSpanish } from "./babel"
import { hsizeOf } from "./paragraph"
import { Unsupported } from "./unsupported"
import { IGNORE_DEPTH, negate } from "./vlist"
import { COLOR_CMD, colorPop, colorPush, setgroup } from "./xcolor"

/** \titleformat{\cmd}[hang]{format}{label}{sep}{before}[after], as far as it is modeled */
export interface TitleFormat {
  /** the format's font: its size command and \bfseries (from the font the heading starts in) */
  size: SizeCommand; bold: boolean
  /** "default": \@seccntformat (\the<name>\quad; spanish.ldf's layout redefines it: a period after the number);
   *  or the label as typed: text (where `\ue000` stands for \the<name>) and \quad or \qquad (its ems) */
  label: "default" | LabelPart[]
  /** the space after the label, read in the format's font */
  sep: string
  /** \titlerule as the after code */
  rule: boolean
  /** \color[model]{spec} in the format: read in vertical mode in \ttl@select's group */
  color?: { spec: string; model?: string }
  /** \titlespacing*{\cmd}{0pt}{before}{after}: the skips as written (\ttl@assign's \setlength at each title) */
  spacing?: { before: string; after: string }
}

export type LabelPart = { text: string } | { quad: number }

/** \the<name> in a label's text */
const NUMBER = "\ue000"

/**
 * A \titleformat label as typed (\ttlh@hang's #2, set in an \sbox in the format's font): \the<name>, the
 * characters around it (a period after it, a word before it) and \quad or \qquad; null for anything else.
 */
function labelParts(label: string, name: string): LabelPart[] | null {
  const parts: LabelPart[] = []
  const text = (t: string) => { const last = parts[parts.length - 1]; if (last && "text" in last) last.text += t; else parts.push({ text: t }) }
  for (const m of label.matchAll(/\\([a-zA-Z]+) *|([A-Za-z0-9.,:;!?()' -]+)|([^])/g)) {
    if (m[2]) text(m[2].replace(/ +/g, " "))
    else if (m[1] === `the${name}`) text(NUMBER)
    else if (m[1] === "quad" || m[1] === "qquad") parts.push({ quad: m[1] === "quad" ? 1 : 2 })
    else return null
  }
  return parts
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
  // (\color: one, the last thing it reads its arguments; more would each push and pop)
  const colors = [...format.matchAll(COLOR_CMD)]
  if (colors.length > 1) throw new Unsupported(`titlesec format ${format.trim()}`)
  const color = colors[0] ? { spec: colors[0][2], ...(colors[0][1] !== undefined ? { model: colors[0][1] } : {}) } : undefined
  for (const t of format.replace(COLOR_CMD, " ").match(/\\[a-zA-Z]+|\S/g) ?? []) {
    if (t === "\\normalfont") bold = false
    else if (t === "\\bfseries") bold = true
    else if (["\\normalsize", "\\large", "\\Large", "\\LARGE", "\\huge", "\\Huge", "\\small", "\\footnotesize"].includes(t)) size = t.slice(1) as SizeCommand
    else throw new Unsupported(`titlesec format ${format.trim()}`)
  }
  // (a space in the label is one in its box, unless it follows a control word)
  const kind = label.trim() === `\\@seccntformat{${m[1]}}` ? "default" : labelParts(label, m[1])
  if (!kind) throw new Unsupported(`titlesec label ${label.trim()}`)
  formats[level] = { size, bold, label: kind, sep: sep.trim() || "0pt", rule: code[1]?.trim() === "\\titlerule", ...(color ? { color } : {}), ...(formats[level].spacing ? { spacing: formats[level].spacing } : {}) }
  return true
}

/**
 * \titlespacing*{\cmd}{left}{before}{after}[right] in the preamble (\ttl@spacing@ii keeps the arguments as written);
 * false if the line is not one. The left and right spaces must be zero; the star is \@afterindentfalse, as the
 * spacing \ttl@extract makes.
 */
export function titlespacing(formats: TitleFormats, line: string): boolean {
  const m = line.match(/^\\titlespacing(\*?)\{\\([a-z]+)\}(.*)$/)
  if (!m) return false
  const level = LEVELS[m[2]]
  if (!level) throw new Unsupported(`\\titlespacing{\\${m[2]}}`)
  if (!m[1]) throw new Unsupported("\\titlespacing without its *")
  const a = args(m[3], 3)
  if (!a) throw new Unsupported(`preamble: ${line}`)
  const [[left, before, after], rest] = a
  const right = rest.trim().match(/^(?:\[(.*)\])?$/)
  if (!right) throw new Unsupported(`preamble: ${line}`)
  const zero = (s: string) => { try { return parseDimen(s, { em: 1, ex: 1 }) === 0 } catch { return false } }
  if (!zero(left) || !zero(right[1] ?? "0pt")) throw new Unsupported(`\\titlespacing's left or right space ${left}${right[1] !== undefined ? `, ${right[1]}` : ""}`)
  // (*n: multiples of \beforetitleunit and \aftertitleunit)
  if (/^\s*\*/.test(before) || /^\s*\*/.test(after)) throw new Unsupported(`\\titlespacing's ${before}, ${after}`)
  formats[level].spacing = { before: before.trim(), after: after.trim() }
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
  const { contentsWrites, counted, counters, headings, lastNode, noskipsecPar, outerParskip, refs, run, typeset, v } = cx
  if (heading.level < 1 || heading.level > 3) throw new Unsupported(`a titlesec ${["\\part", "", "", "", "\\paragraph", "\\subparagraph"][heading.level]}`)
  if (headings) throw new Unsupported("titlesec with running heads")
  const level = heading.level as 1 | 2 | 3
  const f = formats[level]
  const b = { ...heading, title: counted(heading.title) }
  // \ttl@extract: \titlespacing*{\cmd}{indent}{-beforeskip}{afterskip}, \the of each at load time (which
  // scans back to the same skip), in the font selected when titlesec loaded
  // (\titlespacing's own: \ttl@assign's \setlength here, in the font the title starts in)
  const units = cx.pre.titlesecUnits!
  const spaced = (s: string) => { try { return parseGlue(s, cx.bodyUnits) } catch { throw new Unsupported(`\\titlespacing's ${s}`) } }
  const before = f.spacing ? spaced(f.spacing.before) : parseGlue(level === 1 ? "3.5ex plus 1ex minus .2ex" : "3.25ex plus 1ex minus .2ex", units)
  const after = f.spacing ? spaced(f.spacing.after) : parseGlue(level === 1 ? "2.3ex plus .2ex" : "1.5ex plus .2ex", units)
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
    refs.label = number; refs.href = `${counters.anchorType(level)}.${counters.theHSectional(level)}` // (\theHsection, not \thesection)
    if (refs.cleveref) refs.cleveref.current = { type, arabic: counters.sectional[level], prefix: counters.crefPrefix(type), label: number }
  }
  // hyperref loaded first: titlesec's \AtBeginDocument lets \ttl@Hy@refstepcounter be hyperref's \refstepcounter,
  // its anchor on the vertical list now, and \ttl@Hy@steplink \@gobble. Loaded after, its own: the anchor saved in
  // \ttl@Hy@saveanchor for \ttl@select (a starred title has no \ttl@savewrite, so no \ttl@Hy@steplink either)
  const saved = hyper && numbered && cx.pre.titlesecHyperref
  if (hyper && numbered && !saved) v.nodes.push(...anchor(refs.href, run.k.sizes.normalsize.baselineskip.width, "v", lastNode()))
  // \ttl@straight@i: \def\@currentlabelname{#2}, the optional title (empty for a starred one), which \label writes with or
  // without nameref (nameref's \label@hook drops a final period)
  refs.name = b.star ? "" : labelName(heading.source ?? heading.title, cx.pre.nameref)
  if (!afterHeading) { v.addpenalty(-300); v.addvspace(before) } // (\bottomtitlespace is negative: bottomtitles)
  if (saved) v.nodes.push(...anchor(refs.href, run.k.sizes.normalsize.baselineskip.width, "v", lastNode())) // \ttl@select: \ttl@Hy@saveanchor
  v.afterindent = false // \titlespacing*: \@afterindentfalse
  // the format's \color, read in vertical mode in \ttl@select's group (\ttlh@hang's #1, before the title's
  // paragraph): \set@color's push on the vertical list; \reset@color's pop (\aftergroup) where that group ends, after
  // the title, its \nobreak and the after code
  const color = f.color ? cx.colorSpec(f.color.spec, f.color.model) : undefined
  if (color) v.nodes.push(colorPush(color))
  const font = f.bold ? run.k.sizes[f.size].bold : run.k.sizes[f.size].font
  const tf = loadFont(dataFont(font.name), font.at)
  const { height, depth } = run.k.sizes[f.size].strut
  const strut = (): Node => ({ kind: "rule", width: 0, height, depth })
  // \everypar's \strut, then (label on) \noindent's box: the label, \strut, \hspace{sep}
  const start: Node[] = [strut()]
  let hang = 0
  if (numbered) {
    const label: Node[] = []
    const state = { spaceFactor: 1000 }
    for (const p of f.label === "default" ? [{ text: NUMBER + (isSpanish(cx.pre.babel) ? "." : "") }, { quad: 1 }] : f.label) { // (spanish.ldf's \@seccntformat)
      if ("text" in p) appendText(label, p.text.replace(NUMBER, number), tf, state, false)
      else label.push(glue(p.quad * tf.params[QUAD]))
    }
    label.push(strut(), glue(parseDimen(f.sep, { em: tf.params[QUAD], ex: tf.params[X_HEIGHT] })))
    const box = hpack(color ? [colorPush(color), ...label, colorPop()] : setgroup(label)) // \sbox: \color@setgroup (the color in force)
    hang = box.width
    start.push(box)
  }
  typeset(b.title, { start, font, hangIndent: hang, interLinePenalty: 10000, clubPenalty: club, end: [...(heading.end ?? []), kern(0, true), strut()], ...(color ? { color } : {}) }, outerParskip, f.size)
  v.nodes.push(penalty(10000))
  if (f.rule) titlerule(cx)
  if (color) v.nodes.push(colorPop())
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
  v.nodes.push(hpack(line, { exactly: hsizeOf(run.k) }), hrule(), penalty(10000))
  v.prevDepth = IGNORE_DEPTH
}
