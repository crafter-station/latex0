// The web fonts cover the engine's fonts: every TFM in data/fonts has a web font file in public/fonts/tex and a
// code point for each of its characters, so the exact page view can draw any glyph the engine sets.

import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { dataFont, webfontData } from "../../latex/data"
import "../data"

export function webfontsCheck(): number {
  const { fonts, codes } = webfontData()
  const bad: string[] = []
  const names = readdirSync("packages/engine/data/fonts").filter((f) => f.endsWith(".json") && f !== "index.json").map((f) => f.slice(0, -5))
  for (const name of names) {
    const entry = fonts[name]
    if (!entry) { bad.push(`${name}: no web font`); continue }
    const [file, vector] = entry
    if (!existsSync(join("public/fonts/tex", `${file}.woff2`))) bad.push(`${name}: public/fonts/tex/${file}.woff2 is missing`)
    const missing = [...dataFont(name).chars.keys()].filter((c) => !codes[vector][c])
    if (missing.length) bad.push(`${name}: no glyph for character${missing.length > 1 ? "s" : ""} ${missing.join(" ")}`)
  }
  console.log(bad.length ? `✗ ${bad.length} fonts the web fonts do not cover (python3 packages/engine/tools/webfonts/build.py):\n${bad.join("\n")}` : `✓ web fonts for all ${names.length} fonts`)
  return bad.length ? 1 : 0
}
