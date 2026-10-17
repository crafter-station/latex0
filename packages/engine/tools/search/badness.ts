// Fixture search (the machine that builds the engine): ask TeX for paragraphs
// whose line-breaking trace contains given badness values, and write them as
// fixtures. Used to pin rule boundaries (§ 852 fitness classes) that ordinary
// text rarely hits.
//   bun engine search:badness 12,13,99,100 [--seed 7] [--tries 200]

import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { oracleRun } from "../oracle/oracle"

const WORDS = ("the a of and to in is that it was for on are as with his they at be this from have or by one had not but what all were when " +
  "we there can an your which their said if do will each about how up out them then she many some so these would other into has more her two " +
  "like him see time could no make than first been its who now people my made over did down only way find use may water long little very after " +
  "words called just where most know").split(" ")

export function searchBadness(targets: number[], seed = 7, tries = 200): Record<number, string> {
  let s = seed
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
  const scratch = join(process.cwd(), ".cache/search")
  mkdirSync(scratch, { recursive: true })
  const found: Record<number, string> = {}
  for (let t = 0; t < tries && Object.keys(found).length < targets.length; t++) {
    const n = 55 + Math.floor(rnd() * 30)
    const text = Array.from({ length: n }, () => WORDS[Math.floor(rnd() * WORDS.length)]).join(" ")
    const body = text[0].toUpperCase() + text.slice(1) + "."
    const file = join(scratch, "candidate.tex")
    writeFileSync(file, `\\documentclass{article}\n\\pagestyle{empty}\n\\begin{document}\n${body}\n\\end{document}\n`)
    const p = oracleRun(file).decisions.paragraphs[0]
    if (!p || p.passes.length !== 1) continue // first pass only: no hyphenation involved
    for (const f of p.passes[0].feasible) {
      if (f.badness !== null && targets.includes(f.badness) && !found[f.badness]) found[f.badness] = body
    }
  }
  return found
}

export function writeBadnessFixtures(found: Record<number, string>, dir = "packages/engine/fixtures/micro/linebreak"): string[] {
  const written: string[] = []
  for (const [b, body] of Object.entries(found)) {
    const lines: string[] = []
    let cur = ""
    for (const w of body.split(" ")) { if ((cur + " " + w).length > 76) { lines.push(cur); cur = w } else cur = cur ? `${cur} ${w}` : w }
    lines.push(cur)
    const file = join(dir, `badness-${b}.tex`)
    writeFileSync(file, `% fixture: linebreak/badness-${b}\n% tier: T3\n% engine: paragraph\n% covers: a feasible break with badness exactly ${b}, on a fitness-class boundary (§ 852: decent ≤ 12 < loose ≤ 99 < very loose); found by search\n% issue: #112\n\\documentclass{article}\n\\pagestyle{empty}\n\\begin{document}\n${lines.join("\n")}\n\\end{document}\n`)
    written.push(file)
  }
  return written
}
