// Hyphenation oracle (#113): TeX's \showhyphens over a word list, compared with
// the engine's Liang implementation word by word.
//   bun engine hyphen:check [--words N]

import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { loadFont } from "../../layout/font"
import { appendText } from "../../layout/hmode"
import { buildHyphenator, type HyphenationData, type Hyphenator } from "../../layout/hyphenate"
import { hyphenateFollowingWord } from "../../layout/hyphenpass"
import { glue, type Node } from "../../layout/nodes"
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
export function engineShowHyphens(h: Hyphenator, word: string): string {
  const font = loadFont(dataFont("cmr10"), 10 * 65536)
  const list: Node[] = [glue(0)]
  appendText(list, word, font, { spaceFactor: 1000 })
  list.push(glue(0))
  hyphenateFollowingWord(list, 0, { hyphenator: h, fontOf: () => font, lHyf: 2, rHyf: 3, ucHyph: 1 })
  return shortDisplay(list.slice(1, -1))
}


export function texShowHyphens(words: string[]): string[] {
  const dir = join(process.cwd(), ".cache/oracle/showhyphens")
  mkdirSync(dir, { recursive: true })
  const out: string[] = []
  for (let i = 0; i < words.length; i += 100) {
    const batch = words.slice(i, i + 100)
    writeFileSync(join(dir, "sh.tex"), `\\documentclass{article}\n\\begin{document}\n\\showhyphens{${batch.join(" ")}}\n\\end{document}\n`)
    execFileSync("latex", ["-interaction=nonstopmode", "sh.tex"], { cwd: dir, env: texEnv({ max_print_line: "1000000" }), stdio: "pipe" })
    const line = readFileSync(join(dir, "sh.log"), "latin1").split("\n").find((l) => l.startsWith("[] \\OT1/cmr/m/n/10 "))
    if (!line) throw new Error("no \\showhyphens output")
    const got = line.slice("[] \\OT1/cmr/m/n/10 ".length).trim().split(" ")
    if (got.length !== batch.length) throw new Error(`batch ${i}: ${got.length} words back for ${batch.length}`)
    out.push(...got)
  }
  return out
}

export function hyphenCheck(n: number): number {
  const all = readFileSync("/usr/share/dict/words", "utf8").split("\n").filter((w) => /^[A-Za-z]+$/.test(w))
  const step = Math.max(1, Math.floor(all.length / n))
  const words = all.filter((_, i) => i % step === 0).slice(0, n)
  const data = JSON.parse(readFileSync("packages/engine/data/hyphenation/en-us.json", "utf8")) as HyphenationData
  const h = buildHyphenator(data)
  const tex = texShowHyphens(words)
  // Compare what the engine actually builds (discretionaries after reconstitute),
  // displayed exactly as TeX displays it.
  const diffs = words.map((w, i) => ({ w, tex: tex[i], ours: engineShowHyphens(h, w) })).filter((d) => d.tex !== d.ours)
  const hyphenated = tex.filter((t) => t.includes("-")).length
  console.log(`${words.length} words from /usr/share/dict/words, ${hyphenated} hyphenated by TeX`)
  for (const d of diffs.slice(0, 20)) console.log(`  ✗ ${d.w}: TeX ${d.tex}  engine ${d.ours}`)
  console.log(diffs.length ? `HYPHENATION CHECK FAILED: ${diffs.length} differences` : "HYPHENATION CHECK PASSED: identical to TeX")
  return diffs.length ? 1 : 0
}
