// Document expansion oracle (#46): random documents that define macros with
// \newcommand (arguments, optional arguments, starred), \renewcommand,
// \providecommand, \def (undelimited and delimited parameters), \edef and \let (of macros and of characters),
// in and out of groups, and use them in text and math around spaces, line ends
// and blank lines. TeX typesets each document twice: as written, and as
// expandDocument (expand/document.ts) rewrites it for the renderer, with the
// definitions removed and every use expanded. The DVI must be identical.
//   bun engine expand:doc [--n 300] [--seed 1]

import { spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { expandDocument } from "../../expand/document"
import { compareTraces } from "../../trace/schema"
import { texEnv } from "../tex"
import { parseDvi } from "./dvi"
import { loadTfm } from "./oracle"

const DIR = ".cache/expanddoc"
const WORDS = "alpha beta gamma delta lemma proof field ring group space vector basis norm limit series".split(" ")

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

/** A macro the generator defined; `safe` if \\edef can expand it and math can hold it (no robust LaTeX commands, no $). */
interface Def { name: string; args: number; optional: boolean; delim?: string; long: boolean; safe: boolean }

function makeCase(r: () => number, id: string): string {
  const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)]
  const defs: Def[] = []
  const lines: string[] = []
  const name = (i: number) => `\\zz${id}${String.fromCharCode(97 + i)}`
  const word = () => pick(WORDS)
  // a body: words, parameters, font commands, math, and calls to earlier macros
  const body = (args: number, calls = true): string => {
    const parts: string[] = []
    for (let k = 1 + Math.floor(r() * 4); k > 0; k--) {
      const x = r()
      if (args && x < 0.35) parts.push(pick([`#${1 + Math.floor(r() * args)}`, `\\textbf{#${1 + Math.floor(r() * args)}}`, `$#${1 + Math.floor(r() * args)}^2$`]))
      else if (calls && defs.length && x < 0.55) parts.push(call(pick(defs), false))
      else if (x < 0.65) parts.push(`\\emph{${word()}}`)
      else if (x < 0.7) parts.push("$x+y$")
      else parts.push(word())
    }
    const sep = pick([" ", " ", ""])
    return parts.reduce((acc, x) => acc + (acc && (sep || (/\\[A-Za-z]+$/.test(acc) && /^[A-Za-z]/.test(x))) ? sep || " " : "") + x, "")
  }
  // a use: the macro and its arguments, as text
  const safeIn = (b: string) => !/\\(textbf|emph|textit)\b|\$/.test(b) && defs.every((e) => e.safe || !b.includes(e.name))
  const arg = (plain = false) => plain ? `{${word()}}` : pick([`{${word()} ${word()}}`, `{${word()}}`, "x", `{\\textit{${word()}}}`, ...(defs.some((d) => d.args === 0 && d.safe && !d.delim) ? [call(pick(defs.filter((d) => d.args === 0 && d.safe && !d.delim)), false)] : [])])
  const call = (d: Def, spaced: boolean, plain = false): string => {
    let s = d.name
    if (d.delim) return `${s} ${word()} ${word()}${d.delim}`
    let n = d.args
    if (d.optional) { if (r() < 0.5) s += (spaced && r() < 0.5 ? " " : "") + `[${word()}]`; n-- }
    for (let k = 0; k < n; k++) {
      const a = arg(plain)
      s += (spaced && r() < 0.3) || (/\\[A-Za-z]+$/.test(s) && /^[A-Za-z]/.test(a)) ? " " + a : a
    }
    return s
  }
  for (let i = 0, n = 2 + Math.floor(r() * 5); i < n; i++) {
    const nm = name(i)
    const x = r()
    let d: Def
    if (x < 0.45) {
      const args = Math.floor(r() * 4), optional = args > 0 && r() < 0.4, star = r() < 0.3
      const b = body(args)
      d = { name: nm, args, optional, long: !star, safe: safeIn(b) && !optional } // \\@protected@testopt breaks in a plain \\edef
      lines.push(`\\newcommand${star ? "*" : ""}${r() < 0.5 ? `{${nm}}` : nm}${args ? `[${args}]` : ""}${optional ? `[${word()}]` : ""}{${b}}`)
    } else if (x < 0.6) {
      const args = Math.floor(r() * 3)
      const b = body(args)
      d = { name: nm, args, optional: false, long: false, safe: safeIn(b) }
      lines.push(`\\def${nm}${Array.from({ length: args }, (_, k) => `#${k + 1}`).join("")}{${b}}`)
    } else if (x < 0.7) {
      d = { name: nm, args: 1, optional: false, long: false, delim: ".", safe: true }
      lines.push(`\\def${nm}#1.{[#1]}`)
    } else if (x < 0.8 && defs.length) {
      const src = pick(defs)
      d = { ...src, name: nm }
      lines.push(`\\let${nm}${r() < 0.5 ? "=" : ""}${src.name}`)
    } else if (x < 0.88 && defs.some((e) => !e.delim)) {
      const old = pick(defs.filter((e) => !e.delim))
      const b = body(old.args, false) // no calls: they could lead back to the macro itself
      old.safe = safeIn(b)
      lines.push(`\\renewcommand{${old.name}}${old.args ? `[${old.args}]` : ""}${old.optional ? `[${word()}]` : ""}{${b}}`)
      continue
    } else if (x < 0.94) {
      const b = body(0)
      d = { name: nm, args: 0, optional: false, long: true, safe: safeIn(b) }
      lines.push(`\\providecommand{${nm}}{${b}}`)
      if (defs.length && r() < 0.5) lines.push(`\\providecommand{${pick(defs).name}}{never used}`)
    } else if (x < 0.97) {
      const c = pick([..."afilx-.,"]) // a letter or other character: \\nm is that character
      d = { name: nm, args: 0, optional: false, long: false, safe: true }
      lines.push(`\\let${nm}${pick(["=", "= ", " "])}${c}`)
    } else {
      d = { name: nm, args: 0, optional: false, long: false, safe: true }
      const ok = defs.filter((e) => !e.optional && e.safe)
      lines.push(`\\edef${nm}{${ok.length ? call(pick(ok), false, true) : "\\relax"} ${word()}}`)
    }
    defs.push(d)
    if (r() < 0.2) lines[lines.length - 1] += pick([" ", "  "]) + word() // text after the definition on its line
    // uses after each definition: in text around spaces, line ends, punctuation and blank lines; in math
    for (let u = 1 + Math.floor(r() * 3); u > 0; u--) {
      const use = pick(defs)
      const after = pick([" " + word(), "{} " + word(), ", " + word(), "\n" + word(), "\n\n" + word(), "  " + word(), "."])
      lines.push(r() < 0.15 && !use.delim && use.safe ? `$${call(use, true, true)}$ ${word()}` : `${word()} ${call(use, true)}${after}`)
    }
    // a group: a local redefinition, used inside and then outside
    if (r() < 0.15) { const g = pick(defs.filter((e) => e.args === 0 && !e.delim).concat([d])); if (g.args === 0 && !g.delim) lines.push(`{\\renewcommand{${g.name}}{local ${word()}}${g.name} ${word()}} ${g.name} ${word()}`) }
  }
  return lines.join("\n")
}

export function expandDocCheck(n: number, seed: number): number {
  mkdirSync(DIR, { recursive: true })
  const r = rng(seed)
  const id = (i: number) => i.toString(26).split("").map((d) => String.fromCharCode(97 + parseInt(d, 26))).join("")
  const cases = Array.from({ length: n }, (_, i) => makeCase(r, id(i)))
  const doc = ["\\documentclass{article}", "\\pagestyle{empty}", "\\begin{document}", cases.join("\n\\clearpage\n"), "\\end{document}", ""].join("\n")
  const { text, errors } = expandDocument(doc)
  if (errors.length) { console.log(`✗ expansion errors: ${errors.slice(0, 3).join("; ")}`); return 1 }
  const traces = [["original", doc], ["expanded", text]].map(([name, src]) => {
    writeFileSync(join(DIR, `${name}.tex`), src)
    const run = spawnSync("latex", ["-interaction=nonstopmode", `${name}.tex`], { cwd: DIR, env: texEnv(), stdio: "ignore", timeout: 300_000 })
    if (run.error) throw run.error
    const log = readFileSync(join(DIR, `${name}.log`), "latin1")
    const err = log.match(/^! .*$/m)
    if (err) throw new Error(`TeX error in ${DIR}/${name}.log: ${err[0]}`)
    return parseDvi(new Uint8Array(readFileSync(join(DIR, `${name}.dvi`))), loadTfm)
  })
  const [tex, ours] = traces
  if (tex.pages.length !== n) throw new Error(`expected ${n} pages, TeX made ${tex.pages.length}`)
  let failed = 0
  for (let p = 0; p < n; p++) {
    const d = compareTraces({ ...tex, pages: [tex.pages[p]] }, { ...ours, pages: [ours.pages[p] ?? { counts: [], glyphs: [], rules: [], specials: [] }] })
    if (!d) continue
    failed++
    if (failed <= 3) console.log(`✗ case ${p + 1}: ${d.field} at glyph ${d.index}\n${cases[p]}\n--- expanded ---\n${expandDocument(["\\begin{document}", cases[p]].join("\n")).text}\n`)
  }
  const defs = (doc.match(/\\(newcommand|renewcommand|providecommand|def|edef|let)\b/g) ?? []).length
  console.log(`${n - failed}/${n} documents typeset identically after expansion (seed ${seed}; ${defs} definitions, ${tex.pages.reduce((s, p) => s + p.glyphs.length, 0)} glyphs)`)
  return failed ? 1 : 0
}
