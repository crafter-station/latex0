// Gaps: what the engine does not lay out yet, ranked by how many documents it
// stops. Each document is laid out by the engine alone (no TeX), so any corpus
// works: the fixtures, the starter corpus, a folder of real documents. A
// document stops at its first construct not laid out; one that throws anything
// else is an engine bug and is listed apart.

import { readFileSync } from "node:fs"
import { relative } from "node:path"
import { document } from "../latex/document"
import { paragraph } from "../latex/paragraph"
import { Unsupported } from "../latex/unsupported"
import "./data"
import { ORACLE_EPOCH } from "./tex"
import { collectFixtures } from "./unit/run"

/** A reason without the text it quotes, so documents stopped by the same construct group together. */
export const reasonKey = (message: string) => message.replace(/"[^"]*"/g, "…").trim()

/** A fixture names its layout in its header (% engine: paragraph); anything else is a whole document. */
const layoutOf = (src: string) => (/^% engine: paragraph$/m.test(src) ? paragraph : (s: string) => document(s, { epoch: ORACLE_EPOCH }))

export function gaps(paths: string[], examples = 3): number {
  const files = collectFixtures(paths)
  const reasons = new Map<string, string[]>()
  const bugs: string[] = []
  let laidOut = 0
  for (const f of files) {
    const name = relative(process.cwd(), f)
    try {
      const src = readFileSync(f, "utf8")
      layoutOf(src)(src)
      laidOut++
    } catch (e) {
      if (!(e instanceof Unsupported)) { bugs.push(`${name}: ${(e as Error).message}`); continue }
      const key = reasonKey(e.message)
      reasons.set(key, [...(reasons.get(key) ?? []), name])
    }
  }
  const ranked = [...reasons].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
  console.log(`${laidOut}/${files.length} documents laid out; ${files.length - laidOut - bugs.length} stopped at a construct not laid out yet; ${bugs.length} engine errors\n`)
  for (const [key, docs] of ranked) {
    console.log(`${String(docs.length).padStart(4)}  ${key}`)
    for (const d of docs.slice(0, examples)) console.log(`        ${d}`)
  }
  if (bugs.length) console.log(`\nengine errors (bugs, not gaps):\n${bugs.map((b) => `  ${b}`).join("\n")}`)
  return bugs.length ? 1 : 0
}
