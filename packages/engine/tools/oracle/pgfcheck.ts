// pgf system-layer oracle (#292): snippets of pgf's \pgfsys@ commands, typeset by TeX as
// `\setbox0\hbox{\nullfont <snippet>}\showbox0` with tikz loaded (a picture's \nullfont: every stray space in
// pgf's macros is a \glue 0.0) by latex (pgf's dvips driver) and by pdflatex (its pdftex driver), and run
// through pgf/'s driver for each. The box dumps must agree node by node: every \special's and \pdfliteral's
// text, every space, every box. A tiny reader of the snippet's commands drives the TS side. Fixed snippets
// cover each primitive, then seeded random sequences.
//   bun engine pgf:check [--n 2000] [--seed 1]

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { emitBoxes } from "../../emit/boxes"
import { Colors } from "../../latex/xcolor"
import { hpack } from "../../layout/pack"
import type { BoxNode as LayoutBox, RuleNode } from "../../layout/nodes"
import { TexArith } from "../../pgf/fixed"
import { DvipsDriver } from "../../pgf/drivers/dvips"
import { PdftexDriver } from "../../pgf/drivers/pdftex"
import type { ColorModel, PgfDriver } from "../../pgf/drivers"
import { pgfSetColor, pgfSetFillColor, pgfSetStrokeColor } from "../../pgf/graphicstate"
import { PgfState } from "../../pgf/state"
import { compareBoxLists, type BoxNode } from "../../trace/schema"
import { texEnv } from "../tex"
import { parseBoxDump } from "./boxes"

const DIR = ".cache/pgfcheck"
/** the colours both sides define first */
const COLORS: [string, string, string][] = [["mine", "HTML", "3A7FC0"], ["dark", "rgb", "0.1,0.2,0.3"], ["ink", "cmyk", "0.5,0,.25,1"], ["mid", "gray", "0.4"]]

interface Target { name: string; program: string; driver: (s: PgfState) => PgfDriver }
const TARGETS: Target[] = [
  { name: "dvips", program: "latex", driver: (s) => new DvipsDriver(s) },
  { name: "pdftex", program: "pdflatex", driver: (s) => new PdftexDriver(s) },
]

/** Each primitive, the colour paths, line widths, nested scopes and groups, boxes, spaces. */
const FIXED = [
  "",
  "\\pgfsys@moveto{1pt}{2.5pt}\\pgfsys@lineto{10cm}{-3pt}\\pgfsys@stroke",
  "\\pgfsys@moveto{0pt}{0pt}\\pgfsys@curveto{1pt}{2pt}{3pt}{4pt}{5pt}{6pt}\\pgfsys@closepath\\pgfsys@fill",
  "\\pgfsys@rect{1pt}{2pt}{3pt}{4pt}\\pgfsys@fillstroke",
  "\\pgfsys@rect{-1in}{.5cm}{72.27pt}{1sp}\\pgfsys@discardpath",
  "\\pgfsys@moveto{16383.99998pt}{-16383.99998pt}\\pgfsys@lineto{1em}{2ex}\\pgfsys@stroke",
  "\\pgfsys@clipnext\\pgfsys@discardpath\\pgfsys@clipnext\\pgfsys@stroke\\pgfsys@clipnext\\pgfsys@fill\\pgfsys@clipnext\\pgfsys@fillstroke",
  "\\pgfsys@eoruletrue\\pgfsys@fill\\pgfsys@clipnext\\pgfsys@discardpath\\pgfsys@clipnext\\pgfsys@stroke\\pgfsys@clipnext\\pgfsys@fill\\pgfsys@clipnext\\pgfsys@fillstroke\\pgfsys@fillstroke",
  "\\pgfsys@eoruletrue\\pgfsys@color@gray@fill{0.5}\\pgfsys@fill\\pgfsys@eorulefalse\\pgfsys@fill",
  "\\pgfsys@setlinewidth{0.4pt}\\pgfsys@setlinewidth{0.8pt}\\pgfsys@setlinewidth{1.2pt}\\pgfsys@setlinewidth{0pt}\\pgfsys@setlinewidth{3mm}",
  "\\pgfsys@setdash{}{0pt}\\pgfsys@setdash{3pt,3pt}{0pt}\\pgfsys@setdash{1pt, 2pt,3pt}{1.5pt}",
  "\\pgfsys@setmiterlimit{10}\\pgfsys@setmiterlimit{1.5}",
  "\\pgfsys@buttcap\\pgfsys@roundcap\\pgfsys@rectcap\\pgfsys@miterjoin\\pgfsys@roundjoin\\pgfsys@beveljoin",
  "\\pgfsys@color@rgb@stroke{1}{0}{0}\\pgfsys@stroke\\pgfsys@color@rgb@fill{0}{0.5}{1}\\pgfsys@fill\\pgfsys@fillstroke",
  "\\pgfsys@color@cmyk@stroke{1}{0}{0}{0}\\pgfsys@color@cmyk@fill{0}{1}{0}{0.5}\\pgfsys@color@cmy@stroke{1}{0}{0}\\pgfsys@color@cmy@fill{0}{1}{0}",
  "\\pgfsys@color@gray@stroke{0.2}\\pgfsys@color@rgb{1}{0}{0}\\pgfsys@color@gray{0.5}\\pgfsys@color@cmyk{0}{0}{0}{1}\\pgfsys@color@cmy{0}{0}{1}",
  "\\pgfsys@color@gray@fill{0.2}\\pgfsys@color@gray{0.5}\\pgfsys@color@reset@inorderfalse\\pgfsys@color@gray{0.5}\\pgfsys@color@reset",
  "\\pgfsetstrokecolor{red}\\pgfsetfillcolor{blue!30}\\pgfsys@fillstroke\\pgfsetcolor{red!30!green}\\pgfsys@stroke",
  "\\pgfsetstrokecolor{mine}\\pgfsetfillcolor{ink}\\pgfsetcolor{cyan}\\pgfsetcolor{mid}\\pgfsetstrokecolor{dark!50}\\pgfsetfillcolor{olive}\\pgfsetstrokecolor{-red}",
  "\\pgfsys@beginscope\\pgfsys@color@rgb@stroke{1}{0}{0}\\pgfsys@setlinewidth{0.8pt}\\pgfsys@rect{0pt}{0pt}{1pt}{2pt}\\pgfsys@stroke\\pgfsys@endscope\\pgfsys@stroke",
  "\\begingroup\\pgfsys@beginscope\\pgfsys@color@rgb@stroke{1}{0}{0}\\begingroup\\pgfsys@beginscope\\pgfsys@color@gray@fill{0}\\pgfsys@fillstroke\\pgfsys@endscope\\endgroup\\pgfsys@fillstroke\\pgfsys@endscope\\endgroup\\pgfsys@fillstroke",
  "{\\pgfsys@eoruletrue\\pgfsys@clipnext}\\pgfsys@fill{\\pgfsys@color@gray@stroke{0.2}}\\pgfsys@stroke",
  "\\pgfsys@transformcm{1}{0}{0}{1}{3pt}{4pt}\\pgfsys@transformcm{0.70711}{0.70711}{-0.70711}{0.70711}{-2cm}{0pt}",
  "\\pgfsys@transformshift{1pt}{-1pt}\\pgfsys@transformxyscale{2}{0.5}",
  "\\setbox1\\hbox{}\\pgfsys@hbox1\\pgfsys@hbox1",
  "\\setbox\\pgfcheckbox\\hbox{\\vrule width 2pt height 3pt}\\pgfsys@hbox\\pgfcheckbox\\pgfsys@hbox\\pgfcheckbox",
  "\\setbox1\\hbox{\\vrule height 1pt depth 2pt}\\pgfsys@hbox1\\pgfsys@begin@text\\pgfsys@stroke\\pgfsys@end@text\\pgfsys@fill",
  "\\pgfsys@begininvisible\\pgfsys@moveto{0pt}{0pt}\\pgfsys@stroke\\pgfsys@endinvisible",
  "\\pgfsys@stroke \\pgfsys@fill { }\\pgfsys@moveto{1pt}{1pt} \\pgfsys@stroke{}  {  }",
  "\\pgfsys@begin@text\\pgfsys@stroke\\pgfsys@beginpicture\\pgfsys@stroke\\pgfsys@endpicture\\pgfsys@stroke",
  "\\pgfsysprotocol@flushcurrentprotocol\\pgfsysprotocol@bufferedtrue\\pgfsys@moveto{1pt}{2pt}\\pgfsys@lineto{3pt}{4pt}\\pgfsys@stroke\\pgfsysprotocol@flushcurrentprotocol\\pgfsysprotocol@flushcurrentprotocol\\pgfsys@fill\\pgfsysprotocol@bufferedfalse\\pgfsys@fill",
  "{\\pgfsysprotocol@bufferedtrue\\pgfsys@setlinewidth{1pt}}\\pgfsys@setlinewidth{2pt}",
].map((body) => `\\pgfsys@beginpicture${body}\\pgfsys@endpicture`)

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

export function makeSnippets(n: number, seed: number): string[] {
  const r = rng(seed)
  const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)]
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))
  const digits = (k: number) => Array.from({ length: k }, () => String(int(0, 9))).join("")
  const dim = () => {
    const unit = pick(["pt", "pt", "pt", "bp", "cm", "mm", "in", "sp", "em", "pc", "dd"])
    const whole = unit === "sp" ? int(0, 999999) : unit === "pt" || unit === "bp" ? int(0, 9999) : int(0, 99)
    return `${pick(["", "", "-"])}${pick([String(whole), `${whole}.${digits(int(1, 6))}`, `.${digits(int(1, 3))}`, "0"])}${unit}`
  }
  const num = () => pick(["0", "1", "-1", "2", "0.5", ".25", `0.${digits(int(1, 5))}`, `-0.${digits(5)}`, `${int(0, 99)}.${digits(int(1, 3))}`])
  const unit = () => pick(["0", "1", "0.5", ".25", `0.${digits(int(1, 5))}`])
  const colorExpr = () => pick(["red", "blue", "green!50", "red!30!blue", "-red", "cyan", "magenta!20", "gray", "black", "white", "olive!40!ink", "mine", "dark", "ink", "mid", "dark!25!red"])
  const model = (): ColorModel => pick(["rgb", "cmyk", "cmy", "gray"])
  const args = (k: number, f: () => string) => Array.from({ length: k }, () => `{${f()}}`).join("")
  const box = () => pick(["\\hbox{}", `\\hbox{\\vrule width ${dim()}}`, `\\hbox{\\vrule height ${dim()} depth ${dim()}}`])
  const commands: (() => string)[] = [
    () => `\\pgfsys@moveto${args(2, dim)}`, () => `\\pgfsys@lineto${args(2, dim)}`, () => `\\pgfsys@curveto${args(6, dim)}`,
    () => `\\pgfsys@rect${args(4, dim)}`, () => "\\pgfsys@closepath",
    () => "\\pgfsys@stroke", () => "\\pgfsys@fill", () => "\\pgfsys@fillstroke", () => "\\pgfsys@clipnext", () => "\\pgfsys@discardpath",
    () => pick(["\\pgfsys@eoruletrue", "\\pgfsys@eorulefalse"]),
    () => `\\pgfsys@setlinewidth{${dim()}}`, () => `\\pgfsys@setdash{${Array.from({ length: int(0, 4) }, dim).join(",")}}{${dim()}}`,
    () => `\\pgfsys@setmiterlimit{${num()}}`,
    () => pick(["\\pgfsys@buttcap", "\\pgfsys@roundcap", "\\pgfsys@rectcap", "\\pgfsys@miterjoin", "\\pgfsys@roundjoin", "\\pgfsys@beveljoin"]),
    () => { const m = model(); return `\\pgfsys@color@${m}${pick(["@stroke", "@fill", ""])}${args(m === "gray" ? 1 : m === "cmyk" ? 4 : 3, unit)}` },
    () => `\\${pick(["pgfsetstrokecolor", "pgfsetfillcolor", "pgfsetcolor"])}{${colorExpr()}}`,
    () => pick(["\\pgfsys@color@reset", "\\pgfsys@color@reset@inorderfalse", "\\pgfsys@color@reset@inordertrue"]),
    () => pick(["\\pgfsys@beginscope", "\\pgfsys@endscope"]),
    () => `\\pgfsys@transformcm${args(4, num)}${args(2, dim)}`, () => `\\pgfsys@transformshift${args(2, dim)}`, () => `\\pgfsys@transformxyscale${args(2, num)}`,
    () => pick([`\\setbox1${box()}\\pgfsys@hbox1`, `\\setbox\\pgfcheckbox${box()}\\pgfsys@hbox\\pgfcheckbox`, "\\pgfsys@hbox1", "\\pgfsys@hbox\\pgfcheckbox"]),
    () => pick(["\\pgfsys@begininvisible", "\\pgfsys@endinvisible", "\\pgfsys@begin@text", "\\pgfsys@end@text"]),
    () => pick([" ", "{ }", "{}"]),
    () => pick(["\\pgfsysprotocol@bufferedtrue", "\\pgfsysprotocol@bufferedfalse", "\\pgfsysprotocol@flushcurrentprotocol", "\\pgfsys@beginpicture", "\\pgfsys@endpicture"]),
  ]
  const body = (depth: number): string => {
    let out = ""
    for (let k = int(1, 8); k > 0; k--) {
      out += depth < 2 && r() < 0.1 ? pick([`{${body(depth + 1)}}`, `\\begingroup${body(depth + 1)}\\endgroup`, `\\pgfsys@beginscope${body(depth + 1)}\\pgfsys@endscope`]) : pick(commands)()
      if (r() < 0.1) out += " "
    }
    return out
  }
  return Array.from({ length: n }, () => `\\pgfsys@beginpicture${body(0)}\\pgfsys@endpicture`)
}

/** The snippet's commands on a driver: TeX's tokens as the snippet has them (spaces after a control word skipped). */
export function runSnippet(src: string, driver: PgfDriver, colors: Colors): void {
  const s = driver.state
  const a = new TexArith({ em: 0, ex: 0 }) // \nullfont's quad and x-height
  const boxes = new Map<string, LayoutBox | null>()
  // \setbox is local: the first one in a group saves the register's value for the group's end (eq_save);
  // \box empties the register without saving
  const saved: Map<string, LayoutBox | null>[] = []
  const assign = (reg: string, b: LayoutBox) => {
    const level = saved[saved.length - 1]
    if (level && !level.has(reg)) level.set(reg, boxes.get(reg) ?? null)
    boxes.set(reg, b)
  }
  const begingroup = () => { s.begingroup(); saved.push(new Map()) }
  const endgroup = () => { s.endgroup(); for (const [reg, b] of saved.pop() ?? []) boxes.set(reg, b) }
  let i = 0
  const skipSpaces = () => { while (/\s/.test(src[i] ?? "")) i++ }
  const controlWord = () => {
    const m = src.slice(i).match(/^\\([A-Za-z@]+)/)
    if (!m) throw new Error(`pgf:check: no control word at ${i} in ${src}`)
    i += m[0].length
    skipSpaces()
    return m[1]
  }
  /** an undelimited argument: a braced group without its braces, or one token */
  const arg = (): string => {
    skipSpaces()
    if (src[i] === "\\") return `\\${controlWord()}`
    if (src[i] !== "{") return src[i++]
    let depth = 0
    const start = i
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++
      else if (src[i] === "}" && --depth === 0) break
    }
    return src.slice(start + 1, i++)
  }
  const dims = (k: number) => Array.from({ length: k }, () => a.dimen(arg()))
  const strs = (k: number) => Array.from({ length: k }, arg)
  /** \setbox<register>\hbox{} or \hbox{\vrule <spec>} */
  const setbox = () => {
    const reg = arg()
    if (controlWord() !== "hbox") throw new Error(`pgf:check: \\setbox${reg} takes an \\hbox`)
    const body = arg().trim()
    if (body === "") { assign(reg, hpack([])); return }
    const m = body.match(/^\\vrule((?:\s*(?:width|height|depth)\s*\S+)*)$/)
    if (!m) throw new Error(`pgf:check: box ${body}`)
    const rule: RuleNode = { kind: "rule", width: 26214, height: null, depth: null } // \vrule's default width 0.4pt
    for (const [, k, v] of m[1].matchAll(/(width|height|depth)\s*(\S+)/g)) rule[k as "width" | "height" | "depth"] = a.dimen(v)
    assign(reg, hpack([rule]))
  }
  const sys: Record<string, () => void> = {
    beginpicture: () => driver.beginPicture(), endpicture: () => driver.endPicture(),
    moveto: () => driver.moveto(...(dims(2) as [number, number])), lineto: () => driver.lineto(...(dims(2) as [number, number])),
    curveto: () => driver.curveto(...(dims(6) as [number, number, number, number, number, number])),
    rect: () => driver.rect(...(dims(4) as [number, number, number, number])), closepath: () => driver.closepath(),
    stroke: () => driver.stroke(), fill: () => driver.fill(), fillstroke: () => driver.fillstroke(),
    clipnext: () => driver.clipnext(), discardpath: () => driver.discardpath(),
    eoruletrue: () => { s.sw.eoRule = true }, eorulefalse: () => { s.sw.eoRule = false },
    transformcm: () => { const [p, q, u, v] = strs(4); const [x, y] = dims(2); driver.transformcm(p, q, u, v, x, y) },
    transformshift: () => driver.transformshift(...(dims(2) as [number, number])),
    transformxyscale: () => driver.transformxyscale(...(strs(2) as [string, string])),
    beginscope: () => driver.beginscope(), endscope: () => driver.endscope(),
    setlinewidth: () => driver.setlinewidth(dims(1)[0]),
    setdash: () => { const p = arg(); driver.setdash(p === "" ? [] : p.split(",").map((x) => a.dimen(x)), dims(1)[0]) },
    setmiterlimit: () => driver.setmiterlimit(arg()),
    buttcap: () => driver.cap("butt"), roundcap: () => driver.cap("round"), rectcap: () => driver.cap("rect"),
    miterjoin: () => driver.join("miter"), roundjoin: () => driver.join("round"), beveljoin: () => driver.join("bevel"),
    "color@reset": () => driver.colorReset(),
    "color@reset@inordertrue": () => { s.sw.colorResetInOrder = true }, "color@reset@inorderfalse": () => { s.sw.colorResetInOrder = false },
    hbox: () => { const reg = arg(); driver.hbox(boxes.get(reg) ?? null, reg.startsWith("\\")); boxes.set(reg, null) },
    begininvisible: () => driver.beginInvisible(), endinvisible: () => driver.endInvisible(),
    "begin@text": () => driver.beginText(), "end@text": () => driver.endText(),
  }
  const commands: Record<string, () => void> = {
    begingroup, endgroup, setbox,
    "pgfsysprotocol@bufferedtrue": () => { s.sw.buffered = true }, "pgfsysprotocol@bufferedfalse": () => { s.sw.buffered = false },
    "pgfsysprotocol@flushcurrentprotocol": () => driver.flush(),
    pgfsetstrokecolor: () => pgfSetStrokeColor(driver, colors.spec(arg())),
    pgfsetfillcolor: () => pgfSetFillColor(driver, colors.spec(arg())),
    pgfsetcolor: () => pgfSetColor(driver, colors.spec(arg())),
  }
  while (i < src.length) {
    const c = src[i]
    if (c === "{") { begingroup(); i++; continue }
    if (c === "}") { endgroup(); i++; continue }
    if (/\s/.test(c)) { s.space(); skipSpaces(); continue }
    const name = controlWord()
    const m = name.match(/^pgfsys@color@(rgb|cmyk|cmy|gray)(?:@(stroke|fill))?$/)
    if (m) { const model = m[1] as ColorModel; driver.color(model, (m[2] ?? "both") as "stroke" | "fill" | "both", strs(model === "gray" ? 1 : model === "cmyk" ? 4 : 3)); continue }
    const f = name.startsWith("pgfsys@") ? sys[name.slice(7)] : commands[name]
    if (!f) throw new Error(`pgf:check: unknown command \\${name}`)
    f()
  }
}

/** TeX's box for each snippet (or its error), from one run per target, cached while the snippets stay the same */
function texBoxes(t: Target, snippets: string[]): (BoxNode | string)[] {
  mkdirSync(DIR, { recursive: true })
  const tex = [
    "\\documentclass{article}", "\\usepackage{tikz}", "\\newbox\\pgfcheckbox", ...COLORS.map(([n, m, v]) => `\\definecolor{${n}}{${m}}{${v}}`),
    "\\showboxdepth=100 \\showboxbreadth=100000", "\\begin{document}", "\\makeatletter",
    // (the protocol is global: what one snippet leaves buffered must not reach the next)
    ...snippets.map((x, i) => `\\immediate\\write16{C:${i}}\\global\\let\\pgfsysprotocol@currentprotocol\\pgfutil@empty\\setbox0\\hbox{\\nullfont ${x}}\\showbox0`), "\\end{document}", "",
  ].join("\n")
  const file = join(DIR, `${t.name}.tex`), log = join(DIR, `${t.name}.log`)
  if (!existsSync(file) || readFileSync(file, "utf8") !== tex || !existsSync(log) || !/^(No pages of output|Output written)/m.test(readFileSync(log, "latin1"))) {
    writeFileSync(file, tex)
    const run = spawnSync(t.program, ["-interaction=nonstopmode", `${t.name}.tex`], { cwd: DIR, env: texEnv({ max_print_line: "100000" }), stdio: "ignore", timeout: 600_000 })
    if (run.error) throw run.error
  }
  const out: (BoxNode | string)[] = []
  const lines = readFileSync(log, "latin1").split("\n")
  let cur = -1
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^C:(\d+)$/)
    if (m) { cur = Number(m[1]); continue }
    if (cur < 0) continue
    if (lines[i] === "> \\box0=") { const { box, end } = parseBoxDump(lines, i + 1); if (out[cur] === undefined) out[cur] = box; i = end; continue }
    if (lines[i].startsWith("! ") && lines[i] !== "! OK.") out[cur] = `TeX error: ${lines[i].slice(2)}`
  }
  return out
}

export function pgfCheck(n: number, seed: number): number {
  const snippets = [...FIXED, ...makeSnippets(n, seed)]
  let failed = 0
  for (const t of TARGETS) {
    const tex = texBoxes(t, snippets)
    let same = 0
    snippets.forEach((src, i) => {
      const expected = tex[i]
      if (expected === undefined) throw new Error(`TeX showed no box for snippet ${i} (${DIR}/${t.name}.log)`)
      let problem: string
      if (typeof expected === "string") problem = expected
      else {
        try {
          const state = new PgfState()
          const colors = new Colors()
          for (const [name, model, values] of COLORS) colors.define(name, model, values)
          runSnippet(src, t.driver(state), colors)
          const d = compareBoxLists([expected], [emitBoxes(hpack(state.out))])
          if (!d) { same++; return }
          problem = `${d.path} ${d.field}\n    TeX:    ${JSON.stringify(d.expected)}\n    engine: ${JSON.stringify(d.actual)}`
        } catch (e) {
          problem = `engine: ${(e as Error).message}`
        }
      }
      failed++
      if (failed <= 10) console.log(`✗ [${t.name}] ${src}\n    ${problem}`)
    })
    console.log(`${same}/${snippets.length} pgf snippets identical to TeX under ${t.name} (seed ${seed})`)
  }
  return failed ? 1 : 0
}
