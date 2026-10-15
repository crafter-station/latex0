// Parsers for TeX's decision logs (#28): \tracingparagraphs (tex.web §§ 846, 855,
// 863) and \tracingpages (§§ 986, 1005, 1011). The log must be written with
// max_print_line large enough that lines are not wrapped.

import { roundDecimals } from "../../layout/dimen"
import { bestFinal, type BreakKind, type Decisions, type FeasibleBreak, type PageTrace, type ParagraphTrace, type Pass, type PassTrace } from "../../trace/decisions"

/** Parse a decimal printed by print_scaled back to sp exactly (round_decimals, § 102). */
export function parseScaled(s: string): number {
  const m = s.match(/^(-?)(\d+)(?:\.(\d+))?$/)
  if (!m) throw new Error(`not a dimension: ${s}`)
  const sp = Number(m[2]) * 65536 + roundDecimals((m[3] ?? "").slice(0, 17).split("").map(Number))
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
  // the chosen path depends on \looseness, which is known only after the trace
  const choose: (() => void)[] = []
  let awaitingLooseness = null as ParagraphTrace | null
  const finishParagraph = () => {
    if (!para) return
    const done = para, last = para.passes.at(-1)
    if (last && succeeded(last)) {
      // Nodes created after the first \par feasible break are the final active
      // nodes; §§ 874–875 pick one. Then follow the prev links back to the start.
      const firstPar = last.feasible.findIndex((f) => f.kind === "par")
      const at = createdAt.get(last) ?? []
      const finals = last.nodes.filter((_, i) => at[i] > firstPar)
      const bySerial = new Map(last.nodes.map((n) => [n.serial, n]))
      choose.push(() => {
        const path: number[] = []
        for (let n = bestFinal(finals, done.looseness); n; n = bySerial.get(n.prev) ?? null) path.unshift(n.serial)
        done.chosen = path
      })
    }
    paragraphs.push(para)
    awaitingLooseness = para
    para = null; pass = null
  }

  for (const raw of log.split("\n")) {
    const line = raw.replace(/[ \r]+$/, "") // not trimEnd: characters 11 and 12 (\alpha, \beta in cmmi) print raw and are JS whitespace
    let m: RegExpMatchArray | null
    // \tracingassigns (e-TeX, from \begin{document}). After line_break, end_graf's
    // normal_paragraph (§ 1070) resets \looseness first if it was nonzero, so the
    // first assignment after a paragraph reveals the \looseness it was broken with.
    if (line.startsWith("{")) {
      if (awaitingLooseness && (m = line.match(/^\{changing \\looseness=(-?\d+)\}$/))) awaitingLooseness.looseness = Number(m[1])
      awaitingLooseness = null
      continue
    }
    // end_diagnostic (§ 863) closes each paragraph's trace with an empty line
    // (a line of spaces is printed text: glue at the end of a line of the paragraph)
    if (!raw.replace(/\r$/, "") && para) { finishParagraph(); continue }
    if ((m = line.match(/^@(first|second|emergency)pass$/))) {
      const kind = m[1] as Pass
      if (kind === "first" || !para) {
        finishParagraph(); para = { passes: [], chosen: [] }
        // an emergency pass always follows a second pass, which went unmarked
        // (\pretolerance < 0) and found no feasible break to print
        if (kind === "emergency") para.passes.push({ pass: "second", feasible: [], nodes: [], text: "" })
      }
      pass = { pass: kind, feasible: [], nodes: [], text: "" }
      para!.passes.push(pass)
      continue
    }
    // with \pretolerance < 0 the second pass starts without a marker (§ 863)
    if (!pass && /^@(?:\\[a-z]+)? via @@\d+ |^@@\d+: line /.test(line)) {
      para = { passes: [], chosen: [] }
      pass = { pass: "second", feasible: [], nodes: [], text: "" }
      para.passes.push(pass)
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
  choose.forEach((f) => f())
  return { paragraphs, pages }
}

export { printScaled } from "../../layout/arith"
