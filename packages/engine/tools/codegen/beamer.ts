// Codegen: beamer themes as data (data/beamer/<theme>.json). TeX loads beamer with
// the theme at every size option and reports, in the document body, each beamer
// color as \usebeamercolor resolves it, the NFSS attributes each beamer font sets,
// and beamer's sizes after \beamer@calculateheadfoot.
//   bun engine codegen [--check]

import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { BeamerColor, BeamerFont, BeamerThemeData } from "../../layout/beamerdata"
import { SIZE_COMMANDS, type ClassData } from "../../layout/classdata"
import { parseScaled } from "../oracle/tracing"
import { texEnv } from "../tex"

const OUT = "packages/engine/data/beamer"
const OPTIONS = ["8pt", "9pt", "10pt", "11pt", "12pt", "14pt", "17pt", "20pt"]
/** the infolines outer theme with beamer's default (empty) headline, as Madrid uses it */
const INFOLINES = ["\\useoutertheme{infolines}", "\\setbeamertemplate{headline}[default]"]
/** each theme: the preamble lines that load it, and the files whose \setbeamercolor's and \setbeamerfont's name the
 *  colors and fonts reported (besides the default color and font themes') */
const THEMES: Record<string, { preamble: string[]; files: string[] }> = {
  default: { preamble: [], files: [] },
  whale: { preamble: ["\\usecolortheme{whale}"], files: ["beamercolorthemewhale.sty"] },
  orchid: { preamble: ["\\usecolortheme{orchid}"], files: ["beamercolorthemeorchid.sty"] },
  Madrid: { preamble: ["\\usetheme{Madrid}"], files: ["beamerthemeMadrid.sty", "beamercolorthemewhale.sty", "beamercolorthemeorchid.sty", "beamerinnerthemerounded.sty", "beamerouterthemeinfolines.sty"] },
  ...outerVariants([["seahorse"], ["beaver"], ["dolphin"], ["whale", "orchid"]]),
  ...outerVariants([[], ["whale"], ["orchid"]], true),
}

/** Color themes (each \usecolortheme in turn), alone (unless `outerOnly`) and followed by the infolines outer theme
 *  with the default headline (as Madrid has it): named by their parts joined with "-" (preamble.ts reads them so) */
function outerVariants(colors: string[][], outerOnly = false): Record<string, { preamble: string[]; files: string[] }> {
  const out: Record<string, { preamble: string[]; files: string[] }> = {}
  for (const c of colors) {
    const preamble = c.map((n) => `\\usecolortheme{${n}}`), files = c.map((n) => `beamercolortheme${n}.sty`)
    if (!outerOnly) out[c.join("-")] = { preamble, files }
    out[[...c, "infolines"].join("-")] = { preamble: [...preamble, ...INFOLINES], files: [...files, "beamerouterthemeinfolines.sty"] }
  }
  return out
}
/** colors and fonts no theme sets that templates use (\usebeamertemplate*{title page}): reported empty */
const UNSET = ["title page"]
/** beamer's sizes: geometry's margins (macros), the text margins and sidebars, and what \beamer@calculateheadfoot sets */
const DIMENS = ["Gm@lmargin", "Gm@rmargin", "beamer@leftmargin", "beamer@rightmargin", "beamer@leftsidebar", "beamer@rightsidebar",
  "headheight", "headdp", "footheight", "footskip", "sidebarheight", "textheight", "textwidth", "headsep", "topmargin", "oddsidemargin"]
/** the size commands beamer's fonts use: the class's and beamer's \Tiny and \TINY */
const SIZES = [...SIZE_COMMANDS, "Tiny", "TINY"]
/** \usebeamerfont run from these values with \selectfont only applying \f@series and \f@shape (its delayed
 *  adjustments, no font loaded): what is still one of them, the font left */
const SENTINEL = { family: "FAMILY", series: "SERIES", shape: "SHAPE", encoding: "ENCODING" }

/** the names a .sty sets with \setbeamercolor (or \setbeamerfont) */
function names(file: string, command: string): string[] {
  const path = execFileSync("kpsewhich", [file], { env: texEnv(), encoding: "utf8" }).trim()
  const src = readFileSync(path, "latin1").replace(/(^|[^\\])%.*$/gm, "$1")
  return [...src.matchAll(new RegExp(`\\\\${command}\\*?\\{([^}]*)\\}`, "g"))].map((m) => m[1])
}

function probe(option: string, preamble: string[], colors: string[], fonts: string[]): string {
  const w = (s: string) => `\\immediate\\write16{${s}}`
  const det = (m: string) => `\\detokenize\\expandafter{${m}}`
  return [
    `\\documentclass[${option}]{beamer}`, ...preamble, "\\setbeamertemplate{navigation symbols}{}",
    "\\begin{document}", "\\makeatletter",
    ...DIMENS.map((d) => `{\\dimen@\\${d}\\relax${w(`D|${d}|\\the\\dimen@`)}}`),
    // each color: its fg and bg as the driver gets them (none when empty), and the expressions they come from
    ...colors.flatMap((c) => ["fg", "bg"].map((k) =>
      `\\setbox0\\hbox{\\ifbeamercolorempty[${k}]{${c}}{${w(`C|${c}|${k}|`)}}{\\usebeamercolor[${k}]{${c}}${w(`C|${c}|${k}|\\current@color`)}}` +
      `\\beamer@thc@prepcolor\\beamer@thc@docolor{${c}}${w(`X|${c}|${k}|${det(`\\beamer@thc@${k}`)}`)}}`)),
    // each font: the size command and attributes it sets, \selectfont selecting nothing; then the font it selects
    ...fonts.map((f) => `\\setbox0\\hbox{{\\def\\selectfont{\\delayed@f@adjustment\\let\\delayed@f@adjustment\\@empty}\\let\\@currsize\\relax` +
      Object.entries(SENTINEL).map(([k, v]) => `\\def\\f@${k}{${v}}`).join("") + `\\def\\f@size{SIZE}` +
      `\\usebeamerfont{${f}}${w(`F|${f}|${SIZES.map((s) => `\\ifx\\@currsize\\${s} ${s}\\fi`).join("")}|\\f@size|${Object.keys(SENTINEL).map((k) => `\\f@${k}`).join("|")}`)}}` +
      `{\\usebeamerfont{${f}}${w(`N|${f}|\\fontname\\font|\\f@size`)}}}`),
    "\\end{document}", "",
  ].join("\n")
}

/** the directory a theme's probe at a size option runs in */
const probeDir = (theme: string, option: string) => join(".cache/beamer", `${theme}-${option}`)

/** Every theme's probe at every size option, run by TeX eight at a time */
function runAll(themes: string[], names: (theme: string) => { colors: string[]; fonts: string[] }) {
  const dirs: string[] = []
  for (const theme of themes) {
    const { colors, fonts } = names(theme)
    for (const option of OPTIONS) {
      const dir = probeDir(theme, option)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, "probe.tex"), probe(option, THEMES[theme].preamble, colors, fonts))
      dirs.push(dir)
    }
  }
  const script = 'cd "$0" && latex -interaction=batchmode -halt-on-error probe.tex >/dev/null || { echo "TeX failed in $0" >&2; exit 255; }'
  execFileSync("xargs", ["-0", "-P", "8", "-n", "1", "sh", "-c", script], { input: dirs.join("\0"), env: texEnv({ max_print_line: "100000" }), encoding: "latin1" })
}

const probeLog = (theme: string, option: string): string[] => readFileSync(join(probeDir(theme, option), "probe.log"), "latin1").split("\n")

/** the colors and fonts reported for a theme: the default themes' and those its files set */
function themeNames(theme: string): { colors: string[]; fonts: string[] } {
  const { files } = THEMES[theme]
  return {
    colors: [...new Set([...names("beamercolorthemedefault.sty", "setbeamercolor"), ...files.flatMap((f) => names(f, "setbeamercolor")), ...UNSET])].sort(),
    fonts: [...new Set([...names("beamerfontthemedefault.sty", "setbeamerfont"), ...files.flatMap((f) => names(f, "setbeamerfont")), ...UNSET])].sort(),
  }
}

/** A theme's data from its probes' logs (runAll ran them) */
function themeData(theme: string, cls: ClassData): BeamerThemeData {
  const { preamble } = THEMES[theme]
  const { colors: colorNames, fonts: fontNames } = themeNames(theme)
  const data: BeamerThemeData = { theme, tex: "beamer as loaded by `latex`", preamble, colors: {}, fonts: {}, options: {} }
  for (const option of OPTIONS) {
    const log = probeLog(theme, option)
    const dimens: Record<string, number> = {}
    const colors: Record<string, BeamerColor> = {}
    const fonts: Record<string, BeamerFont> = {}
    for (const line of log) {
      const f = line.split("|")
      if (f[0] === "D" && f.length === 3) dimens[f[1]] = parseScaled(f[2].replace(/pt$/, ""))
      else if (f[0] === "C" && f.length === 4) { const c = (colors[f[1]] ??= {}); if (f[3]) c[f[2] as "fg" | "bg"] = f[3] }
      // an expression with the current fg or bg in it (not a beamer color's X.fg)
      else if (f[0] === "X" && f.length === 4 && /(^|[!,])\s*(fg|bg)\s*($|[!,])/.test(f[3])) (colors[f[1]] ??= {}).contextual = true
      else if (f[0] === "F" && f.length === 8) {
        const [, name, size, fsize, family, series, shape, encoding] = f
        if (!size && fsize !== "SIZE") throw new Error(`${theme} [${option}]: beamer font ${name} sets a size with no size command (${fsize})`)
        const font: BeamerFont = {}
        if (size) font.size = size
        if (family !== SENTINEL.family) font.family = family
        if (series !== SENTINEL.series) font.series = series
        if (shape !== SENTINEL.shape) font.shape = shape
        if (encoding !== SENTINEL.encoding) font.encoding = encoding
        fonts[name] = font
      } else if (f[0] === "N" && f.length === 4) {
        // the font selected at the outer level is the class's for the attributes (what the engine looks up)
        const font = fonts[f[1]], k = cls.options[option]
        const size = font.size ?? "normalsize"
        const shape = `${font.encoding ?? "OT1"}/${font.family ?? "cmss"}/${font.series ?? "m"}/${font.shape ?? "n"}`
        const known = k.sizes[size as keyof typeof k.sizes]?.fonts[shape]
        if (known && known.name !== f[2].replace(/ at .*$/, "")) throw new Error(`${theme} [${option}]: beamer font ${f[1]} is ${f[2]}, not the class data's ${known.name}`)
      }
    }
    const missing = [...DIMENS.filter((d) => !(d in dimens)), ...colorNames.filter((c) => !(c in colors)), ...fontNames.filter((n) => !(n in fonts))]
    if (missing.length) throw new Error(`${theme} [${option}]: TeX did not report ${missing.join(", ")}`)
    data.options[option] = { dimens }
    // colors and fonts do not depend on the size option
    if (option === OPTIONS[0]) { data.colors = colors; data.fonts = fonts }
    else if (JSON.stringify(colors) !== JSON.stringify(data.colors) || JSON.stringify(fonts) !== JSON.stringify(data.fonts)) throw new Error(`${theme}: colors or fonts differ at ${option}`)
  }
  return data
}

export function codegenBeamer(check: boolean): number {
  const cls = JSON.parse(readFileSync("packages/engine/data/classes/beamer.json", "utf8")) as ClassData
  const stale: string[] = []
  runAll(Object.keys(THEMES), themeNames)
  for (const theme of Object.keys(THEMES)) {
    const body = JSON.stringify(themeData(theme, cls)) + "\n"
    const file = join(OUT, `${theme}.json`)
    if (existsSync(file) && readFileSync(file, "utf8") === body) continue
    stale.push(file)
    if (!check) { mkdirSync(OUT, { recursive: true }); writeFileSync(file, body) }
  }
  if (check) {
    console.log(stale.length ? `beamer theme data out of date: ${stale.join(", ")}\nrun: bun engine codegen` : `beamer theme data up to date (${Object.keys(THEMES).length} themes)`)
    return stale.length ? 1 : 0
  }
  console.log(stale.length ? `wrote ${stale.join(", ")}` : "beamer theme data unchanged")
  return 0
}
