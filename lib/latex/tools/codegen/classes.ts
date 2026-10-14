// Codegen (#44): class parameters per size option, as data. TeX loads each
// class with each option and reports, in the document body, every length and
// parameter we track and what each size command (\tiny … \Huge) sets.
//   bun engine codegen [--check]

import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { SIZE_COMMANDS, type ClassData, type ClassOptionData, type SizeData } from "../../layout/classdata"
import { parseGlue } from "../../layout/dimen"
import { parseScaled } from "../oracle/tracing"
import { dataFont } from "../fonts"
import { texEnv } from "../tex"

const OUT = "lib/latex/data/classes"
const CLASSES = ["article", "report", "book"]
const OPTIONS = ["10pt", "11pt", "12pt"]

const DIMENS = [
  "paperwidth", "paperheight", "textwidth", "textheight", "oddsidemargin", "evensidemargin", "topmargin", "headheight", "headsep",
  "footskip", "maxdepth", "marginparwidth", "marginparsep", "columnsep", "columnseprule", "parindent", "lineskiplimit",
  "hoffset", "voffset", "emergencystretch", "hfuzz", "vfuzz", "footnotesep", "leftmargini", "leftmarginii", "leftmarginiii",
  "leftmarginiv", "leftmarginv", "leftmarginvi", "labelsep", "labelwidth", "arraycolsep", "tabcolsep", "arrayrulewidth",
  "doublerulesep", "fboxsep", "fboxrule", "jot", "abovecaptionskip", "belowcaptionskip", "columnwidth", "normallineskiplimit",
]
const GLUE = [
  "topskip", "parskip", "baselineskip", "lineskip", "parfillskip", "leftskip", "rightskip", "floatsep", "textfloatsep",
  "intextsep", "dblfloatsep", "dbltextfloatsep", "smallskipamount", "medskipamount", "bigskipamount", "marginparpush",
  "topsep", "partopsep", "itemsep", "parsep", "abovedisplayskip", "belowdisplayskip", "abovedisplayshortskip", "belowdisplayshortskip",
  "normallineskip",
]
const INTS = [
  "pretolerance", "tolerance", "linepenalty", "hyphenpenalty", "exhyphenpenalty", "clubpenalty", "widowpenalty",
  "displaywidowpenalty", "brokenpenalty", "binoppenalty", "relpenalty", "predisplaypenalty", "postdisplaypenalty",
  "interlinepenalty", "floatingpenalty", "adjdemerits", "doublehyphendemerits", "finalhyphendemerits", "looseness",
  "lefthyphenmin", "righthyphenmin", "uchyph", "mag", "interfootnotelinepenalty",
]
const DISPLAY = ["abovedisplayskip", "belowdisplayskip", "abovedisplayshortskip", "belowdisplayshortskip"] as const

function probe(cls: string, option: string): string {
  return [
    `\\documentclass[${option}]{${cls}}`,
    "\\makeatletter",
    "\\def\\P#1#2{\\immediate\\write16{#1:\\expandafter\\@gobble\\string#2=\\the#2}}",
    `\\def\\S#1{{#1\\check@mathfonts\\immediate\\write16{S:\\expandafter\\@gobble\\string#1:\\f@size:\\sf@size:\\ssf@size:\\fontname\\font:\\the\\baselineskip${DISPLAY.map((d) => `:\\the\\${d}`).join("")}}` +
      // the math families 0–3 at text, script and scriptscript size
      `\\immediate\\write16{T:\\expandafter\\@gobble\\string#1:\\the\\ht\\strutbox:\\the\\dp\\strutbox}` +
      `{\\fontencoding{TS1}\\selectfont\\immediate\\write16{C:\\expandafter\\@gobble\\string#1:\\fontname\\font}}` +
      `\\immediate\\write16{F:\\expandafter\\@gobble\\string#1${["text", "script", "scriptscript"].flatMap((st) => [0, 1, 2, 3].map((f) => `:\\fontname\\${st}font${f}`)).join("")}}}}`,
    "\\begin{document}",
    ...DIMENS.map((d) => `\\P D\\${d}`), ...GLUE.map((g) => `\\P G\\${g}`), ...INTS.map((i) => `\\P I\\${i}`),
    ...SIZE_COMMANDS.map((s) => `\\S\\${s}`),
    // \raggedbottom defines \@textbottom as \vskip\z@\@plus.0001fil; \flushbottom lets it be \relax
    "\\immediate\\write16{I:raggedbottom=\\ifx\\@textbottom\\relax 0\\else 1\\fi}",
    "\\immediate\\write16{I:twoside=\\if@twoside 1\\else 0\\fi}",
    // the footnote insertion class: its box number, \\skip, \\count and \\dimen
    "\\immediate\\write16{I:footins=\\number\\footins}\\immediate\\write16{I:footinscount=\\the\\count\\footins}",
    "\\immediate\\write16{G:footinsskip=\\the\\skip\\footins}\\immediate\\write16{D:footinsdimen=\\the\\dimen\\footins}",
    "\\end{document}", "",
  ].join("\n")
}

const ENV0 = { em: 0, ex: 0 }
const glue = (s: string) => parseGlue(s, ENV0)
const dimen = (s: string) => parseScaled(s.replace(/pt$/, ""))

function texData(cls: string, option: string): ClassOptionData {
  const dir = join(".cache/classes", `${cls}-${option}`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "probe.tex"), probe(cls, option))
  execFileSync("latex", ["-interaction=batchmode", "-halt-on-error", "probe.tex"], { cwd: dir, env: texEnv({ max_print_line: "100000" }), encoding: "latin1" })
  const log = readFileSync(join(dir, "probe.log"), "latin1").split("\n")
  const data: ClassOptionData = { dimens: {}, glue: {}, ints: {}, sizes: {} as ClassOptionData["sizes"] }
  const mathFonts = new Map<string, SizeData["math"]>()
  const struts = new Map<string, SizeData["strut"]>()
  const companion = new Map<string, SizeData["companion"]>()
  for (const line of log) {
    let m: RegExpMatchArray | null
    if ((m = line.match(/^([DGI]):(\w+)=(.*)$/))) {
      if (m[1] === "D") data.dimens[m[2]] = dimen(m[3])
      else if (m[1] === "G") data.glue[m[2]] = glue(m[3])
      else data.ints[m[2]] = Number(m[3])
    } else if ((m = line.match(/^S:(\w+):([\d.]+):([\d.]+):([\d.]+):(\w+)(?: at ([\d.]+)pt)?:(.*)$/))) {
      const [baselineskip, ...display] = m[7].split(":").map(glue)
      const s: SizeData = {
        size: parseScaled(m[2]), scriptSize: parseScaled(m[3]), scriptScriptSize: parseScaled(m[4]),
        font: { name: m[5], at: m[6] ? parseScaled(m[6]) : designSize(m[5]) },
        baselineskip,
        abovedisplayskip: display[0], belowdisplayskip: display[1], abovedisplayshortskip: display[2], belowdisplayshortskip: display[3],
        math: { text: [], script: [], scriptscript: [] },
        strut: { height: 0, depth: 0 },
        companion: { name: "", at: 0 },
      }
      data.sizes[m[1] as keyof ClassOptionData["sizes"]] = s
    } else if ((m = line.match(/^C:(\w+):(\w+)(?: at ([\d.]+)pt)?$/))) {
      companion.set(m[1], { name: m[2], at: m[3] ? parseScaled(m[3]) : designSize(m[2]) })
    } else if ((m = line.match(/^T:(\w+):([\d.]+)pt:([\d.]+)pt$/))) {
      struts.set(m[1], { height: parseScaled(m[2]), depth: parseScaled(m[3]) })
    } else if ((m = line.match(/^F:(\w+):(.*)$/))) {
      const refs = m[2].split(":").map((f) => { const x = f.match(/^(\w+)(?: at ([\d.]+)pt)?$/)!; return { name: x[1], at: x[2] ? parseScaled(x[2]) : designSize(x[1]) } })
      mathFonts.set(m[1], { text: refs.slice(0, 4), script: refs.slice(4, 8), scriptscript: refs.slice(8, 12) })
    }
  }
  for (const [size, mf] of mathFonts) if (data.sizes[size as keyof ClassOptionData["sizes"]]) data.sizes[size as keyof ClassOptionData["sizes"]].math = mf
  for (const [size, st] of struts) if (data.sizes[size as keyof ClassOptionData["sizes"]]) data.sizes[size as keyof ClassOptionData["sizes"]].strut = st
  for (const [size, c] of companion) if (data.sizes[size as keyof ClassOptionData["sizes"]]) data.sizes[size as keyof ClassOptionData["sizes"]].companion = c
  const missing = [...DIMENS.filter((d) => !(d in data.dimens)), ...GLUE.filter((g) => !(g in data.glue)), ...[...INTS, "raggedbottom", "twoside", "footins", "footinscount"].filter((i) => !(i in data.ints)), ...["footinsskip"].filter((g) => !(g in data.glue)), ...["footinsdimen"].filter((d) => !(d in data.dimens)), ...SIZE_COMMANDS.filter((s) => !data.sizes[s] || data.sizes[s].math.text.length !== 4)]
  if (missing.length) throw new Error(`${cls} [${option}]: TeX did not report ${missing.join(", ")}`)
  return data
}

/** A font loaded without "at" is at its design size: the TFM's fix_word, in sp (§ 568). */
function designSize(name: string): number {
  return Math.floor(dataFont(name).designSize / 16)
}

export function codegenClasses(check: boolean): number {
  const stale: string[] = []
  for (const cls of CLASSES) {
    const data: ClassData = { class: cls, tex: "LaTeX kernel and standard classes as loaded by `latex`", options: {} }
    for (const o of OPTIONS) data.options[o] = texData(cls, o)
    const body = JSON.stringify(data) + "\n"
    const file = join(OUT, `${cls}.json`)
    if (existsSync(file) && readFileSync(file, "utf8") === body) continue
    stale.push(file)
    if (!check) { mkdirSync(OUT, { recursive: true }); writeFileSync(file, body) }
  }
  if (check) {
    console.log(stale.length ? `class data out of date: ${stale.join(", ")}\nrun: bun engine codegen` : `class data up to date (${CLASSES.length} classes × ${OPTIONS.length} options)`)
    return stale.length ? 1 : 0
  }
  console.log(stale.length ? `wrote ${stale.join(", ")}` : "class data unchanged")
  return 0
}
