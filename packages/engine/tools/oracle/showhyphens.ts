// Hyphenation oracle (#113, #63): TeX's \showhyphens over a word list, compared with
// the engine's Liang implementation word by word, in each language's patterns: English
// (/usr/share/dict/words in cmr10), British English likewise, Spanish and Portuguese (words made
// of their syllables, in T1: ecrm1000, whose characters the patterns are in).
//   bun engine hyphen:check [--words N] [--lang en-us|en-gb|es|pt|fr]

import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { loadFont } from "../../layout/font"
import { appendText } from "../../layout/hmode"
import { buildHyphenator, type Hyphenator } from "../../layout/hyphenate"
import { hyphenateFollowingWord } from "../../layout/hyphenpass"
import { glue, type Node } from "../../layout/nodes"
import { hyphenationData } from "../../latex/data"
import { dataFont } from "../fonts"
import { texEnv } from "../tex"

/** TeX's short_display (§§ 174–175) for character-level lists. */
export function shortDisplay(list: Node[]): string {
  let out = ""
  for (let i = 0; i < list.length; i++) {
    const n = list[i]
    switch (n.kind) {
      case "char": out += n.text; break // a ligature shows its original characters
      case "glue": out += " "; break
      case "disc": out += shortDisplay(n.pre) + shortDisplay(n.post); i += n.replaceCount; break // replaced nodes are skipped
      case "hlist": case "vlist": out += "[]"; break
      case "rule": out += "|"; break
      default: break
    }
  }
  return out
}

/** Hyphenate one word the way a paragraph's second pass does, and display it like TeX. */
export function engineShowHyphens(h: Hyphenator, word: string, lang: HyphenLanguage = LANGUAGES["en-us"]): string {
  const font = loadFont(dataFont(lang.font), 10 * 65536)
  const list: Node[] = [glue(0)]
  appendText(list, lang.t1 ? word.replace(/œ/g, "\xf7") : word, font, { spaceFactor: 1000 }) // (the characters in T1: Latin-1's, and œ)
  list.push(glue(0))
  hyphenateFollowingWord(list, 0, { hyphenator: h, fontOf: () => font, lHyf: lang.mins[0], rHyf: lang.mins[1], ucHyph: 1, ...(lang.lc ? { lc: lang.lc } : {}) })
  return shortDisplay(list.slice(1, -1))
}

/** a language's check: TeX's language (\l@<name>), its \lefthyphenmin and \righthyphenmin (babel's), the font */
interface HyphenLanguage { tex: string; mins: [number, number]; font: string; t1: boolean; /** \lccode changes (babel's extras) */ lc?: Record<number, number> }
const LANGUAGES: Record<string, HyphenLanguage> = {
  "en-us": { tex: "english", mins: [2, 3], font: "cmr10", t1: false },
  "en-gb": { tex: "british", mins: [2, 3], font: "cmr10", t1: false },
  es: { tex: "spanish", mins: [2, 2], font: "ecrm1000", t1: true },
  pt: { tex: "portuguese", mins: [2, 3], font: "ecrm1000", t1: true },
  fr: { tex: "french", mins: [2, 3], font: "ecrm1000", t1: true, lc: { 39: 39 } },
}

/** Words of Spanish (or Portuguese, or French) syllables (onset, nucleus with or without an accent, coda), from a fixed
 *  seed; French ones after an elided article now and then (l', d', qu' …: the apostrophe is a letter there) */
function syllableWords(n: number, pt = false, fr = false): string[] {
  if (fr) {
    const onsets = ["", "b", "c", "ç", "ch", "d", "f", "g", "gu", "j", "l", "m", "n", "gn", "p", "ph", "qu", "r", "s", "ss", "t", "th", "v", "z", "bl", "br", "cl", "cr", "dr", "fl", "fr", "gl", "gr", "pl", "pr", "tr", "h", "x"]
    const nuclei = ["a", "e", "i", "o", "u", "é", "è", "ê", "à", "â", "î", "ï", "ô", "û", "ai", "ei", "oi", "ou", "au", "eau", "eu", "œu", "ie", "io", "ui", "y"]
    const codas = ["", "", "", "n", "s", "r", "l", "m", "t", "x", "nt", "st", "rs"]
    let seed = 47
    const r = (k: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % k }
    const words: string[] = []
    while (words.length < n) {
      let w = ["", "", "", "l'", "d'", "qu'", "j'", "n'", "s'", "jusqu'", "lorsqu'", "'"][r(12)] // (and an apostrophe first: a letter)
      for (let s = 2 + r(4); s > 0; s--) w += onsets[r(onsets.length)] + nuclei[r(nuclei.length)] + codas[r(codas.length)]
      if (!/^(ss|ç|gn)/.test(w)) words.push(w)
    }
    return words
  }
  const onsets = pt
    ? ["", "b", "c", "ç", "ch", "d", "f", "g", "gu", "j", "l", "lh", "m", "n", "nh", "p", "qu", "r", "rr", "s", "ss", "t", "v", "x", "z", "bl", "br", "cl", "cr", "dr", "fl", "fr", "gl", "gr", "pl", "pr", "tr", "h"]
    : ["", "b", "c", "ch", "d", "f", "g", "gu", "j", "l", "ll", "m", "n", "ñ", "p", "qu", "r", "rr", "s", "t", "v", "y", "z", "bl", "br", "cl", "cr", "dr", "fl", "fr", "gl", "gr", "pl", "pr", "tr", "x", "h"]
  const nuclei = pt
    ? ["a", "e", "i", "o", "u", "á", "é", "í", "ó", "ú", "â", "ê", "ô", "ã", "õ", "ai", "ei", "oi", "ou", "eu", "ão", "õe", "ia", "io", "ua"]
    : ["a", "e", "i", "o", "u", "á", "é", "í", "ó", "ú", "ia", "ie", "io", "ua", "ue", "ui", "au", "ei", "ai", "oi", "ü", "üe"]
  const codas = pt ? ["", "", "", "n", "s", "r", "l", "m", "z", "ns", "x"] : ["", "", "", "n", "s", "r", "l", "d", "z", "ns", "bs", "c", "x", "p"]
  let seed = 63
  const r = (k: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % k }
  const words: string[] = []
  while (words.length < n) {
    let w = ""
    for (let s = 2 + r(4); s > 0; s--) w += onsets[r(onsets.length)] + nuclei[r(nuclei.length)] + codas[r(codas.length)]
    if (!/^(rr|ñ|ç|lh|nh|ss)/.test(w)) words.push(w)
  }
  return words
}


export function texShowHyphens(words: string[], lang: HyphenLanguage = LANGUAGES["en-us"]): string[] {
  const dir = join(process.cwd(), ".cache/oracle/showhyphens")
  mkdirSync(dir, { recursive: true })
  const out: string[] = []
  const head = `[] \\${lang.t1 ? "T1" : "OT1"}/cmr/m/n/10 `
  for (let i = 0; i < words.length; i += 100) {
    const batch = words.slice(i, i + 100)
    const lc = Object.entries(lang.lc ?? {}).map(([c, v]) => `\\lccode${c}=${v}`).join("")
    const setup = `${lang.t1 ? "\\usepackage[T1]{fontenc}\n" : ""}\\begin{document}\n\\language=\\csname l@${lang.tex}\\endcsname\\lefthyphenmin=${lang.mins[0]}\\righthyphenmin=${lang.mins[1]}${lc}\n`
    writeFileSync(join(dir, "sh.tex"), `\\documentclass{article}\n${setup}\\showhyphens{${batch.join(" ")}}\n\\end{document}\n`)
    execFileSync("latex", ["-interaction=nonstopmode", "sh.tex"], { cwd: dir, env: texEnv({ max_print_line: "1000000" }), stdio: "pipe" })
    const line = readFileSync(join(dir, "sh.log"), "latin1").split("\n").find((l) => l.startsWith(head))
    if (!line) throw new Error("no \\showhyphens output")
    const got = line.slice(head.length).trim().split(" ")
    if (got.length !== batch.length) throw new Error(`batch ${i}: ${got.length} words back for ${batch.length}`)
    out.push(...got)
  }
  return out
}

export function hyphenCheck(n: number, id = "en-us"): number {
  const lang = LANGUAGES[id]
  if (!lang) throw new Error(`hyphen:check: no language ${id}`)
  let words: string[]
  if (id === "es" || id === "pt" || id === "fr") words = syllableWords(n, id === "pt", id === "fr")
  else {
    const all = readFileSync("/usr/share/dict/words", "utf8").split("\n").filter((w) => /^[A-Za-z]+$/.test(w))
    const step = Math.max(1, Math.floor(all.length / n))
    words = all.filter((_, i) => i % step === 0).slice(0, n)
  }
  const data = hyphenationData(id)
  const h = buildHyphenator(data)
  const tex = texShowHyphens(words, lang)
  // Compare what the engine actually builds (discretionaries after reconstitute),
  // displayed exactly as TeX displays it.
  const diffs = words.map((w, i) => ({ w, tex: tex[i], ours: engineShowHyphens(h, w, lang) })).filter((d) => d.tex !== d.ours)
  const hyphenated = tex.filter((t) => t.includes("-")).length
  console.log(`${words.length} ${id} words${id === "es" ? " of Spanish syllables" : id === "pt" ? " of Portuguese syllables" : id === "fr" ? " of French syllables" : " from /usr/share/dict/words"}, ${hyphenated} hyphenated by TeX`)
  for (const d of diffs.slice(0, 20)) console.log(`  ✗ ${d.w}: TeX ${d.tex}  engine ${d.ours}`)
  console.log(diffs.length ? `HYPHENATION CHECK FAILED: ${diffs.length} differences` : "HYPHENATION CHECK PASSED: identical to TeX")
  return diffs.length ? 1 : 0
}
