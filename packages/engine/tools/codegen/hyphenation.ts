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

/** each language's data file: its pattern file, and whether pdfTeX reads it through conv-utf8-ec.tex, or as one of
 *  dehyph's legacy files (which loadhyph-de-1901.tex and loadhyph-de-1996.tex input for 8-bit engines) */
const LANGUAGES: Record<string, { file: string; source: string; ec: boolean; dehyph?: boolean }> = {
  "en-us": { file: "hyphen.tex", source: "hyphen.tex (Knuth, TeX Live)", ec: false },
  "en-gb": { file: "hyph-en-gb.tex", source: "hyph-en-gb.tex (hyph-utf8, TeX Live's ukenglish)", ec: false },
  es: { file: "hyph-es.tex", source: "hyph-es.tex (hyph-utf8, TeX Live's spanish), EC characters", ec: true },
  pt: { file: "hyph-pt.tex", source: "hyph-pt.tex (hyph-utf8, TeX Live's portuguese), EC characters", ec: true },
  fr: { file: "hyph-fr.tex", source: "hyph-fr.tex (hyph-utf8, TeX Live's french, the apostrophe a letter), EC characters", ec: true },
  "de-1901": { file: "dehypht.tex", source: "dehypht.tex (dehyph, TeX Live's german: what loadhyph-de-1901.tex reads in pdfTeX), T1 and OT1 characters", ec: false, dehyph: true },
  "de-1996": { file: "dehyphn.tex", source: "dehyphn.tex (dehyph, TeX Live's ngerman: what loadhyph-de-1996.tex reads in pdfTeX), T1 and OT1 characters", ec: false, dehyph: true },
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

/**
 * dehyph's \patterns{…} as TeX 3 reads them: \n{…} (patterns with umlauts) and \c{…} (their OT1 duplicates) kept, "a "o
 * "u the T1 umlauts (^^e4 ^^f6 ^^fc), \3 T1's \ss (^^ff) and \9 OT1's (^^Y)
 */
function dehyphPatterns(src: string): string[] {
  const start = src.search(/^\\patterns\{/m) // (not the comments' \patterns{...})
  const body = src.slice(start + 10).split("\n").map((l) => l.replace(/%.*/, "")).join(" ")
  const end = body.search(/\}\s*(?:\\endgroup|$)/)
  if (start < 0 || end < 0) throw new Error("dehyph: no \\patterns")
  let text = body.slice(0, end)
  for (let was = ""; was !== text;) { was = text; text = text.replace(/\\[nc]\{([^{}]*)\}/g, "$1") } // (\n{\c{…}} too)
  text = text.replace(/\\3/g, "\xff").replace(/\\9/g, "\x19")
    .replace(/"([aou])/g, (_, v: string) => String.fromCharCode({ a: 0xe4, o: 0xf6, u: 0xfc }[v]!))
  if (/[\\{}"]/.test(text)) throw new Error(`dehyph: unexpected ${text.match(/[\\{}"].{0,20}/)![0]}`)
  return text.split(/\s+/).filter(Boolean)
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
    const data: HyphenationData = lang.dehyph ? { format: 1, source: lang.source, patterns: dehyphPatterns(src), exceptions: [] }
      : { format: 1, source: lang.source, patterns: block(src, "patterns").map(chars), exceptions: block(src, "hyphenation", true).map(chars) }
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
