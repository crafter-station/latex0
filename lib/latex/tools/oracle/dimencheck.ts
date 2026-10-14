// Dimension oracle (#52): seeded random numbers, dimensions and glue, scanned
// by TeX and by the engine (layout/dimen.ts). Each case must agree on the value
// in sp, on TeX's error messages, and on exactly what was left unscanned
// (\afterassignment captures the remainder).
//   bun engine dimen:check [--n 5000] [--seed 1]

import { spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { UNITY } from "../../layout/arith"
import { Scanner, type GlueSpec, type Internal, type ScanEnv } from "../../layout/dimen"
import { loadFont, QUAD, X_HEIGHT } from "../../layout/font"
import { dataFont } from "../fonts"
import { texEnv } from "../tex"

type Kind = "int" | "dimen" | "glue"
interface Case { kind: Kind; input: string }

// Registers the document sets before the cases; the engine sees the same values.
const DIMEN: Record<number, number> = { 1: 3.25 * UNITY, 2: -7.5 * UNITY }
const COUNT: Record<number, number> = { 1: 7, 2: -3 }
const SKIP: Record<number, GlueSpec> = { 1: { width: UNITY, stretch: 2 * UNITY, stretchOrder: 1, shrink: 3 * UNITY, shrinkOrder: 0 } }
const PREAMBLE = "\\dimen1=3.25pt \\dimen2=-7.5pt \\count1=7 \\count2=-3 \\skip1=1pt plus 2fil minus 3pt"

function env(mag: number): ScanEnv {
  const f = loadFont(dataFont("cmr10"), 10 * UNITY)
  const reg = <T>(table: Record<number, T>, s: Scanner): T => table[s.scanInt().value] ?? (0 as T)
  return {
    em: f.params[QUAD], ex: f.params[X_HEIGHT], mag,
    internal: (name, s): Internal | undefined => {
      if (name === "dimen") return { level: "dimen", value: reg(DIMEN, s) }
      if (name === "count") return { level: "int", value: reg(COUNT, s) }
      if (name === "skip") return { level: "glue", value: reg(SKIP, s) ?? { width: 0, stretch: 0, stretchOrder: 0, shrink: 0, shrinkOrder: 0 } }
      if (name === "parindent") return { level: "dimen", value: 15 * UNITY }
      return undefined
    },
  }
}

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

export function makeCases(n: number, seed: number): Case[] {
  const r = rng(seed)
  const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)]
  const digits = (k: number) => Array.from({ length: k }, () => String(Math.floor(r() * 10))).join("")
  const sign = () => pick(["", "", "", "-", "+", "--", " -", "- ", "-+-", " "])
  const number = (): string => pick([
    () => digits(1 + Math.floor(r() * 3)),
    () => digits(1 + Math.floor(r() * 3)) + pick([".", ","]) + digits(Math.floor(r() * 8)),
    () => pick(["", "0"]) + pick([".", ","]) + digits(1 + Math.floor(r() * 20)),
    () => digits(4 + Math.floor(r() * 7)) + (r() < 0.5 ? "." + digits(Math.floor(r() * 4)) : ""),
    () => "16383." + pick(["99998", "99999", "999999", "9999847", "99998474121"]),
    () => pick(["'17", "'777", '"1F', '"A', '"FFFFFFF', "`a", "`\\A", "`.", "`\\count1", "`\\dimen2"]),
    () => pick(["\\count1", "\\count2", "\\dimen1", "\\dimen2", "\\parindent", "\\skip1"]),
    () => pick([".", "", "1.5.5"]),
  ])()
  const unit = (inf: boolean): string => {
    const u = pick(["pt", "pt", "in", "pc", "cm", "mm", "bp", "dd", "cc", "nd", "nc", "sp", "em", "ex", "px", "true pt", "true cm", "PT", "Cm", "\\dimen1", "\\dimen2", "\\count1", "\\parindent", "\\skip1", "p", "xy", "", "e", "tru"])
    const fil = pick(["fil", "fill", "filll", "fillll", "FIL", "fi"])
    return (r() < 0.25 ? " " : "") + (inf && r() < 0.4 ? fil : u)
  }
  // never glue letters onto a control word: that makes an undefined control
  // sequence, which is expansion's business, not the scanner's
  const cat = (...parts: string[]) => parts.reduce((a, b) => a + (/\\[a-zA-Z]+$/.test(a) && /^[a-zA-Z]/.test(b) ? " " : "") + b, "")
  const tail = () => pick(["", "", "", " x", "x", "  y", ".5", " plus"])
  const dimen = (inf = false) => cat(sign(), number(), unit(inf))
  const out: Case[] = []
  for (let i = 0; i < n; i++) {
    const kind: Kind = pick(["int", "dimen", "dimen", "dimen", "glue", "glue"])
    let input: string
    if (kind === "int") input = cat(sign(), pick([() => digits(1 + Math.floor(r() * 11)), number])(), tail())
    else if (kind === "dimen") input = cat(dimen(), tail())
    else {
      input = dimen()
      if (r() < 0.6) input = cat(input, pick([" plus ", " plus", "plus ", " PLUS "]), dimen(true))
      if (r() < 0.5) input = cat(input, pick([" minus ", " minus", " MINUS "]), dimen(true))
      input = cat(input, tail())
    }
    out.push({ kind, input: input.replace(/\s+/g, " ").trimEnd() })
  }
  return out
}

/**
 * Fixed edge cases: exact half-sp decimals (k + ½)/65536, which need all 17
 * digits TeX keeps (§ 452), with their 16- and 18-digit neighbours, and the
 * largest dimensions.
 */
export function edgeCases(): Case[] {
  const out: Case[] = []
  for (const k of [0, 1, 2, 1000, 32767, 65534, 65535]) {
    let r = 2 * k + 1, digits = ""
    for (let i = 0; i < 17; i++) { r *= 10; digits += Math.floor(r / 131072); r %= 131072 }
    for (const int of ["0", "1", "16383"]) {
      for (const frac of [digits, digits.slice(0, 16), digits + "9", digits.slice(0, 16) + "49"]) out.push({ kind: "dimen", input: `${int}.${frac}pt` })
    }
  }
  for (const input of ["16383.99999pt", "16384pt", "1073741823sp", "1073741824sp", "-1073741823sp", "2147483647sp", "2147483648sp", "16383.99999999pt", "8191.99999in", "1.5\\dimen1", "16383\\dimen1"]) out.push({ kind: "dimen", input })
  return out
}

/** The remainder of `src` from `pos` written as \detokenize would write it. */
function detokenized(s: Scanner): string {
  let out = ""
  for (let t = s.peek(); t; t = s.peek(t.end)) {
    if (t.cs === undefined) out += t.ch
    else out += "\\" + t.cs + (/^[a-zA-Z]/.test(t.cs) ? " " : "")
  }
  return out
}

const REG: Record<Kind, string> = { int: "\\count0", dimen: "\\dimen0", glue: "\\skip0" }
const SHOW: Record<Kind, string> = { int: "\\number\\count0", dimen: "\\number\\dimen0", glue: "\\the\\skip0" }

interface Outcome { value: string; errors: string[]; rest: string }

function texOutcomes(cases: Case[], mag: number): Outcome[] {
  const dir = ".cache/dimen"
  mkdirSync(dir, { recursive: true })
  const lines = cases.map((c, i) => `\\noindent\\immediate\\write16{C:${i}}\\afterassignment\\probe${REG[c.kind]}=${c.input}\\relax\\immediate\\write16{V:${SHOW[c.kind]}}\\par`)
  writeFileSync(join(dir, "dimen.tex"), [
    `\\mag=${mag}`, "\\documentclass{article}", "\\begin{document}", PREAMBLE,
    "\\def\\probe#1\\relax{\\immediate\\write16{R:[\\detokenize{#1}]}}",
    ...lines, "\\end{document}", "",
  ].join("\n"))
  // the cases provoke TeX errors on purpose, so TeX's exit status is not a failure
  spawnSync("latex", ["-interaction=nonstopmode", "dimen.tex"], { cwd: dir, env: texEnv({ max_print_line: "100000", error_line: "254", half_error_line: "238" }), stdio: "ignore" })
  const log = readFileSync(join(dir, "dimen.log"), "latin1").split("\n")
  const out: Outcome[] = []
  let cur: Outcome | null = null
  for (const line of log) {
    let m: RegExpMatchArray | null
    if ((m = line.match(/^C:(\d+)$/))) { cur = { value: "", errors: [], rest: "" }; out[Number(m[1])] = cur; continue }
    if (!cur) continue
    if (line.startsWith("! ")) cur.errors.push(line.slice(2).replace(/\.$/, ""))
    else if ((m = line.match(/^R:\[(.*)\]$/))) cur.rest = m[1]
    else if ((m = line.match(/^V:(.*)$/))) cur.value = m[1]
  }
  return out
}

/** print_spec (§ 178) of a glue, as \the\skip prints it. */
function showGlue(g: GlueSpec): string {
  const ord = (o: number) => (o === 0 ? "pt" : "fil" + "l".repeat(o - 1))
  const scaled = (sp: number) => {
    let out = sp < 0 ? "-" : ""
    let s = Math.abs(sp)
    out += Math.floor(s / 65536) + "."
    s = 10 * (s % 65536) + 5
    let delta = 10
    do { if (delta > 65536) s = s + 0o100000 - 50000; out += String(Math.floor(s / 65536)); s = 10 * (s % 65536); delta *= 10 } while (s > delta)
    return out
  }
  let out = scaled(g.width) + "pt"
  if (g.stretch !== 0) out += " plus " + scaled(g.stretch) + ord(g.stretchOrder)
  if (g.shrink !== 0) out += " minus " + scaled(g.shrink) + ord(g.shrinkOrder)
  return out
}

function engineOutcome(c: Case, e: ScanEnv): Outcome {
  const s = new Scanner(c.input + "\\relax", e)
  let value: string
  if (c.kind === "int") {
    const v = s.scanInt().value
    value = String(v)
  } else if (c.kind === "dimen") value = String(s.scanDimen().value)
  else value = showGlue(s.scanGlue())
  const rest = detokenized(s).replace(/\\relax $/, "")
  return { value, errors: [...s.errors], rest }
}

export function dimenCheck(n: number, seed: number): number {
  // most cases at \mag=1000; a fifth at \mag=1728 (\magstep3), where true units rescale (§ 457)
  const batches = [{ mag: 1000, cases: [...edgeCases(), ...makeCases(n - Math.floor(n / 5), seed)] }, { mag: 1728, cases: makeCases(Math.floor(n / 5), seed + 1e6) }]
  let failed = 0
  const errorKinds = new Map<string, number>()
  for (const { mag, cases } of batches) {
    const tex = texOutcomes(cases, mag)
    const e = env(mag)
    cases.forEach((c, i) => {
      const t = tex[i]
      if (!t) throw new Error(`TeX produced no outcome for case ${i} (\\mag=${mag}): ${c.input}`)
      t.errors.forEach((x) => errorKinds.set(x, (errorKinds.get(x) ?? 0) + 1))
      const a = engineOutcome(c, e)
      if (a.value === t.value && a.rest === t.rest && a.errors.join("|") === t.errors.join("|")) return
      failed++
      if (failed <= 12) console.log(`✗ ${c.kind} "${c.input}" (\\mag=${mag})\n    TeX:    ${JSON.stringify(t)}\n    engine: ${JSON.stringify(a)}`)
    })
  }
  const total = batches.reduce((t, b) => t + b.cases.length, 0)
  console.log(`${total - failed}/${total} scans identical to TeX (seed ${seed}); TeX errors exercised: ${[...errorKinds].map(([k, v]) => `${k} ×${v}`).join(", ") || "none"}`)
  return failed ? 1 : 0
}
