// Layout "paragraph": a fixture whose body is paragraphs of plain text and
// inline math ($…$, as mathlayout/parse.ts reads it) in a standard class at
// 10pt, 11pt or 12pt. Paragraphs are separated by blank lines;
// one may be set in a size group, {\large … \par}. Each may start with
// paragraph assignments:
//   \noindent  \parshape <n> <i>pt <l>pt …  \<int param>=<n>  \<dimen param>=<n>pt  \mathsurround=<n>pt
// (see INT_PARAMS and DIMEN_PARAMS).
// Lines are broken by the engine's own line breaker (#112).
//
// Every parameter comes from the class data (#44). The page is LaTeX's
// \@outputpage: \topmargin, a \headheight box and \headsep above the text box,
// shifted right by \oddsidemargin.

import { SIZE_COMMANDS, type ClassOptionData, type FontRef, type SizeCommand } from "../layout/classdata"
import { parseDimen, Scanner, type GlueSpec } from "../layout/dimen"
import { loadFont, QUAD, SLANT, SPACE, SPACE_SHRINK, SPACE_STRETCH, X_HEIGHT, type Font } from "../layout/font"
import { appendText } from "../layout/hmode"
import { buildHyphenator } from "../layout/hyphenate"
import { lineBreak, type LineBreakParams } from "../layout/linebreak"
import { emptyBox, NORMAL, glue, kern, paramGlue, penalty, type BoxNode, type GlueNode, type InsNode, type Node, filGlue, fillGlue, ssGlue } from "../layout/nodes"
import { mlistToHlist, ORD, TEXT, type MathEnv, type MItem } from "../mathlayout/mlist"
import { parseMath } from "../mathlayout/parse"
import { emitBoxes } from "../emit/boxes"
import { hpack, vpack } from "../layout/pack"
import type { ParagraphTrace } from "../trace/decisions"
import { shipOut } from "../emit/trace"
import { classData, documentClass } from "./classes"
import { dataFont } from "./data"
import { hyphenationData, mathData } from "./data"
import type { LayoutResult } from "./result"
import { endDocument, makeColumns } from "./output"
import { anchor, refLink, spotAnchor, tocLink } from "./hyperref"
import { Unsupported } from "./unsupported"

export const spec = (param: string, g: GlueSpec, width = g.width): GlueNode => paramGlue(param, glue(width, g.stretch, g.stretchOrder, g.shrink, g.shrinkOrder))

// assignable parameters: TeX name → LineBreakParams field
const INT_PARAMS = {
  hangafter: "hangAfter", looseness: "looseness", tolerance: "tolerance", pretolerance: "pretolerance",
  linepenalty: "linePenalty", adjdemerits: "adjDemerits", hyphenpenalty: "hyphenPenalty", exhyphenpenalty: "exHyphenPenalty",
  doublehyphendemerits: "doubleHyphenDemerits", finalhyphendemerits: "finalHyphenDemerits",
} as const
const DIMEN_PARAMS = { hangindent: "hangIndent", emergencystretch: "emergencyStretch" } as const

let memoHyphenator: ReturnType<typeof buildHyphenator> | undefined
const hyphenator = () => (memoHyphenator ??= buildHyphenator(hyphenationData("en-us")))
export { mathData }

/** The math fonts and parameters of a size command (\DeclareMathSizes), with LaTeX's math setup. */
/**
 * LaTeX's math alphabets and the family each sets for its argument: \mathrm, \mathnormal and \mathcal use the
 * operators, letters and symbols fonts (\DeclareSymbolFontAlphabet); \mathbf, \mathit, \mathsf and \mathtt
 * get families of their own (\DeclareMathAlphabet), 4–7 here (LaTeX numbers them as they are first used;
 * the number never shows)
 */
const ALPHABET_FONTS = ["mathbf", "mathit", "mathsf", "mathtt"] as const
export const MATH_ALPHABETS: Record<string, number> = { mathrm: 0, mathnormal: 1, mathcal: 2, ...Object.fromEntries(ALPHABET_FONTS.map((a, i) => [a, 4 + i])) }

/** A formula (between $…$) as an mlist, with the document's amsmath and LaTeX's math alphabets. */
export function parseFormula(src: string, amsmath = false): MItem[] {
  try { return parseMath(src, mathData(), { amsmath, alphabets: MATH_ALPHABETS }) } catch (e) { throw new Unsupported((e as Error).message) } // (what the parser does not read)
}

export function mathEnv(k: ClassOptionData, size: SizeCommand, amsmath = false): MathEnv {
  const m = amsmath ? k.sizes[size].mathAms : k.sizes[size].math, data = mathData()
  return {
    // families 0–3, then the math alphabets' (MATH_ALPHABETS)
    fonts: [m.text, m.script, m.scriptscript].map((fs, s) => [...fs, ...ALPHABET_FONTS.map((a) => k.sizes[size].alphabets[a][s])].map((f) => loadFont(dataFont(f.name), f.at))),
    muskips: data.muskips as MathEnv["muskips"], binoppenalty: data.ints.binoppenalty, relpenalty: data.ints.relpenalty,
    scriptspace: data.dimens.scriptspace, nulldelimiterspace: data.dimens.nulldelimiterspace,
    delimiterfactor: data.ints.delimiterfactor, delimitershortfall: data.dimens.delimitershortfall,
    arraycolsep: k.dimens.arraycolsep, arstrut: k.sizes[size].strut, // \@arstrutbox: \strutbox at \arraystretch 1
  }
}

/** Line-breaking parameters as a class sets them (latex.ltx and the class's .clo). */
export function classParams(k: ClassOptionData): LineBreakParams {
  const i = k.ints
  return {
    hsize: k.dimens.textwidth, leftSkip: spec("leftskip", k.glue.leftskip), rightSkip: spec("rightskip", k.glue.rightskip), parFillSkip: spec("parfillskip", k.glue.parfillskip),
    pretolerance: i.pretolerance, tolerance: i.tolerance, emergencyStretch: k.dimens.emergencystretch, linePenalty: i.linepenalty, adjDemerits: i.adjdemerits,
    doubleHyphenDemerits: i.doublehyphendemerits, finalHyphenDemerits: i.finalhyphendemerits, hangIndent: 0, hangAfter: 1, parShape: [],
    interLinePenalty: i.interlinepenalty, clubPenalty: i.clubpenalty, widowPenalty: i.widowpenalty, brokenPenalty: i.brokenpenalty, looseness: i.looseness, prevGraf: 0,
    hyphenPenalty: i.hyphenpenalty, exHyphenPenalty: i.exhyphenpenalty,
  }
}

/** Document state that crosses paragraphs: LaTeX's footnote counter, and the font shapes NFSS has
 *  substituted so far (a substitution declares the shape it replaced, which later merges then see) */
export interface DocState {
  footnote: number; substituted?: Set<string>; refs?: Refs
  /** xcolor is loaded (\normalcolor and \color@setgroup push the color) */
  xcolor?: boolean
  /** a color expression as its \special text */
  color?: (spec: string, model?: string) => string
  /** \lstinline number n (taken out of the source before expansion) at a size in a font */
  lstinline?: (n: number, size: SizeCommand, attrs: FontAttrs) => Node[]
  /** \url number n (taken out of the source before expansion) at a size in a font */
  url?: (n: number, size: SizeCommand, attrs: FontAttrs, penalties: boolean, color: string | undefined) => Node[]
  /** \includegraphics number n, with \linewidth where it stands */
  graphic?: (n: number, lineWidth: number, units: { em: number; ex: number }) => Node[]
  /** \href number n around its typeset text */
  href?: (n: number, text: Node[], color: string | undefined) => Node[]
  /** tabular number n (taken out of the source after expansion) at a size in a font: its \hbox */
  /** (`sfcodes`: the \sfcode changes in force, which the entries keep; `outer`: the paragraph it is in, whose
   *  footnote traces the p{width} entries' paragraphs join and whose \clubpenalty and \finalhyphendemerits they keep) */
  tabular?: (n: number, size: SizeCommand, attrs: FontAttrs, sfcodes?: Record<number, number>, outer?: TabularOuter) => Node
  /** minipage number n (taken out of the source after expansion) at a size in a font: what \@iiiparbox appends */
  minipage?: (n: number, size: SizeCommand, attrs: FontAttrs, sfcodes: Record<number, number> | undefined, outer: TabularOuter) => Node[]
}

/** where a tabular stands: the traces its p{width} entries' paragraphs join, and the parameters they keep */
export interface TabularOuter { notes: ParagraphTrace[]; club: number; widow: number; finalHyph: number; /** \linewidth there (a list's \parshape width) */ lineWidth?: number }

/**
 * Cross-references: \@currentlabel (local: lists, equations and floats restore it), \@currentHref
 * (global), the labels the run before wrote to the .aux file (null: none yet), and this run's
 * \newlabel writes, whose pages make the next run's \pageref.
 */
export interface Refs {
  label: string; href: string
  /** \@currentlabelname: hyperref's nameref sets it to a heading's title */
  name: string
  prev: Map<string, { label: string; page: string; href: string }> | null
  /** \bibcite values the run before wrote: key → number */
  cites?: Map<string, string>
  writes: { node: Node; key: string; label: string; href: string }[]
  /** hyperref: \ref and \pageref are links to the label's anchor */
  hyper?: boolean
  /** hyperref's \c@Hfootnote: footnotes so far, never reset */
  hfootnotes?: number
}

/** \label{key}: \protected@write\@auxout{}{\string\newlabel{key}{{\@currentlabel}{\thepage}{}{\@currentHref}{}}} */
export function labelWrite(refs: Refs, key: string, label = refs.label, href = refs.href, name = refs.name): Node {
  const node: Node = { kind: "whatsit", text: `\\write1{\\newlabel{${key}}{{${label}}{\\thepage }{${name}}{${href}}{}}}` }
  refs.writes.push({ node, key, label, href })
  return node
}

/** What a paragraph's surroundings set: the start of its list (in place of the indent box) and its shape. */
export interface ParagraphOptions {
  start?: Node[]; parShape?: [number, number][]; clubPenalty?: number
  /** the text font, when not the size's roman (a heading's \bfseries) */
  font?: FontRef
  /** the text font's attributes, when not the size's roman (amsthm's \itshape body): \emph and friends work from them */
  attrs?: FontAttrs
  hangIndent?: number; interLinePenalty?: number
  /** \clubpenalty while the paragraph is read, which its footnotes see, when it differs from the one at its \par */
  noteClubPenalty?: number
  /** the \clubpenalty footnotes see in the {\color …} group that starts the paragraph (\everypar ran there) */
  leadGroupNoteClubPenalty?: number
  /** \centering and friends */
  leftSkip?: GlueNode; rightSkip?: GlueNode; parFillSkip?: GlueNode; finalHyphenDemerits?: number
  /** \unskips before the \par (\@item's two, \endtrivlist's one), each taking a final glue */
  unskip?: number
  /** \sloppy (\@parboxrestore in floats and boxes) */
  tolerance?: number; emergencyStretch?: number; pretolerance?: number
  /** amsmath is loaded: its math fonts */
  amsmath?: boolean
  /** lines already in the paragraph (before a display), and the widow penalty in force */
  prevGraf?: number; widowPenalty?: number
  /** nodes after the text, before the \par (marks from \@mkboth in a heading's title) */
  end?: Node[]
  /** \sfcode changes (thebibliography's \sfcode`\.\@m) */
  sfcodes?: Record<number, number>
  /** \widowpenalty in force, which footnotes see, when not the class's (thebibliography's 4000) */
  noteWidowPenalty?: number
  /** \hsize, when not \textwidth (a \parbox) */
  hsize?: number
}

/**
 * Paragraph text as TeX's reading leaves it: runs of spaces are one space, none at the start. One at the
 * end stays after a closing brace: the group may end with a space of its own, and \par (line_break, § 816)
 * removes only the last glue; elsewhere the end's space is that last glue, so it goes.
 */
export const squeeze = (t: string): string => {
  const s = t.replace(/\s+/g, " ").replace(/^ /, "")
  // a space after } or ~ is glue \par removes in place of what comes before it
  return /[}~] $/.test(s) ? s : s.replace(/ $/, "")
}

/** Where the group opened at `open` closes (braces nest, \{ and \} do not count). */
function closingBrace(body: string, open: number): number {
  let depth = 0
  for (let j = open; j < body.length; j++) {
    if (body[j] === "\\") j++
    else if (body[j] === "{") depth++
    else if (body[j] === "}" && --depth === 0) return j
  }
  throw new Error(`paragraph adapter: unbalanced { in "${body.slice(open, open + 40)}"`)
}

/** A body piece: plain text, a formula $…$, or \footnote{…} (whose text is again text and formulas). */
type Piece =
  | { kind: "text" | "math" | "footnote"; src: string }
  /** a text symbol (TEXT_SYMBOLS), and \, (\thinspace) */
  | { kind: "symbol"; name: string } | { kind: "thinspace" }
  /** ~, \label{key}, \ref{key}, \pageref{key} */
  | { kind: "tie" } | { kind: "currentlabel"; label: string; href: string } | { kind: "lstinline"; n: number } | { kind: "url"; n: number } | { kind: "href"; n: number; inner: Piece[] } | { kind: "tabular"; n: number } | { kind: "graphic"; n: number } | { kind: "minipage"; n: number } | { kind: "underline"; inner: Piece[] }
  /** \textcolor[model]{spec}{…} or {\color[model]{spec} …}: the color's push, the group, its pop */
  | { kind: "color"; spec: string; model?: string; inner: Piece[]; /** pushed already (in vertical mode, before the paragraph) */ pushed?: boolean }
  /** \\ in a paragraph (\@normalcr): its * and [skip] */
  | { kind: "newline"; star: boolean; skip: string | null }
  /** \hfill, \hfil, \quad, \qquad */
  | { kind: "space"; cmd: "hfill" | "hfil" | "quad" | "qquad" }
  /** {\large …}: a size command in a group */
  | { kind: "size"; size: SizeCommand; inner: Piece[] } | { kind: "label"; key: string } | { kind: "cite"; keys: string[] } | { kind: "ref"; key: string } | { kind: "pageref"; key: string }
  /** amsmath's \tagform@ around \ref{key} (in \eqref) */
  | { kind: "tagref"; key: string }
  /** \textbf{…} and friends: the command, its argument as pieces, and the characters around the argument
   *  that \check@icl and \check@icr look at (its first, and the one after the closing brace) */
  | { kind: "font"; cmd: FontCommand; src: string; inner: Piece[]; next: string }

/** Text symbols (\DeclareTextSymbol): each one's code in the encodings that have it; TS1 is the default's. */
export const TEXT_SYMBOLS: Record<string, Partial<Record<FontAttrs["enc"], number>>> = {
  textdollar: { T1: 36, TS1: 36 },
  textdegree: { TS1: 176 },
}

/** LaTeX's text font commands (\DeclareTextFontCommand) */
const FONT_COMMANDS = ["textbf", "textmd", "textit", "textsl", "textsc", "textup", "textrm", "textsf", "texttt", "textnormal", "emph"] as const
type FontCommand = typeof FONT_COMMANDS[number]

/** NFSS attributes: encoding, family, series, shape */
export interface FontAttrs { enc: "OT1" | "T1" | "TS1"; fam: "cmr" | "cmss" | "cmtt"; ser: "m" | "bx"; shape: Shape }
type Shape = "n" | "it" | "sl" | "sc" | "scit" | "scsl"

/**
 * \fontshape with LaTeX's \DeclareFontShapeChangeRule table: a rule gives a shape and a second choice;
 * \selectfont takes the first that the family declares, else the shape asked for (\merge@font@shape).
 * Without a rule, the shape asked for. \upshape asks for "up".
 */
const SHAPE_RULES: Record<Shape, Partial<Record<"it" | "sl" | "sc" | "up", [Shape, Shape | null]>>> = {
  n: { it: ["it", "sl"], sl: ["sl", "it"], up: ["n", null] },
  it: { sl: ["sl", "it"], sc: ["scit", "scsl"], up: ["n", null] },
  sl: { it: ["it", "sl"], sc: ["scsl", "scit"], up: ["n", null] },
  sc: { it: ["scit", "scsl"], sl: ["scsl", "scit"], up: ["n", null] },
  scit: { it: ["scit", null], sl: ["scsl", "scit"], sc: ["scit", null], up: ["sc", null] },
  scsl: { it: ["scit", "scsl"], sl: ["scsl", null], sc: ["scsl", null], up: ["sc", null] },
}
function mergeShape(k: ClassOptionData, size: SizeCommand, a: FontAttrs, target: "it" | "sl" | "sc" | "up", doc: DocState): Shape {
  const rule = SHAPE_RULES[a.shape][target]
  if (!rule) { if (target === "up") throw new Error(`no \\upshape rule from ${a.shape}`); return target }
  const declared = (sh: Shape | null) => sh !== null && (k.sizes[size].fonts[`${a.enc}/${a.fam}/${a.ser}/${sh}`]?.declared || doc.substituted?.has(`${a.enc}/${a.fam}/${a.ser}/${sh}`))
  if (declared(rule[0])) return rule[0]
  if (declared(rule[1])) return rule[1]!
  if (target === "up") throw new Error(`\\upshape from ${a.shape}: no shape declared`)
  return target
}
/** A font declaration (\bfseries, \itshape, \ttfamily …) on the attributes; null for one that is not modeled */
export function fontDeclaration(name: string, a: FontAttrs, k: ClassOptionData, size: SizeCommand, doc: DocState): FontAttrs | null {
  switch (name) {
    case "bfseries": return { ...a, ser: "bx" }
    case "mdseries": return { ...a, ser: "m" }
    case "itshape": return { ...a, shape: mergeShape(k, size, a, "it", doc) }
    case "slshape": return { ...a, shape: mergeShape(k, size, a, "sl", doc) }
    case "scshape": return { ...a, shape: mergeShape(k, size, a, "sc", doc) }
    case "upshape": return { ...a, shape: mergeShape(k, size, a, "up", doc) }
    case "rmfamily": return { ...a, fam: "cmr" }
    case "sffamily": return { ...a, fam: "cmss" }
    case "ttfamily": return { ...a, fam: "cmtt" }
    case "normalfont": return { ...a, fam: "cmr", ser: "m", shape: "n" }
  }
  return null
}
const fontMemo = new Map<string, Font>()
/** A font at a size, loaded once */
export function fontAt(name: string, at: number, hyphenChar?: number): Font {
  const key = `${name}@${at}`
  let f = fontMemo.get(key)
  if (!f) { f = loadFont(dataFont(name), at); fontMemo.set(key, f) }
  if (hyphenChar !== undefined) f.hyphenChar = hyphenChar
  return f
}
/** \selectfont: the font for the attributes at a size, from the class data (NFSS's substitute for an undeclared shape) */
export function selectFont(k: ClassOptionData, size: SizeCommand, a: FontAttrs): Font {
  const r = k.sizes[size].fonts[`${a.enc}/${a.fam}/${a.ser}/${a.shape}`]
  if (!r) throw new Error(`no font ${a.enc}/${a.fam}/${a.ser}/${a.shape} at ${size}`)
  return fontAt(r.name, r.at, r.hyphenchar)
}
/** A font command's attributes; \em turns italic in an upright font and upright in a slanted one */
function applyFontCommand(cmd: FontCommand, a: FontAttrs, cur: Font, base: FontAttrs, k: ClassOptionData, size: SizeCommand, doc: DocState): FontAttrs {
  switch (cmd) {
    case "textbf": return { ...a, ser: "bx" }
    case "textmd": return { ...a, ser: "m" }
    case "textit": return { ...a, shape: mergeShape(k, size, a, "it", doc) }
    case "textsl": return { ...a, shape: mergeShape(k, size, a, "sl", doc) }
    case "textsc": return { ...a, shape: mergeShape(k, size, a, "sc", doc) }
    case "textup": return { ...a, shape: mergeShape(k, size, a, "up", doc) }
    case "textrm": return { ...a, fam: "cmr" }
    case "textsf": return { ...a, fam: "cmss" }
    case "texttt": return { ...a, fam: "cmtt" }
    case "textnormal": return { ...base, fam: "cmr", ser: "m", shape: "n" }
    case "emph": return { ...a, shape: mergeShape(k, size, a, cur.params[SLANT] > 0 ? "up" : "it", doc) } // \eminnershape is \upshape
  }
}

/**
 * \sw@slant (latex.ltx): the italic correction of the character before, with a skip at the end of
 * the list taken off first (\unskip … \hskip) and a penalty too (\fix@penalty)
 */
/** \/ (append_italic_correction, § 1113): an explicit kern of the last character's italic correction, if the list ends with one */
function italicCorrection(list: Node[]) {
  const tail = list[list.length - 1]
  if (tail?.kind === "char") list.push(kern(fontAt(tail.font, tail.size).chars.get(tail.char)!.italic, true))
}
function swSlant(list: Node[]) {
  const last = list[list.length - 1]
  const skip = last?.kind === "glue" && last.width !== 0 ? (list.pop() as GlueNode) : null
  const l2 = list[list.length - 1]
  const pen = l2?.kind === "penalty" && l2.penalty !== 0 ? list.pop() : null
  italicCorrection(list)
  if (pen) list.push(pen)
  if (skip) list.push(glue(skip.width, skip.stretch, skip.stretchOrder, skip.shrink, skip.shrinkOrder))
}

function pieces(body: string, footnotes = true): Piece[] {
  const out: Piece[] = []
  let i = 0, text = ""
  const flushText = () => {
    if (text) out.push({ kind: "text", src: text })
    text = ""
  }
  while (i < body.length) {
    // \# \% \& are \chardef'd: the character, with ligatures and kerns as any other; \$ is \textdollar (TS1)
    if (body[i] === "\\" && "#%&".includes(body[i + 1] ?? "")) { text += body[i + 1]; i += 2; continue }
    if (body.startsWith("\\$", i)) { flushText(); out.push({ kind: "symbol", name: "textdollar" }); i += 2; continue }
    // a text symbol (\textdegree …); the spaces after a control word go
    const sym = body.slice(i).match(/^\\([A-Za-z]+)(?![A-Za-z])\s*/)
    if (sym && sym[1] in TEXT_SYMBOLS) { flushText(); out.push({ kind: "symbol", name: sym[1] }); i += sym[0].length; continue }
    // \, in text: \thinspace, \kern.16667em
    if (body.startsWith("\\,", i)) { flushText(); out.push({ kind: "thinspace" }); i += 2; continue }
    if (body[i] === "~") { flushText(); out.push({ kind: "tie" }); i++; continue }
    // \\ (\@ifnextchar skips the spaces after it, but not after \\[skip]'s ])
    const nl = body.slice(i).match(/^\\\\(\*)?(?:\s*\[([^\]]*)\]|\s*)/)
    if (nl) { flushText(); out.push({ kind: "newline", star: !!nl[1], skip: nl[2] ?? null }); i += nl[0].length; continue }
    const sp = body.slice(i).match(/^\\(hfill|hfil|quad|qquad)(?![A-Za-z])\s*/)
    if (sp) { flushText(); out.push({ kind: "space", cmd: sp[1] as "hfill" }); i += sp[0].length; continue }
    // \textcolor[model]{spec}{text}; a group that starts with \color[model]{spec} (\color skips the spaces after it)
    const tc = body.slice(i).match(/^\\textcolor(?![A-Za-z])\s*(?:\[([^\]{}]*)\])?\s*\{([^{}]*)\}\s*\{/) ?? body.slice(i).match(/^\{\\(?:color|LXcolorpushed)(?![A-Za-z])\s*(?:\[([^\]{}]*)\])?\s*\{([^{}]*)\}\s*/)
    if (tc) {
      const open = i + tc[0].length - (tc[0].startsWith("{") ? tc[0].length : 1)
      let depth = 0, j = open
      for (; j < body.length; j++) { if (body[j] === "{") depth++; else if (body[j] === "}" && --depth === 0) break }
      if (j >= body.length) throw new Error("paragraph adapter: unbalanced color group")
      flushText(); out.push({ kind: "color", spec: tc[2], model: tc[1], inner: pieces(body.slice(i + tc[0].length, j), footnotes), ...(tc[0].startsWith("{\\LXcolorpushed") ? { pushed: true } : {}) }); i = j + 1; continue
    }
    const sz = body.slice(i).match(new RegExp(`^\\{\\\\(${SIZE_COMMANDS.join("|")})(?![A-Za-z])\\s*`))
    if (sz) {
      let depth = 0, j = i
      for (; j < body.length; j++) { if (body[j] === "{") depth++; else if (body[j] === "}" && --depth === 0) break }
      if (j >= body.length) throw new Error("paragraph adapter: unbalanced {")
      flushText(); out.push({ kind: "size", size: sz[1] as SizeCommand, inner: pieces(body.slice(i + sz[0].length, j), footnotes) }); i = j + 1; continue
    }
    const cite = body.slice(i).match(/^\\cite\{([A-Za-z0-9:._,\s-]+)\}/)
    if (cite) { flushText(); out.push({ kind: "cite", keys: cite[1].split(",").map((x) => x.trim()) }); i += cite[0].length; continue }
    const lst = body.slice(i).match(/^\\LXlstinline\{(\d+)\}/) // \lstinline, taken out before expansion
    if (lst) { flushText(); out.push({ kind: "lstinline", n: Number(lst[1]) }); i += lst[0].length; continue }
    const gr = body.slice(i).match(/^\\LXgraphic\{(\d+)\}/) // \includegraphics
    if (gr) { flushText(); out.push({ kind: "graphic", n: Number(gr[1]) }); i += gr[0].length; continue }
    const url = body.slice(i).match(/^\\LXurl\{(\d+)\}/) // \url, taken out before expansion
    if (url) { flushText(); out.push({ kind: "url", n: Number(url[1]) }); i += url[0].length; continue }
    const href = body.slice(i).match(/^\\LXhref\{(\d+)\}\s*\{/) // \href{address}{text}: the text in an \hbox, no footnotes or labels
    if (href) {
      const open = i + href[0].length - 1, j = closingBrace(body, open)
      flushText(); out.push({ kind: "href", n: Number(href[1]), inner: pieces(body.slice(open + 1, j), false) }); i = j + 1; continue
    }
    const tab = body.slice(i).match(/^\\LXtabular\{(\d+)\}/)
    if (tab) { flushText(); out.push({ kind: "tabular", n: Number(tab[1]) }); i += tab[0].length; continue }
    const mp = body.slice(i).match(/^\\LXminipage\{(\d+)\}/)
    if (mp) { flushText(); out.push({ kind: "minipage", n: Number(mp[1]) }); i += mp[0].length; continue }
    if (/^\\underline\s*\{/.test(body.slice(i))) { // the text in an \hbox: no footnotes or labels
      const open = body.indexOf("{", i), j = closingBrace(body, open)
      flushText(); out.push({ kind: "underline", inner: pieces(body.slice(open + 1, j), false) }); i = j + 1; continue
    }
    const cur = body.slice(i).match(/^\\LXcurrentlabel\{([^{}]*)\}\{([^{}]*)\}/) // a \refstepcounter's, where it stands
    if (cur) { flushText(); out.push({ kind: "currentlabel", label: cur[1], href: cur[2] }); i += cur[0].length; continue }
    // amsmath's \eqref{key}: \textup{\tagform@{\ref{key}}}
    const eqref = body.slice(i).match(/^\\eqref\{([A-Za-z0-9:._-]+)\}/)
    if (eqref) {
      flushText(); out.push({ kind: "font", cmd: "textup", src: "\\tagform@", inner: [{ kind: "tagref", key: eqref[1] }], next: body[i + eqref[0].length] ?? "" }); i += eqref[0].length; continue
    }
    const ref = body.slice(i).match(/^\\(label|ref|pageref)\{([A-Za-z0-9:._-]+)\}/)
    if (ref) {
      if (ref[1] === "label" && !footnotes) throw new Error("paragraph adapter: \\label in a footnote")
      flushText(); out.push({ kind: ref[1] as "label" | "ref" | "pageref", key: ref[2] } as Piece); i += ref[0].length; continue
    }
    // an empty group: no node, but no ligature or kern across it
    if (body.startsWith("{}", i)) { flushText(); i += 2; continue }
    if (body[i] === "$") {
      const j = body.indexOf("$", i + 1)
      if (j < 0) throw new Error("paragraph adapter: unbalanced $")
      flushText(); out.push({ kind: "math", src: body.slice(i + 1, j) }); i = j + 1
    } else if (body[i] === "\\" && FONT_COMMANDS.some((c) => body.startsWith(`\\${c}{`, i) || body.startsWith(`\\${c} {`, i))) {
      const cmd = body.slice(i + 1).match(/^[a-z]+/)![0] as FontCommand
      const open = body.indexOf("{", i), j = closingBrace(body, open)
      const src = body.slice(open + 1, j)
      flushText(); out.push({ kind: "font", cmd, src, inner: pieces(src, footnotes), next: body[j + 1] ?? "" }); i = j + 1
    } else if (footnotes && body.startsWith("\\footnote{", i)) {
      let depth = 0, j = i + 9
      for (; j < body.length; j++) { if (body[j] === "{") depth++; else if (body[j] === "}" && --depth === 0) break }
      if (j >= body.length) throw new Error("paragraph adapter: unbalanced \\footnote{")
      flushText(); out.push({ kind: "footnote", src: body.slice(i + 10, j) }); i = j + 1
    } else {
      if ("\\{}%&#^_~".includes(body[i])) throw new Error(`paragraph adapter accepts plain text, $…$ and \\footnote{…}: ${body.slice(i, i + 40)}`)
      text += body[i++]
    }
  }
  flushText()
  return out
}

const sizeFont = (k: ClassOptionData, size: SizeCommand) => { const f = k.sizes[size].font; return loadFont(dataFont(f.name), f.at) }

/**
 * \@makefnmark at a size: \hbox{\@textsuperscript{\normalfont N}}, that is
 * \hbox{$^{\mbox{N}}$} with \mathsurround=0pt and N in roman at \sf@size.
 */
function footnoteMark(n: number, k: ClassOptionData, size: SizeCommand, amsmath = false): BoxNode {
  // \normalfont at \sf@size: math family 0's script font, or with T1 the EC font of that size
  const ref = k.ints.T1 ? { name: `ecrm${String(Math.round(k.sizes[size].scriptSize / 655.36)).padStart(4, "0")}`, at: k.sizes[size].scriptSize } : k.sizes[size].math.script[0]
  const digits: Node[] = []
  appendText(digits, String(n), loadFont(dataFont(ref.name), ref.at), { spaceFactor: 1000 }, false)
  const mbox = hpack(digits)
  const formula = mlistToHlist([{ noad: ORD, nucleus: null, sup: { kind: "box", box: mbox }, sub: null }], mathEnv(k, size, amsmath), TEXT, false)
  return hpack([{ kind: "math", on: true, width: 0 }, ...formula, { kind: "math", on: false, width: 0 }])
}

/** Interline glue (§ 679) and the box, appended to a vertical list; returns the new \prevdepth. */
export function appendToVlist(out: Node[], box: BoxNode, prevDepth: number | null, baselineskip: GlueSpec, lineskip: GlueSpec, lineskiplimit: number): number {
  if (prevDepth !== null) {
    const d = baselineskip.width - prevDepth - box.height
    out.push(d < lineskiplimit ? spec("lineskip", lineskip) : spec("baselineskip", baselineskip, d))
  }
  out.push(box)
  return box.depth
}

/**
 * \@footnotetext: \insert\footins{\footnotesize … \@parboxrestore \@makefntext{\rule\z@\footnotesep
 * text \@finalstrut\strutbox}\par}, with the article class's \@makefntext:
 * \noindent\hb@xt@1.8em{\hss\@makefnmark}. Returns the insertion and the
 * footnote paragraph's line-breaking trace.
 */
function footnoteInsert(src: string, n: number, ctx: PieceContext, hn = 0) {
  const { k } = ctx
  const fs: SizeCommand = "footnotesize"
  const font = sizeFont(k, fs)
  const em = font.params[QUAD]
  // the paragraph's parameters, less what normal_paragraph (§ 1070) resets at \insert and what
  // \@parboxrestore sets: \leftskip, \rightskip 0, \parfillskip \@flushglue, \sloppy
  // (\tolerance 9999, \emergencystretch 3em)
  const params: LineBreakParams = { ...ctx.params, looseness: 0, hangIndent: 0, hangAfter: 1, parShape: [], prevGraf: 0, widowPenalty: ctx.noteWidow ?? k.ints.widowpenalty, ...(ctx.noteClub !== undefined ? { clubPenalty: ctx.noteClub } : {}) }
  Object.assign(params, {
    hsize: k.dimens.columnwidth, leftSkip: spec("leftskip", ZERO), rightSkip: spec("rightskip", ZERO), parFillSkip: paramGlue("parfillskip", filGlue()),
    tolerance: 9999, emergencyStretch: new Scanner("3em", { em, ex: 0 }).scanDimen().value, interLinePenalty: k.ints.interfootnotelinepenalty,
  })
  params.hyphenation = hyphenation(k, font)
  const markBox = hpack([ssGlue(), footnoteMark(n, k, fs, ctx.amsmath)], { exactly: new Scanner("1.8em", { em, ex: 0 }).scanDimen().value })
  const strut = hpack([{ kind: "rule", width: 0, height: k.dimens.footnotesep, depth: 0 }]) // \rule\z@\footnotesep
  const list: Node[] = [markBox, strut]
  if (hn) list.push(...spotAnchor(`Hfootnote.${hn}`, "h", strut)) // hyperref's \hyper@@anchor after the strut
  appendPieces(list, pieces(squeeze(src), false), font, fs, { spaceFactor: 1000, ...(ctx.sfcodes ? { sfcodes: ctx.sfcodes } : {}) }, { ...ctx, base: { ...ctx.base, fam: "cmr", ser: "m", shape: "n" } }) // \reset@font
  if (list.at(-1)?.kind === "glue") list.pop() // \unskip
  list.push(penalty(10000), { kind: "rule", width: 0, height: 0, depth: k.sizes[fs].strut.depth }) // \@finalstrut\strutbox
  const { vlist, trace } = lineBreak(list, params)
  // the insertion's vertical list starts with \prevdepth = ignore_depth (§ 1099)
  const v: Node[] = []
  let prevDepth: number | null = null
  for (const x of vlist) {
    if (x.kind === "hlist") prevDepth = appendToVlist(v, x, prevDepth, k.sizes[fs].baselineskip, k.glue.normallineskip, k.dimens.normallineskiplimit)
    else v.push(x)
  }
  const box = vpack(v)
  const ins: InsNode = {
    kind: "ins", n: k.ints.footins, height: box.height + box.depth, depth: k.sizes[fs].strut.depth,
    splitTopSkip: glue(k.dimens.footnotesep), floatCost: 20000, list: v,
  }
  return { ins, trace }
}

const ZERO: GlueSpec = { width: 0, stretch: 0, stretchOrder: 0, shrink: 0, shrinkOrder: 0 }
const glueOf = (g: GlueSpec): GlueNode => glue(g.width, g.stretch, g.stretchOrder, g.shrink, g.shrinkOrder)

function hyphenation(k: ClassOptionData, font: ReturnType<typeof loadFont>): LineBreakParams["hyphenation"] {
  return {
    hyphenator: hyphenator(),
    fontOf: (name, size) => (name === font.name && size === font.size ? font : fontAt(name, size)),
    lHyf: k.ints.lefthyphenmin, rHyf: k.ints.righthyphenmin, ucHyph: k.ints.uchyph,
  }
}

/** What text, formulas and footnotes are built with; footnote paragraphs' traces go to `notes`. */
interface PieceContext { k: ClassOptionData; params: LineBreakParams; mathSurround: number; doc: DocState; notes: ParagraphTrace[]; noteClub?: number; leadGroupNoteClub?: number; /** the paragraph's first piece */ lead?: Piece; noteWidow?: number; sfcodes?: Record<number, number>; amsmath?: boolean; base: FontAttrs; /** \ignorespaces after a \label */ ignoreSpaces?: boolean; /** the current color (xcolor), when not the document's */ color?: string; /** restricted horizontal mode (no discretionary after a hyphen) */ restricted?: boolean }

/** \linewidth where the paragraph is: its \parshape's last width (in a list), else \hsize */
const lineWidthOf = (ctx: PieceContext) => (ctx.params.parShape.length ? ctx.params.parShape[ctx.params.parShape.length - 1][1] : ctx.params.hsize)

/** Text, formulas and footnotes into a horizontal list. */
function appendPieces(list: Node[], ps: Piece[], font: Font, size: SizeCommand, state: { spaceFactor: number; sfcodes?: Record<number, number> }, ctx: PieceContext, attrs: FontAttrs = ctx.base) {
  const { k, mathSurround, doc } = ctx
  for (const p of ps) {
    if (p.kind === "text") { appendText(list, ctx.ignoreSpaces ? p.src.replace(/^ +/, "") : p.src, font, state, !ctx.restricted); ctx.ignoreSpaces = false; continue }
    if (p.kind === "currentlabel") {
      if (doc.refs) { doc.refs.label = p.label; doc.refs.href = p.href }
      if (doc.refs?.hyper) list.push(...anchor(p.href, k.sizes[size].baselineskip.width, "h", list.at(-1))) // hyperref's anchor where it stands
      continue
    }
    ctx.ignoreSpaces = false
    if (p.kind === "newline") {
      // \@gnewline: \unskip, \vadjust{\nobreak \vskip skip} for * and [skip], \nobreak\hfil\break
      if (list.at(-1)?.kind === "glue") list.pop()
      const adj: Node[] = [...(p.star ? [penalty(10000)] : []), ...(p.skip ? [glueOf(new Scanner(p.skip, { em: font.params[QUAD], ex: font.params[X_HEIGHT] }).scanGlue())] : [])]
      if (adj.length) list.push({ kind: "adjust", list: adj })
      list.push(penalty(10000), filGlue(), penalty(-10000))
      if (!p.skip) ctx.ignoreSpaces = true
    }
    else if (p.kind === "space") list.push(p.cmd === "hfill" ? fillGlue() : p.cmd === "hfil" ? filGlue() : glue(font.params[QUAD] * (p.cmd === "qquad" ? 2 : 1)))
    else if (p.kind === "size") appendPieces(list, p.inner, selectFont(k, p.size, attrs), p.size, state, ctx, attrs)
    else if (p.kind === "cite") {
      // \@citex: \@cite{numbers}: [, each \hbox{number} (undefined: \hbox{\reset@font\bfseries ?}) after
      // ,\penalty\@m\  , then ]
      appendText(list, "[", font, state, !ctx.restricted)
      p.keys.forEach((key, i) => {
        if (i) {
          appendText(list, ",", font, state, !ctx.restricted)
          list.push(penalty(1000), glue(font.params[SPACE], font.params[SPACE_STRETCH], NORMAL, font.params[SPACE_SHRINK], NORMAL))
        }
        const n = doc.refs?.cites?.get(key), l: Node[] = []
        if (n) appendText(l, n, font, { spaceFactor: 1000 }, false)
        else appendText(l, "?", selectFont(k, size, { ...attrs, fam: "cmr", ser: "bx", shape: "n" }), { spaceFactor: 1000 }, false)
        list.push(hpack(l))
        state.spaceFactor = 1000
      })
      appendText(list, "]", font, state, !ctx.restricted)
    }
    else if (p.kind === "tie") { // \nobreakspace: \leavevmode\nobreak\ (a control space: the font's interword glue)
      list.push(penalty(10000), glue(font.params[SPACE], font.params[SPACE_STRETCH], NORMAL, font.params[SPACE_SHRINK], NORMAL))
    }
    else if (p.kind === "label") {
      // \@bsphack, the write, \@esphack: after a space, \nobreak\hskip\z@skip and \ignorespaces
      if (!doc.refs) throw new Error("paragraph adapter: \\label outside a document")
      const last = list[list.length - 1]
      const savsk = last?.kind === "glue" ? last.width : 0
      list.push(labelWrite(doc.refs, p.key))
      if (savsk > 0) { list.push(penalty(10000), glue(0)); ctx.ignoreSpaces = true }
    }
    else if (p.kind === "tagref") {
      // \tagform@: \maketag@@@{(\ignorespaces\ref{key}\unskip\@@italiccorr)}, \maketag@@@: \hbox{\m@th\normalfont#1}
      if (!ctx.amsmath) throw new Error("paragraph adapter: \\eqref without amsmath")
      const nf: FontAttrs = { enc: k.ints.T1 ? "T1" : "OT1", fam: "cmr", ser: "m", shape: "n" }, f = selectFont(k, size, nf)
      const inner: Node[] = [], st = { spaceFactor: 1000 }
      appendText(inner, "(", f, st, false)
      appendPieces(inner, [{ kind: "ref", key: p.key }], f, size, st, { ...ctx, restricted: true }, nf)
      italicCorrection(inner)
      appendText(inner, ")", f, st, false)
      list.push(hpack(inner))
      state.spaceFactor = 1000
    }
    else if (p.kind === "ref" || p.kind === "pageref") {
      // \@setref: the label's number or page and \null; undefined, \nfss@text{\reset@font\bfseries ??}
      const known = doc.refs?.prev?.get(p.key)
      if (known && doc.refs!.hyper) { // hyperref: a link around the text, which keeps its space factor (\Hy@SaveSpaceFactor)
        if (p.kind === "ref" && !known.label) continue // \Hy@setref@link: no link for an empty text
        const text: Node[] = []
        appendText(text, p.kind === "ref" ? known.label : known.page, font, state, !ctx.restricted)
        list.push(...refLink(text, known.href, doc.xcolor ? ctx.color ?? "gray 0" : undefined))
        continue
      }
      if (known) { appendText(list, p.kind === "ref" ? known.label : known.page, font, state, !ctx.restricted); list.push(hpack([])) }
      else {
        const qq: Node[] = []
        appendText(qq, "??", selectFont(k, size, { ...attrs, fam: "cmr", ser: "bx", shape: "n" }), { spaceFactor: 1000 }, false)
        list.push(hpack(qq))
      }
      state.spaceFactor = 1000
    }
    // \textdollar: in T1 the text font's own; otherwise the TS1 font of the same family, series and shape
    else if (p.kind === "color") {
      if (!doc.color) throw new Error("paragraph adapter: color without xcolor")
      const spec = doc.color(p.spec, p.model), outer = ctx.color
      if (!p.pushed) list.push({ kind: "whatsit", text: `\\special{color push ${spec}}` })
      ctx.color = spec
      const noteClub = ctx.noteClub
      if (p.pushed && ctx.leadGroupNoteClub !== undefined) ctx.noteClub = ctx.leadGroupNoteClub
      appendPieces(list, p.inner, font, size, state, ctx, attrs)
      ctx.noteClub = noteClub
      ctx.color = outer
      ctx.ignoreSpaces = false // \ignorespaces stops at the closing brace
      list.push({ kind: "whatsit", text: "\\special{color pop}" })
    }
    else if (p.kind === "graphic") {
      if (!doc.graphic) throw new Error("paragraph adapter: \\includegraphics outside a document")
      list.push(...doc.graphic(p.n, lineWidthOf(ctx), { em: font.params[QUAD], ex: font.params[X_HEIGHT] })) // (em and ex: the current font's)
      state.spaceFactor = 1000 // after a box
    }
    else if (p.kind === "tabular") { // \leavevmode\hbox{$…$}
      if (!doc.tabular) throw new Error("paragraph adapter: a tabular outside a document")
      // (a tabular that starts the paragraph starts it in its group: the \everypar's \clubpenalty there is its own)
      const lead = p === ctx.lead && ctx.leadGroupNoteClub !== undefined
      list.push(doc.tabular(p.n, size, attrs, state.sfcodes, { notes: ctx.notes, club: lead ? ctx.leadGroupNoteClub! : ctx.noteClub ?? ctx.params.clubPenalty, widow: ctx.noteWidow ?? k.ints.widowpenalty, finalHyph: ctx.params.finalHyphenDemerits, lineWidth: lineWidthOf(ctx) }))
      state.spaceFactor = 1000
    }
    else if (p.kind === "minipage") { // \leavevmode, then \@iiiparbox's box (in its group, like a tabular's)
      if (!doc.minipage) throw new Error("paragraph adapter: a minipage outside a document")
      const lead = p === ctx.lead && ctx.leadGroupNoteClub !== undefined
      list.push(...doc.minipage(p.n, size, attrs, state.sfcodes, { notes: ctx.notes, club: lead ? ctx.leadGroupNoteClub! : ctx.noteClub ?? ctx.params.clubPenalty, widow: ctx.noteWidow ?? k.ints.widowpenalty, finalHyph: ctx.params.finalHyphenDemerits, lineWidth: lineWidthOf(ctx) }))
      state.spaceFactor = 1000
    }
    else if (p.kind === "underline") { // $\@@underline{\hbox{#1}}\m@th$: the box as an under noad's nucleus
      const inner: Node[] = []
      appendPieces(inner, p.inner, font, size, { ...state, spaceFactor: 1000 }, { ...ctx, restricted: true }, attrs)
      const noad: MItem = { noad: ORD, line: "under", nucleus: { kind: "box", box: hpack(inner) }, sup: null, sub: null }
      list.push({ kind: "math", on: true, width: 0 }, ...mlistToHlist([noad], mathEnv(k, size, ctx.amsmath), TEXT, !ctx.restricted), { kind: "math", on: false, width: 0 })
      ctx.ignoreSpaces = false
      state.spaceFactor = 1000
    }
    else if (p.kind === "lstinline") {
      if (!doc.lstinline) throw new Error("paragraph adapter: \\lstinline outside a document")
      list.push(...doc.lstinline(p.n, size, attrs))
      state.spaceFactor = 1000
    }
    else if (p.kind === "href") {
      if (!doc.href) throw new Error("paragraph adapter: \\href outside a document")
      // the text in the link's box, which starts with the space factor before it and leaves its own after it
      // (\Hy@SaveSpaceFactor, \Hy@RestoreSpaceFactor)
      const inner: Node[] = []
      appendPieces(inner, p.inner, font, size, state, { ...ctx, restricted: true }, attrs)
      list.push(...doc.href(p.n, inner, doc.xcolor ? ctx.color ?? "gray 0" : undefined))
      ctx.ignoreSpaces = false
    }
    else if (p.kind === "url") {
      if (!doc.url) throw new Error("paragraph adapter: \\url outside a document")
      list.push(...doc.url(p.n, size, attrs, !ctx.restricted, doc.xcolor ? ctx.color ?? "gray 0" : undefined))
      state.spaceFactor = 1000 // after \mathoff
    }
    else if (p.kind === "symbol") {
      // \DeclareTextSymbol in the current encoding, else the default's (\UseTextSymbol: the companion font, TS1)
      const codes = TEXT_SYMBOLS[p.name], own = codes[attrs.enc]
      const f = own !== undefined ? font : selectFont(k, size, { ...attrs, enc: "TS1" })
      appendText(list, String.fromCharCode(own ?? codes.TS1!), f, state, !ctx.restricted)
    }
    else if (p.kind === "thinspace") { // \tmspace+\thinmuskip{.16667em}; amsmath's says .1667em
      list.push(kern(parseDimen(ctx.amsmath ? ".1667em" : ".16667em", { em: font.params[QUAD], ex: font.params[X_HEIGHT] }), true))
    }
    else if (p.kind === "font") {
      // \DeclareTextFontCommand: {\text@command{#1}<switch>\check@icl #1\check@icr}; an empty argument (or a
      // lone space) has no italic corrections; one before the argument if the new font is upright and the
      // argument does not start with , or . ; one after it if the font around is upright and no , or . follows
      const a = applyFontCommand(p.cmd, attrs, font, ctx.base, k, size, doc)
      const inner = selectFont(k, size, a)
      const key = `${a.enc}/${a.fam}/${a.ser}/${a.shape}`
      if (!k.sizes[size].fonts[key].declared) (doc.substituted ??= new Set()).add(key) // \wrong@fontshape
      const corr = p.src !== "" && p.src !== " "
      if (corr && inner.params[SLANT] <= 0 && !",.".includes(p.src[0])) swSlant(list)
      appendPieces(list, p.inner, inner, size, state, ctx, a)
      ctx.ignoreSpaces = false // \ignorespaces stops at the closing brace
      if (corr && font.params[SLANT] <= 0 && !(p.next === "," || p.next === ".")) swSlant(list)
    }
    else if (p.kind === "math") {
      // after_math (§ 1196): \mathon, the formula in text style with penalties, \mathoff
      list.push({ kind: "math", on: true, width: mathSurround }, ...mlistToHlist(parseFormula(p.src, ctx.amsmath), mathEnv(k, size, ctx.amsmath), TEXT, !ctx.restricted), { kind: "math", on: false, width: mathSurround })
      state.spaceFactor = 1000
    } else {
      // \footnote: \stepcounter, \@footnotemark (\nobreak, the mark, the space factor kept), \@footnotetext
      const n = ++doc.footnote
      // hyperref: the mark in a link to the note's anchor (\hyper@linkstart{link}{Hfootnote.n} … \hyper@linkend)
      const hn = doc.refs?.hyper ? (doc.refs.hfootnotes = (doc.refs.hfootnotes ?? 0) + 1) : 0
      const mark = footnoteMark(n, k, size, ctx.amsmath)
      list.push(penalty(10000), hn ? tocLink([mark], `Hfootnote.${hn}`, k.sizes[size].baselineskip.width) : mark)
      const { ins, trace } = footnoteInsert(p.src, n, ctx, hn)
      list.push(ins)
      ctx.notes.push(trace)
    }
  }
}

/**
 * Material in restricted horizontal mode (a tabular cell): text, formulas, font, size and color
 * commands, in the font `attrs` at `size`; no footnotes or labels.
 */
export function hlistInput(body: string, k: ClassOptionData, size: SizeCommand, doc: DocState, attrs: FontAttrs, state = { spaceFactor: 1000 }, amsmath = false, color?: string): Node[] {
  const list: Node[] = []
  const base: FontAttrs = { enc: k.ints.T1 ? "T1" : "OT1", fam: "cmr", ser: "m", shape: "n" }
  appendPieces(list, pieces(body.replace(/\s+/g, " "), false), selectFont(k, size, attrs), size, state, { k, params: classParams(k), mathSurround: mathData().dimens.mathsurround, doc, notes: [], amsmath, base, restricted: true, ...(color ? { color } : {}) }, attrs)
  return list
}

/**
 * One paragraph of text, inline math and footnotes with leading assignments, as
 * the horizontal list TeX builds for it and the line-breaking parameters in
 * force. `notes` are the footnote paragraphs' traces, which TeX breaks first.
 */
export function paragraphInput(body: string, k: ClassOptionData = classData("article", "10pt"), size: SizeCommand = "normalsize", doc: DocState = { footnote: 0 }, opts: ParagraphOptions = {}): { list: Node[]; params: LineBreakParams; notes: ParagraphTrace[] } {
  const params = classParams(k)
  const font = opts.attrs ? selectFont(k, size, opts.attrs) : opts.font ? loadFont(dataFont(opts.font.name), opts.font.at) : sizeFont(k, size)
  const env = { em: font.params[QUAD], ex: font.params[X_HEIGHT] }
  let indent = true
  let mathSurround = mathData().dimens.mathsurround
  body = squeeze(body)
  // leading paragraph assignments, scanned as TeX scans them (§§ 440–463)
  for (;;) {
    const m = body.match(/^\\([a-z]+)\s*/)
    if (!m) break
    const name = m[1]
    if (name === "noindent") { indent = false; body = body.slice(m[0].length); continue }
    if (!(name in INT_PARAMS || name in DIMEN_PARAMS || name === "parshape" || name === "mathsurround")) break
    const s = new Scanner(body.slice(m[0].length).replace(/^=\s*/, ""), env) // optional equals (§ 1224)
    if (name in INT_PARAMS) params[INT_PARAMS[name as keyof typeof INT_PARAMS]] = s.scanInt().value
    else if (name in DIMEN_PARAMS) params[DIMEN_PARAMS[name as keyof typeof DIMEN_PARAMS]] = s.scanDimen().value
    else if (name === "mathsurround") mathSurround = s.scanDimen().value
    else {
      const n = s.scanInt().value
      params.parShape = Array.from({ length: n }, () => [s.scanDimen().value, s.scanDimen().value] as [number, number])
    }
    if (s.errors.length) throw new Error(`\\${name}: ${s.errors[0]}`)
    body = s.rest().trimStart()
  }
  const ps = pieces(body)
  params.hyphenation = hyphenation(k, font)
  if (opts.parShape) params.parShape = opts.parShape
  if (opts.hsize !== undefined) params.hsize = opts.hsize
  if (opts.clubPenalty !== undefined) params.clubPenalty = opts.clubPenalty
  if (opts.hangIndent !== undefined) params.hangIndent = opts.hangIndent
  if (opts.interLinePenalty !== undefined) params.interLinePenalty = opts.interLinePenalty
  if (opts.leftSkip) params.leftSkip = opts.leftSkip
  if (opts.rightSkip) params.rightSkip = opts.rightSkip
  if (opts.parFillSkip) params.parFillSkip = opts.parFillSkip
  if (opts.finalHyphenDemerits !== undefined) params.finalHyphenDemerits = opts.finalHyphenDemerits
  if (opts.tolerance !== undefined) params.tolerance = opts.tolerance
  if (opts.pretolerance !== undefined) params.pretolerance = opts.pretolerance
  if (opts.emergencyStretch !== undefined) params.emergencyStretch = opts.emergencyStretch
  if (opts.prevGraf !== undefined) params.prevGraf = opts.prevGraf
  if (opts.widowPenalty !== undefined) params.widowPenalty = opts.widowPenalty
  const list: Node[] = opts.start ?? (indent ? [emptyBox("hlist", k.dimens.parindent)] : [])
  const notes: ParagraphTrace[] = []
  const base: FontAttrs = opts.attrs ?? { enc: k.ints.T1 ? "T1" : "OT1", fam: "cmr", ser: opts.font && opts.font.name === k.sizes[size].bold.name ? "bx" : "m", shape: "n" }
  appendPieces(list, ps, font, size, { spaceFactor: 1000, ...(opts.sfcodes ? { sfcodes: opts.sfcodes } : {}) }, { k, params, mathSurround, doc, notes, lead: ps[0], noteClub: opts.noteClubPenalty, ...(opts.leadGroupNoteClubPenalty !== undefined ? { leadGroupNoteClub: opts.leadGroupNoteClubPenalty } : {}), noteWidow: opts.noteWidowPenalty, sfcodes: opts.sfcodes, amsmath: opts.amsmath, base })
  for (let i = 0; i < (opts.unskip ?? 0) && list.at(-1)?.kind === "glue"; i++) list.pop()
  if (opts.end) list.push(...opts.end)
  return { list, params, notes }
}

/** The body's paragraphs: blank-line separated, or a size group {\large … \par}. */
function paragraphsOf(body: string): { size: SizeCommand; text: string }[] {
  const out: { size: SizeCommand; text: string }[] = []
  const group = new RegExp(`^\\{\\\\(${SIZE_COMMANDS.join("|")})\\s+([^{}]*?)\\\\par\\s*\\}\\s*`)
  body = body.trim()
  while (body) {
    const m = body.match(group)
    if (m) { out.push({ size: m[1] as SizeCommand, text: m[2] }); body = body.slice(m[0].length); continue }
    const end = body.search(new RegExp(`\\n\\s*\\n|\\{\\\\(${SIZE_COMMANDS.join("|")})\\b`))
    const text = end < 0 ? body : body.slice(0, Math.max(end, 1))
    if (text.trim()) out.push({ size: "normalsize", text })
    body = body.slice(text.length).trim()
  }
  return out
}

/**
 * The document body as TeX builds it: each paragraph broken into lines, the
 * main vertical list (§ 679 interline glue, LaTeX's \parskip pair), and the pages
 * cut from it by the page builder.
 */
export function typesetBody(paras: { size: SizeCommand; text: string }[], k: ClassOptionData) {
  // the main vertical list: LaTeX's \write at \begin{document}, then each paragraph's lines
  // with interline glue (§ 679). A paragraph begun in vertical mode gets \parskip
  // (new_graf, § 1091), then a second, zero \parskip: LaTeX's paragraph code (ltpara)
  // restarts the paragraph in a group with \parskip=0pt.
  const contrib: Node[] = [{ kind: "whatsit", text: "\\write-{}" }]
  const decisions: ParagraphTrace[] = []
  const doc: DocState = { footnote: 0 }
  let prevDepth: number | null = null
  let lineCount = 0
  for (const para of paras) {
    const { list, params, notes } = paragraphInput(para.text, k, para.size, doc)
    const { lines, vlist, trace } = lineBreak(list, params)
    decisions.push(...notes, trace) // footnote paragraphs end, and are broken, first
    lineCount += lines.length
    const baselineskip = k.sizes[para.size].baselineskip // in force when \par appends the lines
    contrib.push(spec("parskip", k.glue.parskip), paramGlue("parskip", glue(0)))
    for (const n of vlist) {
      if (n.kind === "hlist") prevDepth = appendToVlist(contrib, n, prevDepth, baselineskip, k.glue.lineskip, k.dimens.lineskiplimit)
      else contrib.push(n)
    }
  }
  const { pages, pageTrace } = endDocument(contrib, k)
  return { decisions, pages, pageTrace, lineCount }
}

export function paragraph(src: string): LayoutResult {
  const { cls, option, extras, unknown } = documentClass(src)
  if (unknown.length) throw new Error(`class option ${unknown.join(",")} is not laid out`)
  const k = classData(cls, option, extras)
  const paras = paragraphsOf(src.slice(src.indexOf("\\begin{document}") + 16, src.indexOf("\\end{document}")))
  const { decisions, pages, pageTrace, lineCount } = typesetBody(paras, k)

  // \@outputpage stacks \topmargin, the \headheight box and \headsep above the column,
  // shifted by \oddsidemargin
  const boxes = makeColumns(pages, k).map((b) => ({ outputbox: b.outputbox, column: b.column! }))
  boxes.forEach((b, i) => { b.outputbox.shift = k.ints.twoside && i % 2 === 1 ? k.dimens.evensidemargin : k.dimens.oddsidemargin }) // \@themargin
  const shipped = boxes.map((b) => vpack([kern(k.dimens.topmargin + k.dimens.headheight + k.dimens.headsep), b.outputbox]))
  return {
    trace: shipOut(shipped),
    decisions,
    pages: pageTrace,
    columns: boxes.map((b) => b.column.map(emitBoxes)),
    notes: [`${cls} [${option}]; ${paras.length} paragraph(s), ${lineCount} lines, ${pages.length} page(s) from the engine's line and page builders`],
  }
}
