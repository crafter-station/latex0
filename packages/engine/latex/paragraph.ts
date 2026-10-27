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
import { parseDimen, parseGlue, Scanner, type GlueSpec } from "../layout/dimen"
import { loadFont, QUAD, SLANT, SPACE, SPACE_SHRINK, SPACE_STRETCH, X_HEIGHT, type Font } from "../layout/font"
import { appendText as appendCodes } from "../layout/hmode"
import { buildHyphenator } from "../layout/hyphenate"
import { lineBreak, type LineBreakParams } from "../layout/linebreak"
import { charNode, emptyBox, NORMAL, glue, kern, paramGlue, penalty, type BoxNode, type GlueNode, type InsNode, type Node, filGlue, fillGlue, ssGlue } from "../layout/nodes"
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
import { endDocument, firstPage, L3BACKEND_HEADER, makeColumns } from "./output"
import { anchor, autorefName, hyperDriver, refLink, spotAnchor, tocLink } from "./hyperref"
import { Unsupported } from "./unsupported"
import { babelAux, babelLanguage, type Babel } from "./babel"
import { SPANISH_OPERATORS, spanishGuillemet, spanishLayout, spanishMath, spanishPercent, spanishShorthand } from "./spanish"
import { ACCENT_COMMAND, accentText, ALLOW_HYPHENS, appendText, TEXT_LETTERS, utf8Text } from "./encodings"
import { xcolor } from "./xcolor"
import { crefOutput, crefRangeOutput, crefWrite, type CrefEntry, type CrefLabel, type CrefOut, type CrefSetup, type CrefWrite } from "./cleveref"
import { singleSpaced } from "./setspace"
import { NAT_COMMANDS, natCite, type NatStyle } from "./natbib"
import { SI_COMMANDS, siunitx, siunitxMath, type SiContext, type SiOptions } from "./siunitx"

export const spec = (param: string, g: GlueSpec, width = g.width): GlueNode => paramGlue(param, glue(width, g.stretch, g.stretchOrder, g.shrink, g.shrinkOrder))

// assignable parameters: TeX name → LineBreakParams field
const INT_PARAMS = {
  hangafter: "hangAfter", looseness: "looseness", tolerance: "tolerance", pretolerance: "pretolerance",
  linepenalty: "linePenalty", adjdemerits: "adjDemerits", hyphenpenalty: "hyphenPenalty", exhyphenpenalty: "exHyphenPenalty",
  doublehyphendemerits: "doubleHyphenDemerits", finalhyphendemerits: "finalHyphenDemerits",
} as const
const DIMEN_PARAMS = { hangindent: "hangIndent", emergencystretch: "emergencyStretch" } as const

const hyphenators = new Map<string, ReturnType<typeof buildHyphenator>>()
const hyphenator = (id = "en-us") => { let h = hyphenators.get(id); if (!h) hyphenators.set(id, (h = buildHyphenator(hyphenationData(id)))); return h }
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

/** The document's math fonts where they are not LaTeX's: `letters`, the family of the Latin letters' \mathcode
 *  (beamer's pureletters: \DeclareMathSymbol{a}\mathalpha{pureletters}{"61}…, the \mathit alphabet's fonts), null
 *  for LaTeX's (letters, cmmi). document() sets it for each run. */
export const mathFonts: { letters: number | null } = { letters: null }
/** \mathalpha (class 7) mathcodes for A–Z and a–z in family `fam` */
const LETTERS = (fam: number): Record<number, number> => Object.fromEntries([..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"].map((c) => [c.charCodeAt(0), 0x7000 | (fam << 8) | c.charCodeAt(0)]))

/** A formula (between $…$) as an mlist, with the document's amsmath and LaTeX's math alphabets; `em`: the current font's;
 *  `si`: siunitx is loaded, and its view of the text around */
export function parseFormula(src: string, amsmath: boolean, em: number, si?: SiContext): MItem[] {
  const commands = si && { arity: SI_COMMANDS, build: (cmd: string, opt: string | undefined, args: string[], fam: number) => siunitxMath(cmd, opt, args, fam, si) }
  const mathcodes = mathFonts.letters === null ? undefined : LETTERS(mathFonts.letters)
  // (spanish.ldf's \mathspanish: its operators and decimal comma)
  const operators = spanishLayout.on ? SPANISH_OPERATORS : undefined
  try { return parseMath(spanishLayout.on ? spanishMath(src) : src, mathData(), { amsmath, alphabets: MATH_ALPHABETS, em, commands, operators, ...(mathcodes ? { mathcodes } : {}) }) } catch (e) { throw e instanceof Unsupported ? e : new Unsupported((e as Error).message) } // (what the parser does not read)
}

/** siunitx's view of the text at a size in a font: \text{\textmu} (its text font reset to the defaults) and \text{…} */
export function siContext(k: ClassOptionData, size: SizeCommand, font: Font, options: SiOptions): SiContext {
  const micro = () => hpack([charNode(selectFont(k, size, { enc: "TS1", fam: "cmr", ser: "m", shape: "n" }), 0xb5)])
  const text = (src: string) => { const box: Node[] = []; appendText(box, src, font, { spaceFactor: 1000 }, false); return hpack(box) }
  return { data: mathData(), micro, font, text, options }
}

export function mathEnv(k: ClassOptionData, size: SizeCommand, amsmath = false): MathEnv {
  const m = amsmath ? k.sizes[size].mathAms : k.sizes[size].math, data = mathData()
  return {
    // families 0–3, then the math alphabets' (MATH_ALPHABETS)
    fonts: [m.text, m.script, m.scriptscript].map((fs, s) => [...fs, ...ALPHABET_FONTS.map((a) => k.sizes[size].alphabets[a][s])].map((f) => loadFont(dataFont(f.name), f.at))),
    muskips: data.muskips as MathEnv["muskips"], binoppenalty: data.ints.binoppenalty, relpenalty: data.ints.relpenalty,
    scriptspace: data.dimens.scriptspace, nulldelimiterspace: data.dimens.nulldelimiterspace,
    delimiterfactor: data.ints.delimiterfactor, delimitershortfall: data.dimens.delimitershortfall,
    arraycolsep: k.dimens.arraycolsep, // \@arstrutbox: \strutbox at \arraystretch 1, with array.sty's \extrarowheight
    arstrut: k.array ? { height: k.sizes[size].strut.height + k.array.extrarowheight, depth: k.sizes[size].strut.depth } : k.sizes[size].strut,
    ...(k.array ? { arrayPackage: true } : {}),
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
  /** in \maketitle: \thanks (and \footnote, which is \thanks there) put the mark here and keep the text for \@thanks */
  thanks?: { n: number; src: string }[]
  /** siunitx is loaded: its options */
  siunitx?: SiOptions
  /** subcaption is loaded (\subref) */
  subcaption?: boolean
  /** xcolor is loaded (\normalcolor and \color@setgroup push the color) */
  xcolor?: boolean
  /** the float number n that starts in this paragraph: the marker its \vadjust holds */
  float?: (n: number, traces: ParagraphTrace[], club: number) => Node
  /** babel is loaded: its languages */
  babel?: Babel
  /** natbib is loaded: its citation punctuation */
  natbib?: NatStyle
  /** a color expression as its \special text */
  color?: (spec: string, model?: string) => string
  /** \lstinline number n (taken out of the source before expansion) at a size in a font */
  lstinline?: (n: number, size: SizeCommand, attrs: FontAttrs) => Node[]
  /** \url number n (taken out of the source before expansion) at a size in a font */
  url?: (n: number, size: SizeCommand, attrs: FontAttrs, penalties: boolean, color: string | undefined) => Node[]
  /** \includegraphics number n, with \linewidth where it stands */
  graphic?: (n: number, lineWidth: number, units: { em: number; ex: number }) => Node[]
  /** TikZ's picture number n, with xcolor's current color, the current font's em and ex, and the size and font its nodes' text is in */
  tikz?: (n: number, color: string, units: { em: number; ex: number }, size: SizeCommand, attrs: FontAttrs) => Node[]
  /** the nodes number n that beamer's \beamer@smuggle puts where \LXsmuggle{n} stands (beamer/overlays.ts) */
  smuggle?: (n: number) => Node[]
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
/** a \newlabel's fields: \@currentlabel, \thepage, nameref's \@currentlabelname, \@currentHref */
export interface NewLabel { label: string; page: string; name: string; href: string }

export interface Refs {
  label: string; href: string
  /** \@currentlabelname: hyperref's nameref sets it to a heading's title */
  name: string
  prev: Map<string, NewLabel> | null
  /** \bibcite values the run before wrote: key → number */
  cites?: Map<string, string>
  writes: { node: Node; key: string; label: string; href: string; name: string }[]
  /** nameref is loaded (hyperref loads it): \label writes \@currentlabelname, \nameref reads it */
  nameref?: boolean
  /** hyperref: \ref and \pageref are links to the label's anchor */
  hyper?: boolean
  /** hyperref's \@footnotetext: an anchor in each note */
  hyperNotes?: boolean
  /** hyperref's \c@Hfootnote: footnotes so far, never reset */
  hfootnotes?: number
  /** cleveref: \cref@currentlabel (local where \@currentlabel is), each \refstepcounter's by its \@currentHref, the
   *  second \newlabel writes, the run before's (key → its \cref@currentlabel), and how much of the main vertical list there is */
  cleveref?: { current: CrefLabel | null; byHref: Map<string, CrefLabel>; writes: CrefWrite[]; prev: Map<string, CrefEntry> | null; at: () => number; setup: CrefSetup }
}

/** cleveref's second write of a \label (none without cleveref): `inPara`, read in a paragraph */
export function crefWrites(refs: Refs, key: string, inPara: boolean, cref = refs.cleveref?.current ?? null): Node[] {
  const c = refs.cleveref
  return c ? [crefWrite(c.writes, key, cref, c.at(), inPara)] : []
}

/** \label{key}: \protected@write\@auxout{}{\string\newlabel{key}{{\@currentlabel}{\thepage}{}{\@currentHref}{}}} */
export function labelWrite(refs: Refs, key: string, label = refs.label, href = refs.href, name = refs.name): Node {
  const node: Node = { kind: "whatsit", text: `\\write1{\\newlabel{${key}}{{${label}}{\\thepage }{${name}}{${href}}{}}}` }
  refs.writes.push({ node, key, label, href, name })
  return node
}

/** What a paragraph's surroundings set: the start of its list (in place of the indent box) and its shape. */
export interface ParagraphOptions {
  /** plain groups and font declarations read (no \everypar runs in them here) */
  groups?: boolean
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
  /** declarations at the top level read (they last to the paragraph's end; the caller knows what they set at its \par) */
  topDecls?: boolean
  /** the size in force at the paragraph's \par (declarations in it), when not the one it starts in: its \baselineskip */
  parSize?: SizeCommand
  /** \\ is \@centercr (\centering and friends), which the caller has taken care of: here it is not laid out */
  centercr?: boolean
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
export function closingBrace(body: string, open: number): number {
  let depth = 0
  for (let j = open; j < body.length; j++) {
    if (body[j] === "\\") j++
    else if (body[j] === "{") depth++
    else if (body[j] === "}" && --depth === 0) return j
  }
  throw new Unsupported(`paragraph adapter: unbalanced { in "${body.slice(open, open + 40)}"`)
}

/** A body piece: plain text, a formula $…$, or \footnote{…} (whose text is again text and formulas). */
type Piece =
  | { kind: "text" | "math" | "footnote" | "thanks"; src: string }
  /** a text symbol (TEXT_SYMBOLS), and \, (\thinspace) */
  | { kind: "symbol"; name: string } | { kind: "thinspace" }
  /** spanish.ldf's \%: \es@sppercent\percentsign{} */
  | { kind: "percent" }
  /** spanish.ldf's guillemets: << and >> (the quoting environment's \lquoti, \rquoti), "< and "> */
  | { kind: "guillemet"; right: boolean; quoting: boolean }
  /** ~, \label{key}, \ref{key}, \pageref{key} */
  | { kind: "tie" } | { kind: "ctlspace" } | { kind: "currentlabel"; label: string; href: string }
  /** babel: \selectlanguage{lang}, \begin{otherlanguage}{lang} and its \end (`other`, `endother`), otherlanguage*'s
   *  (`otherstar`, `endotherstar`); \foreignlanguage{lang}{…} */
  | { kind: "babel"; what: "select" | "other" | "endother" | "otherstar" | "endotherstar"; lang: string } | { kind: "foreign"; lang: string; inner: Piece[] } | { kind: "lstinline"; n: number } | { kind: "url"; n: number } | { kind: "href"; n: number; inner: Piece[] } | { kind: "tabular"; n: number } | { kind: "graphic"; n: number } | { kind: "tikz"; n: number } | { kind: "minipage"; n: number } | { kind: "smuggle"; n: number } | { kind: "underline"; inner: Piece[] }
  /** \textcolor[model]{spec}{…} or {\color[model]{spec} …}: the color's push, the group, its pop */
  | { kind: "color"; spec: string; model?: string; inner: Piece[]; /** pushed already (in vertical mode, before the paragraph) */ pushed?: boolean }
  /** \\ in a paragraph (\@normalcr): its * and [skip] */
  | { kind: "newline"; star: boolean; skip: string | null }
  /** \vspace{skip} and \vspace*{skip} in a paragraph */
  | { kind: "vspace"; star: boolean; skip: string | GlueSpec }
  /** \hfill, \hfil, \quad, \qquad */
  | { kind: "space"; cmd: "hfill" | "hfil" | "quad" | "qquad" }
  /** {…}: a group, where groups are read (`PieceOptions.groups`); \bfseries, \itshape …: a declaration for the rest of its group */
  | { kind: "group"; inner: Piece[] } | { kind: "decl"; name: string; inner: Piece[] }
  /** {\large …}: a size command in a group */
  | { kind: "size"; size: SizeCommand; inner: Piece[] } | { kind: "label"; key: string } | { kind: "cite"; keys: string[] } | { kind: "ref"; key: string; sub?: true } | { kind: "pageref"; key: string }
  /** natbib's \citep, \citet and friends (and \cite with notes): the command, its keys, notes and whether an optional argument was given */
  /** a float that starts in the paragraph (\LXfloat{n}) */
  | { kind: "float"; n: number }
  | { kind: "natcite"; cmd: string; keys: string[]; pre: Piece[]; post: Piece[]; optional: boolean }
  /** amsmath's \tagform@ around \ref{key} (in \eqref) */
  | { kind: "tagref"; key: string }
  /** cleveref's \cref{keys}, \Cref, \cpageref and \Cpageref (`star`: no links), \crefrange{a}{b} and friends; what they
   *  print: a link to a label's anchor around its pieces, a bold ?? */
  | { kind: "cref"; keys: string[]; variant: "cref" | "Cref" | "cpageref" | "Cpageref"; star: boolean }
  | { kind: "crefrange"; a: string; b: string; family: "cref" | "Cref"; page: boolean; star: boolean }
  | { kind: "creflink"; key: string; inner: Piece[] } | { kind: "qq" }
  /** hyperref's \autoref{key} and nameref's \nameref{key} (`star`: \autoref*, \nameref*) */
  | { kind: "autoref"; key: string; star: boolean } | { kind: "nameref"; key: string; star: boolean }
  /** \textbf{…} and friends: the command, its argument as pieces, and the characters around the argument
   *  that \check@icl and \check@icr look at (its first, and the one after the closing brace) */
  | { kind: "font"; cmd: FontCommand; src: string; inner: Piece[]; next: string }
  /** a siunitx command (SI_COMMANDS) and its arguments */
  | { kind: "si"; cmd: string; opt?: string; args: string[] }

/** Text symbols (\DeclareTextSymbol): each one's code in the encodings that have it; TS1 is the default's. */
export const TEXT_SYMBOLS: Record<string, Partial<Record<FontAttrs["enc"], number>>> = {
  textdollar: { T1: 36, TS1: 36 },
  textdegree: { TS1: 176 },
  textsection: { T1: 159, TS1: 167 },
  textordfeminine: { TS1: 170 },
  textordmasculine: { TS1: 186 },
}
/** UTF-8 characters that are text symbols (ts1enc.dfu) */
const UTF8_SYMBOLS: Record<string, string> = { "°": "textdegree", "§": "textsection", "ª": "textordfeminine", "º": "textordmasculine" }

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
  if (!rule) { if (target === "up") throw new Unsupported(`no \\upshape rule from ${a.shape}`); return target }
  const declared = (sh: Shape | null) => sh !== null && (k.sizes[size].fonts[`${a.enc}/${a.fam}/${a.ser}/${sh}`]?.declared || doc.substituted?.has(`${a.enc}/${a.fam}/${a.ser}/${sh}`))
  if (declared(rule[0])) return rule[0]
  if (declared(rule[1])) return rule[1]!
  if (target === "up") throw new Unsupported(`\\upshape from ${a.shape}: no shape declared`)
  return target
}
/** A font declaration (\bfseries, \itshape, \ttfamily …) on the attributes; null for one that is not modeled */
export function fontDeclaration(name: string, a: FontAttrs, k: ClassOptionData, size: SizeCommand, doc: DocState, cur?: Font): FontAttrs | null {
  if (name in OLD_FONT_COMMANDS) return fontDeclaration(OLD_FONT_COMMANDS[name], fontDeclaration("normalfont", a, k, size, doc)!, k, size, doc)
  // \em: \eminnershape (\upshape) in a slanted font, else \itshape
  if (name === "em" && cur) return { ...a, shape: mergeShape(k, size, a, cur.params[SLANT] > 0 ? "up" : "it", doc) }
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
  if (!r) throw new Unsupported(`no font ${a.enc}/${a.fam}/${a.ser}/${a.shape} at ${size}`)
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

/** `groups`: plain groups and font declarations read (where no \everypar runs in them: an entry, a p{width} box);
 *  `grouped`: the body is a group's (a declaration lasts to its end) */
interface PieceOptions { groups?: boolean; grouped?: boolean; centercr?: boolean }
export const DECLARATIONS = ["bfseries", "mdseries", "itshape", "slshape", "scshape", "upshape", "rmfamily", "sffamily", "ttfamily", "normalfont"]
/** the classes' old font commands (\DeclareOldFontCommand{\bf}{\normalfont\bfseries}…) */
const OLD_FONT_COMMANDS: Record<string, string> = { rm: "rmfamily", sf: "sffamily", tt: "ttfamily", bf: "bfseries", it: "itshape", sl: "slshape", sc: "scshape" }
/** the declarations a paragraph reads in a group: LaTeX's, the old ones, and \em */
export const BODY_DECLARATIONS = [...DECLARATIONS, ...Object.keys(OLD_FONT_COMMANDS), "em"]
const ALIGN_DECLARATIONS = ["centering", "raggedright", "raggedleft"]
/** \smallskipamount, \medskipamount and \bigskipamount (latex.ltx), which \smallskip … \vspace */
export const SKIP_AMOUNTS: Record<string, GlueSpec> = {
  smallskip: { width: 3 * 65536, stretch: 65536, stretchOrder: 0, shrink: 65536, shrinkOrder: 0 },
  medskip: { width: 6 * 65536, stretch: 2 * 65536, stretchOrder: 0, shrink: 2 * 65536, shrinkOrder: 0 },
  bigskip: { width: 12 * 65536, stretch: 4 * 65536, stretchOrder: 0, shrink: 4 * 65536, shrinkOrder: 0 },
}

function pieces(body: string, footnotes = true, po: PieceOptions = {}): Piece[] {
  const inner: PieceOptions = { ...po, grouped: true }
  const out: Piece[] = []
  let i = 0, text = ""
  const flushText = () => {
    if (text) out.push({ kind: "text", src: text })
    text = ""
  }
  while (i < body.length) {
    // \# \% \& are \chardef'd: the character, with ligatures and kerns as any other; \$ is \textdollar (TS1)
    if (spanishLayout.on) { // spanish.ldf's shorthands
      if (body.startsWith("\\%", i)) { flushText(); out.push({ kind: "percent" }); i += 2; continue }
      const sh = spanishShorthand(body.slice(i, i + 2))
      if (sh) { if (typeof sh === "string") text += sh; else { flushText(); out.push(sh) } i += 2; continue }
    }
    if (body[i] === "\\" && "#%&".includes(body[i + 1] ?? "")) { text += body[i + 1]; i += 2; continue }
    if (body.startsWith("\\$", i)) { flushText(); out.push({ kind: "symbol", name: "textdollar" }); i += 2; continue }
    // a text symbol (\textdegree …); the spaces after a control word go
    const sym = body.slice(i).match(/^\\([A-Za-z]+)(?![A-Za-z])\s*/)
    if (sym && sym[1] in TEXT_SYMBOLS) { flushText(); out.push({ kind: "symbol", name: sym[1] }); i += sym[0].length; continue }
    // \, in text: \thinspace, \kern.16667em
    if (body.startsWith("\\,", i)) { flushText(); out.push({ kind: "thinspace" }); i += 2; continue }
    if (body[i] === "~" || body[i] === "\u00a0") { flushText(); out.push({ kind: "tie" }); i++; continue } // (U+00A0 is \nobreakspace)
    // a text accent on a letter, \i or \j: the letter and the accent's combining mark (encodings.ts)
    const acc = body.slice(i).match(ACCENT_COMMAND)
    if (acc) { text += accentText(acc); i += acc[0].length; continue }
    const letter = body.slice(i).match(/^\\([A-Za-z]+)(?![A-Za-z])\s*/)
    if (letter && Object.hasOwn(TEXT_LETTERS, letter[1])) { text += TEXT_LETTERS[letter[1]]; i += letter[0].length; continue }
    if (body[i] === ALLOW_HYPHENS) { text += body[i++]; continue }
    if (body.charCodeAt(i) >= 128) { // UTF-8 input: the character as utf8.def reads it
      const ch = String.fromCodePoint(body.codePointAt(i)!)
      if (Object.hasOwn(UTF8_SYMBOLS, ch)) { flushText(); out.push({ kind: "symbol", name: UTF8_SYMBOLS[ch] }); i += ch.length; continue }
      const t = utf8Text(ch)
      if (t === null) throw new Unsupported(`the character ${ch}`)
      text += t; i += ch.length; continue
    }
    if (body.startsWith("\\ ", i)) { flushText(); out.push({ kind: "ctlspace" }); i += 2; continue } // \␣
    // \\ (\@ifnextchar skips the spaces after it, but not after \\[skip]'s ])
    const nl = body.slice(i).match(/^\\\\(\*)?(?:\s*\[([^\]]*)\]|\s*)/)
    if (nl && po.centercr) throw new Unsupported("\\\\ as \\@centercr in a group")
    if (nl) { flushText(); out.push({ kind: "newline", star: !!nl[1], skip: nl[2] ?? null }); i += nl[0].length; continue }
    // \noindent in horizontal mode does nothing (§ 1093)
    const ni = body.slice(i).match(/^\\noindent(?![A-Za-z])\s*/)
    if (ni) { i += ni[0].length; continue }
    const vs = body.slice(i).match(/^\\vspace(?![A-Za-z])\s*(\*?)\s*\{([^{}]*)\}/)
    if (vs) { flushText(); out.push({ kind: "vspace", star: !!vs[1], skip: vs[2] }); i += vs[0].length; continue }
    const bs = body.slice(i).match(/^\\(bigskip|smallskip)(?![A-Za-z])/) // \vspace\bigskipamount … (letter.cls has its own \medskipamount)
    if (bs) { flushText(); out.push({ kind: "vspace", star: false, skip: SKIP_AMOUNTS[bs[1]] }); i += bs[0].length; continue }
    const sp = body.slice(i).match(/^\\(hfill|hfil|quad|qquad)(?![A-Za-z])\s*/)
    if (sp) { flushText(); out.push({ kind: "space", cmd: sp[1] as "hfill" }); i += sp[0].length; continue }
    // \textcolor[model]{spec}{text}; a group that starts with \color[model]{spec} (\color skips the spaces after it)
    const tc = body.slice(i).match(/^\\textcolor(?![A-Za-z])\s*(?:\[([^\]{}]*)\])?\s*\{([^{}]*)\}\s*\{/) ?? body.slice(i).match(/^\{\\(?:color|LXcolorpushed)(?![A-Za-z])\s*(?:\[([^\]{}]*)\])?\s*\{([^{}]*)\}\s*/)
    if (tc) {
      const open = i + tc[0].length - (tc[0].startsWith("{") ? tc[0].length : 1)
      let depth = 0, j = open
      for (; j < body.length; j++) { if (body[j] === "{") depth++; else if (body[j] === "}" && --depth === 0) break }
      if (j >= body.length) throw new Unsupported("paragraph adapter: unbalanced color group")
      flushText(); out.push({ kind: "color", spec: tc[2], model: tc[1], inner: pieces(body.slice(i + tc[0].length, j), footnotes, inner), ...(tc[0].startsWith("{\\LXcolorpushed") ? { pushed: true } : {}) }); i = j + 1; continue
    }
    const sz = body.slice(i).match(new RegExp(`^\\{\\\\(${SIZE_COMMANDS.join("|")})(?![A-Za-z])\\s*`))
    if (sz) {
      let depth = 0, j = i
      for (; j < body.length; j++) { if (body[j] === "{") depth++; else if (body[j] === "}" && --depth === 0) break }
      if (j >= body.length) throw new Unsupported("paragraph adapter: unbalanced {")
      flushText(); out.push({ kind: "size", size: sz[1] as SizeCommand, inner: pieces(body.slice(i + sz[0].length, j), footnotes, inner) }); i = j + 1; continue
    }
    const si = body.slice(i).match(/^\\([A-Za-z]+)(?![A-Za-z])\s*/)
    if (si && si[1] in SI_COMMANDS) { // siunitx: its options, its arguments in braces
      const args: string[] = []
      let j = i + si[0].length, opt: string | undefined
      if (body[j] === "[") {
        const close = body.indexOf("]", j)
        if (close < 0 || !/^[^{}]*(?:\{[^{}]*\}[^{}]*)*$/.test(body.slice(j + 1, close))) throw new Unsupported(`\\${si[1]}${body.slice(j, j + 20)}`)
        opt = body.slice(j + 1, close); j = close + 1
      }
      for (let n = 0; n < SI_COMMANDS[si[1]]; n++) {
        while (body[j] === " ") j++
        if (body[j] !== "{") throw new Unsupported(`\\${si[1]} ${body.slice(j, j + 20)}`)
        const close = closingBrace(body, j)
        args.push(body.slice(j + 1, close)); j = close + 1
      }
      flushText(); out.push({ kind: "si", cmd: si[1], ...(opt !== undefined ? { opt } : {}), args }); i = j; continue
    }
    // babel's language commands (blocks.ts names otherlanguage's \begin and \end \LXotherlanguage …)
    const sel = body.slice(i).match(/^\\(selectlanguage|LXotherlanguage|LXotherlanguagestar)\s*\{([A-Za-z]+)\}|^\\(LXendotherlanguage|LXendotherlanguagestar)(?![A-Za-z])\{([A-Za-z]*)\}/)
    if (sel) {
      const what = ({ selectlanguage: "select", LXotherlanguage: "other", LXotherlanguagestar: "otherstar", LXendotherlanguage: "endother", LXendotherlanguagestar: "endotherstar" } as const)[(sel[1] ?? sel[3]) as "selectlanguage"]
      flushText(); out.push({ kind: "babel", what, lang: sel[2] ?? sel[4] }); i += sel[0].length; continue
    }
    const fgn = body.slice(i).match(/^\\foreignlanguage\s*\{([A-Za-z]+)\}\s*\{/)
    if (fgn) {
      const open = i + fgn[0].length - 1, j = closingBrace(body, open)
      flushText(); out.push({ kind: "foreign", lang: fgn[1], inner: pieces(body.slice(open + 1, j), footnotes, inner) }); i = j + 1; continue
    }
    const cite = body.slice(i).match(/^\\cite\{([A-Za-z0-9:._,\s-]+)\}/)
    if (cite) { flushText(); out.push({ kind: "cite", keys: cite[1].split(",").map((x) => x.trim()) }); i += cite[0].length; continue }
    // natbib's commands: \@ifstar, then \@ifnextchar[ twice (each skips spaces), then the keys
    const nat = body.slice(i).match(/^\\([A-Za-z]+)(?![A-Za-z])(\*?)\s*(?:\[([^\]]*)\]\s*(?:\[([^\]]*)\]\s*)?)?\{([A-Za-z0-9:._,\s-]+)\}/)
    if (nat && nat[1] in NAT_COMMANDS) {
      // one optional argument is the post-note; two are the pre- and post-notes
      const [pre, post] = nat[4] !== undefined ? [nat[3], nat[4]] : ["", nat[3] ?? ""]
      flushText(); out.push({ kind: "natcite", cmd: nat[1], keys: nat[5].split(","), pre: pieces(pre, false), post: pieces(post, false), optional: nat[3] !== undefined }); i += nat[0].length; continue
    }
    const lst = body.slice(i).match(/^\\LXlstinline\{(\d+)\}/) // \lstinline, taken out before expansion
    if (lst) { flushText(); out.push({ kind: "lstinline", n: Number(lst[1]) }); i += lst[0].length; continue }
    const fl = body.slice(i).match(/^\\LXfloat\{(\d+)\}/) // a figure or table, taken out of the paragraph's source
    if (fl) { flushText(); out.push({ kind: "float", n: Number(fl[1]) }); i += fl[0].length; continue }
    const sm = body.slice(i).match(/^\\LXsmuggle\{(\d+)\}/) // beamer's overlay specials
    if (sm) { flushText(); out.push({ kind: "smuggle", n: Number(sm[1]) }); i += sm[0].length; continue }
    const gr = body.slice(i).match(/^\\LXgraphic\{(\d+)\}/) // \includegraphics
    if (gr) { flushText(); out.push({ kind: "graphic", n: Number(gr[1]) }); i += gr[0].length; continue }
    const tz = body.slice(i).match(/^\\LXtikz\{(\d+)\}/) // a tikzpicture or \tikz
    if (tz) { flushText(); out.push({ kind: "tikz", n: Number(tz[1]) }); i += tz[0].length; continue }
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
    const cref = body.slice(i).match(/^\\(cref|Cref|cpageref|Cpageref)(\*?)\{([^{}]*)\}/)
    if (cref) {
      // (a key with a space or an empty one: \r@ key@cref, undefined)
      const keys = cref[3].split(",")
      if (!keys.every((x) => /^[A-Za-z0-9:._-]+$/.test(x))) throw new Unsupported(`\\${cref[1]}{${cref[3]}}`)
      flushText(); out.push({ kind: "cref", keys, variant: cref[1] as "cref", star: !!cref[2] }); i += cref[0].length; continue
    }
    const crange = body.slice(i).match(/^\\(crefrange|Crefrange|cpagerefrange|Cpagerefrange)(\*?)\{([A-Za-z0-9:._-]+)\}\{([A-Za-z0-9:._-]+)\}/)
    if (crange) {
      flushText(); out.push({ kind: "crefrange", a: crange[3], b: crange[4], family: crange[1][0] === "C" ? "Cref" : "cref", page: crange[1].includes("page"), star: !!crange[2] }); i += crange[0].length; continue
    }
    // hyperref's \autoref and nameref's \nameref; \Nameref{key}: `\nameref{key}' on page~\pageref{key}
    const aref = body.slice(i).match(/^\\(autoref|nameref)(\*?)\{([A-Za-z0-9:._-]+)\}/)
    if (aref) { flushText(); out.push({ kind: aref[1] as "autoref" | "nameref", key: aref[3], star: !!aref[2] }); i += aref[0].length; continue }
    const Nref = body.slice(i).match(/^\\Nameref\{([A-Za-z0-9:._-]+)\}/)
    if (Nref) {
      flushText(); out.push({ kind: "text", src: "`" }, { kind: "nameref", key: Nref[1], star: false }, { kind: "text", src: "' on page" }, { kind: "tie" }, { kind: "pageref", key: Nref[1] })
      i += Nref[0].length; continue
    }
    // subcaption's \subref{key}: \ref{sub@key} in a group (subrefformat=simple, \p@subref empty)
    const subref = body.slice(i).match(/^\\subref\{([A-Za-z0-9:._-]+)\}/)
    if (subref) { flushText(); out.push({ kind: "ref", key: `sub@${subref[1]}`, sub: true }); i += subref[0].length; continue }
    const ref = body.slice(i).match(/^\\(label|ref|pageref)\{([A-Za-z0-9:._-]+)\}/)
    if (ref) {
      if (ref[1] === "label" && !footnotes) throw new Unsupported("paragraph adapter: \\label in a footnote")
      flushText(); out.push({ kind: ref[1] as "label" | "ref" | "pageref", key: ref[2] } as Piece); i += ref[0].length; continue
    }
    // an empty group: no node, but no ligature or kern across it
    // (and \ignorespaces stops at it)
    if (body.startsWith("{}", i)) { flushText(); out.push({ kind: "group", inner: [] }); i += 2; continue }
    if (po.groups && body[i] === "{") { // (no ligature or kern across its ends either)
      const j = closingBrace(body, i)
      flushText(); out.push({ kind: "group", inner: pieces(body.slice(i + 1, j), footnotes, inner) }); i = j + 1; continue
    }
    // a declaration (or a size command) in a group: to the group's end
    const decl = po.groups && po.grouped ? body.slice(i).match(/^\\([A-Za-z]+)(?![A-Za-z])\s*/) : null
    // (\centering and friends: what they set is read at the \par, which is not in the group; at the top level, the
    // caller reads them)
    if (decl && ALIGN_DECLARATIONS.includes(decl[1])) {
      if (/\\\\/.test(body.slice(i))) throw new Unsupported(`\\\\ after \\${decl[1]}`)
      flushText(); i += decl[0].length; continue
    }
    if (decl && (BODY_DECLARATIONS.includes(decl[1]) || (SIZE_COMMANDS as readonly string[]).includes(decl[1]))) {
      const rest = pieces(body.slice(i + decl[0].length), footnotes, inner)
      flushText(); out.push(BODY_DECLARATIONS.includes(decl[1]) ? { kind: "decl", name: decl[1], inner: rest } : { kind: "size", size: decl[1] as SizeCommand, inner: rest }); i = body.length; continue
    }
    if (body[i] === "$") {
      const j = body.indexOf("$", i + 1)
      if (j < 0) throw new Unsupported("paragraph adapter: unbalanced $")
      flushText(); out.push({ kind: "math", src: body.slice(i + 1, j) }); i = j + 1
    } else if (body[i] === "\\" && FONT_COMMANDS.some((c) => body.startsWith(`\\${c}{`, i) || body.startsWith(`\\${c} {`, i))) {
      const cmd = body.slice(i + 1).match(/^[a-z]+/)![0] as FontCommand
      const open = body.indexOf("{", i), j = closingBrace(body, open)
      const src = body.slice(open + 1, j)
      flushText(); out.push({ kind: "font", cmd, src, inner: pieces(src, footnotes, inner), next: body[j + 1] ?? "" }); i = j + 1
    } else if (/^\\thanks\s*\{/.test(body.slice(i))) { // (\maketitle's: in a tabular entry too)
      const open = body.indexOf("{", i), j = closingBrace(body, open)
      flushText(); out.push({ kind: "thanks", src: body.slice(open + 1, j) }); i = j + 1
    } else if (footnotes && body.startsWith("\\footnote{", i)) {
      let depth = 0, j = i + 9
      for (; j < body.length; j++) { if (body[j] === "{") depth++; else if (body[j] === "}" && --depth === 0) break }
      if (j >= body.length) throw new Unsupported("paragraph adapter: unbalanced \\footnote{")
      flushText(); out.push({ kind: "footnote", src: body.slice(i + 10, j) }); i = j + 1
    } else {
      if ("\\{}%&#^_~".includes(body[i])) throw new Unsupported(`paragraph adapter accepts plain text, $…$ and \\footnote{…}: ${body.slice(i, i + 40)}`)
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
/** \@textsuperscript{\normalfont\@fnsymbol n} at a size: $^{\mbox{…}}$, at \sf@size: \textasteriskcentered, \textdagger,
 *  \textdaggerdbl, \textsection, \textparagraph, \textbardbl (TS1's; \textsection T1's with T1), then doubled */
function fnsymbolMark(n: number, k: ClassOptionData, size: SizeCommand, amsmath = false): Node[] {
  const kinds = ["*", "dagger", "ddagger", "section", "paragraph", "bardbl", "**", "dagger2", "ddagger2"]
  const kind = kinds[n - 1]
  if (!kind) throw new Unsupported(`\\thanks number ${n}`) // (\@ctrerr)
  const sf = k.sizes[size].scriptSize, pt = String(Math.round(sf / 655.36)).padStart(4, "0")
  const font = (name: string) => loadFont(dataFont(name), sf)
  const [f, code] = kind === "section" && k.ints.T1 ? [font(`ecrm${pt}`), 159]
    : [font(`tcrm${pt}`), { "*": 42, "**": 42, dagger: 132, dagger2: 132, ddagger: 133, ddagger2: 133, section: 167, paragraph: 182, bardbl: 134 }[kind]!]
  const chars = kind.endsWith("2") || kind === "**" ? [code, code] : [code]
  const formula = mlistToHlist([{ noad: ORD, nucleus: null, sup: { kind: "box", box: hpack(chars.map((c) => charNode(f, c))) }, sub: null }], mathEnv(k, size, amsmath), TEXT, false)
  return [{ kind: "math", on: true, width: 0 }, ...formula, { kind: "math", on: false, width: 0 }]
}

/** \@thanks: \footnotetext[n]{text} in vertical mode, with \maketitle's \@makefntext (\parindent 1em\noindent
 *  \hb@xt@1.8em{\hss\@textsuperscript{\normalfont\@thefnmark}}#1): the insertion and its paragraph's trace */
export function thanksInsert(src: string, n: number, k: ClassOptionData, doc: DocState, club: number, amsmath = false) {
  const ctx: PieceContext = { k, params: classParams(k), mathSurround: mathData().dimens.mathsurround, doc, notes: [], noteClub: club, amsmath, base: { enc: k.ints.T1 ? "T1" : "OT1", fam: "cmr", ser: "m", shape: "n" } }
  return footnoteInsert(src, n, ctx, 0, fnsymbolMark(n, k, "footnotesize", amsmath))
}

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
function footnoteInsert(src: string, n: number, outer: PieceContext, hn = 0, mark?: Node[]) {
  const k = singleSpaced(outer.k) // setspace's \@footnotetext: \def\baselinestretch{\setspace@singlespace}
  const ctx = { ...outer, k }
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
  const markBox = hpack([ssGlue(), ...(mark ?? [footnoteMark(n, k, fs, ctx.amsmath)])], { exactly: new Scanner("1.8em", { em, ex: 0 }).scanDimen().value })
  const strut = hpack([{ kind: "rule", width: 0, height: k.dimens.footnotesep, depth: 0 }]) // \rule\z@\footnotesep
  const list: Node[] = [markBox, strut]
  if (hn && outer.doc.refs?.hyperNotes) list.push(...spotAnchor(`Hfootnote.${hn}`, "h", strut, k.sizes[fs].baselineskip.width)) // hyperref's \hyper@@anchor after the strut
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
    hyphenator: hyphenator(k.patterns),
    fontOf: (name, size) => (name === font.name && size === font.size ? font : fontAt(name, size)),
    lHyf: k.ints.lefthyphenmin, rHyf: k.ints.righthyphenmin, ucHyph: k.ints.uchyph,
  }
}

/** What text, formulas and footnotes are built with; footnote paragraphs' traces go to `notes`. */
interface PieceContext { k: ClassOptionData; params: LineBreakParams; mathSurround: number; doc: DocState; notes: ParagraphTrace[]; noteClub?: number; leadGroupNoteClub?: number; /** the paragraph's first piece */ lead?: Piece; noteWidow?: number; sfcodes?: Record<number, number>; amsmath?: boolean; base: FontAttrs; /** \ignorespaces after a \label */ ignoreSpaces?: boolean; /** the current color (xcolor), when not the document's */ color?: string; /** restricted horizontal mode (no discretionary after a hyphen) */ restricted?: boolean; /** in spanish.ldf's quoting (<< … >>) */ quoting?: boolean }

/** \linewidth where the paragraph is: its \parshape's last width (in a list), else \hsize */
const lineWidthOf = (ctx: PieceContext) => (ctx.params.parShape.length ? ctx.params.parShape[ctx.params.parShape.length - 1][1] : ctx.params.hsize)

/** Text, formulas and footnotes into a horizontal list. */
function appendPieces(list: Node[], ps: Piece[], font: Font, size: SizeCommand, state: { spaceFactor: number; sfcodes?: Record<number, number> }, ctx: PieceContext, attrs: FontAttrs = ctx.base) {
  const { k, mathSurround, doc } = ctx
  for (const p of ps) {
    if (p.kind === "text") { appendText(list, ctx.ignoreSpaces ? p.src.replace(/^ +/, "") : p.src, font, state, !ctx.restricted); ctx.ignoreSpaces = false; continue }
    if (p.kind === "currentlabel") {
      if (doc.refs) { doc.refs.label = p.label; doc.refs.href = p.href; if (doc.refs.cleveref) doc.refs.cleveref.current = doc.refs.cleveref.byHref.get(p.href)! }
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
    else if (p.kind === "size" || p.kind === "group") {
      // (footnotes in a group that starts the paragraph see the \clubpenalty its \everypar set there)
      const noteClub = ctx.noteClub
      if (p === ctx.lead && ctx.leadGroupNoteClub !== undefined) ctx.noteClub = ctx.leadGroupNoteClub
      if (p.kind === "size") appendPieces(list, p.inner, selectFont(k, p.size, attrs), p.size, state, ctx, attrs)
      else appendPieces(list, p.inner, font, size, state, ctx, attrs)
      ctx.noteClub = noteClub
    }
    else if (p.kind === "percent") list.push(...spanishPercent(list, k, size, font, !!ctx.amsmath, state))
    else if (p.kind === "guillemet") {
      if (p.quoting) { // (one level of the quoting environment, in one paragraph)
        if (ctx.quoting === !p.right) throw new Unsupported(p.right ? "spanish.ldf's >> without <<" : "spanish.ldf's quoting in quoting")
        ctx.quoting = !p.right
      }
      list.push(...spanishGuillemet(p.right, attrs.enc, k, size, font, state))
    }
    else if (p.kind === "babel" || p.kind === "foreign") {
      const lang = babelLanguage(doc.babel, p.lang)
      if (p.kind === "foreign") { appendPieces(list, p.inner, font, size, state, ctx, attrs); continue } // (in a group)
      // \selectlanguage and otherlanguage (and its end, \bbl@pop@language: the language before) write to the .aux
      // file; otherlanguage's \begin and \end then \ignorespaces
      if (p.what === "select" || p.what === "other" || p.what === "endother") list.push({ kind: "whatsit", text: babelAux(lang) })
      if (p.what === "other" || p.what === "endother") ctx.ignoreSpaces = true
    }
    else if (p.kind === "decl") {
      const a = fontDeclaration(p.name, attrs, k, size, doc, font)!
      appendPieces(list, p.inner, selectFont(k, size, a), size, state, ctx, a)
    }
    else if (p.kind === "vspace") {
      // \@vspace (\@vspacer for \vspace*) in a paragraph: \@bsphack, \vadjust{(\hrule\@height\z@ \nobreak) \vskip skip
      // \vskip\z@skip}, \@esphack: after a space, \nobreak\hskip\z@skip, and the spaces after it go
      if (ctx.restricted) throw new Unsupported("\\vspace in restricted horizontal mode")
      let g: GlueSpec
      if (typeof p.skip !== "string") g = p.skip
      else try { g = parseGlue(p.skip, { em: font.params[QUAD], ex: font.params[X_HEIGHT] }) } catch { throw new Unsupported(`\\vspace{${p.skip}}`) }
      const last = list[list.length - 1]
      const savsk = last?.kind === "glue" ? last.width : 0
      list.push({ kind: "adjust", list: [...(p.star ? [{ kind: "rule", width: null, height: 0, depth: 0 } as Node, penalty(10000)] : []), glueOf(g), glue(0)] })
      if (savsk > 0) { list.push(penalty(10000), glue(0)); ctx.ignoreSpaces = true }
    }
    else if (p.kind === "float") {
      // \@xfloat's \@bsphack, \end@float's \vadjust{\penalty-\@Miv\vbox{}\penalty-\@Mii} and \@Esphack: after a
      // space, \nobreak\hskip\z@skip, and the spaces after it go
      if (!doc.float) throw new Unsupported("a float inside a paragraph here")
      const last = list[list.length - 1]
      const savsk = last?.kind === "glue" ? last.width : 0
      list.push({ kind: "adjust", list: [doc.float(p.n, ctx.notes, ctx.noteClub ?? ctx.params.clubPenalty)] }) // (its paragraphs' traces where its footnotes' go, read with their \clubpenalty)
      if (savsk > 0) { list.push(penalty(10000), glue(0)); ctx.ignoreSpaces = true }
    }
    else if (p.kind === "natcite" || p.kind === "cite" && doc.natbib) {
      if (!doc.natbib) throw new Unsupported(`\\${p.kind === "natcite" ? p.cmd : "cite"} without natbib`)
      const n = p.kind === "natcite" ? p : { cmd: "cite", keys: p.keys, pre: [], post: [], optional: false }
      const bold = selectFont(k, size, { ...attrs, fam: "cmr", ser: "bx", shape: "n" }) // \reset@font\bfseries
      for (const item of natCite(doc.natbib, n.cmd, n.keys.length, n.pre.length ? "pre" : "", n.post.length ? "post" : "", n.optional)) {
        if (item.kind === "text") appendText(list, item.text, font, state, !ctx.restricted)
        else if (item.kind === "q") appendText(list, "?", bold, state, !ctx.restricted)
        else if (item.kind === "ctl") list.push(glue(font.params[SPACE], font.params[SPACE_STRETCH], NORMAL, font.params[SPACE_SHRINK], NORMAL))
        else if (item.kind === "note") appendPieces(list, item.which === "pre" ? n.pre : n.post, font, size, state, ctx, attrs)
        else { const l: Node[] = []; appendText(l, item.text, font, { spaceFactor: 1000 }, false); list.push(hpack(l)); state.spaceFactor = 1000 }
      }
    }
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
        // hyperref's \bibcite: the number in \hyper@@link[cite] to the item's cite.<key> anchor
        if (n && doc.refs?.hyper) { const t: Node[] = []; appendText(t, n, font, { spaceFactor: 1000 }, false); l.push(...refLink(t, `cite.${key}`, doc.xcolor ? ctx.color ?? xcolor.normal : undefined, "cite")) }
        else if (n) appendText(l, n, font, { spaceFactor: 1000 }, false)
        else appendText(l, "?", selectFont(k, size, { ...attrs, fam: "cmr", ser: "bx", shape: "n" }), { spaceFactor: 1000 }, false)
        list.push(hpack(l))
        state.spaceFactor = 1000
      })
      appendText(list, "]", font, state, !ctx.restricted)
    }
    else if (p.kind === "tie") { // \nobreakspace: \leavevmode\nobreak\ (a control space: the font's interword glue)
      list.push(penalty(10000), glue(font.params[SPACE], font.params[SPACE_STRETCH], NORMAL, font.params[SPACE_SHRINK], NORMAL))
    }
    // \␣ (§ 1041): the font's interword glue, whatever the space factor, which stays
    else if (p.kind === "ctlspace") list.push(glue(font.params[SPACE], font.params[SPACE_STRETCH], NORMAL, font.params[SPACE_SHRINK], NORMAL))
    else if (p.kind === "label") {
      // \@bsphack, the write, \@esphack: after a space, \nobreak\hskip\z@skip and \ignorespaces
      if (!doc.refs) throw new Unsupported("paragraph adapter: \\label outside a document")
      const last = list[list.length - 1]
      const savsk = last?.kind === "glue" ? last.width : 0
      list.push(labelWrite(doc.refs, p.key))
      if (savsk > 0) list.push(penalty(10000), glue(0))
      // cleveref's own \@bsphack…\@esphack after it sees no skip (the \hskip\z@skip, or the write): its write, and no
      // \ignorespaces (the first one's stopped at that \@bsphack)
      if (doc.refs.cleveref) list.push(...crefWrites(doc.refs, p.key, true))
      else if (savsk > 0) ctx.ignoreSpaces = true
    }
    else if (p.kind === "tagref") {
      // \tagform@: \maketag@@@{(\ignorespaces\ref{key}\unskip\@@italiccorr)}, \maketag@@@: \hbox{\m@th\normalfont#1}
      if (!ctx.amsmath) throw new Unsupported("paragraph adapter: \\eqref without amsmath")
      const nf: FontAttrs = { enc: k.ints.T1 ? "T1" : "OT1", fam: "cmr", ser: "m", shape: "n" }, f = selectFont(k, size, nf)
      const inner: Node[] = [], st = { spaceFactor: 1000 }
      appendText(inner, "(", f, st, false)
      appendPieces(inner, [{ kind: "ref", key: p.key }], f, size, st, { ...ctx, restricted: true }, nf)
      italicCorrection(inner)
      appendText(inner, ")", f, st, false)
      list.push(hpack(inner))
      state.spaceFactor = 1000
    }
    else if (p.kind === "cref" || p.kind === "crefrange") {
      // \cref and friends: what cleveref.ts reads from the run before, as pieces; with hyperref (not starred) the links
      const c = doc.refs?.cleveref
      const cmd = p.kind === "cref" ? p.variant : `${p.family === "Cref" ? "C" : "c"}${p.page ? "pageref" : "ref"}range`
      if (!c) throw new Unsupported(`\\${cmd} without cleveref`)
      if (p.star && !doc.refs!.hyper) throw new Unsupported(`\\${cmd}* without hyperref`)
      const links = doc.refs!.hyper && !p.star
      const out = p.kind === "cref" ? crefOutput(c.setup, c.prev, p.keys, p.variant, !!links) : crefRangeOutput(c.setup, c.prev, p.a, p.b, p.family, p.page, !!links)
      const toPieces = (xs: CrefOut[]): Piece[] => {
        const ps: Piece[] = []
        for (const x of xs) {
          if (x.t === "text") {
            // (a run of characters goes on into the next text, but not over a name's case change)
            x.s.split("\u0000").forEach((t, i) => { const prev = ps.at(-1); if (i === 0 && prev?.kind === "text") prev.src += t; else ps.push({ kind: "text", src: t }) })
          }
          else if (x.t === "tie") ps.push({ kind: "tie" })
          else if (x.t === "qq") ps.push({ kind: "qq" })
          else if (x.t === "link") ps.push({ kind: "creflink", key: x.key, inner: toPieces(x.out) })
          else ps.push({ kind: "font", cmd: "textup", src: x.src, inner: toPieces(x.out), next: "" })
        }
        return ps
      }
      appendPieces(list, toPieces(out), font, size, state, ctx, attrs)
    }
    else if (p.kind === "qq") { // \nfss@text{\reset@font\bfseries ??}
      const l: Node[] = []
      appendText(l, "??", selectFont(k, size, { ...attrs, fam: "cmr", ser: "bx", shape: "n" }), { spaceFactor: 1000 }, false)
      list.push(hpack(l))
      state.spaceFactor = 1000
    }
    else if (p.kind === "creflink") {
      // \cref@hyperlink: \hyper@@link[link]{}{the label's anchor}{…} (with dvips the text in an \hbox, its space factor
      // saved and restored around it: \pdf@rect)
      const known = doc.refs?.prev?.get(p.key)
      if (!known) throw new Unsupported(`a cleveref link to ${p.key}, with no \\newlabel`)
      const text: Node[] = []
      appendPieces(text, p.inner, font, size, state, hyperDriver.pdftex ? ctx : { ...ctx, restricted: true }, attrs)
      list.push(...refLink(text, known.href, doc.xcolor ? ctx.color ?? xcolor.normal : undefined))
    }
    else if (p.kind === "autoref" || p.kind === "nameref") {
      const refs = doc.refs
      if (!refs) throw new Unsupported(`paragraph adapter: \\${p.kind} outside a document`)
      if (p.kind === "autoref" && !refs.hyper) throw new Unsupported("\\autoref without hyperref")
      if (p.kind === "nameref" && !refs.nameref) throw new Unsupported("\\nameref without nameref")
      const known = refs.prev?.get(p.key)
      if (!known) { // \nfss@text{\reset@font\bfseries ??}
        const qq: Node[] = []
        appendText(qq, "??", selectFont(k, size, { ...attrs, fam: "cmr", ser: "bx", shape: "n" }), { spaceFactor: 1000 }, false)
        list.push(hpack(qq))
        state.spaceFactor = 1000
        continue
      }
      const linked = refs.hyper && !p.star
      // (with dvips the link's text is an \hbox: restricted horizontal mode)
      const inner = linked && !hyperDriver.pdftex ? { ...ctx, restricted: true } : ctx
      const text: Node[] = []
      if (p.kind === "autoref") {
        // \HyRef@autosetref: \hyper@@link{}{anchor}{\HyRef@currentHtag label \null}, the tag the name and ~;
        // \autoref* \@gobbletwo's the link's first two arguments
        const name = autorefName(known.href)
        appendPieces(text, [...(name === null ? [] : [{ kind: "text", src: name } as Piece, { kind: "tie" } as Piece]), { kind: "text", src: known.label }], font, size, state, inner, attrs)
      } else {
        // \T@nameref: the label's third field (its tokens as the .aux file is read) in \@setref; with hyperref
        // \hyper@@link{}{anchor}{name}, nothing for an empty name (\Hy@setref@link); \nameref* (or no hyperref) \real@setref
        if (refs.hyper && !p.star && !known.name) continue
        // (a macro in it, \contentsname or \thethm, means what it means here, not where the name was taken)
        if (/\\/.test(known.name.replace(/\$[^$]*\$/g, ""))) throw new Unsupported(`\\nameref to "${known.name}"`)
        appendPieces(text, pieces(known.name, false), font, size, state, inner, attrs)
      }
      // \null (a linked name's box leaves the space factor its text ended with: \Hy@RestoreSpaceFactor)
      if (p.kind === "autoref" || !linked) { text.push(hpack([])); state.spaceFactor = 1000 }
      list.push(...(linked ? refLink(text, known.href, doc.xcolor ? ctx.color ?? xcolor.normal : undefined) : text))
      continue
    }
    else if (p.kind === "ref" || p.kind === "pageref") {
      // \@setref: the label's number or page and \null; undefined, \nfss@text{\reset@font\bfseries ??}
      if (p.kind === "ref" && p.sub && !doc.subcaption) throw new Unsupported("\\subref without subcaption")
      const known = doc.refs?.prev?.get(p.key)
      if (p.kind === "ref" && p.sub && doc.refs?.hyper) {
        // with hyperref, \hyperref[key]{\ref*{sub@key}}: \ref*'s text and \null, in a link to key's anchor when key is defined
        let text: Node[] = []
        if (known) { appendText(text, known.label, font, state, !ctx.restricted); text.push(hpack([])) }
        else { appendText(text, "??", selectFont(k, size, { ...attrs, fam: "cmr", ser: "bx", shape: "n" }), { spaceFactor: 1000 }, false); text = [hpack(text)] }
        const target = doc.refs.prev?.get(p.key.slice("sub@".length))
        list.push(...(target ? refLink(text, target.href, doc.xcolor ? ctx.color ?? xcolor.normal : undefined) : text))
        state.spaceFactor = 1000
        continue
      }
      if (known && doc.refs!.hyper) { // hyperref: a link around the text, which keeps its space factor (\Hy@SaveSpaceFactor)
        if (p.kind === "ref" && !known.label) continue // \Hy@setref@link: no link for an empty text
        const text: Node[] = []
        appendText(text, p.kind === "ref" ? known.label : known.page, font, state, !ctx.restricted)
        list.push(...refLink(text, known.href, doc.xcolor ? ctx.color ?? xcolor.normal : undefined))
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
      if (!doc.color) throw new Unsupported("paragraph adapter: color without xcolor")
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
    else if (p.kind === "smuggle") {
      // \beamer@smuggle in horizontal mode: a \lastskip other than 0.0pt taken off before the nodes, put back after them
      if (!doc.smuggle) throw new Unsupported("paragraph adapter: beamer's overlay specials outside a beamer frame")
      const last = list.at(-1)
      if (last?.kind === "glue" && (last.width || last.stretch || last.shrink)) {
        list.pop()
        list.push(...doc.smuggle(p.n), glue(last.width, last.stretch, last.stretchOrder, last.shrink, last.shrinkOrder))
      } else list.push(...doc.smuggle(p.n))
    }
    else if (p.kind === "graphic") {
      if (!doc.graphic) throw new Unsupported("paragraph adapter: \\includegraphics outside a document")
      list.push(...doc.graphic(p.n, lineWidthOf(ctx), { em: font.params[QUAD], ex: font.params[X_HEIGHT] })) // (em and ex: the current font's)
      state.spaceFactor = 1000 // after a box
    }
    else if (p.kind === "tikz") {
      if (!doc.tikz) throw new Unsupported("a tikzpicture outside a document")
      list.push(...doc.tikz(p.n, ctx.color ?? xcolor.normal, { em: font.params[QUAD], ex: font.params[X_HEIGHT] }, size, attrs))
      state.spaceFactor = 1000 // after a box
    }
    else if (p.kind === "tabular") { // \leavevmode\hbox{$…$}
      if (!doc.tabular) throw new Unsupported("paragraph adapter: a tabular outside a document")
      // (a tabular that starts the paragraph starts it in its group: the \everypar's \clubpenalty there is its own)
      const lead = p === ctx.lead && ctx.leadGroupNoteClub !== undefined
      list.push(doc.tabular(p.n, size, attrs, state.sfcodes, { notes: ctx.notes, club: lead ? ctx.leadGroupNoteClub! : ctx.noteClub ?? ctx.params.clubPenalty, widow: ctx.noteWidow ?? k.ints.widowpenalty, finalHyph: ctx.params.finalHyphenDemerits, lineWidth: lineWidthOf(ctx) }))
      state.spaceFactor = 1000
    }
    else if (p.kind === "minipage") { // \leavevmode, then \@iiiparbox's box (in its group, like a tabular's)
      if (!doc.minipage) throw new Unsupported("paragraph adapter: a minipage outside a document")
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
      if (!doc.lstinline) throw new Unsupported("paragraph adapter: \\lstinline outside a document")
      list.push(...doc.lstinline(p.n, size, attrs))
      state.spaceFactor = 1000
    }
    else if (p.kind === "href") {
      if (!doc.href) throw new Unsupported("paragraph adapter: \\href outside a document")
      if (hyperDriver.pdftex) { // \pdfstartlink, the text where it stands (it may break), \pdfendlink
        const [start, end] = doc.href(p.n, [], undefined)
        list.push(start)
        appendPieces(list, p.inner, font, size, state, ctx, attrs)
        list.push(end)
        continue
      }
      // the text in the link's box, which starts with the space factor before it and leaves its own after it
      // (\Hy@SaveSpaceFactor, \Hy@RestoreSpaceFactor)
      const inner: Node[] = []
      appendPieces(inner, p.inner, font, size, state, { ...ctx, restricted: true }, attrs)
      list.push(...doc.href(p.n, inner, doc.xcolor ? ctx.color ?? xcolor.normal : undefined))
      ctx.ignoreSpaces = false
    }
    else if (p.kind === "url") {
      if (!doc.url) throw new Unsupported("paragraph adapter: \\url outside a document")
      list.push(...doc.url(p.n, size, attrs, !ctx.restricted, doc.xcolor ? ctx.color ?? xcolor.normal : undefined))
      state.spaceFactor = 1000 // after \mathoff
    }
    else if (p.kind === "symbol") {
      // \DeclareTextSymbol in the current encoding, else the default's (\UseTextSymbol: the companion font, TS1)
      const codes = TEXT_SYMBOLS[p.name], own = codes[attrs.enc]
      const f = own !== undefined ? font : selectFont(k, size, { ...attrs, enc: "TS1" })
      appendCodes(list, String.fromCharCode(own ?? codes.TS1!), f, state, !ctx.restricted)
    }
    else if (p.kind === "si") {
      if (!doc.siunitx) throw new Unsupported(`\\${p.cmd} without siunitx`)
      const cx = siContext(k, size, font, doc.siunitx)
      for (const x of siunitx(p.cmd, p.opt, p.args, cx)) {
        if (x.kind === "formula") list.push({ kind: "math", on: true, width: mathSurround }, ...mlistToHlist(x.list, mathEnv(k, size, ctx.amsmath), TEXT, !ctx.restricted), { kind: "math", on: false, width: mathSurround })
        else if (x.kind === "nobreak") list.push(penalty(10000))
        else if (x.kind === "mbox") list.push(cx.text(x.src))
        else if (x.kind === "source") appendPieces(list, pieces(x.src, false), font, size, state, ctx, attrs)
        else appendPieces(list, [{ kind: "text", src: x.src }], font, size, state, ctx, attrs)
        if (x.kind === "formula" || x.kind === "mbox") state.spaceFactor = 1000
      }
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
      list.push({ kind: "math", on: true, width: mathSurround }, ...mlistToHlist(parseFormula(p.src, !!ctx.amsmath, font.params[QUAD], doc.siunitx ? siContext(k, size, font, doc.siunitx) : undefined), mathEnv(k, size, ctx.amsmath), TEXT, !ctx.restricted), { kind: "math", on: false, width: mathSurround })
      state.spaceFactor = 1000
    } else if (p.kind === "thanks") {
      // \maketitle's \thanks: \footnotemark (\stepcounter, \nobreak, \@makefnmark: \rlap{\@textsuperscript{\normalfont
      // \@fnsymbol\c@footnote}}, the space factor kept); the text waits for \@thanks
      if (!doc.thanks) throw new Unsupported("\\thanks outside \\maketitle")
      const n = ++doc.footnote
      list.push(penalty(10000), hpack([...fnsymbolMark(n, k, size, ctx.amsmath), ssGlue()], { exactly: 0 }))
      doc.thanks.push({ n, src: p.src })
    } else {
      // \footnote: \stepcounter, \@footnotemark (\nobreak, the mark, the space factor kept), \@footnotetext
      const n = ++doc.footnote
      // hyperref: the mark in a link to the note's anchor (\hyper@linkstart{link}{Hfootnote.n} … \hyper@linkend)
      const hn = doc.refs?.hyper ? (doc.refs.hfootnotes = (doc.refs.hfootnotes ?? 0) + 1) : 0
      const mark = footnoteMark(n, k, size, ctx.amsmath)
      list.push(penalty(10000), ...(hn ? tocLink([mark], `Hfootnote.${hn}`, k.sizes[size].baselineskip.width) : [mark]))
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
export function hlistInput(body: string, k: ClassOptionData, size: SizeCommand, doc: DocState, attrs: FontAttrs, state = { spaceFactor: 1000 }, amsmath = false, color?: string, groups = false): Node[] {
  const list: Node[] = []
  const base: FontAttrs = { enc: k.ints.T1 ? "T1" : "OT1", fam: "cmr", ser: "m", shape: "n" }
  appendPieces(list, pieces(body.replace(/\s+/g, " "), false, { groups, grouped: groups }), selectFont(k, size, attrs), size, state, { k, params: classParams(k), mathSurround: mathData().dimens.mathsurround, doc, notes: [], amsmath, base, restricted: true, ...(color ? { color } : {}) }, attrs)
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
    if (s.errors.length) throw new Unsupported(`\\${name}: ${s.errors[0]}`)
    body = s.rest().trimStart()
  }
  const ps = pieces(body, true, { groups: !!opts.groups, grouped: !!opts.topDecls, centercr: !!opts.centercr })
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
  const pctx: PieceContext = { k, params, mathSurround, doc, notes, lead: ps[0], noteClub: opts.noteClubPenalty, ...(opts.leadGroupNoteClubPenalty !== undefined ? { leadGroupNoteClub: opts.leadGroupNoteClubPenalty } : {}), noteWidow: opts.noteWidowPenalty, sfcodes: opts.sfcodes, amsmath: opts.amsmath, base }
  appendPieces(list, ps, font, size, { spaceFactor: 1000, ...(opts.sfcodes ? { sfcodes: opts.sfcodes } : {}) }, pctx)
  if (pctx.quoting) throw new Unsupported("spanish.ldf's quoting over paragraphs") // (\es@quotcont in \everypar)
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
  if (shipped.length) shipped[0] = firstPage(shipped[0], [L3BACKEND_HEADER]) // (the reference TeX is latex: dvips)
  return {
    trace: shipOut(shipped),
    decisions,
    pages: pageTrace,
    columns: boxes.map((b) => b.column.map(emitBoxes)),
    notes: [`${cls} [${option}]; ${paras.length} paragraph(s), ${lineCount} lines, ${pages.length} page(s) from the engine's line and page builders`],
  }
}
