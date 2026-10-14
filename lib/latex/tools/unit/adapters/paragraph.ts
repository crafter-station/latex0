// Adapter "paragraph": a fixture whose body is one paragraph of plain text in
// article 10pt, optionally preceded by paragraph assignments:
//   \noindent  \parshape <n> <i>pt <l>pt …  \<int param>=<n>  \<dimen param>=<n>pt
// (see INT_PARAMS and DIMEN_PARAMS).
// Lines are broken by the engine's own line breaker (#112).
//
// Scaffolding, stated plainly: the page origin (first baseline) is read from the
// oracle until the page model exists. The left margin is article's letterpaper
// \oddsidemargin (62pt).

import { UNITY } from "../../../layout/arith"
import { Scanner } from "../../../layout/dimen"
import { loadFont, QUAD, X_HEIGHT } from "../../../layout/font"
import { appendText } from "../../../layout/hmode"
import { buildHyphenator, type HyphenationData } from "../../../layout/hyphenate"
import { latexDefaults, lineBreak, type LineBreakParams } from "../../../layout/linebreak"
import { emptyBox, glue, kern, paramGlue, type Node } from "../../../layout/nodes"
import { emitBoxes } from "../../../emit/boxes"
import { vpack } from "../../../layout/pack"
import { shipOut } from "../../../emit/trace"
import { readFileSync } from "node:fs"
import { dataFont } from "../../fonts"
import type { Adapter } from "./index"

const PT = UNITY
const HSIZE = 345 * PT, PARINDENT = 15 * PT, BASELINESKIP = 12 * PT, TOPSKIP = 10 * PT
const LINESKIP = 1 * PT, LINESKIPLIMIT = 0, ODDSIDEMARGIN = 62 * PT

// assignable parameters: TeX name → LineBreakParams field
const INT_PARAMS = {
  hangafter: "hangAfter", looseness: "looseness", tolerance: "tolerance", pretolerance: "pretolerance",
  linepenalty: "linePenalty", adjdemerits: "adjDemerits", hyphenpenalty: "hyphenPenalty", exhyphenpenalty: "exHyphenPenalty",
  doublehyphendemerits: "doubleHyphenDemerits", finalhyphendemerits: "finalHyphenDemerits",
} as const
const DIMEN_PARAMS = { hangindent: "hangIndent", emergencystretch: "emergencyStretch" } as const

let memoHyphenator: ReturnType<typeof buildHyphenator> | undefined
const hyphenator = () => (memoHyphenator ??= buildHyphenator(JSON.parse(readFileSync("lib/latex/data/hyphenation/en-us.json", "utf8")) as HyphenationData))

/**
 * One paragraph of article-10pt plain text with leading assignments, as the
 * horizontal list TeX builds for it and the line-breaking parameters in force.
 */
export function paragraphInput(body: string): { list: Node[]; params: LineBreakParams } {
  const params = latexDefaults(HSIZE)
  const font = loadFont(dataFont("cmr10"), 10 * PT)
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
    lHyf: 2, rHyf: 3, ucHyph: 1, // \lefthyphenmin, \righthyphenmin, \uchyph for English
  }
  const list: Node[] = indent ? [emptyBox("hlist", PARINDENT)] : []
  appendText(list, body, font, { spaceFactor: 1000 })
  return { list, params }
}

export const paragraph: Adapter = (src, oracle) => {
  const eg = oracle.pages[0]?.glyphs ?? []
  if (!eg.length) throw new Error("oracle trace has no glyphs")
  const { list, params } = paragraphInput(src.slice(src.indexOf("\\begin{document}") + 16, src.indexOf("\\end{document}")))
  const { lines, vlist, trace: decisions } = lineBreak(list, params)

  // column: \topskip, then the line vlist with interline glue (§ 679)
  const col: Node[] = [paramGlue("topskip", glue(Math.max(0, TOPSKIP - lines[0].height)))]
  let prevDepth: number | null = null
  for (const n of vlist) {
    if (n.kind === "hlist") {
      if (prevDepth !== null) {
        const d = BASELINESKIP - prevDepth - n.height
        col.push(d < LINESKIPLIMIT ? paramGlue("lineskip", glue(LINESKIP)) : paramGlue("baselineskip", glue(d)))
      }
      prevDepth = n.depth
    }
    col.push(n)
  }
  const column = vpack(col)
  column.shift = ODDSIDEMARGIN
  const page = vpack([kern(eg[0].v - TOPSKIP), column])
  return {
    trace: shipOut([page]),
    decisions: [decisions],
    column: col.map(emitBoxes),
    notes: [`engine line breaker: ${lines.length} lines via ${decisions.passes.map((p) => p.pass).join(" → ")} pass`, "scaffold: first-baseline position taken from the oracle (page model)"],
  }
}
