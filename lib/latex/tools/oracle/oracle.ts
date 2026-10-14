// Oracle runner: compile a fixture with real TeX (offline, dev only) and return
// TeX's own record of where every glyph and rule went. TeX is the oracle,
// never the runtime: nothing in this folder is imported by the engine.

import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, copyFileSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import { parseDvi, type Trace } from "./dvi"
import { parseTfm, type Tfm } from "./tfm"

const TEXBIN = process.env.TEXBIN ?? "/Library/TeX/texbin"
const ENV = { ...process.env, PATH: `${TEXBIN}:${process.env.PATH}` }
const CACHE = resolve(process.cwd(), ".cache/oracle")

const tfmCache = new Map<string, Tfm>()
export function loadTfm(name: string): Tfm {
  const hit = tfmCache.get(name)
  if (hit) return hit
  const path = execFileSync("kpsewhich", [`${name}.tfm`], { env: ENV, encoding: "utf8" }).trim()
  if (!path) throw new Error(`TFM not found: ${name}`)
  const tfm = parseTfm(new Uint8Array(readFileSync(path)), name)
  tfmCache.set(name, tfm)
  return tfm
}

export function texVersion(): string {
  return execFileSync("latex", ["--version"], { env: ENV, encoding: "utf8" }).split("\n")[0]
}

/** Compile `fixture` to DVI (twice, for refs) and return the trace. */
export function oracleTrace(fixture: string): Trace {
  const name = basename(fixture, ".tex")
  const dir = join(CACHE, name)
  mkdirSync(dir, { recursive: true })
  copyFileSync(fixture, join(dir, `${name}.tex`))
  for (let pass = 0; pass < 2; pass++) {
    execFileSync("latex", ["-interaction=nonstopmode", "-halt-on-error", `${name}.tex`], { cwd: dir, env: ENV, stdio: "pipe" })
  }
  return parseDvi(new Uint8Array(readFileSync(join(dir, `${name}.dvi`))), loadTfm)
}
