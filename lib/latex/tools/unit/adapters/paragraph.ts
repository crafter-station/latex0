// Adapter "paragraph": a fixture whose body is one plain-text paragraph in
// article 10pt. Lays it out with the engine's layout primitives.
//
// Scaffolding, stated plainly: line breaks and the page origin are read from
// the oracle until the paragraph builder (#112) and the page model exist.

import { INF_PENALTY, UNITY } from "../../../layout/arith"
import { loadFont } from "../../../layout/font"
import { appendText } from "../../../layout/hmode"
import { emptyBox, FIL, glue, kern, penalty, type BoxNode, type Node } from "../../../layout/nodes"
import { hpack, vpack } from "../../../layout/pack"
import { shipOut } from "../../../emit/trace"
import type { Trace } from "../../../trace/schema"
import { dataFont } from "../../fonts"
import type { Adapter } from "./index"

// article.cls, 10pt, letterpaper (size10.clo)
const PT = UNITY
const HSIZE = 345 * PT, PARINDENT = 15 * PT, BASELINESKIP = 12 * PT, TOPSKIP = 10 * PT
const LINESKIP = 1 * PT, LINESKIPLIMIT = 0

export const paragraph: Adapter = (src, oracle) => {
  const eg = oracle.pages[0]?.glyphs ?? []
  if (!eg.length) throw new Error("oracle trace has no glyphs")

  // scaffold inputs from the oracle
  const lineVs = [...new Set(eg.map((g) => g.v))]
  const wordsPerLine = lineVs.map((v) => {
    const gs = eg.filter((g) => g.v === v)
    return 1 + gs.slice(1).filter((g, i) => g.h - (gs[i].h + gs[i].width) > 1.5 * PT).length
  })
  const origin = { h: eg[0].h - PARINDENT, v: eg[0].v }

  // engine computation
  const font = loadFont(dataFont("cmr10"), 10 * PT)
  const body = src.slice(src.indexOf("\\begin{document}") + 16, src.indexOf("\\end{document}")).replace(/\s+/g, " ").trim()
  if (/[\\{}$%&#^_~]/.test(body)) throw new Error("paragraph adapter accepts plain text only (no commands or special characters)")

  const list: Node[] = [emptyBox("hlist", PARINDENT)]
  appendText(list, body, font, { spaceFactor: 1000 })
  if (list.at(-1)?.kind === "glue") list.pop() // § 816
  list.push(penalty(INF_PENALTY), glue(0, UNITY, FIL)) // \parfillskip

  const lines: BoxNode[] = []
  let line: Node[] = [], seen = 0, li = 0, target = wordsPerLine[0]
  for (const n of list) {
    if (n.kind === "glue" && n.stretchOrder === 0 && ++seen === target) {
      lines.push(hpack([...line, glue(0)], { exactly: HSIZE })) // + \rightskip (§ 887)
      line = []; li++; target += wordsPerLine[li] ?? Infinity
      continue
    }
    line.push(n)
  }
  lines.push(hpack([...line, glue(0)], { exactly: HSIZE }))

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
  const trace: Trace = shipOut([page])
  return { trace, notes: [`scaffold: ${lines.length} line breaks and page origin taken from the oracle (#112, page model)`] }
}
