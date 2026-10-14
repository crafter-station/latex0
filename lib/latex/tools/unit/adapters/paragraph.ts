// Adapter "paragraph": a fixture whose body is one paragraph of plain text in
// article 10pt, optionally preceded by paragraph-shape assignments:
//   \noindent  \hangindent=<n>pt  \hangafter=<n>  \parshape <n> <i>pt <l>pt …
// Lines are broken by the engine's own line breaker (#112).
//
// Scaffolding, stated plainly: the page origin (first baseline) is read from the
// oracle until the page model exists. The left margin is article's letterpaper
// \oddsidemargin (62pt).

import { UNITY } from "../../../layout/arith"
import { loadFont } from "../../../layout/font"
import { appendText } from "../../../layout/hmode"
import { buildHyphenator, type HyphenationData } from "../../../layout/hyphenate"
import { latexDefaults, lineBreak } from "../../../layout/linebreak"
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

/** "12.5pt" → sp, via TeX's decimal rounding (§ 102) */
function pt(s: string): number {
  const m = s.match(/^(-?)(\d*)(?:\.(\d+))?pt$/)
  if (!m) throw new Error(`paragraph adapter: only pt dimensions are supported, got "${s}"`)
  const digits = (m[3] ?? "").slice(0, 17).split("").map(Number)
  let a = 0
  for (let k = digits.length - 1; k >= 0; k--) a = Math.floor((a + digits[k] * 0o400000) / 10)
  const sp = Number(m[2] || 0) * 65536 + Math.floor((a + 1) / 2)
  return m[1] ? -sp : sp
}

let memoHyphenator: ReturnType<typeof buildHyphenator> | undefined
const hyphenator = () => (memoHyphenator ??= buildHyphenator(JSON.parse(readFileSync("lib/latex/data/hyphenation/en-us.json", "utf8")) as HyphenationData))

export const paragraph: Adapter = (src, oracle) => {
  const eg = oracle.pages[0]?.glyphs ?? []
  if (!eg.length) throw new Error("oracle trace has no glyphs")

  let body = src.slice(src.indexOf("\\begin{document}") + 16, src.indexOf("\\end{document}")).replace(/\s+/g, " ").trim()
  const params = latexDefaults(HSIZE)
  let indent = true
  // leading paragraph-shape assignments
  for (;;) {
    let m: RegExpMatchArray | null
    if ((m = body.match(/^\\noindent\s*/))) { indent = false }
    else if ((m = body.match(/^\\hangindent\s*=\s*(-?[\d.]+pt)\s*/))) { params.hangIndent = pt(m[1]) }
    else if ((m = body.match(/^\\hangafter\s*=\s*(-?\d+)\s*/))) { params.hangAfter = Number(m[1]) }
    else if ((m = body.match(/^\\parshape\s*=?\s*(\d+)((?:\s+-?[\d.]+pt)+)\s*/))) {
      const dims = m[2].trim().split(/\s+/).map(pt)
      const n = Number(m[1])
      if (dims.length !== 2 * n) throw new Error(`\\parshape ${n} needs ${2 * n} dimensions`)
      params.parShape = Array.from({ length: n }, (_, i) => [dims[2 * i], dims[2 * i + 1]] as [number, number])
    } else break
    body = body.slice(m[0].length)
  }
  if (/[\\{}$%&#^_~]/.test(body)) throw new Error("paragraph adapter accepts plain text after the shape assignments")

  const font = loadFont(dataFont("cmr10"), 10 * PT)
  params.hyphenation = {
    hyphenator: hyphenator(),
    fontOf: (name, size) => { if (name !== font.name || size !== font.size) throw new Error(`no font ${name}@${size}`); return font },
    lHyf: 2, rHyf: 3, ucHyph: 1, // \lefthyphenmin, \righthyphenmin, \uchyph for English
  }
  const list: Node[] = indent ? [emptyBox("hlist", PARINDENT)] : []
  appendText(list, body, font, { spaceFactor: 1000 })
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
