// Unit workflow (#32): fixture → oracle (cached) → engine adapter → compare → report.
// Works on any subset of fixtures, so iterating on one rule never needs the corpus.

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { compareBoxLists, compareTraces, validateTrace, type BoxDivergence, type Divergence, type Trace } from "../../trace/schema"
import { findColumn } from "../oracle/boxes"
import { compareParagraphs, type DecisionDivergence } from "../../trace/decisions"
import { cachedOracle } from "../oracle/oracle"
import { ADAPTERS } from "./adapters"
import { parseHeader, type Tier } from "./header"

export interface UnitResult {
  fixture: string
  tier: Tier
  engine: string
  status: "pass" | "fail" | "error" | "skip" | "xfail" | "xpass"
  cached: boolean
  ms: number
  glyphs: number
  divergence?: Divergence
  decisionDivergence?: DecisionDivergence
  boxDivergence?: BoxDivergence
  context?: string
  message?: string
  notes?: string[]
}

export function collectFixtures(paths: string[]): string[] {
  const out: string[] = []
  const walk = (p: string) => {
    if (statSync(p).isDirectory()) for (const e of readdirSync(p).sort()) walk(join(p, e))
    else if (p.endsWith(".tex")) out.push(p)
  }
  paths.forEach(walk)
  return out
}

// OT1 (cmr) codes that are ligatures or special glyphs, for readable reports.
const OT1: Record<number, string> = { 11: "ff", 12: "fi", 13: "fl", 14: "ffi", 15: "ffl", 34: "”", 60: "¡", 62: "¿", 92: "“", 123: "–", 124: "—" }
const show = (c: number) => OT1[c] ?? String.fromCharCode(c)

/** The expected line around a divergent glyph, with the glyph bracketed. */
function contextOf(t: Trace, d: Divergence): string | undefined {
  const gs = t.pages[d.page]?.glyphs
  const g = gs?.[d.index]
  if (!gs || !g) return undefined
  const line = gs.map((x, i) => ({ x, i })).filter(({ x }) => x.v === g.v)
  return line.map(({ x, i }) => (i === d.index ? `[${show(x.char)}]` : show(x.char))).join("")
}

export function runFixture(path: string): UnitResult {
  const t0 = performance.now()
  const src = readFileSync(path, "utf8")
  const fixture = relative(process.cwd(), path)
  let header
  try { header = parseHeader(src) } catch (e) {
    return { fixture, tier: "T3", engine: "?", status: "error", cached: false, ms: 0, glyphs: 0, message: (e as Error).message }
  }
  const base = { fixture, tier: header.tier, engine: header.engine ?? "-", cached: false, glyphs: 0 }
  const done = (r: Omit<UnitResult, "ms" | keyof typeof base> & Partial<typeof base>): UnitResult => {
    const out: UnitResult = { ...base, ...r, ms: Math.round(performance.now() - t0) }
    if (header.xfail && out.status === "fail") { out.status = "xfail"; out.message = `expected: ${header.xfail}` }
    else if (header.xfail && out.status === "pass") { out.status = "xpass"; out.message = `now passes: remove "xfail" from the header (${header.xfail})` }
    return out
  }

  if (header.tier !== "T3") return done({ status: "skip", message: `tier ${header.tier} comparison lands with the harness (#25)` })
  const adapter = header.engine ? ADAPTERS[header.engine] : undefined
  if (!adapter) return done({ status: "skip", message: `no engine adapter "${header.engine ?? ""}" (available: ${Object.keys(ADAPTERS).join(", ")})` })

  try {
    const { trace: expected, decisions: oracleDecisions, pages, cached } = cachedOracle(path)
    base.cached = cached
    base.glyphs = expected.pages.reduce((n, p) => n + p.glyphs.length, 0)
    const { trace: actual, decisions, column, notes } = adapter(src, expected)
    const schema = validateTrace(actual)
    if (schema.length) return done({ status: "error", message: `schema: ${schema[0]}`, notes })
    if (decisions) {
      const dd = compareParagraphs(oracleDecisions.paragraphs, decisions)
      if (dd) return done({ status: "fail", decisionDivergence: dd, message: `line-breaking decisions differ: ${dd.what}`, notes })
    }
    if (column) {
      const texColumn = pages[0] ? findColumn(pages[0]) : null
      if (!texColumn) return done({ status: "error", message: "no \\topskip column in TeX's page dump", notes })
      // compare the engine's column with the same number of items from TeX's
      const bd = compareBoxLists(texColumn.slice(0, column.length), column)
      if (bd) return done({ status: "fail", boxDivergence: bd, message: `box tree differs at ${bd.path}: ${bd.field}`, notes })
    }
    const divergence = compareTraces(expected, actual)
    if (divergence) return done({ status: "fail", divergence, context: contextOf(expected, divergence), notes })
    return done({ status: "pass", notes })
  } catch (e) {
    return done({ status: "error", message: (e as Error).message.split("\n")[0] })
  }
}

const ICON = { pass: "✓", fail: "✗", error: "!", skip: "–", xfail: "○", xpass: "★" } as const

export function report(results: UnitResult[], verbose = false): string {
  const lines: string[] = []
  for (const r of results) {
    lines.push(`${ICON[r.status]} ${r.fixture}  ${r.tier} · ${r.engine} · ${r.glyphs} glyphs · ${r.ms}ms${r.cached ? " · cached" : ""}`)
    if ((r.status === "fail" || r.status === "xfail") && r.divergence) {
      const d = r.divergence
      lines.push(`    first divergence: page ${d.page + 1}, glyph ${d.index}, ${d.field}: TeX ${JSON.stringify(d.expected)} vs engine ${JSON.stringify(d.actual)}` +
        (typeof d.expected === "number" && typeof d.actual === "number" ? ` (Δ ${d.actual - d.expected} sp)` : ""))
      if (r.context) lines.push(`    TeX line: ${r.context}`)
    }
    if (r.boxDivergence) lines.push(`    TeX:    ${JSON.stringify(r.boxDivergence.expected)}`, `    engine: ${JSON.stringify(r.boxDivergence.actual)}`)
    if (r.decisionDivergence) {
      const d = r.decisionDivergence
      lines.push(`    TeX:    ${JSON.stringify(d.expected)}`, `    engine: ${JSON.stringify(d.actual)}`)
    }
    if (r.message && r.status !== "pass") lines.push(`    ${r.message}`)
    if (verbose && r.notes) r.notes.forEach((n) => lines.push(`    note: ${n}`))
  }
  const count = (s: UnitResult["status"]) => results.filter((r) => r.status === s).length
  lines.push("", `${count("pass")} passed · ${count("fail")} failed · ${count("error")} errors · ${count("xfail")} expected failures · ${count("xpass")} unexpected passes · ${count("skip")} skipped · ${results.length} fixtures`)
  return lines.join("\n")
}
