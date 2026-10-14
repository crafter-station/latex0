// Parsers for TeX's decision logs (#28): \tracingparagraphs (tex.web §§ 846, 855,
// 863) and \tracingpages (§§ 986, 1005, 1011). The log must be written with
// max_print_line large enough that lines are not wrapped.

import type { ActiveNode, BreakKind, Decisions, FeasibleBreak, PageTrace, ParagraphTrace, Pass, PassTrace } from "../../trace/decisions"

/** Parse a decimal printed by print_scaled back to sp exactly (round_decimals, § 102). */
export function parseScaled(s: string): number {
  const m = s.match(/^(-?)(\d+)(?:\.(\d+))?$/)
  if (!m) throw new Error(`not a dimension: ${s}`)
  const digits = (m[3] ?? "").slice(0, 17).split("").map(Number)
  let a = 0
  for (let k = digits.length - 1; k >= 0; k--) a = Math.floor((a + digits[k] * 0o400000) / 10)
  const sp = Number(m[2]) * 65536 + Math.floor((a + 1) / 2)
  return m[1] ? -sp : sp
}

const star = (s: string) => (s === "*" ? null : Number(s))
const KIND: Record<string, BreakKind> = { "": "glue", "\\par": "par", "\\discretionary": "disc", "\\penalty": "penalty", "\\kern": "kern", "\\math": "math" }

export function parseDecisions(log: string): Decisions {
  const paragraphs: ParagraphTrace[] = []
  const pages: PageTrace[] = []
  let para: ParagraphTrace | null = null
  let pass: PassTrace | null = null
  let page: PageTrace | null = null

  // For each pass: number of feasible breaks seen when each active node was created.
  const createdAt = new Map<PassTrace, number[]>()
  const succeeded = (p: PassTrace | null) => !!p && p.feasible.some((f) => f.kind === "par")
  const finishParagraph = () => {
    if (!para) return
    const last = para.passes.at(-1)
    if (last && succeeded(last)) {
      // Nodes created after the first \par feasible break are the candidates for
      // the end of the paragraph; TeX keeps the one with fewest total demerits
      // (looseness = 0, § 874). Then follow the prev links back to the start.
      const firstPar = last.feasible.findIndex((f) => f.kind === "par")
      const at = createdAt.get(last) ?? []
      const finals = last.nodes.filter((_, i) => at[i] > firstPar)
      const best = finals.reduce<ActiveNode | null>((b, n) => (!b || n.total < b.total ? n : b), null)
      const bySerial = new Map(last.nodes.map((n) => [n.serial, n]))
      const path: number[] = []
      for (let n = best; n; n = bySerial.get(n.prev) ?? null) path.unshift(n.serial)
      para.chosen = path
    }
    paragraphs.push(para)
    para = null; pass = null
  }

  for (const raw of log.split("\n")) {
    const line = raw.trimEnd()
    let m: RegExpMatchArray | null
    if ((m = line.match(/^@(first|second|emergency)pass$/))) {
      const kind = m[1] as Pass
      if (kind === "first" || !para || succeeded(pass)) { finishParagraph(); para = { passes: [], chosen: [] } }
      pass = { pass: kind, feasible: [], nodes: [], text: "" }
      para!.passes.push(pass)
      continue
    }
    if (pass && (m = line.match(/^@(\\[a-z]+)? via @@(\d+) b=(\*|-?\d+) p=(-?\d+) d=(\*|-?\d+)$/))) {
      const f: FeasibleBreak = { kind: KIND[m[1] ?? ""], via: Number(m[2]), badness: star(m[3]), penalty: Number(m[4]), demerits: star(m[5]) }
      pass.feasible.push(f)
      continue
    }
    if (pass && (m = line.match(/^@@(\d+): line (\d+)\.([0-3])(-?) t=(-?\d+) -> @@(\d+)$/))) {
      pass.nodes.push({ serial: Number(m[1]), line: Number(m[2]), fitness: Number(m[3]) as 0 | 1 | 2 | 3, hyphenated: m[4] === "-", total: Number(m[5]), prev: Number(m[6]) })
      createdAt.set(pass, [...(createdAt.get(pass) ?? []), pass.feasible.length])
      continue
    }
    if ((m = line.match(/^%% goal height=(-?[\d.]+), max depth=(-?[\d.]+)$/))) {
      finishParagraph()
      page = { goal: parseScaled(m[1]), maxDepth: parseScaled(m[2]), candidates: [], splits: [] }
      pages.push(page)
      continue
    }
    if (page && (m = line.match(/^% t=(-?[\d.]+)((?: plus -?[\d.]+(?:fil+)?)*)((?: minus -?[\d.]+(?:fil+)?)?) g=(-?[\d.]+) b=(\*|-?\d+) p=(-?\d+) c=(\*|-?\d+)(#?)$/))) {
      page.candidates.push({ t: parseScaled(m[1]), tPlus: m[2].trim(), tMinus: m[3].trim(), goal: parseScaled(m[4]), badness: star(m[5]), penalty: Number(m[6]), cost: star(m[7]), best: m[8] === "#" })
      continue
    }
    if (page && line.startsWith("% split")) { page.splits.push(line.slice(2)); continue }
    if (pass && line && !line.startsWith("@")) pass.text += (pass.text ? " " : "") + line
  }
  finishParagraph()
  return { paragraphs, pages }
}

/** TeX's print_scaled (§ 103): the shortest decimal that parses back to `s`. */
export function printScaled(s: number): string {
  let out = ""
  if (s < 0) { out = "-"; s = -s }
  out += Math.floor(s / 65536) + "."
  s = 10 * (s % 65536) + 5
  let delta = 10
  do {
    if (delta > 65536) s = s + 0o100000 - 50000 // round the last digit
    out += String(Math.floor(s / 65536))
    s = 10 * (s % 65536)
    delta *= 10
  } while (s > delta)
  return out
}
