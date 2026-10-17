// Expansion oracle (#46, #47): seeded random macro programs run by TeX and by
// the engine's expander (expand/). For each, \detokenize of an \edef result and
// \meaning of every macro must be identical.
//   bun engine expand:check [--n 3000] [--seed 1]

import { spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Expander, ExpansionError } from "../../expand/expander"
import { showTokens, Tokenizer } from "../../expand/tokens"
import { texEnv } from "../tex"

const DIR = ".cache/expand"
const NAMES = ["zza", "zzb", "zzc", "zzd", "zze", "zzf"]
// names that are \relax in every case, so a stray expansion never meets an undefined control sequence
const RELAXED = ["zzq", "zzr", "zzstart", "zzend"]

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

/** A parameter text as items: a literal, or parameter k with the delimiter text after it ("" = undelimited, "{" = #{). */
type PItem = { lit: string } | { k: number; delim: string }
interface MacroSpec { name: string; items: PItem[]; body: string; long: boolean }

export function makeCase(r: () => number): { text: string; macros: string[] } {
  const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)]
  const word = () => Array.from({ length: 1 + Math.floor(r() * 3) }, () => pick([..."abcxyz"])).join("")
  // a control sequence followed by a letter needs a space between them
  const cat = (...parts: string[]) => parts.reduce((a, b) => a + (/\\[a-zA-Z]+$/.test(a) && /^[a-zA-Z]/.test(b) ? " " : "") + b, "")
  const macros: MacroSpec[] = []

  const argText = (depth: number): string => cat(...Array.from({ length: Math.floor(r() * 3) }, () =>
    pick([word, () => " ", () => (depth < 2 ? "{" + argText(depth + 1) + "}" : word())])()))
  /** a call of macro m with arguments that fit its parameter text */
  const call = (m: MacroSpec): string => {
    let out = "\\" + m.name
    for (const it of m.items) {
      if ("lit" in it) { out = cat(out, it.lit); continue }
      if (it.delim === "") out = cat(out, pick([" ", ""]), r() < 0.5 ? "{" + argText(1) + "}" : pick([..."pqr"]))
      else if (it.delim === "{") out = cat(out, argText(2), "{", word(), "}")
      else out = cat(out, r() < 0.2 ? "{" + argText(1) + "}" : argText(2), it.delim)
    }
    return out
  }
  const piece = (avail: MacroSpec[], nParams: number, depth: number): string => {
    const opts: (() => string)[] = [word, word, () => " ",
      () => (depth < 2 ? "{" + pieces(avail, nParams, depth + 1) + "}" : word()),
      () => `\\ifnum ${Math.floor(r() * 20)}${pick(["<", "=", ">"])}${Math.floor(r() * 20)} Y\\else N\\fi`,
      () => `\\number ${pick(["007", "42", "-3", "0"])} `,
      () => `\\string\\${pick(NAMES)}`,
      () => cat("\\string", pick(["~", "\\#", "x"])),
    ]
    if (nParams) opts.push(() => "#" + (1 + Math.floor(r() * nParams)), () => "#" + (1 + Math.floor(r() * nParams)))
    if (avail.length) {
      opts.push(() => call(pick(avail)), () => call(pick(avail)), () => `\\noexpand\\${pick(avail).name}`,
        () => `\\ifx\\${pick(avail).name}\\${pick(avail).name} T\\else F\\fi`,
        () => `\\unexpanded{\\${pick(avail).name}${word()}}`)
      const zero = avail.filter((m) => m.items.length === 0)
      if (zero.length) opts.push(() => `\\csname ${pick(zero).name}\\endcsname`)
      const one = avail.filter((m) => m.items.length === 1 && "k" in m.items[0] && m.items[0].delim === "")
      if (one.length) opts.push(() => `\\expandafter\\${pick(one).name}\\csname ${pick(RELAXED)}\\endcsname`)
    }
    return pick(opts)()
  }
  const pieces = (avail: MacroSpec[], nParams: number, depth: number) => cat(...Array.from({ length: 1 + Math.floor(r() * 4) }, () => piece(avail, nParams, depth)))

  const n = 2 + Math.floor(r() * 4)
  for (let i = 0; i < n; i++) {
    const items: PItem[] = []
    if (r() < 0.2) items.push({ lit: pick(["<", "\\zzstart", "!"]) })
    const k = Math.floor(r() * 4)
    for (let j = 1; j <= k; j++) {
      const delim = j === k && r() < 0.15 ? "{" : r() < 0.45 ? pick([".", ";", "\\zzend", "|", "::"]) : ""
      items.push({ k: j, delim })
      if (delim === "{") break
    }
    const spec: MacroSpec = { name: NAMES[i], items, body: pieces(macros.slice(), items.filter((x) => "k" in x).length, 0), long: r() < 0.1 }
    if (i > 0 && r() < 0.1) { spec.items = macros[i - 1].items; spec.body = macros[i - 1].body; spec.long = macros[i - 1].long } // identical twins for \ifx
    macros.push(spec)
  }
  const defText = (m: MacroSpec) => {
    let p = ""
    for (const it of m.items) {
      if ("lit" in it) p = cat(p, it.lit)
      else if (it.delim === "{") p = cat(p, `#${it.k}#`) // #{: the brace that opens the body is also the last delimiter
      else p = cat(p, `#${it.k}`, it.delim)
    }
    return `${m.long ? "\\long" : ""}\\def\\${m.name}${p}{${m.body}}`
  }
  const lets = r() < 0.3 ? [`\\let\\zzg=\\${pick(macros).name}`, `\\let\\zzh= ${pick([..."ab"])}`] : []
  const result = cat(...Array.from({ length: 1 + Math.floor(r() * 4) }, () => piece(macros, 0, 0)), lets.length ? `\\ifx\\zzg\\${pick(macros).name} G\\fi` : "")
  const names = [...macros.map((m) => m.name), ...(lets.length ? ["zzg", "zzh"] : [])]
  const relax = [...RELAXED, ...NAMES.slice(n)].map((x) => `\\let\\${x}\\relax`)
  return { text: [...relax, ...macros.map(defText), ...lets, `\\edef\\zzresult{${result}}`].join(""), macros: names }
}

interface Outcome { result: string; meanings: string[] }

function engine(text: string, names: string[]): Outcome | { error: string } {
  try {
    const x = new Expander(new Tokenizer(text), 2_000_000)
    x.run()
    const m = x.meaningOf("zzresult")
    if (m.kind !== "macro") return { error: "no \\zzresult" }
    const result = showTokens(m.body.map((b) => ("tok" in b ? b.tok : { cat: 12, c: 63 })))
    return { result, meanings: names.map((n) => x.printMeaning({ cs: n })) }
  } catch (e) {
    if (e instanceof ExpansionError) return { error: e.message }
    throw e
  }
}

export function expandCheck(n: number, seed: number): number {
  // a macro that never stops expanding must end in a diagnostic, not a hang
  const t0 = Date.now()
  const loop = engine("\\def\\zzloop{a\\zzloop}\\edef\\zzresult{\\zzloop}", [])
  if (!("error" in loop) || !/fuel/.test(loop.error) || Date.now() - t0 > 5000) { console.log("✗ a self-recursive macro did not stop with a fuel diagnostic"); return 1 }

  mkdirSync(DIR, { recursive: true })
  const r = rng(seed)
  const cases = Array.from({ length: n }, () => makeCase(r))
  const lines = cases.map((c, i) => `\\begingroup ${c.text}\\immediate\\write16{C:${i}}\\immediate\\write16{R:[\\detokenize\\expandafter{\\zzresult}]}` +
    c.macros.map((m) => `\\immediate\\write16{M:\\meaning\\${m}}`).join("") + "\\endgroup")
  writeFileSync(join(DIR, "expand.tex"), ["\\documentclass{article}", "\\begin{document}", ...lines, "\\end{document}", ""].join("\n"))
  const run = spawnSync("latex", ["-interaction=nonstopmode", "expand.tex"], { cwd: DIR, env: texEnv({ max_print_line: "1000000" }), stdio: "ignore", timeout: 300_000 })
  if (run.error) throw run.error
  const log = readFileSync(join(DIR, "expand.log"), "latin1").split("\n")
  const tex: (Outcome & { errors: string[] })[] = []
  let cur: (Outcome & { errors: string[] }) | null = null
  for (const line of log) {
    let m: RegExpMatchArray | null
    if ((m = line.match(/^C:(\d+)$/))) { cur = { result: "", meanings: [], errors: [] }; tex[Number(m[1])] = cur; continue }
    if (!cur) continue
    if ((m = line.match(/^R:\[(.*)\]$/))) cur.result = m[1]
    else if ((m = line.match(/^M:(.*)$/))) cur.meanings.push(m[1])
  }
  // TeX errors before the C: marker belong to the case on that input line
  const errLines = log.filter((l) => l.startsWith("! ")).length
  let failed = 0, texErrors = 0
  cases.forEach((c, i) => {
    const t = tex[i]
    const e = engine(c.text, c.macros)
    if (!t) { texErrors++; return }
    const same = !("error" in e) && e.result === t.result && e.meanings.join("\n") === t.meanings.join("\n")
    if (same) return
    failed++
    if (failed <= 6) console.log(`✗ case ${i}: ${c.text}\n    TeX:    ${JSON.stringify({ result: t.result, meanings: t.meanings })}\n    engine: ${JSON.stringify(e)}`)
  })
  console.log(`${n - failed - texErrors}/${n} macro programs identical to TeX (seed ${seed})${texErrors ? `; ${texErrors} not run by TeX` : ""}${errLines ? `; TeX reported ${errLines} errors` : ""}`)
  return failed || texErrors || errLines ? 1 : 0
}
