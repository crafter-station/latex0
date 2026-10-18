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
import { loadTfm } from "../oracle/oracle"
import { texEnv } from "../tex"

const OUT = "packages/engine/data/classes"
const CLASSES = ["article", "report", "book", "letter"]
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
/** The text fonts the engine selects: encoding/family/series/shape (NFSS) */
const FONT_SHAPES = ["OT1", "T1", "TS1"].flatMap((e) => ["cmr", "cmss", "cmtt"].flatMap((f) => ["m", "bx"].flatMap((s) => ["n", "it", "sl", "sc", "scit", "scsl"].map((h) => `${e}/${f}/${s}/${h}`))))
const LIST = [["D", "leftmargin"], ["D", "labelwidth"], ["G", "topsep"], ["G", "partopsep"], ["G", "parsep"], ["G", "itemsep"]] as const
/** the math alphabets that allocate a family of their own (\\mathrm, \\mathnormal and \\mathcal use 0, 1 and 2) */
export const ALPHABETS = ["mathbf", "mathit", "mathsf", "mathtt"] as const
const DISPLAY = ["abovedisplayskip", "belowdisplayskip", "abovedisplayshortskip", "belowdisplayshortskip"] as const

function probe(cls: string, option: string, packages = ""): string {
  return [
    `\\documentclass[${option}]{${cls}}`, packages,
    "\\makeatletter",
    "\\def\\P#1#2{\\ifdefined#2\\immediate\\write16{#1:\\expandafter\\@gobble\\string#2=\\the#2}\\fi}", // (letter lacks some)
    `\\def\\S#1{{#1\\check@mathfonts\\immediate\\write16{S:\\expandafter\\@gobble\\string#1:\\f@size:\\sf@size:\\ssf@size:\\fontname\\font:\\the\\baselineskip${DISPLAY.map((d) => `:\\the\\${d}`).join("")}}` +
      // the math families 0–3 at text, script and scriptscript size
      `\\immediate\\write16{T:\\expandafter\\@gobble\\string#1:\\the\\ht\\strutbox:\\the\\dp\\strutbox}` +
      `{\\fontencoding{TS1}\\selectfont\\immediate\\write16{C:\\expandafter\\@gobble\\string#1:\\fontname\\font}}` +
      `{\\bfseries\\immediate\\write16{B:\\expandafter\\@gobble\\string#1:\\fontname\\font}}` +
      `\\immediate\\write16{F:\\expandafter\\@gobble\\string#1${["text", "script", "scriptscript"].flatMap((st) => [0, 1, 2, 3].map((f) => `:\\fontname\\${st}font${f}`)).join("")}}` +
      // the math alphabets' families (allocated on first use) at text, script and scriptscript size
      `\\setbox0\\hbox{$${ALPHABETS.map((a) => `\\${a}{\\xdef\\fam${a}{\\the\\fam}}`).join("")}` +
      `\\immediate\\write16{A:\\expandafter\\@gobble\\string#1${ALPHABETS.flatMap((a) => ["text", "script", "scriptscript"].map((st) => `:\\fontname\\${st}font\\csname fam${a}\\endcsname`)).join("")}}$}}}`,
    "\\begin{document}",
    // with fontenc loaded: the font of every encoding, family, series and shape at every size (what NFSS
    // substitutes when the shape is not declared) and its \\hyphenchar
    // which shapes the .fd files declare, read before any substitution (which declares the shape it replaces)
    ...(packages.includes("fontenc") ? [...new Set(FONT_SHAPES.map((f) => f.split("/").slice(0, 2).join("/")))].map((ef) => `{\\fontencoding{${ef.split("/")[0]}}\\fontfamily{${ef.split("/")[1]}}\\fontseries{m}\\fontshape{n}\\selectfont}`) : []),
    ...(packages.includes("fontenc") ? FONT_SHAPES.map((f) => `\\immediate\\write16{D:${f}:\\ifcsname ${f}\\endcsname 1\\else 0\\fi}`) : []),
    ...(packages.includes("fontenc") ? SIZE_COMMANDS.map((sz) => `{\\${sz}${FONT_SHAPES.map((f) => { const [e, fam, ser, sh] = f.split("/"); return `{\\fontencoding{${e}}\\fontfamily{${fam}}\\fontseries{${ser}}\\fontshape{${sh}}\\selectfont\\immediate\\write16{N:${sz}:${f}:\\fontname\\font:\\the\\hyphenchar\\font}}` }).join("")}}`) : []),
    ...DIMENS.map((d) => `\\P D\\${d}`), ...GLUE.map((g) => `\\P G\\${g}`), ...INTS.map((i) => `\\P I\\${i}`),
    ...SIZE_COMMANDS.map((s) => `\\S\\${s}`),
    // \raggedbottom defines \@textbottom as \vskip\z@\@plus.0001fil; \flushbottom lets it be \relax
    "\\immediate\\write16{I:raggedbottom=\\ifx\\@textbottom\\relax 0\\else 1\\fi}",
    "\\immediate\\write16{I:twoside=\\if@twoside 1\\else 0\\fi}",
    "\\immediate\\write16{I:secnumdepth=\\the\\c@secnumdepth}",
    // float placement: the counters, the fractions of \\textheight TeX computes (\\@floatplacement's
    // \\@toproom, \\@botroom and \\@fpmin, \\@flsettextmin's \\@textmin), and the float page skips
    "\\immediate\\write16{I:topnumber=\\the\\c@topnumber}\\immediate\\write16{I:bottomnumber=\\the\\c@bottomnumber}\\immediate\\write16{I:totalnumber=\\the\\c@totalnumber}",
    ...([["toproom", "topfraction"], ["botroom", "bottomfraction"], ["textmin", "textfraction"], ["fpmin", "floatpagefraction"]] as const).map(([d, f]) => `{\\dimen@\\${f}\\textheight\\immediate\\write16{D:${d}=\\the\\dimen@}}`),
    // the fractions as TeX scans them (the factor in sp), for other text heights
    ...["topfraction", "bottomfraction", "textfraction", "floatpagefraction"].map((f) => `{\\dimen@\\${f}\\p@\\immediate\\write16{I:${f}=\\number\\dimen@}}`),
    "\\immediate\\write16{G:fptop=\\the\\@fptop}\\immediate\\write16{G:fpsep=\\the\\@fpsep}\\immediate\\write16{G:fpbot=\\the\\@fpbot}",
    // the first list level at each size (\\small and \\footnotesize define their own \\@listi)
    ...SIZE_COMMANDS.map((sz) => `{\\${sz}\\@listi${LIST.map(([t, p]) => `\\immediate\\write16{${t}:list1${p}@${sz}=\\the\\${p}}`).join("")}}`),
    // list levels as \\list sets them, each nested in the one before (\\@listi … \\@listvi)
    `{${["i", "ii", "iii", "iv", "v", "vi"].map((r, n) => `\\@list${r}${LIST.map(([t, p]) => `\\immediate\\write16{${t}:list${n + 1}${p}=\\the\\${p}}`).join("")}`).join("")}}`,
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
  // the same probe with amsmath, which scales the math extension font with the size: only its math fonts are kept
  writeFileSync(join(dir, "ams.tex"), probe(cls, option, "\\usepackage{amsmath}"))
  execFileSync("latex", ["-interaction=batchmode", "-halt-on-error", "ams.tex"], { cwd: dir, env: texEnv({ max_print_line: "100000" }), encoding: "latin1" })
  const amsLog = readFileSync(join(dir, "ams.log"), "latin1").split("\n")
  // and with \usepackage[T1]{fontenc}: only its text fonts are kept
  writeFileSync(join(dir, "t1.tex"), probe(cls, option, "\\usepackage[T1]{fontenc}"))
  execFileSync("latex", ["-interaction=batchmode", "-halt-on-error", "t1.tex"], { cwd: dir, env: texEnv({ max_print_line: "100000" }), encoding: "latin1" })
  const t1Log = readFileSync(join(dir, "t1.log"), "latin1").split("\n")
  const data: ClassOptionData = { dimens: {}, glue: {}, ints: {}, sizes: {} as ClassOptionData["sizes"] }
  const mathFonts = new Map<string, SizeData["math"]>()
  const alphabets = new Map<string, SizeData["alphabets"]>()
  const struts = new Map<string, SizeData["strut"]>()
  const companion = new Map<string, SizeData["companion"]>()
  const bold = new Map<string, SizeData["bold"]>()
  for (const line of log) {
    let m: RegExpMatchArray | null
    if ((m = line.match(/^([DGI]):([\w@]+)=(.*)$/))) {
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
        mathAms: { text: [], script: [], scriptscript: [] },
        alphabets: { mathbf: [], mathit: [], mathsf: [], mathtt: [] },
        strut: { height: 0, depth: 0 },
        companion: { name: "", at: 0 },
        bold: { name: "", at: 0 },
        t1: { font: { name: "", at: 0 }, bold: { name: "", at: 0 } },
        fonts: {},
      }
      data.sizes[m[1] as keyof ClassOptionData["sizes"]] = s
    } else if ((m = line.match(/^([CB]):(\w+):(\w+)(?: at ([\d.]+)pt)?$/))) {
      (m[1] === "C" ? companion : bold).set(m[2], { name: m[3], at: m[4] ? parseScaled(m[4]) : designSize(m[3]) })
    } else if ((m = line.match(/^T:(\w+):([\d.]+)pt:([\d.]+)pt$/))) {
      struts.set(m[1], { height: parseScaled(m[2]), depth: parseScaled(m[3]) })
    } else if ((m = line.match(/^A:(\w+):(.*)$/))) {
      const refs = m[2].split(":").map((f) => { const x = f.match(/^(\w+)(?: at ([\d.]+)pt)?$/)!; return { name: x[1], at: x[2] ? parseScaled(x[2]) : designSize(x[1]) } })
      alphabets.set(m[1], Object.fromEntries(ALPHABETS.map((a, i) => [a, refs.slice(3 * i, 3 * i + 3)])) as SizeData["alphabets"])
    } else if ((m = line.match(/^F:(\w+):(.*)$/))) {
      const refs = m[2].split(":").map((f) => { const x = f.match(/^(\w+)(?: at ([\d.]+)pt)?$/)!; return { name: x[1], at: x[2] ? parseScaled(x[2]) : designSize(x[1]) } })
      mathFonts.set(m[1], { text: refs.slice(0, 4), script: refs.slice(4, 8), scriptscript: refs.slice(8, 12) })
    }
  }
  for (const [size, mf] of mathFonts) if (data.sizes[size as keyof ClassOptionData["sizes"]]) data.sizes[size as keyof ClassOptionData["sizes"]].math = mf
  for (const [size, a] of alphabets) if (data.sizes[size as keyof ClassOptionData["sizes"]]) data.sizes[size as keyof ClassOptionData["sizes"]].alphabets = a
  for (const line of amsLog) {
    const m = line.match(/^F:(\w+):(.*)$/)
    if (!m || !data.sizes[m[1] as keyof ClassOptionData["sizes"]]) continue
    const refs = m[2].split(":").map((f) => { const x = f.match(/^(\w+)(?: at ([\d.]+)pt)?$/)!; return { name: x[1], at: x[2] ? parseScaled(x[2]) : designSize(x[1]) } })
    data.sizes[m[1] as keyof ClassOptionData["sizes"]].mathAms = { text: refs.slice(0, 4), script: refs.slice(4, 8), scriptscript: refs.slice(8, 12) }
  }
  const ref = (name: string, at?: string) => ({ name, at: at ? parseScaled(at) : designSize(name) })
  const declared = new Map<string, boolean>()
  for (const line of t1Log) {
    let m: RegExpMatchArray | null
    const sz = (x: string) => data.sizes[x as keyof ClassOptionData["sizes"]]
    if ((m = line.match(/^D:([\w/]+):([01])$/))) declared.set(m[1], m[2] === "1")
    else if ((m = line.match(/^N:(\w+):([\w/]+):(\w+)(?: at ([\d.]+)pt)?:(-?\d+)$/)) && sz(m[1])) sz(m[1]).fonts[m[2]] = { ...ref(m[3], m[4]), hyphenchar: Number(m[5]), declared: declared.get(m[2]) ?? false }
    else if ((m = line.match(/^S:(\w+):[\d.]+:[\d.]+:[\d.]+:(\w+)(?: at ([\d.]+)pt)?:/)) && sz(m[1])) sz(m[1]).t1.font = ref(m[2], m[3])
    else if ((m = line.match(/^B:(\w+):(\w+)(?: at ([\d.]+)pt)?$/)) && sz(m[1])) sz(m[1]).t1.bold = ref(m[2], m[3])
  }
  for (const [size, st] of struts) if (data.sizes[size as keyof ClassOptionData["sizes"]]) data.sizes[size as keyof ClassOptionData["sizes"]].strut = st
  for (const [size, c] of companion) if (data.sizes[size as keyof ClassOptionData["sizes"]]) data.sizes[size as keyof ClassOptionData["sizes"]].companion = c
  for (const [size, c] of bold) if (data.sizes[size as keyof ClassOptionData["sizes"]]) data.sizes[size as keyof ClassOptionData["sizes"]].bold = c
  const missing = [...DIMENS.filter((d) => !(d in data.dimens)), ...GLUE.filter((g) => !(g in data.glue)), ...[...INTS, "raggedbottom", "twoside", "footins", "footinscount", "secnumdepth", "topnumber", "bottomnumber", "totalnumber", "topfraction", "bottomfraction", "textfraction", "floatpagefraction"].filter((i) => !(i in data.ints)), ...["footinsskip", "fptop", "fpsep", "fpbot", ...[1, 2, 3, 4, 5, 6].flatMap((n) => LIST.filter(([t]) => t === "G").map(([, p]) => `list${n}${p}`)), ...SIZE_COMMANDS.flatMap((sz) => LIST.filter(([t]) => t === "G").map(([, p]) => `list1${p}@${sz}`))].filter((g) => !(g in data.glue)), ...["footinsdimen", "toproom", "botroom", "textmin", "fpmin", ...[1, 2, 3, 4, 5, 6].flatMap((n) => LIST.filter(([t]) => t === "D").map(([, p]) => `list${n}${p}`)), ...SIZE_COMMANDS.flatMap((sz) => LIST.filter(([t]) => t === "D").map(([, p]) => `list1${p}@${sz}`))].filter((d) => !(d in data.dimens)), ...SIZE_COMMANDS.filter((s) => !data.sizes[s] || data.sizes[s].math.text.length !== 4 || ALPHABETS.some((a) => data.sizes[s].alphabets[a].length !== 3) || !data.sizes[s].t1.font.name || !data.sizes[s].t1.bold.name || FONT_SHAPES.some((f) => !data.sizes[s].fonts[f]))]
  // letter has no floats' captions
  const absent = cls === "letter" ? ["abovecaptionskip", "belowcaptionskip"] : []
  const lacking = missing.filter((x) => !absent.includes(x))
  if (lacking.length) throw new Error(`${cls} [${option}]: TeX did not report ${lacking.join(", ")}`)
  return data
}

/** A font loaded without "at" is at its design size: the TFM's fix_word, in sp (§ 568). */
function designSize(name: string): number {
  return Math.floor(loadTfm(name).designSize / 16)
}

/** Class options besides the size that change the page: the paper, and one- or two-sided printing */
const PAPERS = ["letterpaper", "a4paper", "a5paper", "b5paper", "legalpaper", "executivepaper"]
const SIDES = ["oneside", "twoside"]

/** The lengths and switches each paper and side option changes, against the class's defaults. */
function variants(cls: string, option: string, base: ClassOptionData): ClassOptionData["variants"] {
  const out: NonNullable<ClassOptionData["variants"]> = {}
  for (const paper of PAPERS) for (const side of SIDES) {
    const v = `${paper},${side}`
    const dir = join(".cache/classes", `${cls}-${option}-${paper}-${side}`)
    mkdirSync(dir, { recursive: true })
    const src = [`\\documentclass[${option},${v}]{${cls}}`, "\\makeatletter", "\\def\\P#1#2{\\ifdefined#2\\immediate\\write16{#1:\\expandafter\\@gobble\\string#2=\\the#2}\\fi}", "\\begin{document}",
      ...DIMENS.map((d) => `\\P D\\${d}`), "\\immediate\\write16{I:twoside=\\if@twoside 1\\else 0\\fi}", "\\immediate\\write16{I:raggedbottom=\\ifx\\@textbottom\\relax 0\\else 1\\fi}", "\\end{document}", ""].join("\n")
    writeFileSync(join(dir, "v.tex"), src)
    execFileSync("latex", ["-interaction=batchmode", "-halt-on-error", "v.tex"], { cwd: dir, env: texEnv({ max_print_line: "100000" }), encoding: "latin1" })
    const diff = { dimens: {} as Record<string, number>, ints: {} as Record<string, number> }
    for (const line of readFileSync(join(dir, "v.log"), "latin1").split("\n")) {
      const m = line.match(/^([DI]):(\w+)=(.*)$/)
      if (!m) continue
      if (m[1] === "D") { const x = dimen(m[3]); if (x !== base.dimens[m[2]]) diff.dimens[m[2]] = x }
      else { const x = Number(m[3]); if (x !== base.ints[m[2]]) diff.ints[m[2]] = x }
    }
    if (Object.keys(diff.dimens).length || Object.keys(diff.ints).length) out[v] = diff
  }
  return out
}

export function codegenClasses(check: boolean): number {
  const stale: string[] = []
  for (const cls of CLASSES) {
    const data: ClassData = { class: cls, tex: "LaTeX kernel and standard classes as loaded by `latex`", options: {} }
    for (const o of OPTIONS) { const d = texData(cls, o); d.variants = variants(cls, o, d); data.options[o] = d }
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
