// pgfmath oracle (#284): seeded random expressions — numbers as typed, scientific notation, units, + − * / ^,
// unary signs, parentheses and pgf's basic functions — through TeX's \pgfmathparse and \pgfmathsetlength
// and through pgf/mathparser.ts. Each case must agree on \pgfmathresult (or the register) to the
// character and on TeX's error messages; \pgf@sys@bp cases check the fixed-point conversion.
//   bun engine pgfmath:check [--n 3000] [--seed 1]

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { printScaled, UNITY } from "../../layout/arith"
import { loadFont, QUAD, X_HEIGHT } from "../../layout/font"
import { sysBp, TexArith } from "../../pgf/fixed"
import { pgfmathParse, pgfmathSetLength, type PgfUnits } from "../../pgf/mathparser"
import { dataFont } from "../fonts"
import { texEnv } from "../tex"

type Kind = "parse" | "length" | "bp"
interface Case { kind: Kind; input: string }
interface Outcome { value: string; errors: string[] }

const DIR = ".cache/pgfmath"

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

const UNARY = ["abs", "round", "floor", "ceil", "neg", "sign", "real", "reciprocal", "ln", "exp", "log2", "log10"]
const BINARY = ["add", "subtract", "multiply", "divide", "mod", "Mod", "pow"]
const UNITS = ["pt", "pt", "cm", "mm", "in", "bp", "em", "ex", "pc", "sp", "dd", "cc", "nd", "nc", "px"]

export function makeCases(n: number, seed: number): Case[] {
  const r = rng(seed)
  const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)]
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))
  const digits = (k: number) => Array.from({ length: k }, () => String(int(0, 9))).join("")
  const sp = () => (r() < 0.15 ? " " : "")
  const whole = () => pick([() => String(int(0, 9)), () => String(int(0, 9)), () => String(int(1, 99)), () => String(int(1, 99)), () => String(int(1, 999))])()
  const frac = () => (r() < 0.1 ? digits(int(6, 12)) : digits(int(1, 5)))
  const plain = (): string => pick([
    whole, whole,
    () => `${whole()}.${frac()}`,
    () => `${whole()}.${frac()}`,
    () => `0.${frac()}`,
    () => `.${frac()}`,
    () => `${whole()}.`,
    () => `0${pick(["7", "17", "123", "0"])}`, // a leading 0 is octal
  ])()
  const scientific = () => `${pick([whole, () => `${int(0, 99)}.${frac()}`])()}${pick(["e", "E"])}${pick(["", "-", "+", "-"])}${r() < 0.1 ? int(5, 7) : int(0, 4)}`
  const dimension = () => `${r() < 0.7 ? pick([() => String(int(0, 9)), () => `${int(0, 9)}.${frac()}`, () => `.${frac()}`])() : plain()}${r() < 0.1 ? " " : ""}${pick(UNITS)}`
  const atom = (depth: number): string => {
    const x = r()
    if (depth <= 0 || x < 0.45) return pick([plain, plain, plain, scientific, dimension, dimension, () => pick(["e", "pi"])])()
    if (x < 0.6) return `(${sp()}${expr(depth - 1)}${sp()})`
    if (x < 0.8) {
      const f = pick(UNARY)
      // logarithms mostly of positive numbers, so that most stay out of pgf's error path
      if (f.startsWith("l") && r() < 0.8) return `${f}(${pick([plain, dimension])()})`
      return r() < 0.1 ? `${f} ${atom(0)}` : `${f}(${expr(depth - 1)})`
    }
    const f = pick([...BINARY, "max", "min"])
    const k = f === "max" || f === "min" ? int(2, 4) : 2
    return `${f}(${Array.from({ length: k }, () => expr(depth - 1)).join(`,${sp()}`)})`
  }
  // a quotient that comes out (nearly) whole: pgf's long division then carries into its last digit
  const exact = () => {
    const b = `${int(1, 9)}.${digits(int(1, 2))}`
    return `${(Number(b) * int(2, 40)).toFixed(int(1, 4))}/${b}`
  }
  const term = (depth: number) => `${pick(["", "", "", "", "", "-", "-", "+", "- "])}${atom(depth)}`
  const expr = (depth: number): string => {
    let out = term(depth)
    for (let k = int(0, depth > 1 ? 2 : 3); k > 0; k--) {
      const op = pick(["+", "-", "*", "/", "+", "-", "*", "/", "^"])
      // powers of small exponents, so that most stay in range
      const right = op === "^" ? pick([() => String(int(0, 5)), () => `-${int(1, 3)}`, () => `0.${digits(1)}`, () => `${int(0, 2)}.${digits(int(1, 2))}`])() : term(depth)
      out += `${sp()}${op}${sp()}${right}`
    }
    return out
  }
  const out: Case[] = []
  while (out.length < n) {
    const kind: Kind = pick(["parse", "parse", "parse", "length", "bp"])
    if (kind === "bp") { out.push({ kind, input: `${pick(["", "-"])}${plain()}${pick(UNITS)}` }); continue }
    const input = r() < 0.08 ? exact() : expr(pick([0, 1, 1, 2, 2, 3]))
    if (kind === "length" && input.startsWith("+")) continue // that is TeX's own assignment, \pgfmath@onquick
    out.push({ kind, input })
  }
  return out
}

/** Fixed cases: the fast lane, pgf's division and reciprocal branches, overflow, the edges of round/floor/ceil. */
export function edgeCases(): Case[] {
  const parse = [
    "1.50", "007", ".", "0", "1.", " 5", "5 ", "-5", "+5", "1 2", "2*-3", "-2^2", "2^-2", "2^0.5", "(1.50)", "((2))",
    "1/0", "0/0", "1/(2-2)", "7/2", "-7/2", "7/-2", "1/3", "2/3", "100/1.5", "1/0.3", "1/0.00002", "1/0.00001", "16383/0.5", "10/3.7",
    "16000+16000", "16000*2", "200*200", "-16000-16000", "16383.99999", "16384", "1e5", "1e-5", "1e9999999999", "2e - 3", "2e+ 3", "1.23456789e4", "5e-4", "3E2", "12.5e+1",
    "round(2.5)", "round(-2.5)", "round(-0.5)", "round(0.49999)", "floor(-0.5)", "floor(-2)", "floor(2.7)", "ceil(-0.5)", "ceil(2.00001)", "ceil(-2)",
    "mod(7,3)", "mod(-7,3)", "mod(7,-3)", "Mod(-7,3)", "mod(5,0)", "mod(16000,0.00002)", "max(1,2,3)", "min(3,-2,1)", "max(5)", "max(12.5)",
    "abs(-16383.99998)", "neg(-3)", "--3", "reciprocal(150.5)", "reciprocal(0.3)", "reciprocal(4)", "reciprocal(0)", "ln(1)", "ln(0)", "ln(-2)",
    "ln(10000)", "ln(0.0001)", "exp(1)", "exp(-1)", "exp(-10)", "exp(9.7)", "exp(10)", "2^10", "2^14", "2^15", "0^0", "0^2", "10^-2", "3^2.5",
    "1pt", "1cm+1mm", "2em-1ex", "1in*2", "1sp", "3.5pc", "1bp", "2dd", "1cc", "1nd", "1nc", "1px", "1 cm", "abs -3", "e", "pi*2", "e^2",
    "5560.8/2.34", "30.3005/2.81682", "19.8/5.5", "67.440/4.7925", "68/6.8", "6.2/1.24", "14/2.8", "21.9/7.3", "63.6/5.3", "34.20/3.8", "57/3.80", "46/2.3",
    "reciprocal(100.25)", "reciprocal(101.37)", "reciprocal(-0.4)", "max(-16200,-16300)", "min(16200, 16300)", "a bs(-2)", "2e3 +1",
    "max(1, 2)", "1+2*3-4/5", "2*(3+4)*5", "1-2-3", "2^3^2", "8/2/2", "add(1,2)*3", "subtract(5,7)", "multiply(2.5,4)", "divide(10,4)", "pow(2,3)",
  ]
  return [
    ...parse.map((input) => ({ kind: "parse" as const, input })),
    ...["1.5cm", "2*3", "1/3", "16000+16000", "0.5em", "1e2", "+1.5cm", "+2em"].map((input) => ({ kind: "length" as const, input })),
    ...["1pt", "-1pt", "16383.99998pt", "1sp", "72.27pt", "1in", "0.5mm"].map((input) => ({ kind: "bp" as const, input })),
  ]
}

function texOutcomes(cases: Case[]): Outcome[] {
  mkdirSync(DIR, { recursive: true })
  const show: Record<Kind, (input: string) => string> = {
    parse: (input) => `\\pgfmathparse{${input}}\\immediate\\write16{V:\\pgfmathresult}`,
    length: (input) => `\\pgfmathsetlength\\len{${input}}\\immediate\\write16{V:\\the\\len}`,
    bp: (input) => `\\pgf@x=${input}\\relax\\pgf@x=0.99627\\pgf@x\\immediate\\write16{V:\\pgf@sys@tonumber\\pgf@x}`,
  }
  const tex = [
    "\\documentclass{article}", "\\usepackage{pgf}", "\\newdimen\\len", "\\begin{document}", "\\makeatletter",
    ...cases.map((c, i) => `\\noindent\\immediate\\write16{C:${i}}${show[c.kind](c.input)}\\par`), "\\end{document}", "",
  ].join("\n")
  const file = join(DIR, "pgfmath.tex"), log = join(DIR, "pgfmath.log")
  // the same cases as last time: TeX's answers are already in the log
  if (!existsSync(file) || readFileSync(file, "utf8") !== tex || !existsSync(log)) {
    writeFileSync(file, tex)
    // the cases provoke TeX errors on purpose (division by zero, overflow), so TeX's exit status is not a failure
    const run = spawnSync("latex", ["-interaction=nonstopmode", "pgfmath.tex"], { cwd: DIR, env: texEnv({ max_print_line: "100000", error_line: "254", half_error_line: "238" }), stdio: "ignore", timeout: 300_000 })
    if (run.error) throw run.error
  }
  const out: Outcome[] = []
  let cur: Outcome | null = null
  for (const line of readFileSync(log, "latin1").split("\n")) {
    let m: RegExpMatchArray | null
    if ((m = line.match(/^C:(\d+)$/))) { cur = { value: "", errors: [] }; out[Number(m[1])] = cur; continue }
    if (!cur) continue
    if (line.startsWith("! ")) cur.errors.push(line.slice(2).replace(/\.$/, ""))
    else if ((m = line.match(/^V:(.*)$/))) cur.value = m[1]
  }
  return out
}

function engineOutcome(c: Case, units: PgfUnits): Outcome {
  try {
    if (c.kind === "bp") {
      const a = new TexArith(units)
      return { value: sysBp(a.dimen(c.input)), errors: a.errors }
    }
    if (c.kind === "length") {
      const { value, errors } = pgfmathSetLength(c.input, units)
      return { value: `${printScaled(value)}pt`, errors }
    }
    const { result, errors } = pgfmathParse(c.input, units)
    return { value: result, errors }
  } catch (e) {
    return { value: `<${(e as Error).message}>`, errors: [] }
  }
}

export function pgfmathCheck(n: number, seed: number): number {
  const f = loadFont(dataFont("cmr10"), 10 * UNITY) // \pgfmath@selectfont: the document's \normalfont
  const units: PgfUnits = { em: f.params[QUAD], ex: f.params[X_HEIGHT] }
  const cases = [...edgeCases(), ...makeCases(n, seed)]
  const tex = texOutcomes(cases)
  let failed = 0
  const errorKinds = new Map<string, number>()
  const kinds = new Map<Kind, number>()
  cases.forEach((c, i) => {
    const t = tex[i]
    if (!t) throw new Error(`TeX produced no outcome for case ${i}: ${c.input} (${DIR}/pgfmath.log)`)
    kinds.set(c.kind, (kinds.get(c.kind) ?? 0) + 1)
    t.errors.forEach((x) => { const k = x.replace(/:.*/, ""); errorKinds.set(k, (errorKinds.get(k) ?? 0) + 1) })
    const a = engineOutcome(c, units)
    if (a.value === t.value && a.errors.join("|") === t.errors.join("|")) return
    failed++
    if (failed <= 12) console.log(`✗ ${c.kind} "${c.input}"\n    TeX:    ${JSON.stringify(t)}\n    engine: ${JSON.stringify(a)}`)
  })
  console.log(`${cases.length - failed}/${cases.length} pgfmath cases identical to TeX (seed ${seed}; ${[...kinds].map(([k, v]) => `${k} ×${v}`).join(", ")}); TeX errors exercised: ${[...errorKinds].map(([k, v]) => `${k} ×${v}`).join(", ") || "none"}`)
  return failed ? 1 : 0
}
