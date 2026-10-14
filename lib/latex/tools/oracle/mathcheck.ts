// Math oracle (#74–#77): random formulas typeset by TeX in \hbox{$…$} and shown
// with \showbox, against the engine's mlist_to_hlist (mathlayout/mlist.ts).
// Formulas are random trees of math characters, symbols, groups, fractions and
// big operators with \limits and \nolimits, with superscripts, subscripts and
// primes, under \displaystyle, \textstyle, \scriptstyle and
// \scriptscriptstyle. Each tree is printed as LaTeX, typeset by TeX, and read
// for the engine by its math parser (mathlayout/parse.ts).
// Articles at 10, 11, 12pt.
//   bun engine math:check [--n 3000] [--seed 1]

import { spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { emitBoxes } from "../../emit/boxes"
import { loadFont } from "../../layout/font"
import { hpack } from "../../layout/pack"
import type { Node } from "../../layout/nodes"
import type { MathData } from "../../mathlayout/data"
import { mlistToHlist, TEXT } from "../../mathlayout/mlist"
import { parseMath } from "../../mathlayout/parse"
import { compareBoxLists, type BoxNode } from "../../trace/schema"
import { classData } from "../classes"
import { dataFont } from "../fonts"
import { texEnv } from "../tex"
import { parseBoxDump } from "./boxes"

const DIR = ".cache/mathcheck"
const SPECIAL = new Set([..."#$%&\\^_{}~'"].map((c) => c.charCodeAt(0)))
const OPERATORS = ["sum", "prod", "int", "oint", "bigcup", "coprod"]
const STYLES = ["displaystyle", "textstyle", "scriptstyle", "scriptscriptstyle"]

/** A formula as a tree: what the generator draws, printed for TeX and built for the engine. */
type Nucleus =
  | { kind: "char"; code: number } | { kind: "sym"; name: string }
  | { kind: "group"; items: Item[] } | { kind: "frac"; num: Item[]; den: Item[] }
  | { kind: "op"; name: string; limits?: "limits" | "nolimits" }
type Script = { kind: "char"; code: number } | { kind: "sym"; name: string } | { kind: "group"; items: Item[] }
type Item =
  | { kind: "atom"; nucleus: Nucleus | null; sup?: Script; sub?: Script; primes: number; subFirst: boolean }
  | { kind: "style"; style: number }

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function generator(r: () => number, pool: number[], busy: number[], symbols: string[]) {
  const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)]
  const char = (): Nucleus & Script => (r() < 0.15 ? { kind: "sym", name: pick(symbols) } : { kind: "char", code: r() < 0.45 ? pick(busy) : pick(pool) })
  const script = (depth: number): Script => (depth < 3 && r() < 0.3 ? { kind: "group", items: list(depth + 1, 3) } : char())
  const nucleus = (depth: number): Nucleus => {
    const x = r()
    if (depth < 3 && x < 0.12) return { kind: "group", items: list(depth + 1, 3) }
    if (depth < 3 && x < 0.2) return { kind: "frac", num: list(depth + 1, 3), den: list(depth + 1, 3) }
    if (x < 0.28) return { kind: "op", name: pick(OPERATORS), limits: r() < 0.3 ? "limits" : r() < 0.2 ? "nolimits" : undefined }
    return char()
  }
  // a bare script (empty nucleus) only where TeX inserts a dummy noad: at the start of a list or after a style change
  const list = (depth: number, max: number): Item[] => {
    const out: Item[] = []
    const n = Math.floor(r() * (max + 1))
    for (let i = 0; i < n; i++) {
      const prev = out[out.length - 1]
      if (r() < 0.08) { out.push({ kind: "style", style: 2 * Math.floor(r() * 4) }); continue }
      const bare = (!prev || prev.kind === "style") && r() < 0.1
      const primes = r() < 0.12 ? 1 + Math.floor(r() * 2) : 0
      const s = r()
      out.push({
        kind: "atom", nucleus: bare ? null : nucleus(depth), primes, subFirst: r() < 0.5,
        ...(s < 0.25 || (bare && s < 0.6) ? { sup: script(depth) } : {}),
        ...((s > 0.15 && s < 0.4) || (bare && s >= 0.6) ? { sub: script(depth) } : {}),
      })
    }
    return out
  }
  return () => list(0, 8)
}

function print(items: Item[]): string {
  const ch = (x: Nucleus | Script) => x.kind === "char" ? String.fromCharCode(x.code) + " " : x.kind === "sym" ? `\\${x.name} ` : ""
  const arg = (s: Script) => (s.kind === "group" ? `{${print(s.items)}}` : ch(s))
  return items.map((it) => {
    if (it.kind === "style") return `\\${STYLES[it.style / 2]} `
    const n = it.nucleus
    let out = !n ? "" : n.kind === "group" ? `{${print(n.items)}}` : n.kind === "frac" ? `\\frac{${print(n.num)}}{${print(n.den)}}`
      : n.kind === "op" ? `\\${n.name}${n.limits ? `\\${n.limits}` : ""} ` : ch(n)
    const sup = it.sup ? `^${arg(it.sup)}` : "", sub = it.sub ? `_${arg(it.sub)}` : ""
    const primes = "'".repeat(it.primes)
    out += it.subFirst ? sub + primes + sup : primes + sup + sub
    return out
  }).join("")
}

export function mathCheck(n: number, seed: number): number {
  mkdirSync(DIR, { recursive: true })
  const data = JSON.parse(readFileSync("lib/latex/data/math/latex.json", "utf8")) as MathData
  const pool = Array.from({ length: 94 }, (_, i) => 33 + i).filter((c) => !SPECIAL.has(c) && data.mathcodes[c] < 0x8000)
  const r = rng(seed)
  // operators and punctuation weigh more, so spacing and rule 5 come up often
  const busy = pool.filter((c) => (data.mathcodes[c] >> 12) !== 7 && (data.mathcodes[c] >> 12) !== 0)
  const symbols = Object.keys(data.symbols).filter((x) => (data.symbols[x] >> 12) !== 1) // big operators come as nuclei
  const gen = generator(r, pool, busy, symbols)
  let failed = 0, total = 0
  const seen = new Map<string, number>()
  for (const option of ["10pt", "11pt", "12pt"]) {
    const k = classData("article", option)
    const m = k.sizes.normalsize.math
    const fonts = [m.text, m.script, m.scriptscript].map((size) => size.map((f) => loadFont(dataFont(f.name), f.at)))
    const cases = Array.from({ length: Math.ceil(n / 3) }, () => ({ style: Math.floor(r() * 4) * 2, items: gen() }))
    writeFileSync(join(DIR, `math-${option}.tex`), [
      `\\documentclass[${option}]{article}`, "\\showboxdepth=100 \\showboxbreadth=100000", "\\begin{document}",
      ...cases.map((c) => `\\setbox0\\hbox{$\\${STYLES[c.style / 2]} ${print(c.items)}$}\\showbox0`), "\\end{document}", "",
    ].join("\n"))
    const run = spawnSync("latex", ["-interaction=nonstopmode", `math-${option}.tex`], { cwd: DIR, env: texEnv({ max_print_line: "100000" }), stdio: "ignore", timeout: 300_000 })
    if (run.error) throw run.error
    const log = readFileSync(join(DIR, `math-${option}.log`), "latin1")
    const err = log.match(/^! (?!OK\.).*$/m)
    if (err) throw new Error(`TeX error in ${DIR}/math-${option}.log: ${err[0]}`)
    const lines = log.split("\n")
    const boxes: BoxNode[] = []
    for (let i = 0; i < lines.length; i++) if (lines[i] === "> \\box0=") { const { box, end } = parseBoxDump(lines, i + 1); boxes.push(box); i = end }
    if (boxes.length !== cases.length) throw new Error(`TeX showed ${boxes.length} boxes for ${cases.length} formulas (${DIR}/math-${option}.log)`)
    const count = (b: BoxNode) => {
      if (b.type === "glue" && b.param) seen.set(b.param, (seen.get(b.param) ?? 0) + 1)
      if (b.type === "rule") seen.set("fraction rule", (seen.get("fraction rule") ?? 0) + 1)
      if (b.type === "hbox" || b.type === "vbox") { if (b.shift) seen.set("shifted box", (seen.get("shifted box") ?? 0) + 1); b.children.forEach(count) }
    }
    cases.forEach((c, i) => {
      total++
      const hl = mlistToHlist(parseMath(`\\${STYLES[c.style / 2]} ${print(c.items)}`, data), {
        fonts, muskips: data.muskips as never, binoppenalty: data.ints.binoppenalty, relpenalty: data.ints.relpenalty,
        scriptspace: data.dimens.scriptspace, nulldelimiterspace: data.dimens.nulldelimiterspace,
      }, TEXT, false)
      const list: Node[] = [{ kind: "math", on: true, width: data.dimens.mathsurround }, ...hl, { kind: "math", on: false, width: data.dimens.mathsurround }]
      const engine = emitBoxes(hpack(list))
      const tex = boxes[i]
      count(tex)
      const d = compareBoxLists([tex], [engine])
      if (!d) return
      failed++
      if (failed <= 8) console.log(`✗ [${option}] $\\${STYLES[c.style / 2]} ${print(c.items)}$: ${d.path} ${d.field}\n    TeX:    ${JSON.stringify(d.expected)}\n    engine: ${JSON.stringify(d.actual)}`)
    })
  }
  console.log(`${total - failed}/${total} formulas identical to TeX (seed ${seed}; ${[...seen].map(([k, v]) => `${k} ×${v}`).join(", ")})`)
  return failed ? 1 : 0
}
