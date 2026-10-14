// Math oracle (#74, #75): random formulas of math characters typeset by TeX in
// \hbox{$…$} and shown with \showbox, against the engine's mlist_to_hlist
// (mathlayout/mlist.ts): mathcode classes, rule 5, make_ord kerns and
// ligatures, italic corrections, inter-atom spacing. Articles at 10, 11, 12pt.
//   bun engine math:check [--n 3000] [--seed 1]

import { spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { emitBoxes } from "../../emit/boxes"
import { loadFont, type Font } from "../../layout/font"
import { hpack } from "../../layout/pack"
import type { Node } from "../../layout/nodes"
import type { MathData } from "../../mathlayout/data"
import { mathCharNoad, mlistToHlist } from "../../mathlayout/mlist"
import { compareBoxLists, type BoxNode } from "../../trace/schema"
import { classData } from "../classes"
import { dataFont } from "../fonts"
import { texEnv } from "../tex"
import { parseBoxDump } from "./boxes"

const DIR = ".cache/mathcheck"
const SPECIAL = new Set([..."#$%&\\^_{}~"].map((c) => c.charCodeAt(0)))

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function mathCheck(n: number, seed: number): number {
  mkdirSync(DIR, { recursive: true })
  const data = JSON.parse(readFileSync("lib/latex/data/math/latex.json", "utf8")) as MathData
  const pool = Array.from({ length: 94 }, (_, i) => 33 + i).filter((c) => !SPECIAL.has(c) && data.mathcodes[c] < 0x8000)
  const r = rng(seed)
  const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)]
  // operators and punctuation weigh more, so spacing and rule 5 come up often
  const busy = pool.filter((c) => (data.mathcodes[c] >> 12) !== 7 && (data.mathcodes[c] >> 12) !== 0)
  let failed = 0, total = 0
  const glueKinds = new Map<string, number>()
  for (const option of ["10pt", "11pt", "12pt"]) {
    const k = classData("article", option)
    const fonts: Font[] = k.sizes.normalsize.math.text.map((f) => loadFont(dataFont(f.name), f.at))
    const cases = Array.from({ length: Math.ceil(n / 3) }, () => Array.from({ length: 1 + Math.floor(r() * 10) }, () => (r() < 0.45 ? pick(busy) : pick(pool))))
    const src = (codes: number[]) => codes.map((c) => String.fromCharCode(c) + (r() < 0.2 ? " " : "")).join("")
    writeFileSync(join(DIR, `math-${option}.tex`), [
      `\\documentclass[${option}]{article}`, "\\showboxdepth=100 \\showboxbreadth=100000", "\\begin{document}",
      ...cases.map((c) => `\\setbox0\\hbox{$${src(c)}$}\\showbox0`), "\\end{document}", "",
    ].join("\n"))
    const run = spawnSync("latex", ["-interaction=nonstopmode", `math-${option}.tex`], { cwd: DIR, env: texEnv({ max_print_line: "100000" }), stdio: "ignore", timeout: 300_000 })
    if (run.error) throw run.error
    const lines = readFileSync(join(DIR, `math-${option}.log`), "latin1").split("\n")
    const boxes: BoxNode[] = []
    for (let i = 0; i < lines.length; i++) if (lines[i] === "> \\box0=") { const { box, end } = parseBoxDump(lines, i + 1); boxes.push(box); i = end }
    if (boxes.length !== cases.length) throw new Error(`TeX showed ${boxes.length} boxes for ${cases.length} formulas (${DIR}/math-${option}.log)`)
    cases.forEach((codes, i) => {
      total++
      const hl = mlistToHlist(codes.map((c) => mathCharNoad(data.mathcodes[c])), {
        fonts, muskips: data.muskips as never, binoppenalty: data.ints.binoppenalty, relpenalty: data.ints.relpenalty, penalties: false, textStyle: true,
      })
      const list: Node[] = [{ kind: "math", on: true, width: data.dimens.mathsurround }, ...hl, { kind: "math", on: false, width: data.dimens.mathsurround }]
      const engine = emitBoxes(hpack(list))
      const tex = boxes[i]
      if (tex.type === "hbox") for (const x of tex.children) if (x.type === "glue" && x.param) glueKinds.set(x.param, (glueKinds.get(x.param) ?? 0) + 1)
      const d = compareBoxLists([tex], [engine])
      if (!d) return
      failed++
      if (failed <= 8) console.log(`✗ [${option}] $${String.fromCharCode(...codes)}$: ${d.path} ${d.field}\n    TeX:    ${JSON.stringify(d.expected)}\n    engine: ${JSON.stringify(d.actual)}`)
    })
  }
  console.log(`${total - failed}/${total} formulas identical to TeX (seed ${seed}; spacing glue: ${[...glueKinds].map(([k, v]) => `${k} ×${v}`).join(", ")})`)
  return failed ? 1 : 0
}
