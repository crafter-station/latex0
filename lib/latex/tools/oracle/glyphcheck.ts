// Glyph-run oracle (#111): words typeset by TeX in \hbox{…} and shown with
// \showbox, against the engine's main loop (layout/mainloop.ts), node by node:
// characters, ligatures (with their boundary marks), font kerns, box size.
//   1. every committed font, random words from its characters
//   2. synthetic fonts written for the check: seeded random lig/kern programs
//      with every ligature op and left/right boundary characters, which no
//      Computer Modern font has
//   bun engine glyph:check [--n 4000] [--seed 1]

import { spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { emitBoxes } from "../../emit/boxes"
import { loadFont, type FixWordFont, type Font } from "../../layout/font"
import { appendItalicCorrection, appendRun } from "../../layout/mainloop"
import type { Node } from "../../layout/nodes"
import { hpack } from "../../layout/pack"
import { compareBoxLists, type BoxNode } from "../../trace/schema"
import { dataFont } from "../fonts"
import { texEnv } from "../tex"
import { parseBoxDump } from "./boxes"
import { writeTfm } from "./tfmwrite"

const DIR = ".cache/glyphs"
const ONE = 1 << 20 // fix_word 1.0

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

const LIG_OPS = [0, 1, 2, 3, 5, 6, 7, 11]
const instr = (skip: number, next: number, op: number, rem: number) => ((skip << 24) | (next << 16) | (op << 8) | rem) >>> 0

/**
 * A random font over 16 characters A–P. Ligatures only produce characters
 * ranked above both inputs (a nonexistent right boundary ranks lowest), so
 * every program terminates, as pltotf would insist.
 */
export function synthFont(seed: number): FixWordFont {
  const r = rng(seed)
  const S = Array.from({ length: 16 }, (_, i) => 65 + i)
  const rank = (c: number) => (c === -1 ? -1 : c - 65)
  const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)]
  const bchar = pick([256, 256, 200, 80, 70]) // none, nonexistent, or a real character
  const hasLeft = bchar !== 256 ? r() < 0.8 : r() < 0.4
  const kerns: number[] = []
  const kern = () => { kerns.push(Math.round((r() - 0.5) * 0.2 * ONE)); return kerns.length - 1 }
  const step = (left: number, next: number, nextRank: number) => {
    const above = S.filter((z) => rank(z) > Math.max(left, nextRank))
    if (above.length && r() < 0.45) return { next, op: pick(LIG_OPS), rem: pick(above) }
    const k = kern()
    return { next, op: 128 + (k >> 8), rem: k & 255 }
  }
  const program = (left: number) => {
    const nexts = S.filter(() => r() < 0.3)
    const ins = nexts.map((n) => step(left, n, rank(n)))
    // a real boundary character is also matched as itself, so it keeps its own rank
    if (bchar !== 256 && r() < 0.5) ins.push(step(left, bchar, S.includes(bchar) ? rank(bchar) : -1))
    return ins
  }
  const lk: number[] = []
  if (bchar !== 256) lk.push(instr(255, bchar, 0, 0)) // § 545: the right boundary character
  const chars: FixWordFont["chars"] = new Map()
  for (const c of S) {
    const ins = r() < 0.75 ? program(rank(c)) : []
    const m = { width: Math.round((0.2 + 0.6 * r()) * ONE), height: Math.round(0.7 * ONE * (0.5 + 0.5 * r())), depth: r() < 0.3 ? Math.round(0.2 * ONE) : 0, italic: r() < 0.5 ? Math.round(r() * 0.1 * ONE) : 0, tag: 0, remainder: 0 }
    if (ins.length) { m.tag = 1; m.remainder = lk.length; ins.forEach((x, i) => lk.push(instr(i === ins.length - 1 ? 128 : 0, x.next, x.op, x.rem))) }
    chars.set(c, m)
  }
  if (hasLeft) {
    const start = lk.length
    const ins = S.filter(() => r() < 0.4).map((n) => step(-1, n, rank(n)))
    if (!ins.length) ins.push(step(-1, S[0], 0))
    ins.forEach((x, i) => lk.push(instr(i === ins.length - 1 ? 128 : 0, x.next, x.op, x.rem)))
    lk.push(instr(255, 0, start >> 8, start & 255)) // § 545: the left boundary program
  }
  // heights and depths draw from few values so they fit the TFM tables
  const hs = [...new Set([...chars.values()].map((m) => m.height))].slice(0, 15)
  for (const m of chars.values()) if (!hs.includes(m.height)) m.height = hs[0]
  return { name: `lkfz${seed}`, checksum: 0, designSize: 10 * ONE, chars, ligKern: lk, kerns, params: [0, 0, Math.round(0.33 * ONE), Math.round(0.16 * ONE), Math.round(0.11 * ONE), Math.round(0.43 * ONE), ONE, Math.round(0.11 * ONE)] }
}

interface Case { font: string; codes: number[]; noBefore: boolean; noAfter: boolean; italic: boolean }

// characters TeX would not read as plain characters in LaTeX's body
const SPECIAL = new Set([..."#$%&\\^_{}~ "].map((c) => c.charCodeAt(0)))

function cases(fonts: { id: string; font: Font }[], synth: { id: string; font: Font }[], n: number, seed: number): Case[] {
  const r = rng(seed)
  const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)]
  const out: Case[] = []
  // ligature- and kern-prone characters weigh more in real fonts
  const PRONE = [..."ffffiillAVWTYoaeckvxyPL.,-`'!?\""].map((c) => c.charCodeAt(0))
  for (let i = 0; i < n; i++) {
    const useSynth = r() < 0.5
    const { id, font } = pick(useSynth ? synth : fonts)
    const avail = [...font.chars.keys()].filter((c) => (useSynth || (c >= 33 && c <= 126)) && !SPECIAL.has(c))
    if (!avail.length) continue
    const low = avail.filter((c) => c < 72) // synthetic: low ranks start ligatures
    const prone = avail.filter((c) => PRONE.includes(c))
    const len = 1 + Math.floor(r() * 8)
    const codes = Array.from({ length: len }, () => pick(useSynth ? (r() < 0.6 ? low : avail) : (prone.length && r() < 0.6 ? prone : avail)))
    // a font's nonexistent boundary character, typed as \char: TeX drops it, and it must
    // not match the boundary's lig/kern instructions on the way (font_false_bchar, § 1038)
    if (useSynth && font.falseBchar < 256 && r() < 0.3) codes.splice(Math.floor(r() * (codes.length + 1)), 0, font.falseBchar)
    const noAfter = useSynth && r() < 0.15
    out.push({ font: id, codes, noBefore: useSynth && r() < 0.15, noAfter, italic: !noAfter && r() < 0.2 })
  }
  return out
}

const csName = (i: number) => "F" + i.toString(26).split("").map((d) => String.fromCharCode(97 + parseInt(d, 26))).join("")

export function glyphCheck(n: number, seed: number): number {
  mkdirSync(DIR, { recursive: true })
  const real = (JSON.parse(readFileSync("lib/latex/data/fonts/index.json", "utf8")) as { fonts: { name: string }[] }).fonts.map((f) => f.name)
  const synthNames: string[] = []
  const fonts = new Map<string, Font>()
  const decl: string[] = []
  real.forEach((name, i) => { const f = dataFont(name); fonts.set(csName(i), loadFont(f, Math.floor(f.designSize / 16))); decl.push(`\\font\\${csName(i)}=${name}`) })
  for (let k = 0; k < 40; k++) {
    const f = synthFont(seed * 1000 + k)
    writeFileSync(join(DIR, `${f.name}.tfm`), writeTfm(f))
    const id = csName(real.length + k)
    fonts.set(id, loadFont(f, 10 * 65536)); decl.push(`\\font\\${id}=${f.name}`); synthNames.push(id)
  }
  const realIds = real.map((_, i) => csName(i))
  const all = cases(realIds.map((id) => ({ id, font: fonts.get(id)! })), synthNames.map((id) => ({ id, font: fonts.get(id)! })), n, seed)
  const text = (codes: number[]) => codes.map((c) => (c >= 33 && c <= 126 && !SPECIAL.has(c) ? String.fromCharCode(c) : `\\char${c} `)).join("")
  writeFileSync(join(DIR, "glyphs.tex"), [
    "\\documentclass{article}", "\\showboxdepth=100 \\showboxbreadth=100000", ...decl, "\\begin{document}",
    ...all.map((c) => `\\setbox0\\hbox{\\${c.font}${c.noBefore ? "\\noboundary " : " "}${text(c.codes)}${c.noAfter ? "\\noboundary" : ""}${c.italic ? "\\/" : ""}}\\showbox0`),
    "\\end{document}", "",
  ].join("\n"))
  const run = spawnSync("latex", ["-interaction=nonstopmode", "glyphs.tex"], { cwd: DIR, env: texEnv({ max_print_line: "100000", TEXFONTS: ".:" }), stdio: "ignore", timeout: 300_000 })
  if (run.error) throw new Error(`TeX did not finish (${run.error.message}); an infinite ligature loop in a synthetic font hangs TeX`)
  const lines = readFileSync(join(DIR, "glyphs.log"), "latin1").split("\n")
  const boxes: BoxNode[] = []
  for (let i = 0; i < lines.length; i++) if (lines[i] === "> \\box0=") { const { box, end } = parseBoxDump(lines, i + 1); boxes.push(box); i = end }
  if (boxes.length !== all.length) throw new Error(`TeX showed ${boxes.length} boxes for ${all.length} cases (see ${DIR}/glyphs.log)`)

  let failed = 0, ligs = 0, hits = 0, kerns = 0
  all.forEach((c, i) => {
    const list: Node[] = []
    const font = fonts.get(c.font)!
    appendRun(list, c.codes, font, { paragraph: false, hyphenChar: 45, noBoundaryBefore: c.noBefore, noBoundaryAfter: c.noAfter })
    if (c.italic) appendItalicCorrection(list, () => font)
    const engine = emitBoxes(hpack(list))
    const tex = boxes[i]
    if (tex.type === "hbox") for (const x of tex.children) { if (x.type === "char" && x.lig !== undefined) { ligs++; if (x.lig.includes("|")) hits++ } if (x.type === "kern") kerns++ }
    // font identifiers: TeX's \Fxx ↔ the engine's name@size, one to one
    const map = new Map([[c.font, `${fonts.get(c.font)!.name}@${fonts.get(c.font)!.size}`]])
    const d = compareBoxLists([tex], [engine], map)
    if (!d) return
    failed++
    if (failed <= 8) console.log(`✗ ${fonts.get(c.font)!.name} ${c.noBefore ? "\\noboundary " : ""}"${String.fromCharCode(...c.codes)}"${c.noAfter ? " \\noboundary" : ""}: ${d.path} ${d.field}\n    TeX:    ${JSON.stringify(d.expected)}\n    engine: ${JSON.stringify(d.actual)}`)
  })
  console.log(`${all.length - failed}/${all.length} glyph runs identical to TeX (seed ${seed}; ${real.length} fonts + 40 synthetic; ${ligs} ligatures, ${hits} with boundary marks, ${kerns} kerns, ${all.filter((c) => c.italic).length} italic corrections)`)
  return failed ? 1 : 0
}
