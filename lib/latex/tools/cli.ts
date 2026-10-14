#!/usr/bin/env bun
// latex0 engine CLI (dev tooling, #39).
//   bun engine unit [paths…] [--watch] [--json] [-v]   fixtures vs TeX at 0 sp (#32)
//   bun engine codegen [--check]                       regenerate committed font metrics (#42)
//   bun engine decisions <fixture.tex>                 TeX line-break and page-break decisions (#28)
//   bun engine search:badness 12,13                    ask TeX for paragraphs hitting given badness values; write fixtures
//   bun engine hyphen:check [--words N]                engine hyphenation vs TeX \\showhyphens (#113)
//   bun engine fuzz:paragraphs [--n 200] [--seed 1]    random paragraphs: engine line breaks vs TeX's decisions (#112)
//   bun engine dimen:check [--n 5000] [--seed 1]       numbers, dimensions and glue: engine scanner vs TeX (#52)
//   bun engine trace <fixture.tex>                     TeX oracle trace as JSON
//   bun engine oracle:check                            oracle self-check against pdflatex
import { spawn } from "node:child_process"
import { watch } from "node:fs"
import { oracleTrace } from "./oracle/oracle"
import { collectFixtures, report, runFixture } from "./unit/run"

const FIXTURES = "lib/latex/fixtures"
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
      .on("exit", () => console.log(`\nwatching lib/latex for changes… (ctrl-c to stop)`))
  }
  watch("lib/latex", { recursive: true }, (_e, file) => {
    if (!file || file.includes(".cache") || !/\.(ts|tex)$/.test(String(file))) return
    clearTimeout(timer); timer = setTimeout(run, 150)
  })
  run()
}

switch (cmd) {
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
    const check = flags.has("--check")
    process.exit(codegenFonts(check) | codegenHyphenation(check) | codegenClasses(check))
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
  case "dimen:check": {
    const { dimenCheck } = await import("./oracle/dimencheck")
    const opt = (k: string, d: number) => { const i = rest.indexOf(k); return i >= 0 ? Number(rest[i + 1]) : d }
    process.exit(dimenCheck(opt("--n", 5000), opt("--seed", 1)))
  }
  case "trace":
    if (!args[0]) throw new Error("usage: bun engine trace <fixture.tex>")
    console.log(JSON.stringify(oracleTrace(args[0]), null, 1))
    break
  case "oracle:check":
    await import("./oracle/selfcheck")
    break
  default:
    console.log("usage: bun engine <unit|codegen|trace|oracle:check> …")
    process.exit(cmd ? 1 : 0)
}
