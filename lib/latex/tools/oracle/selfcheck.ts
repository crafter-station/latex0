// Oracle self-check: the DVI trace must agree with pdflatex + pdftotext -bbox,
// an independent path through TeX. Run: bun lib/latex/tools/oracle/selfcheck.ts
import { execFileSync } from "node:child_process"
import { join } from "node:path"
import { oracleTrace, loadTfm, texVersion } from "./oracle"
import { scaled } from "./tfm"

const fx = join(process.cwd(), "lib/latex/fixtures/micro/text/paragraph-basic.tex")
console.log(texVersion())

// 1. TFM sanity: known tftopl values for cmr10 ('a' = 0.500002 design units, design size 10pt)
const cmr10 = loadTfm("cmr10")
const a = scaled(cmr10.chars.get(97)!.width, 10 * 65536)
console.log(`cmr10 design=${cmr10.designSize / 2 ** 20}pt  width('a')=${a}sp (expect 327681)  quad=${scaled(cmr10.params[6], 655360)}sp (expect 655361)`)

const LIG: Record<number,string> = { 11: "ff", 12: "fi", 13: "fl", 14: "ffi", 15: "ffl", 123: "–", 124: "—", 92: "“", 34: "”" }
// 2. DVI trace
const t = oracleTrace(fx)
const pg = t.pages[0]
const text = pg.glyphs.map((g) => LIG[g.char] ?? String.fromCharCode(g.char)).join("")
console.log(`pages=${t.pages.length} glyphs=${pg.glyphs.length} fonts=${[...new Set(pg.glyphs.map(g => g.font))].join(",")}`)

// group glyphs into words: same v, gap > 0 between end of one and start of next
const words: { h: number; v: number; s: string }[] = []
for (const g of pg.glyphs) {
  const last = words.at(-1), prev = pg.glyphs[pg.glyphs.indexOf(g) - 1]
  const contiguous = last && prev && prev.v === g.v && g.h - (prev.h + prev.width) < 65536 * 2 // kerns (even negative) join; interword glue (>=3pt) splits
  if (contiguous) last!.s += LIG[g.char] ?? String.fromCharCode(g.char)
  else words.push({ h: g.h, v: g.v, s: LIG[g.char] ?? String.fromCharCode(g.char) })
}

// 3. Independent check: pdflatex + pdftotext -bbox word xMin, in bp from page corner
const dir = join(process.cwd(), ".cache/oracle/paragraph-basic")
execFileSync("pdflatex", ["-interaction=nonstopmode", "paragraph-basic.tex"], { cwd: dir, env: { ...process.env, PATH: `/Library/TeX/texbin:${process.env.PATH}` }, stdio: "pipe" })
const html = execFileSync("pdftotext", ["-bbox", join(dir, "paragraph-basic.pdf"), "-"], { encoding: "utf8" })
const pdfWords = [...html.matchAll(/xMin="([\d.]+)" yMin="[\d.]+" xMax="[\d.]+" yMax="([\d.]+)">([^<]*)</g)].map((m) => ({ x: +m[1], s: m[3] }))
const toBp = (sp: number) => (sp / 65536 + 72.27) * 72 / 72.27 // DVI origin is 1in,1in
let compared = 0, maxErr = 0
let unmatched = 0
for (let i = 0; i < Math.min(words.length, pdfWords.length); i++) {
  if (words[i].s !== pdfWords[i].s) { unmatched++; console.log("  text differs:", JSON.stringify(words[i].s), "vs", JSON.stringify(pdfWords[i].s)) }
  const err = Math.abs(toBp(words[i].h) - pdfWords[i].x)
  maxErr = Math.max(maxErr, err); compared++
}
console.log(`text mismatches: ${unmatched}`)
console.log(`words: dvi=${words.length} pdf=${pdfWords.length} compared=${compared} max |Δx|=${maxErr.toFixed(4)}bp`)
console.log("first line from DVI:", words.filter(w => w.v === words[0].v).map(w => w.s).join(" "))
const ok = a === 327681 && unmatched === 0 && compared === pdfWords.length && maxErr < 0.01
console.log(ok ? "ORACLE SELF-CHECK PASSED" : "ORACLE SELF-CHECK FAILED")
if (!ok) process.exit(1)
