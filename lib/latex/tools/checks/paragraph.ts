// Emitter check for #29: lay out a fixture's single paragraph with the engine's
// layout primitives and compare the shipped-out trace with TeX's DVI at 0 sp.
//
// Scaffolding, stated plainly: two inputs are taken from the oracle because the
// engine pieces that compute them do not exist yet.
//   - line breaks  → Knuth–Plass paragraph builder (phase 4 issue)
//   - page origin  → page model / geometry (phase 4 issue)
// Everything else (metrics, ligatures, kerns, space factor, interword glue,
// parindent, parfillskip, hpack, interline glue, ship_out rounding) is the
// engine's own computation.

import { readFileSync } from "node:fs"
import { UNITY, INF_PENALTY } from "../../layout/arith"
import { loadFont } from "../../layout/font"
import { appendText } from "../../layout/hmode"
import { emptyBox, glue, kern, penalty, FIL, type BoxNode, type Node } from "../../layout/nodes"
import { hpack, vpack } from "../../layout/pack"
import { emitBoxes } from "../../emit/boxes"
import { shipOut } from "../../emit/trace"
import { compareTraces, validateBoxes, validateTrace } from "../../trace/schema"
import { loadTfm, oracleTrace } from "../oracle/oracle"

// article.cls, 10pt, letterpaper (size10.clo)
const PT = UNITY
const HSIZE = 345 * PT, PARINDENT = 15 * PT, BASELINESKIP = 12 * PT, TOPSKIP = 10 * PT
const LINESKIP = 1 * PT, LINESKIPLIMIT = 0

export function checkParagraph(fixture: string): boolean {
  const expected = oracleTrace(fixture)

  // --- inputs taken from the oracle (see header) ---
  const eg = expected.pages[0].glyphs
  const lineVs = [...new Set(eg.map((g) => g.v))]
  const wordsPerLine = lineVs.map((v) => {
    const gs = eg.filter((g) => g.v === v)
    return 1 + gs.slice(1).filter((g, i) => g.h - (gs[i].h + gs[i].width) > 1.5 * PT).length
  })
  const origin = { h: eg[0].h - PARINDENT, v: eg[0].v } // left edge and first baseline

  // --- engine computation ---
  const font = loadFont(loadTfm("cmr10"), 10 * PT)
  const src = readFileSync(fixture, "utf8")
  const body = src.slice(src.indexOf("\\begin{document}") + 16, src.indexOf("\\end{document}")).replace(/\s+/g, " ").trim()

  const list: Node[] = [emptyBox("hlist", PARINDENT)]
  appendText(list, body, font, { spaceFactor: 1000 })
  if (list.at(-1)?.kind === "glue") list.pop() // line_break removes a final glue (§ 816)
  list.push(penalty(INF_PENALTY), glue(0, UNITY, FIL)) // \parfillskip = 0pt plus 1fil

  // post_line_break (§§ 877–890): break at interword glue, discard it, add \rightskip
  const lines: BoxNode[] = []
  let line: Node[] = [], seenGlue = 0, li = 0, target = wordsPerLine[0]
  for (const n of list) {
    const interword = n.kind === "glue" && n.stretchOrder === 0
    if (interword && ++seenGlue === target) {
      lines.push(hpack([...line, glue(0)], { exactly: HSIZE }))
      line = []; li++; target += wordsPerLine[li] ?? Infinity
      continue
    }
    line.push(n)
  }
  lines.push(hpack([...line, glue(0)], { exactly: HSIZE }))

  // build the column: \topskip then interline glue (§ 679 append_to_vlist)
  const col: Node[] = [glue(Math.max(0, TOPSKIP - lines[0].height))]
  lines.forEach((b, i) => {
    if (i > 0) {
      const d = BASELINESKIP - lines[i - 1].depth - b.height
      col.push(d < LINESKIPLIMIT ? glue(LINESKIP) : glue(d))
    }
    col.push(b)
  })
  const column = vpack(col)
  column.shift = origin.h
  const page = vpack([kern(origin.v - TOPSKIP), column])
  const actual = shipOut([page])

  // --- verdict ---
  const schemaErrs = [...validateTrace(actual), ...validateBoxes(emitBoxes(page))]
  const div = compareTraces(expected, actual)
  const glyphs = actual.pages[0].glyphs.length
  console.log(`fixture: ${fixture.split("/").slice(-2).join("/")}`)
  console.log(`  lines: ${lines.length} (TeX ${lineVs.length})  glyphs: ${glyphs} (TeX ${eg.length})  schema errors: ${schemaErrs.length}`)
  lines.forEach((b, i) => console.log(`  line ${i + 1}: glue ${["normal", "stretch", "shrink"][b.glueSign]} ratio ${b.glueSet.toFixed(6)}`))
  if (schemaErrs.length) console.log("  " + schemaErrs.slice(0, 5).join("\n  "))
  if (div) {
    console.log(`  FIRST DIVERGENCE page ${div.page} item ${div.index} ${div.field}: expected ${JSON.stringify(div.expected)} actual ${JSON.stringify(div.actual)}`)
    return false
  }
  console.log(`  IDENTICAL: all ${glyphs} glyph positions equal TeX's DVI at 0 sp`)
  return schemaErrs.length === 0
}
