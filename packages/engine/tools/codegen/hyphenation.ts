// Codegen (#113, #63): the hyphenation patterns LaTeX's format loads, as data, one file per language of TeX
// Live's language.dat: English (language 0) is Knuth's hyphen.tex; the others are hyph-utf8's patterns as
// pdfTeX's loaders read them (loadhyph-<id>.tex), UTF-8 turned into the EC (T1) characters of
// conv-utf8-ec.tex.

import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { HyphenationData } from "../../layout/hyphenate"
import { texEnv } from "../tex"

const OUT = "packages/engine/data/hyphenation"

/** each language's data file: its pattern file, and whether pdfTeX reads it through conv-utf8-ec.tex */
const LANGUAGES: Record<string, { file: string; source: string; ec: boolean }> = {
  "en-us": { file: "hyphen.tex", source: "hyphen.tex (Knuth, TeX Live)", ec: false },
  "en-gb": { file: "hyph-en-gb.tex", source: "hyph-en-gb.tex (hyph-utf8, TeX Live's ukenglish)", ec: false },
  es: { file: "hyph-es.tex", source: "hyph-es.tex (hyph-utf8, TeX Live's spanish), EC characters", ec: true },
  pt: { file: "hyph-pt.tex", source: "hyph-pt.tex (hyph-utf8, TeX Live's portuguese), EC characters", ec: true },
  fr: { file: "hyph-fr.tex", source: "hyph-fr.tex (hyph-utf8, TeX Live's french, the apostrophe a letter), EC characters", ec: true },
}

function block(src: string, cmd: string, optional = false): string[] {
  const start = src.indexOf(`\\${cmd}{`)
  if (start < 0) { if (optional) return []; throw new Error(`no \\${cmd} in source`) }
  const end = src.indexOf("}", start)
  return src.slice(src.indexOf("{", start) + 1, end)
    .split("\n").map((l) => l.replace(/%.*/, "")).join(" ")
    .split(/\s+/).filter(Boolean)
}

/** conv-utf8-ec.tex: each two-byte UTF-8 sequence's EC character (\def^^c3#1{\ifx#1^^a9^^e9\else …}) */
function ecConversion(): Map<string, string> {
  const path = execFileSync("kpsewhich", ["conv-utf8-ec.tex"], { encoding: "utf8", env: texEnv() }).trim()
  const src = readFileSync(path, "latin1")
  const map = new Map<string, string>()
  for (const d of src.matchAll(/\\def\^\^([0-9a-f]{2})#1\{([^]*?)\\errmessage/g)) {
    for (const e of d[2].matchAll(/\\ifx#1\^\^([0-9a-f]{2})\^\^([0-9a-f]{2})\\else/g)) {
      const utf8 = Buffer.from([parseInt(d[1], 16), parseInt(e[1], 16)]).toString("utf8")
      map.set(utf8, String.fromCharCode(parseInt(e[2], 16)))
    }
  }
  return map
}

export function codegenHyphenation(check: boolean): number {
  let stale = 0
  const ec = ecConversion()
  for (const [id, lang] of Object.entries(LANGUAGES)) {
    const path = execFileSync("kpsewhich", [lang.file], { encoding: "utf8", env: texEnv() }).trim()
    const src = readFileSync(path, lang.ec ? "utf8" : "latin1")
    const chars = (word: string) => !lang.ec ? word : [...word].map((ch) => {
      const c = ch.charCodeAt(0) < 128 ? ch : ec.get(ch)
      if (c === undefined) throw new Error(`${lang.file}: no EC character for ${ch}`)
      return c
    }).join("")
    const data: HyphenationData = { format: 1, source: lang.source, patterns: block(src, "patterns").map(chars), exceptions: block(src, "hyphenation", true).map(chars) }
    const body = JSON.stringify(data) + "\n"
    const file = join(OUT, `${id}.json`)
    const same = existsSync(file) && readFileSync(file, "utf8") === body
    if (check) { if (!same) { console.log(`hyphenation data out of date (${id}): run bun engine codegen`); stale = 1 } continue }
    mkdirSync(OUT, { recursive: true })
    writeFileSync(file, body)
    console.log(`wrote ${file}: ${data.patterns.length} patterns, ${data.exceptions.length} exceptions (${(body.length / 1024).toFixed(1)} KB)`)
  }
  if (check && !stale) console.log("hyphenation data up to date")
  return stale
}
