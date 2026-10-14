// Adapter "paragraph": a fixture whose body is plain-text paragraphs in a
// standard class at 10pt, 11pt or 12pt. Paragraphs are separated by blank lines;
// one may be set in a size group, {\large … \par}. Each may start with
// paragraph assignments:
//   \noindent  \parshape <n> <i>pt <l>pt …  \<int param>=<n>  \<dimen param>=<n>pt
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
import { emptyBox, glue, kern, paramGlue, type GlueNode, type Node } from "../../../layout/nodes"
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
  body = body.replace(/\s+/g, " ").trim()
  // leading paragraph assignments, scanned as TeX scans them (§§ 440–463)
  for (;;) {
    const m = body.match(/^\\([a-z]+)\s*/)
    if (!m) break
    const name = m[1]
    if (name === "noindent") { indent = false; body = body.slice(m[0].length); continue }
    if (!(name in INT_PARAMS || name in DIMEN_PARAMS || name === "parshape")) break
    const s = new Scanner(body.slice(m[0].length).replace(/^=\s*/, ""), env) // optional equals (§ 1224)
    if (name in INT_PARAMS) params[INT_PARAMS[name as keyof typeof INT_PARAMS]] = s.scanInt().value
    else if (name in DIMEN_PARAMS) params[DIMEN_PARAMS[name as keyof typeof DIMEN_PARAMS]] = s.scanDimen().value
    else {
      const n = s.scanInt().value
      params.parShape = Array.from({ length: n }, () => [s.scanDimen().value, s.scanDimen().value] as [number, number])
    }
    if (s.errors.length) throw new Error(`\\${name}: ${s.errors[0]}`)
    body = s.rest().trimStart()
  }
  if (/[\\{}$%&#^_~]/.test(body)) throw new Error("paragraph adapter accepts plain text after the assignments")

  params.hyphenation = {
    hyphenator: hyphenator(),
    fontOf: (name, size) => { if (name !== font.name || size !== font.size) throw new Error(`no font ${name}@${size}`); return font },
    lHyf: k.ints.lefthyphenmin, rHyf: k.ints.righthyphenmin, ucHyph: k.ints.uchyph,
  }
  const list: Node[] = indent ? [emptyBox("hlist", k.dimens.parindent)] : []
  appendText(list, body, font, { spaceFactor: 1000 })
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
    const end = body.search(/\n\s*\n|\{\\/)
    const text = end < 0 ? body : body.slice(0, Math.max(end, 1))
    if (text.trim()) out.push({ size: "normalsize", text })
    body = body.slice(text.length).trim()
  }
  return out
}

export const paragraph: Adapter = (src) => {
  const { cls, option } = documentClass(src)
  const k = classData(cls, option)
  const paras = paragraphsOf(src.slice(src.indexOf("\\begin{document}") + 16, src.indexOf("\\end{document}")))

  // text column: \topskip; each paragraph's lines with interline glue (§§ 679, 1001).
  // A paragraph begun in vertical mode gets \parskip (new_graf, § 1091), then a
  // second, zero \parskip: LaTeX's paragraph code (ltpara) restarts the paragraph
  // in a group with \parskip=0pt. The page builder discards both on the first one.
  const col: Node[] = []
  const decisions = []
  let prevDepth: number | null = null
  let lineCount = 0
  for (const [i, para] of paras.entries()) {
    const { list, params } = paragraphInput(para.text, k, para.size)
    const { lines, vlist, trace } = lineBreak(list, params)
    decisions.push(trace)
    lineCount += lines.length
    const baselineskip = k.sizes[para.size].baselineskip // in force when \par appends the lines
    if (i === 0) col.push(spec("topskip", k.glue.topskip, Math.max(0, k.glue.topskip.width - lines[0].height)))
    else col.push(spec("parskip", k.glue.parskip), paramGlue("parskip", glue(0)))
    for (const n of vlist) {
      if (n.kind === "hlist") {
        if (prevDepth !== null) {
          const d = baselineskip.width - prevDepth - n.height
          col.push(d < k.dimens.lineskiplimit ? spec("lineskip", k.glue.lineskip) : spec("baselineskip", baselineskip, d))
        }
        prevDepth = n.depth
      }
      col.push(n)
    }
  }
  const column = vpack(col)
  column.shift = k.dimens.oddsidemargin
  // \@outputpage: \topmargin, the \headheight box, \headsep, then the text box
  const page = vpack([kern(k.dimens.topmargin + k.dimens.headheight + k.dimens.headsep), column])
  return {
    trace: shipOut([page]),
    decisions,
    column: col.map(emitBoxes),
    notes: [`${cls} [${option}]; ${paras.length} paragraph(s), ${lineCount} lines from the engine line breaker`],
  }
}
