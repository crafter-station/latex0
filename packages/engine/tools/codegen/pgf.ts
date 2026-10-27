// Codegen (#286): pgfmath's lookup tables (pgfmathfunctions.trigonometric.code.tex) as data — \pgfmath@cos@<n>
// for n = 0…181 and \pgfmath@acos@<n>, \pgfmath@atan@<n> for n = 0…1000, the macros' texts as TeX expands
// them in a document body with pgf loaded.
//   bun engine codegen [--check]

import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { PgfTables } from "../../pgf/mathtrig"
import { texEnv } from "../tex"

const OUT = "packages/engine/data/pgf"
const SIZES: Record<keyof PgfTables, number> = { cos: 182, acos: 1001, atan: 1001 }

export function codegenPgf(check: boolean): number {
  const dir = ".cache/pgfdata"
  mkdirSync(dir, { recursive: true })
  const tables = Object.keys(SIZES) as (keyof PgfTables)[]
  writeFileSync(join(dir, "probe.tex"), [
    "\\documentclass{article}", "\\usepackage{pgf}", "\\begin{document}", "\\makeatletter",
    ...tables.map((t) => `\\count255=0 \\loop\\immediate\\write16{T:${t}:\\the\\count255=\\csname pgfmath@${t}@\\the\\count255\\endcsname}\\advance\\count255 1 \\ifnum\\count255<${SIZES[t]} \\repeat`),
    "\\end{document}", "",
  ].join("\n"))
  execFileSync("latex", ["-interaction=batchmode", "-halt-on-error", "probe.tex"], { cwd: dir, env: texEnv({ max_print_line: "100000" }) })
  const data: PgfTables = { cos: [], acos: [], atan: [] }
  for (const line of readFileSync(join(dir, "probe.log"), "latin1").split("\n")) {
    const m = line.match(/^T:(\w+):(\d+)=(-?\d+\.\d+)$/)
    if (m) data[m[1] as keyof PgfTables][Number(m[2])] = m[3]
  }
  for (const t of tables) if (data[t].length !== SIZES[t] || data[t].includes(undefined as never)) throw new Error(`pgf codegen: TeX did not report every ${t} entry`)
  const body = JSON.stringify(data) + "\n"
  const file = join(OUT, "tables.json")
  const same = existsSync(file) && readFileSync(file, "utf8") === body
  if (check) { console.log(same ? "pgf data up to date" : "pgf data out of date: run bun engine codegen"); return same ? 0 : 1 }
  mkdirSync(OUT, { recursive: true })
  writeFileSync(file, body)
  console.log(`wrote ${file}`)
  return 0
}
