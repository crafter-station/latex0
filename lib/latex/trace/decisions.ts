// Decision traces: what TeX considered, not just what it chose. Shared by the
// oracle (parsed from \tracingparagraphs / \tracingpages logs) and the engine's
// paragraph and page builders (#112, page builder issue). Dimensions in sp;
// "*" in TeX's log (awful_bad / artificial demerits) becomes null.

export type BreakKind = "glue" | "par" | "disc" | "penalty" | "kern" | "math"
export type Pass = "first" | "second" | "emergency"

/** "@ via @@n b=… p=… d=…": a feasible breakpoint reached from active node n. */
export interface FeasibleBreak { kind: BreakKind; via: number; badness: number | null; penalty: number; demerits: number | null }
/** "@@n: line l.f[-] t=T -> @@m": an active node created for the best way to reach a break. */
export interface ActiveNode { serial: number; line: number; fitness: 0 | 1 | 2 | 3; hyphenated: boolean; total: number; prev: number }

export interface PassTrace { pass: Pass; feasible: FeasibleBreak[]; nodes: ActiveNode[]; /** paragraph text as TeX displayed it */ text: string }
export interface ParagraphTrace {
  passes: PassTrace[]
  /** Serials of the chosen breaks, first line to last (empty if no pass succeeded). */
  chosen: number[]
  /** \looseness in force when the paragraph ended (§ 875); absent means 0. */
  looseness?: number
}

/**
 * The break that ends the paragraph (§§ 874–875): among the final active nodes,
 * fewest demerits, then the line count nearest `looseness` without overshooting
 * it. Ties keep the earlier node, as TeX's scan of the active list does.
 */
export function bestFinal<T extends { line: number; total: number }>(finals: T[], looseness = 0): T | null {
  let best: T | null = null
  for (const r of finals) if (!best || r.total < best.total) best = r
  if (!best || looseness === 0) return best
  const bestLine = best.line
  let actual = 0
  for (const r of finals) {
    const diff = r.line - bestLine
    if ((diff < actual && looseness <= diff) || (diff > actual && looseness >= diff)) { best = r; actual = diff }
    else if (diff === actual && r.total < best.total) best = r
  }
  return best
}

/** "% t=… g=… b=… p=… c=…[#]": one candidate page break. */
export interface PageCandidate { t: number; tPlus: string; tMinus: string; goal: number; badness: number | null; penalty: number; cost: number | null; best: boolean }
export interface PageTrace { goal: number; maxDepth: number; candidates: PageCandidate[]; splits: string[] }

export interface Decisions { paragraphs: ParagraphTrace[]; pages: PageTrace[] }

export interface DecisionDivergence { paragraph: number; what: string; expected: unknown; actual: unknown }

/** First difference in line-breaking decisions (passes, feasible breaks, active nodes, chosen path). */
export function compareParagraphs(expected: ParagraphTrace[], actual: ParagraphTrace[]): DecisionDivergence | null {
  if (expected.length !== actual.length) return { paragraph: -1, what: "paragraph count", expected: expected.length, actual: actual.length }
  for (let i = 0; i < expected.length; i++) {
    const e = expected[i], a = actual[i]
    if ((e.looseness ?? 0) !== (a.looseness ?? 0)) return { paragraph: i, what: "\\looseness", expected: e.looseness ?? 0, actual: a.looseness ?? 0 }
    const ep = e.passes.map((p) => p.pass).join(","), ap = a.passes.map((p) => p.pass).join(",")
    if (ep !== ap) return { paragraph: i, what: "passes", expected: ep, actual: ap }
    for (let p = 0; p < e.passes.length; p++) {
      const ef = e.passes[p].feasible, af = a.passes[p].feasible
      for (let k = 0; k < Math.max(ef.length, af.length); k++) {
        if (JSON.stringify(ef[k]) !== JSON.stringify(af[k])) return { paragraph: i, what: `${e.passes[p].pass} pass, feasible break ${k}`, expected: ef[k] ?? null, actual: af[k] ?? null }
      }
      const en = e.passes[p].nodes, an = a.passes[p].nodes
      for (let k = 0; k < Math.max(en.length, an.length); k++) {
        if (JSON.stringify(en[k]) !== JSON.stringify(an[k])) return { paragraph: i, what: `${e.passes[p].pass} pass, active node ${k}`, expected: en[k] ?? null, actual: an[k] ?? null }
      }
    }
    if (e.chosen.join() !== a.chosen.join()) return { paragraph: i, what: "chosen breaks", expected: e.chosen, actual: a.chosen }
  }
  return null
}

/**
 * TeX's page traces for the pages a document actually builds: LaTeX's own
 * output calls (penalties ≤ -10001, e.g. at \begin{document} and in \clearpage)
 * are bookkeeping, not page breaks.
 */
export function documentPages(pages: PageTrace[]): PageTrace[] {
  return pages.filter((p) => !p.candidates.some((c) => c.penalty <= -10001))
}

/** First difference in page-breaking decisions (goal, max depth, every candidate). */
export function comparePages(expected: PageTrace[], actual: PageTrace[]): DecisionDivergence | null {
  if (expected.length !== actual.length) return { paragraph: -1, what: "page count", expected: expected.length, actual: actual.length }
  for (let i = 0; i < expected.length; i++) {
    const e = expected[i], a = actual[i]
    if (e.goal !== a.goal || e.maxDepth !== a.maxDepth) return { paragraph: i, what: `page ${i + 1} goal`, expected: [e.goal, e.maxDepth], actual: [a.goal, a.maxDepth] }
    for (let k = 0; k < Math.max(e.candidates.length, a.candidates.length); k++) {
      if (JSON.stringify(e.candidates[k]) !== JSON.stringify(a.candidates[k])) return { paragraph: i, what: `page ${i + 1}, break candidate ${k}`, expected: e.candidates[k] ?? null, actual: a.candidates[k] ?? null }
    }
  }
  return null
}
