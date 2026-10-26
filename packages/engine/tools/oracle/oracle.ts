// Oracle runner: compile a fixture with real TeX (offline, dev only) and return
// TeX's own record of where every glyph and rule went. TeX is the oracle,
// never the runtime: nothing in this folder is imported by the engine.

import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, copyFileSync, rmSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import type { Decisions } from "../../trace/decisions"
import { parseDvi, type Trace } from "./dvi"
import { parseDecisions } from "./tracing"
import { parseShipouts } from "./boxes"
import type { BoxNode } from "../../trace/schema"
import { ORACLE_EPOCH, texEnv } from "../tex"
import { parseTfm, type Tfm } from "./tfm"
import { boxTrace } from "./boxtrace"
import { parseHeader } from "../unit/header"

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

/** The TeX version plus a hash of the installation's package database, so a reference never outlives the packages that made it. */
export function texInstallation(): string {
  const root = execFileSync("kpsewhich", ["-var-value", "TEXMFROOT"], { env: ENV, encoding: "utf8" }).trim()
  const tlpdb = join(root, "tlpkg", "texlive.tlpdb")
  return texVersion() + (existsSync(tlpdb) ? " " + createHash("sha256").update(readFileSync(tlpdb)).digest("hex").slice(0, 16) : "")
}

export interface OracleResult { trace: Trace; decisions: Decisions; /** every shipped page as a box tree (\\tracingoutput) */ pages: BoxNode[] }

/**
 * Compile `fixture` with real TeX (twice, for references) and return TeX's own
 * records: glyph positions from the DVI, and line/page-break decisions from the
 * log (\tracingparagraphs, \tracingpages). Tracing does not change the output.
 * A fixture whose header names pdflatex is compiled by it: no DVI, so the positions
 * are the ones its box dumps imply (boxtrace.ts, checked against the DVI for latex).
 */
export function oracleRun(fixture: string): OracleResult {
  const name = basename(fixture, ".tex")
  const dir = join(CACHE, name)
  mkdirSync(dir, { recursive: true })
  copyFileSync(fixture, join(dir, `${name}.tex`))
  for (const f of parseHeader(readFileSync(fixture, "utf8")).files) copyFileSync(join(dirname(fixture), f), join(dir, f)) // (% files:)
  // the first run reads what an earlier document of the same name wrote
  for (const ext of ["aux", "toc", "lof", "lot", "out"]) rmSync(join(dir, `${name}.${ext}`), { force: true })
  const job = `\\AtBeginDocument{\\tracingassigns=1}\\tracingparagraphs=1\\tracingpages=1\\tracingoutput=1\\pdftracingfonts=1\\showboxdepth=10000\\showboxbreadth=100000\\tracingonline=0\\input{${name}}`
  const env = { ...ENV, max_print_line: "100000", error_line: "254", half_error_line: "238" }
  const pdf = parseHeader(readFileSync(fixture, "utf8")).oracle === "pdflatex"
  for (let pass = 0; pass < 2; pass++) {
    execFileSync(pdf ? "pdflatex" : "latex", ["-interaction=nonstopmode", "-halt-on-error", `-jobname=${name}`, job], { cwd: dir, env, stdio: "pipe" })
  }
  const log = readFileSync(join(dir, `${name}.log`), "latin1")
  const pages = parseShipouts(log)
  return {
    trace: pdf ? boxTrace(pages) : parseDvi(new Uint8Array(readFileSync(join(dir, `${name}.dvi`))), loadTfm),
    decisions: parseDecisions(log), pages,
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
import { existsSync, readdirSync, unlinkSync, writeFileSync } from "node:fs"

const ORACLE_FORMAT = 8 // 8: character 10 after a font named by \pdftracingfonts; 7: \pdftracingfonts (box dumps name each font's file and size); 6: a line of spaces does not end a paragraph's trace; 5: fixed date; 3: cache holds { trace, decisions, pages }; 4: \tracingassigns for \looseness
let texVersionMemo: string | undefined

export function cachedOracle(fixture: string): OracleResult & { cached: boolean } {
  texVersionMemo ??= texInstallation()
  const hash = createHash("sha256").update(readFileSync(fixture))
  for (const f of parseHeader(readFileSync(fixture, "utf8")).files) hash.update(f).update(readFileSync(join(dirname(fixture), f)))
  const key = hash.update(texVersionMemo).update(String(ORACLE_FORMAT)).digest("hex").slice(0, 16)
  const file = join(CACHE, "refs", `${basename(fixture, ".tex")}.${key}.json`)
  if (existsSync(file)) return { ...(JSON.parse(readFileSync(file, "utf8")) as OracleResult), cached: true }
  const result = oracleRun(fixture)
  mkdirSync(join(CACHE, "refs"), { recursive: true })
  // one reference per fixture name: older ones (another content or TeX) go
  const prefix = `${basename(fixture, ".tex")}.`
  for (const f of readdirSync(join(CACHE, "refs"))) if (f.startsWith(prefix) && /^[0-9a-f]{16}\.json$/.test(f.slice(prefix.length))) unlinkSync(join(CACHE, "refs", f))
  writeFileSync(file, JSON.stringify(result))
  return { ...result, cached: false }
}

export function cachedOracleTrace(fixture: string): { trace: Trace; cached: boolean } {
  const { trace, cached } = cachedOracle(fixture)
  return { trace, cached }
}
