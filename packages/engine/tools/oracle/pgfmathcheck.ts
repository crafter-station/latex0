// pgfmath oracle (#284, #286): seeded random expressions — numbers as typed, scientific notation, units,
// + − * / ^, unary signs, parentheses, comparisons, logic, ?:, postfix r and !, pgf's basic, trigonometric
// and misc functions — through TeX's \pgfmathparse and \pgfmathsetlength and through pgf/mathparser.ts.
// Each case must agree on \pgfmathresult (or the register) to the character and on TeX's error messages;
// \pgf@sys@bp cases check the fixed-point conversion, point cases pgfcorepoints (pgf/points.ts).
//   bun engine pgfmath:check [--n 3000] [--seed 1]

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { printScaled, UNITY } from "../../layout/arith"
import { loadFont, QUAD, X_HEIGHT } from "../../layout/font"
import { sysBp, TexArith } from "../../pgf/fixed"
import { pgfmathParse, pgfmathSetLength, type PgfUnits } from "../../pgf/mathparser"
import { pointLineAtDistance, pointNormalised } from "../../pgf/points"
import { dataFont } from "../fonts"
import { texEnv } from "../tex"

/** point: `x,y` for \pgfpointnormalised; `d;x1,y1;x2,y2` for \pgfpointlineatdistance (dimensions as typed) */
type Kind = "parse" | "length" | "bp" | "point"
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

const UNARY = [
  "abs", "round", "floor", "ceil", "neg", "sign", "real", "reciprocal", "ln", "exp", "log2", "log10",
  "sin", "cos", "tan", "sec", "cosec", "cot", "atan", "deg", "rad", "not",
]
const BINARY = [
  "add", "subtract", "multiply", "divide", "mod", "Mod", "pow", "veclen", "atan2",
  "greater", "less", "equal", "notequal", "notless", "notgreater", "and", "or", "approxequalto",
]
const COMPARE = ["<", ">", "==", "!=", "<=", ">=", "&&", "||", "< =", "= ="]
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
    if (x < 0.66) {
      // the functions whose domain is bounded, with arguments inside it (and at its edges)
      const unit = () => pick(["0", "1", "-1", `0.${frac()}`, `-0.${frac()}`, `.${digits(1)}`, "0.99999", "-0.00001"])
      return pick([
        () => `${pick(["asin", "acos"])}(${unit()})`,
        () => `sqrt(${pick([plain, plain, dimension, () => `abs(${expr(depth - 1)})`])()})`,
        () => `factorial(${int(0, 13)})`,
        () => `(${int(0, 9)}!)`, // bare, a following == would make it !=
        () => `${pick([plain, () => `(${expr(depth - 1)})`])()}${sp()}r`,
        () => `${pick(["sin", "cos", "tan", "atan"])}(${pick([() => String(int(-4, 4) * 90), () => `${int(-400, 400)}.${frac()}`, () => String(pick([45, 30, 60, 180, 270, 360, 720, -90]))])()})`,
        () => `!${atom(depth - 1)}`,
        () => pick(["true", "false"]),
      ])()
    }
    if (x < 0.72) return `(${expr(depth - 1)}${sp()}${pick(COMPARE)}${sp()}${expr(depth - 1)})`
    if (x < 0.76) return `(${expr(depth - 1)}${sp()}?${sp()}${expr(depth - 1)}${sp()}:${sp()}${expr(depth - 1)})`
    if (x < 0.86) {
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
    const kind: Kind = pick(["parse", "parse", "parse", "parse", "length", "bp", "point"])
    if (kind === "bp") { out.push({ kind, input: `${pick(["", "-"])}${plain()}${pick(UNITS)}` }); continue }
    if (kind === "point") {
      const coord = () => pick([() => "0pt", () => `${pick(["", "-"])}${int(0, 9)}.${frac()}pt`, () => `${pick(["", "-"])}${whole()}pt`, () => `${pick(["", "-"])}0.000${int(1, 9)}pt`, () => `${pick(["", "-"])}${plain()}${pick(UNITS)}`])()
      const pair = () => `${coord()},${coord()}`
      const d = pick([dimension, plain, () => expr(1)])()
      if (d.startsWith("+")) continue // TeX's own assignment, as for length
      out.push({ kind, input: r() < 0.5 ? pair() : `${d};${pair()};${pair()}` })
      continue
    }
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
    "sqrt(0)", "sqrt(2)", "sqrt(9.99999)", "sqrt(10)", "sqrt(99.99999)", "sqrt(100)", "sqrt(999.9)", "sqrt(1000)", "sqrt(9999.5)", "sqrt(10000)",
    "sqrt(16383.99998)", "sqrt(0.00001)", "sqrt(0.25)", "sqrt(1)", "sqrt 4", "sqrt(4)*sqrt(4)",
    "veclen(0,0)", "veclen(3,4)", "veclen(-3,-4)", "veclen(0,5)", "veclen(5,0)", "veclen(100,1)", "veclen(100.5,1)", "veclen(1000.5,0.1)",
    "veclen(10001,1)", "veclen(16000,16000)", "veclen(0.00002,0.00001)", "veclen(1,1)",
    "sin(0)", "sin(90)", "sin(180)", "sin(270)", "sin(360)", "sin(-90)", "sin(30.5)", "sin(179.99)", "sin(-0.5)", "sin(16383)", "sin(-16383.99)", "sin(-16383.99999)", "sin(-20000)",
    "approxequalto(16000,-16000)", "approxequalto(-16000,16000)", "approxequalto(16383.99999,-16383.99999)",
    "cos(0)", "cos(90)", "cos(180)", "cos(89.999)", "cos(179.5)", "cos(180.5)", "cos(-720.5)", "cos(359.99999)", "cos(16383.99998)",
    "tan(0)", "tan(45)", "tan(90)", "tan(-45.5)", "tan(89.9)", "cot(0)", "cot(45)", "cot(90)", "sec(0)", "sec(90)", "sec(60)", "cosec(0)", "cosec(30)",
    "asin(0)", "asin(1)", "asin(-1)", "asin(0.5)", "asin(0.99999)", "asin(-0.00001)", "asin(0.0005)", "acos(0)", "acos(1)", "acos(-1)", "acos(-0.70711)", "acos(0.12345)",
    "atan(0)", "atan(1)", "atan(-1)", "atan(1.00001)", "atan(0.99999)", "atan(-1000)", "atan(16383)", "atan(0.0001)", "atan(2)",
    "atan2(0,0)", "atan2(0,-1)", "atan2(0,1)", "atan2(0.0009,0)", "atan2(-0.0009,0)", "atan2(0.001,0)", "atan2(1,0)", "atan2(-1,0)", "atan2(1,1)",
    "atan2(3,-4)", "atan2(-3,-4)", "atan2(-3,4)", "atan2(4,3)", "atan2(20000,1)", "atan2(1,20000)", "atan2(-0.0009,-5)",
    "deg(pi)", "deg(1)", "deg(-2.5)", "rad(180)", "rad(-90)", "rad(1)", "2r", "pi r", "(pi/2)r", "-1r", "2r+1",
    "factorial(0)", "factorial(1)", "factorial(5)", "factorial(7)", "factorial(8)", "factorial(3.7)", "factorial(-2)", "5!", "3!+1", "2*3!", "-3!",
    "1<2", "2<1", "1>2", "1==1", "1==1.00001", "1!=2", "1!=1", "1<=1", "1>=2", "2>=2", "1&&0", "1&&2", "0||0", "1||0", "0||3",
    "!1", "!0", "!(1>2)", "!!5", "1?2:3", "0?2:3", "1>2?5:6", "1?2:0?3:4", "0?1:2?3:4", "1+2<4", "true", "false", "true+1",
    "1==1&&2==2", "1<2||2<1", "-1<0", "2<3<1", "1 < = 2", "1= =1", "(1<2)*5", "1<2*5", "approxequalto(1,1.00001)", "approxequalto(1,1.0001)",
    "greater(2,1)", "less(1,2)", "equal(1,1)", "notequal(1,1)", "notless(1,2)", "notgreater(1,2)", "and(1,0)", "or(0,0)", "not(5)", "ifthenelse(0,1,2)", "ifthenelse(1,1,2)",
    "cos(360.5)", "sin(450.5)", "cos(-360.5)", "cos(1000.3)", "sin(-725.25)", "atan2(1.234,-1.234)", "atan2(-0.7,0.7)", "atan2(5,5)",
    "veclen(3.00002,3)", "veclen(1,100)", "veclen(3,1000)", "veclen(7,10000)", "veclen(100,100)",
    "greater(1,1)", "1>1", "and(0,20000)", "0&&20000", "or(5,20000)", "1||20000", "0&&1>=0", "0&&1<=2", "0&&1!=0", "0&&1==0", "1||0<1",
    "1?(1,2):(3,4)", "0?(1,2):(3,4)", "0&&1!=1", "1||1!=1", "cos(16230.5)", "sin(-16000.7)", "cos(16383.5)",
    "max(1, 2)", "1+2*3-4/5", "2*(3+4)*5", "1-2-3", "2^3^2", "8/2/2", "add(1,2)*3", "subtract(5,7)", "multiply(2.5,4)", "divide(10,4)", "pow(2,3)",
  ]
  return [
    ...parse.map((input) => ({ kind: "parse" as const, input })),
    ...["1.5cm", "2*3", "1/3", "16000+16000", "0.5em", "1e2", "+1.5cm", "+2em"].map((input) => ({ kind: "length" as const, input })),
    ...["1pt", "-1pt", "16383.99998pt", "1sp", "72.27pt", "1in", "0.5mm"].map((input) => ({ kind: "bp" as const, input })),
    ...[
      "0pt,0pt", "1pt,0pt", "0pt,1pt", "-1pt,0pt", "0pt,-1pt", "3pt,4pt", "-3pt,-4pt", "1pt,1pt", "0.0005pt,0pt", "0pt,0.0005pt", "0pt,-0.0005pt",
      "16383pt,1pt", "1sp,1sp", "2cm,1cm", "-5pt,0.0001pt",
      "2pt;0pt,1pt;2pt,3pt", "3pt;2pt,3pt;0pt,1pt", "1cm;0pt,0pt;0pt,0pt", "5;1pt,1pt;1pt,-4pt", "2*3pt;10pt,10pt;-10pt,-10pt",
      "1pt;-16000pt,0pt;16000pt,0pt", "-2pt;0pt,0pt;3pt,4pt", "0pt;1pt,2pt;3pt,4pt", "1pt;0pt,16000pt;0pt,-16000pt", "1pt;16000pt,0pt;-16000pt,0pt", "2pt;-16000pt,-16000pt;16000pt,16000pt",
    ].map((input) => ({ kind: "point" as const, input })),
  ]
}

function texOutcomes(cases: Case[]): Outcome[] {
  mkdirSync(DIR, { recursive: true })
  const show: Record<Kind, (input: string) => string> = {
    parse: (input) => `\\pgfmathparse{${input}}\\immediate\\write16{V:\\pgfmathresult}`,
    length: (input) => `\\pgfmathsetlength\\len{${input}}\\immediate\\write16{V:\\the\\len}`,
    bp: (input) => `\\pgf@x=${input}\\relax\\pgf@x=0.99627\\pgf@x\\immediate\\write16{V:\\pgf@sys@tonumber\\pgf@x}`,
    point: (input) => {
      const pt = (s: string) => `{\\pgfqpoint{${s.split(",")[0]}}{${s.split(",")[1]}}}`
      const [d, a, b] = input.split(";")
      const call = a === undefined ? `\\pgfpointnormalised${pt(d)}` : `\\pgfpointlineatdistance{${d}}${pt(a)}${pt(b)}`
      return `${call}\\immediate\\write16{V:\\the\\pgf@x,\\the\\pgf@y}`
    },
  }
  const tex = [
    "\\documentclass{article}", "\\usepackage{pgf}", "\\newdimen\\len", "\\begin{document}", "\\makeatletter",
    ...cases.map((c, i) => `\\noindent\\immediate\\write16{C:${i}}${show[c.kind](c.input)}\\par`), "\\end{document}", "",
  ].join("\n")
  const file = join(DIR, "pgfmath.tex"), log = join(DIR, "pgfmath.log")
  // the same cases as last time: TeX's answers are already in the log
  // (and TeX finished: a run killed half way leaves a log without the later cases)
  if (!existsSync(file) || readFileSync(file, "utf8") !== tex || !existsSync(log) || !/^(No pages of output|Output written)/m.test(readFileSync(log, "latin1"))) {
    writeFileSync(file, tex)
    // the cases provoke TeX errors on purpose (division by zero, overflow), so TeX's exit status is not a failure
    const run = spawnSync("latex", ["-interaction=nonstopmode", "pgfmath.tex"], { cwd: DIR, env: texEnv({ max_print_line: "100000", error_line: "254", half_error_line: "238" }), stdio: "ignore", timeout: 1_200_000 })
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
    if (c.kind === "point") {
      const a = new TexArith(units)
      const point = (s: string) => ({ x: a.dimen(s.split(",")[0]), y: a.dimen(s.split(",")[1]) })
      const [d, p, q] = c.input.split(";")
      const { point: r, errors } = q === undefined ? pointNormalised(point(d), units) : pointLineAtDistance(d, point(p), point(q), units)
      return { value: `${printScaled(r.x)}pt,${printScaled(r.y)}pt`, errors: [...a.errors, ...errors] }
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
