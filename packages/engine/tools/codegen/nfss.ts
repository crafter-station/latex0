// Codegen (#340): font packages as data. NFSS selects a family's fonts from its .fd files by size; TeX reports, for
// each family the engine knows past Computer Modern, the font every encoding, series and shape selects at each font
// size the classes use (data/nfss/<family>.json), and, for each package that sets up math fonts, the math families
// and alphabets at each size of the classes (data/nfss/math-<package>.json).
//   bun engine codegen [--check]

import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { printScaled } from "../../layout/arith"
import { SIZE_COMMANDS, type ClassData, type FamilyData, type FontRef, type MathFontData, type SizeData } from "../../layout/classdata"
import { parseScaled } from "../oracle/tracing"
import { loadTfm } from "../oracle/oracle"
import { texEnv } from "../tex"
import { ALPHABETS } from "./classes"

const OUT = "packages/engine/data/nfss"
/** the families: lmodern.sty's \rmdefault, \sfdefault and \ttdefault, and PSNFSS's Times, Helvetica and Courier (times.sty, helvet.sty, courier.sty) */
export const FAMILIES = ["lmr", "lmss", "lmtt", "ptm", "phv", "pcr"]
/** the packages that set up math fonts, as a preamble loads them */
export const MATH_PACKAGES: Record<string, string> = { lmodern: "\\usepackage{lmodern}" }
/** the encodings, series and shapes the engine selects (FontAttrs) */
const SHAPES = ["OT1", "T1", "TS1"].flatMap((e) => ["m", "bx"].flatMap((s) => ["n", "it", "sl", "sc", "scit", "scsl"].map((h) => `${e}/${s}/${h}`)))
const BOLD = SHAPES.filter((s) => s.split("/")[1] === "m").map((s) => s.replace("/m/", "/b/"))
/** the classes whose sizes the data covers (beamer's are its own) */
const CLASSES = ["article", "report", "book", "letter"]

const tex = (dir: string, name: string, src: string): string[] => {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${name}.tex`), src)
  execFileSync("latex", ["-interaction=batchmode", "-halt-on-error", `${name}.tex`], { cwd: dir, env: texEnv({ max_print_line: "100000" }), encoding: "latin1" })
  return readFileSync(join(dir, `${name}.log`), "latin1").split("\n")
}
/** \f@size as the classes write it (\@xipt is 10.95) */
const sizeText = (sp: number) => printScaled(sp).replace(/\.0$/, "")
/** A font loaded without "at" is at its design size (§ 568). */
const ref = (name: string, at?: string): FontRef => ({ name, at: at ? parseScaled(at) : Math.floor(loadTfm(name).designSize / 16) })
const FONTNAME = /^([\w-]+)(?: at ([\d.]+)pt)?$/

/** every \f@size, \sf@size and \ssf@size of the classes, and each size's math sizes */
function classSizes(): { sizes: number[]; triples: Set<string> } {
  const sizes = new Set<number>(), triples = new Set<string>()
  for (const cls of CLASSES) {
    const d = JSON.parse(readFileSync(join("packages/engine/data/classes", `${cls}.json`), "utf8")) as ClassData
    for (const o of Object.values(d.options)) for (const s of Object.values(o.sizes)) {
      sizes.add(s.size).add(s.scriptSize).add(s.scriptScriptSize)
      triples.add(`${s.size}:${s.scriptSize}:${s.scriptScriptSize}`)
    }
  }
  return { sizes: [...sizes].sort((a, b) => a - b), triples }
}

function familyData(family: string, sizes: number[]): FamilyData {
  const src = [
    "\\documentclass{article}", "\\usepackage[T1]{fontenc}", "\\makeatletter", "\\begin{document}",
    // which shapes the .fd files declare, read before any substitution (which declares the shape it replaces)
    ...["OT1", "T1", "TS1"].map((e) => `{\\fontencoding{${e}}\\fontfamily{${family}}\\fontseries{m}\\fontshape{n}\\selectfont}`),
    ...SHAPES.map((s) => { const [e, ser, sh] = s.split("/"); return `\\immediate\\write16{D:${s}:\\ifcsname ${e}/${family}/${ser}/${sh}\\endcsname 1\\else 0\\fi}` }),
    // series b too (\bfseries's when bx lacks a shape, \DeclareFontSeriesChangeRule{m}{bx}{bx}{b}; and the series itself
    // for families outside latex.ltx's \init@series@setup list): checked against bx below, not kept
    ...BOLD.map((s) => { const [e, ser, sh] = s.split("/"); return `\\immediate\\write16{D:${s}:\\ifcsname ${e}/${family}/${ser}/${sh}\\endcsname 1\\else 0\\fi}` }),
    ...sizes.map((sp) => `{\\fontsize{${sizeText(sp)}}{${sizeText(sp)}}${[...SHAPES, ...BOLD].map((s) => { const [e, ser, sh] = s.split("/"); return `{\\fontencoding{${e}}\\fontfamily{${family}}\\fontseries{${ser}}\\fontshape{${sh}}\\selectfont\\immediate\\write16{N:\\f@size:${s}:\\fontname\\font:\\the\\hyphenchar\\font}}` }).join("")}}`),
    "\\end{document}", "",
  ].join("\n")
  const log = tex(join(".cache/nfss", family), "family", src)
  const declared = new Map<string, boolean>()
  const data: FamilyData = { family, tex: "NFSS's font selection from the family's .fd files, as `latex` loads them", sizes: {} }
  for (const line of log) {
    let m: RegExpMatchArray | null
    if ((m = line.match(/^D:([\w/]+):([01])$/))) declared.set(m[1], m[2] === "1")
    else if ((m = line.match(/^N:([\d.]+):([\w/]+):([\w-]+)(?: at ([\d.]+)pt)?:(-?\d+)$/))) {
      ;(data.sizes[String(parseScaled(m[1]))] ??= {})[m[2]] = { ...ref(m[3], m[4]), hyphenchar: Number(m[5]), declared: declared.get(m[2]) ?? false }
    }
  }
  const missing = sizes.filter((sp) => [...SHAPES, ...BOLD].some((s) => !data.sizes[String(sp)]?.[s]))
  if (missing.length) throw new Error(`${family}: TeX did not report the fonts at ${missing.map(sizeText).join(", ")}`)
  // The engine's \bfseries is bx. For a family in \init@series@setup's list (lm…) that holds when b declares no shape bx
  // lacks; for one outside it (\bfseries@rm is b: ptm…), when b and bx declare the same shapes with the same fonts.
  const kernelList = ["cmr", "cmss", "cmtt", "lcmss", "lcmtt", "lmr", "lmss", "lmtt"].includes(family)
  for (const b of BOLD) {
    const bx = b.replace("/b/", "/bx/")
    if (kernelList ? declared.get(b) && !declared.get(bx) : declared.get(b) !== declared.get(bx) || sizes.some((sp) => declared.get(b) && data.sizes[String(sp)][b].name !== data.sizes[String(sp)][bx].name)) throw new Error(`${family}: series b and bx differ at ${b}`)
  }
  for (const s of Object.values(data.sizes)) for (const b of BOLD) delete s[b]
  return data
}

/** The math families 0–3 and the alphabets at each size command of a class option, with the package loaded (after amsmath or not). */
function mathProbe(option: string, packages: string): string {
  return [
    `\\documentclass[${option}]{article}`, packages, "\\makeatletter",
    `\\def\\S#1{{#1\\check@mathfonts\\immediate\\write16{Z:\\f@size:\\sf@size:\\ssf@size}` +
      `\\immediate\\write16{F${["text", "script", "scriptscript"].flatMap((st) => [0, 1, 2, 3].map((f) => `:\\fontname\\${st}font${f}`)).join("")}}` +
      `\\setbox0\\hbox{$${ALPHABETS.map((a) => `\\${a}{\\xdef\\fam${a}{\\the\\fam}}`).join("")}` +
      `\\immediate\\write16{A${ALPHABETS.flatMap((a) => ["text", "script", "scriptscript"].map((st) => `:\\fontname\\${st}font\\csname fam${a}\\endcsname`)).join("")}}$}}}`,
    "\\begin{document}", ...SIZE_COMMANDS.map((s) => `\\S\\${s}`), "\\end{document}", "",
  ].join("\n")
}

function mathData(pkg: string, triples: Set<string>): MathFontData {
  const data: MathFontData = { package: pkg, tex: "the math fonts after the package, as `latex` loads it (mathAms: after amsmath)", sizes: {} }
  const refs = (s: string) => s.split(":").slice(1).map((f) => { const x = f.match(FONTNAME); if (!x) throw new Error(`${pkg}: font ${f}`); return ref(x[1], x[2]) })
  for (const option of ["10pt", "11pt", "12pt"]) {
    for (const ams of [false, true]) {
      const log = tex(join(".cache/nfss", `math-${pkg}-${option}`), ams ? "ams" : "math", mathProbe(option, (ams ? "\\usepackage{amsmath}" : "") + MATH_PACKAGES[pkg]))
      let key = ""
      for (const line of log) {
        let m: RegExpMatchArray | null
        if ((m = line.match(/^Z:([\d.]+):([\d.]+):([\d.]+)$/))) {
          key = [m[1], m[2], m[3]].map(parseScaled).join(":")
          data.sizes[key] ??= { math: { text: [], script: [], scriptscript: [] }, mathAms: { text: [], script: [], scriptscript: [] }, alphabets: { mathbf: [], mathit: [], mathsf: [], mathtt: [] } }
        } else if (line.startsWith("F:")) {
          const r = refs(line), m: SizeData["math"] = { text: r.slice(0, 4), script: r.slice(4, 8), scriptscript: r.slice(8, 12) }
          data.sizes[key][ams ? "mathAms" : "math"] = m
        } else if (line.startsWith("A:") && !ams) {
          const r = refs(line)
          data.sizes[key].alphabets = Object.fromEntries(ALPHABETS.map((a, i) => [a, r.slice(3 * i, 3 * i + 3)])) as SizeData["alphabets"]
        }
      }
    }
  }
  const missing = [...triples].filter((t) => !data.sizes[t] || data.sizes[t].math.text.length !== 4 || data.sizes[t].mathAms.text.length !== 4 || ALPHABETS.some((a) => data.sizes[t].alphabets[a].length !== 3))
  if (missing.length) throw new Error(`${pkg}: TeX did not report the math fonts at ${missing.join(", ")}`)
  return data
}

export function codegenNfss(check: boolean): number {
  const { sizes, triples } = classSizes()
  const files = new Map<string, string>()
  for (const f of FAMILIES) files.set(`${f}.json`, JSON.stringify(familyData(f, sizes)) + "\n")
  for (const p of Object.keys(MATH_PACKAGES)) files.set(`math-${p}.json`, JSON.stringify(mathData(p, triples)) + "\n")
  const stale = [...files].filter(([f, body]) => !existsSync(join(OUT, f)) || readFileSync(join(OUT, f), "utf8") !== body).map(([f]) => f)
  if (check) {
    console.log(stale.length ? `font package data out of date: ${stale.join(", ")}\nrun: bun engine codegen` : `font package data up to date (${files.size} files)`)
    return stale.length ? 1 : 0
  }
  mkdirSync(OUT, { recursive: true })
  for (const [f, body] of files) writeFileSync(join(OUT, f), body)
  console.log(stale.length ? `wrote ${stale.map((f) => join(OUT, f)).join(", ")}` : "font package data unchanged")
  return 0
}
