// Codegen (#113): the hyphenation patterns LaTeX's format loads, as data.
// English (language 0) is Knuth's hyphen.tex, per TeX Live's language.dat.

import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { HyphenationData } from "../../layout/hyphenate"

const OUT = "lib/latex/data/hyphenation"
const TEXBIN = process.env.TEXBIN ?? "/Library/TeX/texbin"

function block(src: string, cmd: string): string[] {
  const start = src.indexOf(`\\${cmd}{`)
  if (start < 0) throw new Error(`no \\${cmd} in source`)
  const end = src.indexOf("}", start)
  return src.slice(src.indexOf("{", start) + 1, end)
    .split("\n").map((l) => l.replace(/%.*/, "")).join(" ")
    .split(/\s+/).filter(Boolean)
}

export function codegenHyphenation(check: boolean): number {
  const path = execFileSync(`${TEXBIN}/kpsewhich`, ["hyphen.tex"], { encoding: "utf8" }).trim()
  const src = readFileSync(path, "latin1")
  const data: HyphenationData = { format: 1, source: "hyphen.tex (Knuth, TeX Live)", patterns: block(src, "patterns"), exceptions: block(src, "hyphenation") }
  const body = JSON.stringify(data) + "\n"
  const file = join(OUT, "en-us.json")
  const same = existsSync(file) && readFileSync(file, "utf8") === body
  if (check) { console.log(same ? "hyphenation data up to date" : "hyphenation data out of date: run bun engine codegen"); return same ? 0 : 1 }
  mkdirSync(OUT, { recursive: true })
  writeFileSync(file, body)
  console.log(`wrote ${file}: ${data.patterns.length} patterns, ${data.exceptions.length} exceptions (${(body.length / 1024).toFixed(1)} KB)`)
  return 0
}
