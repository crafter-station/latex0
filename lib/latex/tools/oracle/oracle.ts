// Oracle runner: compile a fixture with real TeX (offline, dev only) and return
// TeX's own record of where every glyph and rule went. TeX is the oracle,
// never the runtime: nothing in this folder is imported by the engine.

import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, copyFileSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import type { Decisions } from "../../trace/decisions"
import { parseDvi, type Trace } from "./dvi"
import { parseDecisions } from "./tracing"
import { parseShipouts } from "./boxes"
import type { BoxNode } from "../../trace/schema"
import { ORACLE_EPOCH, texEnv } from "../tex"
import { parseTfm, type Tfm } from "./tfm"

// a fixed date, so \today and friends never change a reference (pdfTeX honours SOURCE_DATE_EPOCH)
const ENV = texEnv({ SOURCE_DATE_EPOCH: String(ORACLE_EPOCH), FORCE_SOURCE_DATE: "1" })
const CACHE = resolve(process.cwd(), ".cache/oracle")

const tfmCache = new Map<string, Tfm>()
export function loadTfm(name: string): Tfm {
  const hit = tfmCache.get(name)
  if (hit) return hit
  const path = execFileSync("kpsewhich", [`${name}.tfm`], { env: ENV, encoding: "utf8" }).trim()
  if (!path) throw new Error(`TFM not found: ${name}`)
  const tfm = parseTfm(new Uint8Array(readFileSync(path)), name)
  tfmCache.set(name, tfm)
  return tfm
}

export function texVersion(): string {
  return execFileSync("latex", ["--version"], { env: ENV, encoding: "utf8" }).split("\n")[0]
}

export interface OracleResult { trace: Trace; decisions: Decisions; /** every shipped page as a box tree (\\tracingoutput) */ pages: BoxNode[] }

/**
 * Compile `fixture` with real TeX (twice, for references) and return TeX's own
 * records: glyph positions from the DVI, and line/page-break decisions from the
 * log (\tracingparagraphs, \tracingpages). Tracing does not change the output.
 */
export function oracleRun(fixture: string): OracleResult {
  const name = basename(fixture, ".tex")
  const dir = join(CACHE, name)
  mkdirSync(dir, { recursive: true })
  copyFileSync(fixture, join(dir, `${name}.tex`))
  const job = `\\AtBeginDocument{\\tracingassigns=1}\\tracingparagraphs=1\\tracingpages=1\\tracingoutput=1\\showboxdepth=10000\\showboxbreadth=100000\\tracingonline=0\\input{${name}}`
  const env = { ...ENV, max_print_line: "100000", error_line: "254", half_error_line: "238" }
  for (let pass = 0; pass < 2; pass++) {
    execFileSync("latex", ["-interaction=nonstopmode", "-halt-on-error", `-jobname=${name}`, job], { cwd: dir, env, stdio: "pipe" })
  }
  return {
    trace: parseDvi(new Uint8Array(readFileSync(join(dir, `${name}.dvi`))), loadTfm),
    ...(() => { const log = readFileSync(join(dir, `${name}.log`), "latin1"); return { decisions: parseDecisions(log), pages: parseShipouts(log) } })(),
  }
}

/** Glyph positions only (kept for callers that need just the DVI view). */
export function oracleTrace(fixture: string): Trace {
  return oracleRun(fixture).trace
}

// ---- reference cache (#32) ----
// Key: fixture content + TeX version + oracle format version. A hit skips TeX
// entirely, so re-running one fixture after an engine edit takes milliseconds.

import { createHash } from "node:crypto"
import { existsSync, writeFileSync } from "node:fs"

const ORACLE_FORMAT = 5 // 5: fixed date; 3: cache holds { trace, decisions, pages }; 4: \tracingassigns for \looseness
let texVersionMemo: string | undefined

export function cachedOracle(fixture: string): OracleResult & { cached: boolean } {
  texVersionMemo ??= texVersion()
  const key = createHash("sha256").update(readFileSync(fixture)).update(texVersionMemo).update(String(ORACLE_FORMAT)).digest("hex").slice(0, 16)
  const file = join(CACHE, "refs", `${basename(fixture, ".tex")}.${key}.json`)
  if (existsSync(file)) return { ...(JSON.parse(readFileSync(file, "utf8")) as OracleResult), cached: true }
  const result = oracleRun(fixture)
  mkdirSync(join(CACHE, "refs"), { recursive: true })
  writeFileSync(file, JSON.stringify(result))
  return { ...result, cached: false }
}

export function cachedOracleTrace(fixture: string): { trace: Trace; cached: boolean } {
  const { trace, cached } = cachedOracle(fixture)
  return { trace, cached }
}
