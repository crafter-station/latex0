// Codegen (#74): LaTeX's math setup as data — \mathcode of every 7-bit
// character, the mu skips, and the math penalties and dimensions — read from
// TeX in a document body.
//   bun engine codegen [--check]

import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Scanner } from "../../layout/dimen"
import type { MathData } from "../../mathlayout/data"
import { parseScaled } from "../oracle/tracing"
import { texEnv } from "../tex"

const OUT = "lib/latex/data/math"
const INTS = ["binoppenalty", "relpenalty", "delimiterfactor"]
const DIMENS = ["mathsurround", "delimitershortfall", "nulldelimiterspace", "scriptspace"]
const MUSKIPS = ["thinmuskip", "medmuskip", "thickmuskip"]

export function codegenMath(check: boolean): number {
  const dir = ".cache/mathdata"
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "probe.tex"), [
    "\\documentclass{article}", "\\begin{document}",
    "\\count255=0 \\loop\\immediate\\write16{C:\\the\\count255=\\the\\mathcode\\count255}\\advance\\count255 1 \\ifnum\\count255<128 \\repeat",
    ...INTS.map((x) => `\\immediate\\write16{I:${x}=\\the\\${x}}`),
    ...DIMENS.map((x) => `\\immediate\\write16{D:${x}=\\the\\${x}}`),
    ...MUSKIPS.map((x) => `\\immediate\\write16{M:${x}=\\the\\${x}}`),
    "\\end{document}", "",
  ].join("\n"))
  execFileSync("latex", ["-interaction=batchmode", "-halt-on-error", "probe.tex"], { cwd: dir, env: texEnv({ max_print_line: "100000" }) })
  const data: MathData = { mathcodes: [], ints: {}, dimens: {}, muskips: {} }
  for (const line of readFileSync(join(dir, "probe.log"), "latin1").split("\n")) {
    let m: RegExpMatchArray | null
    if ((m = line.match(/^C:(\d+)=(\d+)$/))) data.mathcodes[Number(m[1])] = Number(m[2])
    else if ((m = line.match(/^I:(\w+)=(-?\d+)$/))) data.ints[m[1]] = Number(m[2])
    else if ((m = line.match(/^D:(\w+)=(-?[\d.]+)pt$/))) data.dimens[m[1]] = parseScaled(m[2])
    else if ((m = line.match(/^M:(\w+)=(.*)$/))) data.muskips[m[1]] = new Scanner(m[2], { em: 0, ex: 0 }).scanGlue(true)
  }
  if (data.mathcodes.length !== 128 || Object.keys(data.muskips).length !== 3) throw new Error("math codegen: TeX did not report every value")
  const body = JSON.stringify(data) + "\n"
  const file = join(OUT, "latex.json")
  const same = existsSync(file) && readFileSync(file, "utf8") === body
  if (check) { console.log(same ? "math data up to date" : "math data out of date: run bun engine codegen"); return same ? 0 : 1 }
  mkdirSync(OUT, { recursive: true })
  writeFileSync(file, body)
  console.log(`wrote ${file}`)
  return 0
}
