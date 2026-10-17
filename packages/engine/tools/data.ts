// The engine's data for dev tooling: the committed files, read from disk, never
// .tfm or .cls files, so the tooling exercises exactly what the engine ships.
// Importing this module installs it.

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { installData, type DataSource } from "../latex/data"

const DIR = join(process.cwd(), "packages/engine/data")
const json = <T>(...path: string[]): T => JSON.parse(readFileSync(join(DIR, ...path), "utf8")) as T

export const fileData: DataSource = {
  font: (name) => json("fonts", `${name}.json`),
  documentClass: (cls) => json("classes", `${cls}.json`),
  hyphenation: (language) => json("hyphenation", `${language}.json`),
  math: () => json("math", "latex.json"),
}

installData(fileData)
