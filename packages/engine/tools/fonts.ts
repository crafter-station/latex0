// Font loading for dev tooling: committed data only, never .tfm files, so the
// tooling exercises exactly what the engine ships.

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { decodeFontData, type FontData } from "../layout/fontdata"
import type { FixWordFont } from "../layout/font"

const DIR = join(process.cwd(), "packages/engine/data/fonts")
const memo = new Map<string, FixWordFont>()

export function dataFont(name: string): FixWordFont {
  let f = memo.get(name)
  if (!f) {
    f = decodeFontData(JSON.parse(readFileSync(join(DIR, `${name}.json`), "utf8")) as FontData)
    memo.set(name, f)
  }
  return f
}
