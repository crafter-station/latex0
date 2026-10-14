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

import { SIZE_COMMANDS, type ClassOptionData, type SizeCommand } from "../../../layout/classdata"
import { Scanner, type GlueSpec } from "../../../layout/dimen"
import { loadFont, QUAD, X_HEIGHT } from "../../../layout/font"
import { appendText } from "../../../layout/hmode"
import { buildHyphenator, type HyphenationData } from "../../../layout/hyphenate"
import { lineBreak, type LineBreakParams } from "../../../layout/linebreak"
import { emptyBox, FIL, glue, kern, paramGlue, type GlueNode, type Node } from "../../../layout/nodes"
import type { MathData } from "../../../mathlayout/data"
import { mlistToHlist, TEXT, type MathEnv } from "../../../mathlayout/mlist"
import { parseMath } from "../../../mathlayout/parse"
import { buildPages } from "../../../layout/pagebuilder"
import { emitBoxes } from "../../../emit/boxes"
import { vpack } from "../../../layout/pack"
import { shipOut } from "../../../emit/trace"
import { readFileSync } from "node:fs"
import { classData, documentClass } from "../../classes"
import { dataFont } from "../../fonts"
import type { Adapter } from "./index"

const spec = (param: string, g: GlueSpec, width = g.width): GlueNode => paramGlue(param, glue(width, g.stretch, g.stretchOrder, g.shrink, g.shrinkOrder))

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
const mathData = () => (memoMath ??= JSON.parse(readFileSync("lib/latex/data/math/latex.json", "utf8")) as MathData)

/** The math fonts and parameters of a size command (\DeclareMathSizes), with LaTeX's math setup. */
export function mathEnv(k: ClassOptionData, size: SizeCommand): MathEnv {
  const m = k.sizes[size].math, data = mathData()
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

/**
 * One paragraph of plain text with leading assignments, as the horizontal list
 * TeX builds for it and the line-breaking parameters in force.
 */
export function paragraphInput(body: string, k: ClassOptionData = classData("article", "10pt"), size: SizeCommand = "normalsize"): { list: Node[]; params: LineBreakParams } {
  const params = classParams(k)
  const nf = k.sizes[size].font
  const font = loadFont(dataFont(nf.name), nf.at)
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
  const parts = body.split("$")
  if (parts.length % 2 === 0) throw new Error("paragraph adapter: unbalanced $")
  if (parts.some((t, i) => i % 2 === 0 && /[\\{}%&#^_~]/.test(t))) throw new Error("paragraph adapter accepts plain text and $…$ after the assignments")

  params.hyphenation = {
    hyphenator: hyphenator(),
    fontOf: (name, size) => { if (name !== font.name || size !== font.size) throw new Error(`no font ${name}@${size}`); return font },
    lHyf: k.ints.lefthyphenmin, rHyf: k.ints.righthyphenmin, ucHyph: k.ints.uchyph,
  }
  const list: Node[] = indent ? [emptyBox("hlist", k.dimens.parindent)] : []
  const state = { spaceFactor: 1000 }
  parts.forEach((t, i) => {
    if (i % 2 === 0) { appendText(list, t, font, state); return }
    // after_math (§ 1196): \mathon, the formula in text style with penalties, \mathoff
    list.push({ kind: "math", on: true, width: mathSurround }, ...mlistToHlist(parseMath(t, mathData()), mathEnv(k, size), TEXT, true), { kind: "math", on: false, width: mathSurround })
    state.spaceFactor = 1000
  })
  return { list, params }
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
  const decisions = []
  let prevDepth: number | null = null
  let lineCount = 0
  for (const para of paras) {
    const { list, params } = paragraphInput(para.text, k, para.size)
    const { lines, vlist, trace } = lineBreak(list, params)
    decisions.push(trace)
    lineCount += lines.length
    const baselineskip = k.sizes[para.size].baselineskip // in force when \par appends the lines
    contrib.push(spec("parskip", k.glue.parskip), paramGlue("parskip", glue(0)))
    for (const n of vlist) {
      if (n.kind === "hlist") {
        if (prevDepth !== null) {
          const d = baselineskip.width - prevDepth - n.height
          contrib.push(d < k.dimens.lineskiplimit ? spec("lineskip", k.glue.lineskip) : spec("baselineskip", baselineskip, d))
        }
        prevDepth = n.depth
      }
      contrib.push(n)
    }
  }
  // \end{document}: a skip of -\prevdepth, at most \maxdepth, when the last line has depth,
  // then \clearpage, whose \newpage is \vfil\penalty-10000 (TeX's page trace and box dumps
  // show both forms)
  if (prevDepth !== null && prevDepth > 0) contrib.push(glue(-Math.min(prevDepth, k.dimens.maxdepth)))
  contrib.push(glue(0, 65536, FIL), { kind: "penalty", penalty: -10000 })
  const { pages, trace: pageTrace } = buildPages(contrib, { vsize: k.dimens.textheight, maxDepth: k.dimens.maxdepth, topSkip: spec("topskip", k.glue.topskip) })
  return { decisions, pages, pageTrace, lineCount }
}

export const paragraph: Adapter = (src) => {
  const { cls, option } = documentClass(src)
  const k = classData(cls, option)
  const paras = paragraphsOf(src.slice(src.indexOf("\\begin{document}") + 16, src.indexOf("\\end{document}")))
  const { decisions, pages, pageTrace, lineCount } = typesetBody(paras, k)

  // LaTeX's output routine for each page: \@makecol puts \box255 in
  // \vbox to\@colht{\unvbox255 \vskip-\dp255 \@textbottom}; \@outputpage stacks
  // \topmargin, the \headheight box and \headsep above it, shifted by \oddsidemargin
  const textbottom: Node[] = k.ints.raggedbottom ? [glue(0, 7, FIL)] : [] // \vskip\z@\@plus.0001fil
  const boxes = pages.map((pg, i) => {
    const box255 = vpack(pg.nodes.slice(), { exactly: pg.goal }, k.dimens.maxdepth)
    const outputbox = vpack([...pg.nodes, glue(-box255.depth), ...textbottom], { exactly: k.dimens.textheight })
    outputbox.shift = k.ints.twoside && i % 2 === 1 ? k.dimens.evensidemargin : k.dimens.oddsidemargin // \@themargin
    return { outputbox, column: pg.nodes.slice(pg.nodes.findIndex((n) => n.kind === "glue" && n.param === "topskip")) }
  })
  const shipped = boxes.map((b) => vpack([kern(k.dimens.topmargin + k.dimens.headheight + k.dimens.headsep), b.outputbox]))
  return {
    trace: shipOut(shipped),
    decisions,
    pages: pageTrace,
    columns: boxes.map((b) => b.column.map(emitBoxes)),
    notes: [`${cls} [${option}]; ${paras.length} paragraph(s), ${lineCount} lines, ${pages.length} page(s) from the engine's line and page builders`],
  }
}
