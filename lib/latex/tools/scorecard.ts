// Conformance scorecard (#37): every fixture's status against TeX, committed as
// lib/latex/fixtures/scorecard.json (plus a shields.io badge.json) and shown at
// /scorecard. CI regenerates it and fails if a fixture regressed against main
// or if the committed file is stale.
//   bun engine scorecard                         run fixtures, write scorecard + badge
//   bun engine scorecard --check [--base f]      fail on regression vs f, or a stale scorecard
//                        [--markdown out.md]     write a PR-comment report

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { collectFixtures, runFixture, type UnitResult } from "./unit/run"
import { parseHeader, type Tier } from "./unit/header"

const FIXTURES = "lib/latex/fixtures"
const FILE = `${FIXTURES}/scorecard.json`
const BADGE = `${FIXTURES}/badge.json`

export interface ScoreFixture {
  id: string
  /** path from lib/latex/fixtures */
  file: string
  area: string
  /** target tier from the header */
  tier: Tier
  /** tier the engine reaches today; null while it does not match TeX */
  reached: Tier | null
  status: UnitResult["status"]
  glyphs: number
  covers: string
  issue?: string
}
export interface Scorecard {
  format: 1
  summary: { fixtures: number; exact: number; expectedFailures: number; failing: number; /** no engine path yet */ pending: number; glyphs: number }
  areas: { area: string; fixtures: number; exact: number }[]
  fixtures: ScoreFixture[]
}

export function buildScorecard(results: UnitResult[]): Scorecard {
  const fixtures: ScoreFixture[] = results.map((r) => {
    const h = parseHeader(readFileSync(r.fixture, "utf8"))
    const id = r.fixture.replace(`${FIXTURES}/`, "").replace(/^(micro|macro)\//, "").replace(/\.tex$/, "")
    return {
      id, file: r.fixture.replace(`${FIXTURES}/`, ""), area: id.split("/")[0], tier: r.tier, reached: r.status === "pass" ? r.tier : null, status: r.status,
      glyphs: r.glyphs, covers: h.covers ?? "", ...(h.issue ? { issue: h.issue } : {}),
    }
  })
  const areas = [...new Set(fixtures.map((f) => f.area))].sort().map((area) => {
    const fs = fixtures.filter((f) => f.area === area)
    return { area, fixtures: fs.length, exact: fs.filter((f) => f.reached === "T3").length }
  })
  return {
    format: 1,
    summary: {
      fixtures: fixtures.length,
      exact: fixtures.filter((f) => f.reached === "T3").length,
      expectedFailures: fixtures.filter((f) => f.status === "xfail").length,
      failing: fixtures.filter((f) => f.status === "fail" || f.status === "error" || f.status === "xpass").length,
      pending: fixtures.filter((f) => f.status === "skip").length,
      glyphs: fixtures.filter((f) => f.reached).reduce((n, f) => n + f.glyphs, 0),
    },
    areas,
    fixtures,
  }
}

export function badge(s: Scorecard) {
  const { exact, fixtures, failing, pending } = s.summary
  // red only for failures; fixtures the engine cannot lay out yet are work to do, not regressions
  return { schemaVersion: 1, label: "identical to TeX", message: `${exact}/${fixtures} fixtures`, color: failing ? "red" : pending ? "blue" : "brightgreen" }
}

const RANK: Record<Tier, number> = { T0: 0, T1: 1, T2: 2, T3: 3 }
const rank = (t: Tier | null) => (t ? RANK[t] + 1 : 0)

export interface Delta { regressed: ScoreFixture[]; removed: string[]; improved: ScoreFixture[]; added: ScoreFixture[] }

export function compareScorecards(base: Scorecard | null, now: Scorecard): Delta {
  const prev = new Map((base?.fixtures ?? []).map((f) => [f.id, f]))
  const ids = new Set(now.fixtures.map((f) => f.id))
  const d: Delta = { regressed: [], removed: [], improved: [], added: [] }
  for (const f of now.fixtures) {
    const p = prev.get(f.id)
    if (!p) d.added.push(f)
    else if (rank(f.reached) < rank(p.reached)) d.regressed.push(f)
    else if (rank(f.reached) > rank(p.reached)) d.improved.push(f)
  }
  for (const id of prev.keys()) if (!ids.has(id)) d.removed.push(id)
  return d
}

export function markdown(now: Scorecard, d: Delta, results: UnitResult[]): string {
  const s = now.summary
  const icon = (f: ScoreFixture) => (f.reached ? "✅" : f.status === "xfail" ? "⏳" : f.status === "skip" ? "⚪" : "❌")
  const row = (f: ScoreFixture) => `| ${icon(f)} | \`${f.id}\` | ${f.reached ?? "—"} | ${f.covers.replace(/\|/g, "\\|")} |`
  const out = [
    "### Engine scorecard",
    "",
    `**${s.exact}/${s.fixtures}** fixtures identical to TeX at 0 sp (${s.glyphs.toLocaleString("en-US")} glyphs)` +
      (s.pending ? ` · ${s.pending} with no engine path yet` : "") + (s.expectedFailures ? ` · ${s.expectedFailures} expected failures` : "") + (s.failing ? ` · **${s.failing} failing**` : ""),
    "",
  ]
  if (d.regressed.length || d.removed.length) {
    out.push("#### ❌ Regressions against main", "", "| | fixture | reached | covers |", "|---|---|---|---|", ...d.regressed.map(row))
    for (const id of d.removed) out.push(`| ❌ | \`${id}\` | removed | |`)
    for (const f of d.regressed) {
      const r = results.find((x) => x.fixture.includes(f.id))
      if (r?.message) out.push("", `\`${f.id}\`: ${r.message}`)
    }
    out.push("")
  }
  if (d.improved.length) out.push("#### Now identical to TeX", "", "| | fixture | reached | covers |", "|---|---|---|---|", ...d.improved.map(row), "")
  if (d.added.length) out.push("#### New fixtures", "", "| | fixture | reached | covers |", "|---|---|---|---|", ...d.added.map(row), "")
  if (!d.regressed.length && !d.removed.length && !d.improved.length && !d.added.length) out.push("No fixture changed status.", "")
  out.push("<details><summary>By area</summary>", "", "| area | identical | fixtures |", "|---|---|---|", ...now.areas.map((a) => `| ${a.area} | ${a.exact} | ${a.fixtures} |`), "", "</details>")
  return out.join("\n") + "\n"
}

const json = (x: unknown) => JSON.stringify(x, null, 1) + "\n"

export function scorecard(opts: { check: boolean; base?: string; markdownOut?: string }): number {
  const results = collectFixtures([FIXTURES]).map(runFixture)
  const now = buildScorecard(results)
  const baseFile = opts.base ?? FILE
  const parsed = existsSync(baseFile) ? (JSON.parse(readFileSync(baseFile, "utf8") || "{}") as Partial<Scorecard>) : {}
  const base = parsed.fixtures ? (parsed as Scorecard) : null // no scorecard on the base branch yet
  const d = compareScorecards(base, now)
  if (opts.markdownOut) writeFileSync(opts.markdownOut, markdown(now, d, results))
  const s = now.summary
  console.log(`${s.exact}/${s.fixtures} fixtures identical to TeX (${s.glyphs} glyphs); ${d.added.length} new, ${d.improved.length} improved, ${d.regressed.length} regressed, ${d.removed.length} removed`)
  for (const f of d.regressed) console.log(`  ✗ regressed: ${f.id} (${f.status})`)
  for (const id of d.removed) console.log(`  ✗ removed: ${id}`)
  if (!opts.check) {
    writeFileSync(FILE, json(now))
    writeFileSync(BADGE, json(badge(now)))
    console.log(`wrote ${FILE} and ${BADGE}`)
    return 0
  }
  let code = d.regressed.length || d.removed.length ? 1 : 0
  const stale = !existsSync(FILE) || readFileSync(FILE, "utf8") !== json(now) || !existsSync(BADGE) || readFileSync(BADGE, "utf8") !== json(badge(now))
  if (stale) { console.log(`${FILE} is out of date: run bun engine scorecard and commit it`); code = 1 }
  return code
}
