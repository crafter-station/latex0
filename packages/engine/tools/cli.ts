#!/usr/bin/env bun
// latex0 engine CLI (dev tooling, #39).
//   bun engine unit [paths…] [--watch] [--json] [-v]   fixtures vs TeX at 0 sp (#32)
//   bun engine codegen [--check]                       regenerate committed font metrics (#42)
//   bun engine decisions <fixture.tex>                 TeX line-break and page-break decisions (#28)
//   bun engine search:badness 12,13                    ask TeX for paragraphs hitting given badness values; write fixtures
//   bun engine hyphen:check [--words N]                engine hyphenation vs TeX \\showhyphens (#113)
//   bun engine fuzz:paragraphs [--n 200] [--seed 1]    random paragraphs: engine line breaks vs TeX's decisions (#112)
//   bun engine dimen:check [--n 5000] [--seed 1]       numbers, dimensions and glue: engine scanner vs TeX (#52)
//   bun engine scorecard [--check] [--base f] [--markdown out.md]   fixture scorecard; CI gate and PR comment (#37)
//   bun engine glyph:check [--n 4000] [--seed 1]      words in every font and synthetic lig/kern fonts vs TeX \showbox (#111)
//   bun engine expand:check [--n 3000] [--seed 1]     random macro programs: \edef results and \meaning vs TeX (#46)
//   bun engine expand:doc [--n 300] [--seed 1]        random documents: TeX output unchanged by expandDocument (#46)
//   bun engine fuzz:documents [--n 30] [--seed 1]    random whole documents: sections, lists, paragraphs vs TeX (#30)
//   bun engine math:check [--n 3000] [--seed 1]       random formulas: mlist_to_hlist vs TeX \showbox (#74)
//   bun engine trace <fixture.tex>                     TeX oracle trace as JSON
//   bun engine oracle:check                            oracle self-check against pdflatex
//   bun engine boundary                                imports stay inside the package (#38)
//   bun engine ci                                      the full conformance gate, locally (what engine.yml runs)
import { execFileSync, spawn, spawnSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { watch } from "node:fs"
import { boundaryCheck } from "./boundary"
import { oracleTrace } from "./oracle/oracle"
import { collectFixtures, report, runFixture } from "./unit/run"

const FIXTURES = "packages/engine/fixtures"
const [cmd, ...rest] = process.argv.slice(2)
const flags = new Set(rest.filter((a) => a.startsWith("-")))
const args = rest.filter((a) => !a.startsWith("-"))

function unit(): number {
  const results = collectFixtures(args.length ? args : [FIXTURES]).map(runFixture)
  console.log(flags.has("--json") ? JSON.stringify(results, null, 1) : report(results, flags.has("-v")))
  return results.some((r) => r.status === "fail" || r.status === "error" || r.status === "xpass") ? 1 : 0
}

function watchUnit() {
  // Re-run in a fresh process so edited engine modules are reloaded.
  let timer: ReturnType<typeof setTimeout> | undefined
  const run = () => {
    process.stdout.write("\x1bc")
    spawn(process.execPath, [process.argv[1], "unit", ...rest.filter((a) => a !== "--watch")], { stdio: "inherit" })
      .on("exit", () => console.log(`\nwatching packages/engine for changes… (ctrl-c to stop)`))
  }
  watch("packages/engine", { recursive: true }, (_e, file) => {
    if (!file || file.includes(".cache") || !/\.(ts|tex)$/.test(String(file))) return
    clearTimeout(timer); timer = setTimeout(run, 150)
  })
  run()
}

// The conformance gate run locally before merging; engine.yml runs the same
// steps on demand. The scorecard must not regress against origin/main.
function ci(): number {
  const base = join(tmpdir(), "latex0-scorecard-base.json")
  try {
    execFileSync("git", ["fetch", "-q", "origin", "main"], { stdio: "ignore" })
    // lib/latex until the move to packages/engine is on main
    const at = (p: string) => execFileSync("git", ["show", `origin/main:${p}/fixtures/scorecard.json`], { stdio: ["ignore", "pipe", "ignore"] })
    let json: Buffer
    try { json = at("packages/engine") } catch { json = at("lib/latex") }
    writeFileSync(base, json)
  } catch {
    writeFileSync(base, "{}")
  }
  const steps = [
    ["boundary"],
    ["codegen", "--check"],
    ["oracle:check"],
    ["unit"],
    ["scorecard", "--check", "--base", base],
    ["dimen:check", "--n", "20000"],
    ["glyph:check", "--n", "10000"],
    ["expand:check", "--n", "3000"],
    ["expand:doc", "--n", "300"],
    ["math:check", "--n", "3000"],
    ["fuzz:paragraphs", "--n", "1000", "--seed", "1"],
    ["fuzz:documents", "--n", "30", "--seed", "1"],
    ["hyphen:check", "--words", "20000"],
  ]
  const summary: string[] = []
  for (const step of steps) {
    const t = Date.now()
    console.log(`\n=== bun engine ${step.join(" ")}`)
    const { status } = spawnSync(process.execPath, [process.argv[1], ...step], { stdio: "inherit" })
    summary.push(`${status === 0 ? "✓" : "✗"} ${step[0]} (${((Date.now() - t) / 1000).toFixed(0)}s)`)
  }
  console.log(`\n${summary.join("\n")}`)
  return summary.some((l) => l.startsWith("✗")) ? 1 : 0
}

switch (cmd) {
  case "ci":
    process.exit(ci())
  case "boundary":
    process.exit(boundaryCheck())
  case "unit":
    if (flags.has("--watch")) watchUnit()
    else process.exit(unit())
    break
  case "check:paragraph": // kept as an alias from #29
    process.exitCode = (() => { args.splice(0, args.length, args[0] ?? `${FIXTURES}/micro/text/paragraph-basic.tex`); return unit() })()
    break
  case "codegen": {
    const { codegenFonts } = await import("./codegen/fonts")
    const { codegenHyphenation } = await import("./codegen/hyphenation")
    const { codegenClasses } = await import("./codegen/classes")
    const { codegenMath } = await import("./codegen/math")
    const check = flags.has("--check")
    process.exit(codegenFonts(check) | codegenHyphenation(check) | codegenClasses(check) | codegenMath(check))
  }
  case "decisions": {
    if (!args[0]) throw new Error("usage: bun engine decisions <fixture.tex>")
    const { cachedOracle } = await import("./oracle/oracle")
    console.log(JSON.stringify(cachedOracle(args[0]).decisions, null, 1))
    break
  }
  case "search:badness": {
    const { searchBadness, writeBadnessFixtures } = await import("./search/badness")
    const targets = (args[0] ?? "").split(",").filter(Boolean).map(Number)
    if (!targets.length) throw new Error("usage: bun engine search:badness 12,13,99,100")
    const found = searchBadness(targets)
    const missing = targets.filter((t) => !(t in found))
    for (const f of writeBadnessFixtures(found)) console.log("wrote", f)
    if (missing.length) console.log("not found:", missing.join(", "))
    break
  }
  case "hyphen:check": {
    const { hyphenCheck } = await import("./oracle/showhyphens")
    const i = rest.indexOf("--words")
    process.exit(hyphenCheck(i >= 0 ? Number(rest[i + 1]) : 10000))
  }
  case "fuzz:paragraphs": {
    const { fuzzParagraphs } = await import("./fuzz/paragraphs")
    const opt = (k: string, d: number) => { const i = rest.indexOf(k); return i >= 0 ? Number(rest[i + 1]) : d }
    process.exit(fuzzParagraphs(opt("--n", 200), opt("--seed", 1)))
  }
  case "fuzz:documents": {
    const { fuzzDocuments } = await import("./fuzz/documents")
    const opt = (k: string, d: number) => { const i = rest.indexOf(k); return i >= 0 ? Number(rest[i + 1]) : d }
    process.exit(fuzzDocuments(opt("--n", 30), opt("--seed", 1)))
  }
  case "dimen:check": {
    const { dimenCheck } = await import("./oracle/dimencheck")
    const opt = (k: string, d: number) => { const i = rest.indexOf(k); return i >= 0 ? Number(rest[i + 1]) : d }
    process.exit(dimenCheck(opt("--n", 5000), opt("--seed", 1)))
  }
  case "scorecard": {
    const { scorecard } = await import("./scorecard")
    const opt = (k: string) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : undefined }
    process.exit(scorecard({ check: flags.has("--check"), base: opt("--base"), markdownOut: opt("--markdown") }))
  }
  case "glyph:check": {
    const { glyphCheck } = await import("./oracle/glyphcheck")
    const opt = (k: string, d: number) => { const i = rest.indexOf(k); return i >= 0 ? Number(rest[i + 1]) : d }
    process.exit(glyphCheck(opt("--n", 4000), opt("--seed", 1)))
  }
  case "expand:check": {
    const { expandCheck } = await import("./oracle/expandcheck")
    const opt = (k: string, d: number) => { const i = rest.indexOf(k); return i >= 0 ? Number(rest[i + 1]) : d }
    process.exit(expandCheck(opt("--n", 3000), opt("--seed", 1)))
  }
  case "expand:doc": {
    const { expandDocCheck } = await import("./oracle/expanddoc")
    const opt = (k: string, d: number) => { const i = rest.indexOf(k); return i >= 0 ? Number(rest[i + 1]) : d }
    process.exit(expandDocCheck(opt("--n", 300), opt("--seed", 1)))
  }
  case "math:check": {
    const { mathCheck } = await import("./oracle/mathcheck")
    const opt = (k: string, d: number) => { const i = rest.indexOf(k); return i >= 0 ? Number(rest[i + 1]) : d }
    process.exit(mathCheck(opt("--n", 3000), opt("--seed", 1)))
  }
  case "trace":
    if (!args[0]) throw new Error("usage: bun engine trace <fixture.tex>")
    console.log(JSON.stringify(oracleTrace(args[0]), null, 1))
    break
  case "oracle:check":
    await import("./oracle/selfcheck")
    break
  default:
    console.log("usage: bun engine <ci|unit|codegen|trace|oracle:check> …")
    process.exit(cmd ? 1 : 0)
}
