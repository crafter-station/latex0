// Codegen (#42): TeX font metrics → committed data in lib/latex/data/fonts.
//   bun engine codegen          regenerate
//   bun engine codegen --check  fail if committed data differs from the TFMs (CI)
// Every file is verified to decode back to exactly the parsed TFM before it is written.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { decodeFontData, encodeFontData, type FontData } from "../../layout/fontdata"
import type { FixWordFont } from "../../layout/font"
import { loadTfm } from "../oracle/oracle"

export const FONTS = [
  // text
  ...["5", "6", "7", "8", "9", "10", "12", "17"].map((s) => `cmr${s}`),
  ...["5", "6", "7", "8", "9", "10", "12"].map((s) => `cmbx${s}`),
  ...["7", "8", "9", "10", "12"].map((s) => `cmti${s}`),
  ...["8", "9", "10", "12"].map((s) => `cmsl${s}`),
  ...["8", "9", "10", "12"].map((s) => `cmtt${s}`),
  ...["8", "9", "10", "12"].map((s) => `cmss${s}`),
  "cmssbx10", "cmssi10", "cmcsc10", "cmbxti10", "cmu10",
  // math
  ...["5", "6", "7", "8", "9", "10", "12"].map((s) => `cmmi${s}`),
  ...["5", "6", "7", "8", "9", "10"].map((s) => `cmsy${s}`),
  "cmex7", "cmex8", "cmex9", "cmex10", "cmmib10", "cmbsy10",
  // AMS and friends
  ...["5", "7", "10"].flatMap((s) => [`msam${s}`, `msbm${s}`, `eufm${s}`]),
  "lasy10", "line10", "lcircle10",
  // text companion (TS1: \textbullet and friends) at the class sizes
  ...["0500", "0600", "0700", "0800", "0900", "1000", "1095", "1200", "1440", "1728", "2074", "2488"].map((s) => `tcrm${s}`),
]

const OUT = "lib/latex/data/fonts"

const sameFont = (a: FixWordFont, b: FixWordFont) => JSON.stringify(encodeFontData(a)) === JSON.stringify(encodeFontData(b)) &&
  a.chars.size === b.chars.size && [...a.chars].every(([c, m]) => JSON.stringify(m) === JSON.stringify(b.chars.get(c)))

export function codegenFonts(check: boolean): number {
  const files = new Map<string, string>()
  for (const name of FONTS) {
    const tfm = loadTfm(name)
    const data = encodeFontData(tfm)
    if (!sameFont(decodeFontData(data), tfm)) throw new Error(`${name}: encoded data does not round-trip`)
    files.set(`${name}.json`, JSON.stringify(data) + "\n")
  }
  const index = { fonts: FONTS.map((n) => ({ name: n, checksum: (JSON.parse(files.get(`${n}.json`)!) as FontData).checksum })) }
  files.set("index.json", JSON.stringify(index, null, 1) + "\n")

  const stale = [...files].filter(([f, body]) => !existsSync(join(OUT, f)) || readFileSync(join(OUT, f), "utf8") !== body).map(([f]) => f)
  if (check) {
    if (stale.length) { console.log(`font data out of date: ${stale.join(", ")}\nrun: bun engine codegen`); return 1 }
    console.log(`font data up to date (${FONTS.length} fonts)`)
    return 0
  }
  mkdirSync(OUT, { recursive: true })
  for (const [f, body] of files) writeFileSync(join(OUT, f), body)
  const bytes = [...files.values()].reduce((n, b) => n + b.length, 0)
  console.log(`wrote ${files.size} files to ${OUT} (${(bytes / 1024).toFixed(1)} KB), ${stale.length} changed`)
  return 0
}
