// Adapter "paragraph": a fixture whose body is paragraphs of plain text and
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

import { SIZE_COMMANDS, type ClassOptionData, type FontRef, type SizeCommand } from "../../../layout/classdata"
import { Scanner, type GlueSpec } from "../../../layout/dimen"
import { loadFont, QUAD, X_HEIGHT } from "../../../layout/font"
import { appendText } from "../../../layout/hmode"
import { buildHyphenator, type HyphenationData } from "../../../layout/hyphenate"
import { lineBreak, type LineBreakParams } from "../../../layout/linebreak"
import { xnOverD } from "../../../layout/arith"
import { emptyBox, FIL, glue, kern, paramGlue, penalty, type BoxNode, type GlueNode, type InsNode, type Node } from "../../../layout/nodes"
import type { MathData } from "../../../mathlayout/data"
import { mlistToHlist, ORD, TEXT, type MathEnv } from "../../../mathlayout/mlist"
import { parseMath } from "../../../mathlayout/parse"
import { buildPages, type Page, type PageParams } from "../../../layout/pagebuilder"
import { emitBoxes } from "../../../emit/boxes"
import { hpack, vpack } from "../../../layout/pack"
import { roundDecimals } from "../../../layout/dimen"
import { documentPages, type ParagraphTrace } from "../../../trace/decisions"
import { shipOut } from "../../../emit/trace"
import { readFileSync } from "node:fs"
import { classData, documentClass } from "../../classes"
import { dataFont } from "../../fonts"
import type { Adapter } from "./index"

export const spec = (param: string, g: GlueSpec, width = g.width): GlueNode => paramGlue(param, glue(width, g.stretch, g.stretchOrder, g.shrink, g.shrinkOrder))

// assignable parameters: TeX name → LineBreakParams field
const INT_PARAMS = {
  hangafter: "hangAfter", looseness: "looseness", tolerance: "tolerance", pretolerance: "pretolerance",
  linepenalty: "linePenalty", adjdemerits: "adjDemerits", hyphenpenalty: "hyphenPenalty", exhyphenpenalty: "exHyphenPenalty",
  doublehyphendemerits: "doubleHyphenDemerits", finalhyphendemerits: "finalHyphenDemerits",
} as const
const DIMEN_PARAMS = { hangindent: "hangIndent", emergencystretch: "emergencyStretch" } as const

let memoHyphenator: ReturnType<typeof buildHyphenator> | undefined
const hyphenator = () => (memoHyphenator ??= buildHyphenator(JSON.parse(readFileSync("lib/latex/data/hyphenation/en-us.json", "utf8")) as HyphenationData))
let memoMath: MathData | undefined
export const mathData = () => (memoMath ??= JSON.parse(readFileSync("lib/latex/data/math/latex.json", "utf8")) as MathData)

/** The math fonts and parameters of a size command (\DeclareMathSizes), with LaTeX's math setup. */
export function mathEnv(k: ClassOptionData, size: SizeCommand, amsmath = false): MathEnv {
  const m = amsmath ? k.sizes[size].mathAms : k.sizes[size].math, data = mathData()
  return {
    fonts: [m.text, m.script, m.scriptscript].map((fs) => fs.map((f) => loadFont(dataFont(f.name), f.at))),
    muskips: data.muskips as MathEnv["muskips"], binoppenalty: data.ints.binoppenalty, relpenalty: data.ints.relpenalty,
    scriptspace: data.dimens.scriptspace, nulldelimiterspace: data.dimens.nulldelimiterspace,
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

/** Document state that crosses paragraphs: LaTeX's footnote counter. */
export interface DocState { footnote: number }

/** What a paragraph's surroundings set: the start of its list (in place of the indent box) and its shape. */
export interface ParagraphOptions {
  start?: Node[]; parShape?: [number, number][]; clubPenalty?: number
  /** the text font, when not the size's roman (a heading's \bfseries) */
  font?: FontRef
  hangIndent?: number; interLinePenalty?: number
  /** \clubpenalty while the paragraph is read, which its footnotes see, when it differs from the one at its \par */
  noteClubPenalty?: number
  /** \centering and friends */
  leftSkip?: GlueNode; rightSkip?: GlueNode; parFillSkip?: GlueNode; finalHyphenDemerits?: number
  /** amsmath is loaded: its math fonts */
  amsmath?: boolean
  /** lines already in the paragraph (before a display), and the widow penalty in force */
  prevGraf?: number; widowPenalty?: number
}

/** A body piece: plain text, a formula $…$, or \footnote{…} (whose text is again text and formulas). */
type Piece = { kind: "text" | "math" | "footnote"; src: string }

function pieces(body: string, footnotes = true): Piece[] {
  const out: Piece[] = []
  let i = 0, text = ""
  const flushText = () => {
    if (/[\\{}%&#^_~]/.test(text)) throw new Error(`paragraph adapter accepts plain text, $…$ and \\footnote{…}: ${text.slice(0, 40)}`)
    if (text) out.push({ kind: "text", src: text })
    text = ""
  }
  while (i < body.length) {
    if (body[i] === "$") {
      const j = body.indexOf("$", i + 1)
      if (j < 0) throw new Error("paragraph adapter: unbalanced $")
      flushText(); out.push({ kind: "math", src: body.slice(i + 1, j) }); i = j + 1
    } else if (footnotes && body.startsWith("\\footnote{", i)) {
      let depth = 0, j = i + 9
      for (; j < body.length; j++) { if (body[j] === "{") depth++; else if (body[j] === "}" && --depth === 0) break }
      if (j >= body.length) throw new Error("paragraph adapter: unbalanced \\footnote{")
      flushText(); out.push({ kind: "footnote", src: body.slice(i + 10, j) }); i = j + 1
    } else text += body[i++]
  }
  flushText()
  return out
}

const sizeFont = (k: ClassOptionData, size: SizeCommand) => { const f = k.sizes[size].font; return loadFont(dataFont(f.name), f.at) }
const hss = () => glue(0, 65536, FIL, 65536, FIL)

/**
 * \@makefnmark at a size: \hbox{\@textsuperscript{\normalfont N}}, that is
 * \hbox{$^{\mbox{N}}$} with \mathsurround=0pt and N in roman at \sf@size.
 */
function footnoteMark(n: number, k: ClassOptionData, size: SizeCommand, amsmath = false): BoxNode {
  const ref = k.sizes[size].math.script[0]
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
function footnoteInsert(src: string, n: number, ctx: PieceContext) {
  const { k } = ctx
  const fs: SizeCommand = "footnotesize"
  const font = sizeFont(k, fs)
  const em = font.params[QUAD]
  // the paragraph's parameters, less what normal_paragraph (§ 1070) resets at \insert and what
  // \@parboxrestore sets: \leftskip, \rightskip 0, \parfillskip \@flushglue, \sloppy
  // (\tolerance 9999, \emergencystretch 3em)
  const params: LineBreakParams = { ...ctx.params, looseness: 0, hangIndent: 0, hangAfter: 1, parShape: [], prevGraf: 0, widowPenalty: k.ints.widowpenalty, ...(ctx.noteClub !== undefined ? { clubPenalty: ctx.noteClub } : {}) }
  Object.assign(params, {
    hsize: k.dimens.columnwidth, leftSkip: spec("leftskip", ZERO), rightSkip: spec("rightskip", ZERO), parFillSkip: paramGlue("parfillskip", glue(0, 65536, FIL)),
    tolerance: 9999, emergencyStretch: new Scanner("3em", { em, ex: 0 }).scanDimen().value, interLinePenalty: k.ints.interfootnotelinepenalty,
  })
  params.hyphenation = hyphenation(k, font)
  const markBox = hpack([hss(), footnoteMark(n, k, fs, ctx.amsmath)], { exactly: new Scanner("1.8em", { em, ex: 0 }).scanDimen().value })
  const strut = hpack([{ kind: "rule", width: 0, height: k.dimens.footnotesep, depth: 0 }]) // \rule\z@\footnotesep
  const list: Node[] = [markBox, strut]
  appendPieces(list, pieces(src.trim(), false), font, fs, { spaceFactor: 1000 }, ctx)
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

function hyphenation(k: ClassOptionData, font: ReturnType<typeof loadFont>): LineBreakParams["hyphenation"] {
  return {
    hyphenator: hyphenator(),
    fontOf: (name, size) => { if (name !== font.name || size !== font.size) throw new Error(`no font ${name}@${size}`); return font },
    lHyf: k.ints.lefthyphenmin, rHyf: k.ints.righthyphenmin, ucHyph: k.ints.uchyph,
  }
}

/** What text, formulas and footnotes are built with; footnote paragraphs' traces go to `notes`. */
interface PieceContext { k: ClassOptionData; params: LineBreakParams; mathSurround: number; doc: DocState; notes: ParagraphTrace[]; noteClub?: number; amsmath?: boolean }

/** Text, formulas and footnotes into a horizontal list. */
function appendPieces(list: Node[], ps: Piece[], font: ReturnType<typeof loadFont>, size: SizeCommand, state: { spaceFactor: number }, ctx: PieceContext) {
  const { k, mathSurround, doc } = ctx
  for (const p of ps) {
    if (p.kind === "text") appendText(list, p.src, font, state)
    else if (p.kind === "math") {
      // after_math (§ 1196): \mathon, the formula in text style with penalties, \mathoff
      list.push({ kind: "math", on: true, width: mathSurround }, ...mlistToHlist(parseMath(p.src, mathData()), mathEnv(k, size, ctx.amsmath), TEXT, true), { kind: "math", on: false, width: mathSurround })
      state.spaceFactor = 1000
    } else {
      // \footnote: \stepcounter, \@footnotemark (\nobreak, the mark, the space factor kept), \@footnotetext
      const n = ++doc.footnote
      list.push(penalty(10000), footnoteMark(n, k, size, ctx.amsmath))
      const { ins, trace } = footnoteInsert(p.src, n, ctx)
      list.push(ins)
      ctx.notes.push(trace)
    }
  }
}

/**
 * One paragraph of text, inline math and footnotes with leading assignments, as
 * the horizontal list TeX builds for it and the line-breaking parameters in
 * force. `notes` are the footnote paragraphs' traces, which TeX breaks first.
 */
export function paragraphInput(body: string, k: ClassOptionData = classData("article", "10pt"), size: SizeCommand = "normalsize", doc: DocState = { footnote: 0 }, opts: ParagraphOptions = {}): { list: Node[]; params: LineBreakParams; notes: ParagraphTrace[] } {
  const params = classParams(k)
  const font = opts.font ? loadFont(dataFont(opts.font.name), opts.font.at) : sizeFont(k, size)
  const env = { em: font.params[QUAD], ex: font.params[X_HEIGHT] }
  let indent = true
  let mathSurround = mathData().dimens.mathsurround
  body = body.replace(/\s+/g, " ").trim()
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
  if (opts.clubPenalty !== undefined) params.clubPenalty = opts.clubPenalty
  if (opts.hangIndent !== undefined) params.hangIndent = opts.hangIndent
  if (opts.interLinePenalty !== undefined) params.interLinePenalty = opts.interLinePenalty
  if (opts.leftSkip) params.leftSkip = opts.leftSkip
  if (opts.rightSkip) params.rightSkip = opts.rightSkip
  if (opts.parFillSkip) params.parFillSkip = opts.parFillSkip
  if (opts.finalHyphenDemerits !== undefined) params.finalHyphenDemerits = opts.finalHyphenDemerits
  if (opts.prevGraf !== undefined) params.prevGraf = opts.prevGraf
  if (opts.widowPenalty !== undefined) params.widowPenalty = opts.widowPenalty
  const list: Node[] = opts.start ?? (indent ? [emptyBox("hlist", k.dimens.parindent)] : [])
  const notes: ParagraphTrace[] = []
  appendPieces(list, ps, font, size, { spaceFactor: 1000 }, { k, params, mathSurround, doc, notes, noteClub: opts.noteClubPenalty, amsmath: opts.amsmath })
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
  const { pages, pageTrace } = endDocument(contrib, prevDepth, k)
  return { decisions, pages, pageTrace, lineCount }
}

/** \end{document} after the main vertical list `contrib`, and the pages TeX's page builder cuts. */
export function endDocument(contrib: Node[], prevDepth: number | null, k: ClassOptionData, float?: PageParams["float"]) {
  // a skip of -\prevdepth, at most \maxdepth, when the last line has depth, then \clearpage,
  // whose \newpage is \vfil\penalty-10000 (TeX's page trace and box dumps show both forms)
  if (prevDepth !== null && prevDepth > 0) contrib.push(glue(-Math.min(prevDepth, k.dimens.maxdepth)))
  contrib.push(glue(0, 65536, FIL), { kind: "penalty", penalty: -10000 })
  // the rest of \clearpage: \write\m@ne{}\vbox{}\penalty-\@Mi. Its output routine (\@doclearpage)
  // ships a page only for footnotes still held over, and then clears the page again
  const clear = (): Node[] => [{ kind: "whatsit", text: "\\write-{}" }, emptyBox("vlist"), penalty(-10001)]
  const built = buildPages(contrib, {
    vsize: k.dimens.textheight, maxDepth: k.dimens.maxdepth, topSkip: spec("topskip", k.glue.topskip),
    inserts: { [k.ints.footins]: { skip: glue(k.glue.footinsskip.width, k.glue.footinsskip.stretch, k.glue.footinsskip.stretchOrder, k.glue.footinsskip.shrink, k.glue.footinsskip.shrinkOrder), count: k.ints.footinscount, dimen: k.dimens.footinsdimen } },
    more: (last) => (last?.outputPenalty === -10000 || (last?.outputPenalty === -10001 && last.inserts[k.ints.footins]) ? clear() : null),
    float,
  })
  const pages = built.pages.filter((pg) => pg.outputPenalty !== -10001 || pg.inserts[k.ints.footins])
  return { pages, pageTrace: documentPages(built.trace) }
}

/**
 * LaTeX's output routine for each page. \@makecol: without footnotes the output box is
 * \box255; with them, \vbox{\boxmaxdepth\@maxdepth \unvbox255 \vskip\skip\footins
 * \footnoterule \unvbox\footins}, where \footnoterule is \kern-3pt \hrule width .4\columnwidth
 * \kern2.6pt. Then \vbox to\@colht{\unvbox the output box, \vskip-its depth, \@textbottom}.
 * `column` is that box's list from \topskip on.
 */
export function makeColumns(pages: Page[], k: ClassOptionData) {
  const textbottom: Node[] = k.ints.raggedbottom ? [glue(0, 7, FIL)] : [] // \vskip\z@\@plus.0001fil
  const rule: Node = { kind: "rule", width: xnOverD(k.dimens.columnwidth, roundDecimals([4]), 65536), height: 26214, depth: 0 }
  const fs = k.glue.footinsskip
  return pages.map((pg) => {
    let box255 = vpack(pg.nodes.slice(), { exactly: pg.goal }, k.dimens.maxdepth)
    const top = box255
    if (pg.outputPenalty === -10001) box255 = vpack([box255, glue(0, 65536, FIL)]) // \@doclearpage: \vbox{\box\@cclv\vfil}
    const foot = pg.inserts[k.ints.footins]
    const out = foot
      ? vpack([...box255.list, glue(fs.width, fs.stretch, fs.stretchOrder, fs.shrink, fs.shrinkOrder), kern(-196608, true), rule, kern(170394, true), ...vpack(foot).list], { additional: 0 }, k.dimens.maxdepth)
      : box255
    const list = [...out.list, glue(-out.depth), ...textbottom]
    const col = top === box255 ? list : top.list
    return { outputbox: vpack(list, { exactly: k.dimens.textheight }), column: col.slice(col.findIndex((n) => n.kind === "glue" && n.param === "topskip")) }
  })
}

export const paragraph: Adapter = (src) => {
  const { cls, option } = documentClass(src)
  const k = classData(cls, option)
  const paras = paragraphsOf(src.slice(src.indexOf("\\begin{document}") + 16, src.indexOf("\\end{document}")))
  const { decisions, pages, pageTrace, lineCount } = typesetBody(paras, k)

  // \@outputpage stacks \topmargin, the \headheight box and \headsep above the column,
  // shifted by \oddsidemargin
  const boxes = makeColumns(pages, k)
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
