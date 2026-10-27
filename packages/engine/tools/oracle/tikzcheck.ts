// TikZ oracle (#309): whole tikzpictures (and \tikz) typeset by TeX as `\setbox0\hbox{<picture>}\showbox0`
// with tikz loaded, by latex (pgf's dvips driver) and by pdflatex (its pdftex driver), and through
// tikz/path.ts on pgf/ for each. The box dumps must agree node by node: the picture's box and its size and
// shift, every \special's and \pdfliteral's text, every space TikZ's macros leave. Fixed pictures cover each
// path command, operation, coordinate kind and option, then seeded random pictures: paths of random
// operations and coordinates under random options, transformations, scopes and groups. What TeX stops at
// with an error must be the engine's Unsupported.
//   bun engine tikz:check [--n 1000] [--seed 1]

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { emitBoxes } from "../../emit/boxes"
import { UNITY } from "../../layout/arith"
import { loadFont, QUAD, X_HEIGHT } from "../../layout/font"
import { hpack } from "../../layout/pack"
import type { Node } from "../../layout/nodes"
import { pdftexColors } from "../../latex/pdftex"
import { Unsupported } from "../../latex/unsupported"
import { Colors, xcolor } from "../../latex/xcolor"
import { DvipsDriver } from "../../pgf/drivers/dvips"
import { PdftexDriver } from "../../pgf/drivers/pdftex"
import type { PgfDriver } from "../../pgf/drivers"
import type { PgfUnits } from "../../pgf/mathparser"
import { PgfState } from "../../pgf/state"
import { TikzDocument } from "../../tikz/path"
import { compareBoxLists, type BoxNode } from "../../trace/schema"
import { dataFont } from "../fonts"
import { texEnv } from "../tex"
import { parseBoxDump } from "./boxes"

const DIR = ".cache/tikzcheck"
/** the colours both sides define first */
const COLORS: [string, string, string][] = [["mine", "HTML", "3A7FC0"], ["dark", "rgb", "0.1,0.2,0.3"], ["ink", "cmyk", "0.5,0,.25,1"], ["mid", "gray", "0.4"]]

interface Target { name: string; program: string; driver: (s: PgfState) => PgfDriver }
const TARGETS: Target[] = [
  { name: "dvips", program: "latex", driver: (s) => new DvipsDriver(s) },
  { name: "pdftex", program: "pdflatex", driver: (s) => new PdftexDriver(s) },
]

const pic = (body: string, options = "") => `\\begin{tikzpicture}${options}${body}\\end{tikzpicture}`

/** Each command, operation, coordinate and option; scopes, groups, \tikz. */
const FIXED = [
  pic(""),
  pic("\n\\draw (0,0) -- (1,0);\n"),
  pic("\\draw (0,0) rectangle (1,1);"),
  pic("\\draw[red] (0,0) circle (1);"),
  pic("\\draw[draw=red,thick] (0,0) -- (1,0) to (2,1);"),
  pic("\\draw (0,0) -- ++(1,0) -- +(0,1) -- cycle (3,0) ellipse (1 and 2);"),
  pic("\\draw (0,0) -| (1,1) |- (2,2) -- (3pt,4pt) -- (1cm,2) -- (2,1cm);"),
  pic("\\draw (30:1cm) -- (0:1) -- (up:2) -- (north west:1cm and 2cm) -- (45:1 and 2);"),
  pic("\\fill (0,0) rectangle (2,1); \\filldraw[fill=blue!20] (0,0) circle (5pt); \\path (5,5);"),
  pic("\\fill[green] (0,0) -- (1,1) -- (1,0) -- cycle;"),
  pic("\\draw[thick,dashed] (0,0) -- (1,0); \\draw[dotted,line width=2pt] (0,1) -- (1,1); \\draw[dash dot] (0,2) -- (2,2);"),
  pic("\\begin{scope}[xshift=1cm,red] \\draw (0,0) -- (1,0); \\end{scope}\n\\draw (0,0) -- (0,1);"),
  pic("\\begin{scope}\\draw[rotate=30] (0,0) rectangle (1,1);\\end{scope}"),
  pic("\\draw[scale=2] (0,0) -- (1,1); \\draw[shift={(1,2)}] (0,0) -- (1,0); \\draw[xscale=-1,yshift=3pt] (0,0) -- (1,0);"),
  pic("\\clip (0,0) rectangle (2,2); \\draw (-1,-1) -- (3,3);"),
  pic("\\clip[red] (0,0) rectangle (2,2);"),
  pic("\\useasboundingbox (0,0) rectangle (1,1); \\draw (-1,-1) -- (3,3);"),
  pic("\\draw (0,0) -- (1,0) [red] -- (1,1) [line width=1pt] -- (0,1);"),
  pic("\\draw (0,0) -- (1pt, +2pt) -- ( +1pt,0pt) -- (+1, 1);"),
  pic("\\draw[draw=red,color=blue,green] (0,0) -- (1,0); \\fill[fill=red,color=blue] (0,0) circle (1pt);"),
  pic("\\draw (0,0) {coordinate (a) -- (1,0)} -- (2,0); \\draw (a) -- (0,1);"),
  pic("\\begin{scope}[scale=0.5,rotate=10] \\coordinate[yshift=1cm] (a) at (1,2); \\coordinate[xshift=2pt,rotate=5] (b) at (1,2); \\end{scope} \\draw (a) -- (b);"),
  pic("\\coordinate (a) at (1,2); \\draw[shift={(1,1)},rotate=30] (a) -- (0,0); \\draw[shift={(1,1)},xscale=2] (a) -- (0,0); \\draw[shift={(1,1)},xslant=1] (a) -- (0,0);"),
  pic("\\draw (0,0) to (1,1) to[red] (2,0);"),
  pic("\\draw (0,0) to (1,1) to +(1,0) to ++(0,1);"),
  pic("\\draw (0,0) circle[radius=2pt] (1,1) circle[x radius=1, y radius=5mm] (2,2) ellipse[radius=1cm];"),
  pic("\\draw (0,0) {-- (1,0) [red] -- (1,1)} -- (0,1);"),
  pic("\\draw[color=red] (0,0) -- (1,0); \\draw[blue,fill=red] (0,0) rectangle (1,1); \\draw[color=red,draw=blue] (0,0) -- (1,0);"),
  pic("\\draw[help lines] (0,0) -- (2,0); \\draw[very thick,gray] (0,0) -- (0,2);"),
  pic("\\draw (0,0) -- (1,0);", "[baseline=3pt]"),
  pic("\\draw (0,0) -- (1,0);", "[scale=0.5,thick]"),
  pic("\\tikzset{every path/.style={red}} \\draw (0,0) -- (1,0);"),
  pic("\\draw (1,2 |- 3,4) -- (1,2 -| 3,4) -- (1,2|-3,4);"),
  pic("\\draw (0,0) -- (1,0);\n\n\\draw (0,1) -- (1,1); % comment\n\\draw (0,2) -- (1,2);"),
  pic("{\\draw[red] (0,0) -- (1,0);} {\\tikzset{thick} \\draw (0,0) -- (0,1);}"),
  pic("\\coordinate (a) at (1,2);"),
  pic("\\coordinate (a) at (1,2);\\draw (a) -- (0,0) -| (1,1) |- (2,2);"),
  pic("\\coordinate (a) at (1,2); \\coordinate (b) at (30:1cm); \\draw[rotate=30] (a) -- (b.north) -- (a |- b) -- (b -| a.center);"),
  pic("\\draw (1,2) coordinate (a) -- (3,1) coordinate (b) (0,0) coordinate[red] (c); \\draw[xshift=1cm,scale=2] (a) rectangle (b) (c) circle (1pt);"),
  pic("\\begin{scope}[rotate=20,xshift=3pt] \\coordinate (a) at (1,1); \\end{scope} \\draw[scale=0.5,yslant=0.2] (a) -- (0,0); \\draw[xscale=3] (0,0) -- (a);"),
  pic("\\path (0,0) coordinate (p) -- (2,1) coordinate (q); \\draw (p) to (q) -- +(1,0) coordinate (r) (r) -- (p);"),
  "\\tikz \\draw (0,0) -- (1,0);",
  "\\tikz[baseline=-0.5ex] \\draw (0,0) circle (2pt);",
  "\\tikz{\\draw (0,0) -- (1,0); \\fill (0,0) circle (1pt);}",
  "\\tikz[red]{\\draw (0,0) -- (1,0)}",
]

/** What TeX typesets but the engine does not model yet: it must refuse each. */
const REFUSED = [
  pic("\\draw ([xshift=1cm]0,0) -- (1,0);"), pic("\\draw ($(0,0)+(1,0)$) -- (1,0);"), pic("\\node at (0,0) {x};"), pic("\\draw (0,0) node {x} -- (1,0);"),
  pic("\\draw[->] (0,0) -- (1,0);"), pic("\\draw[rounded corners] (0,0) -- (1,0) -- (1,1);"), pic("\\draw (0,0) to[out=90,in=0] (1,1);"),
  pic("\\draw (0,0) arc (0:90:1);"), pic("\\draw (0,0) edge (1,0);"), pic("\\draw (0,0) grid (2,2);"), pic("\\foreach \\x in {1,2} \\draw (\\x,0) -- (0,0);"),
  pic("\\draw (0,0) .. controls (1,1) .. (2,0);"), pic("\\draw (0,0) -- (1,0,1);"), pic("\\draw (0,0) -- (1,{2});"), pic("\\draw[x=2cm] (0,0) -- (1,0);"),
  pic("\\draw (0,0) -- (1,0);", "[baseline=(current bounding box.center)]"), pic("\\draw[red] (0,0) -- (1,0) [.] -- (0,1);"),
  pic("\\coordinate (a) at (0,0); \\draw (a.text) -- (1,0);"), pic("\\draw (0,0) -- (b);"), pic("\\draw (0,0) -- (1cm,1) arc[radius=1, start angle=0, end angle=90];"),
]

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

/** Random pictures: paths of random operations and coordinates under random options, scopes and groups. */
export function makePictures(n: number, seed: number): string[] {
  const r = rng(seed * 7919 + 29)
  const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)]
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))
  const digits = (k: number) => Array.from({ length: k }, () => String(int(0, 9))).join("")
  const num = () => `${pick(["", "", "-"])}${pick([String(int(0, 3)), `${int(0, 2)}.${digits(int(1, 3))}`, `.${digits(int(1, 2))}`])}`
  const len = () => `${num()}${pick(["pt", "cm", "mm", "em", "ex", "bp", "in"])}`
  const sp = () => pick(["", "", "", " "])
  return Array.from({ length: n }, (_, k) => {
    // the coordinates named by the paths so far, and by the current path (their names the picture's own:
    // TeX's are global and outlive a picture)
    const names: string[] = [], pending: string[] = []
    const coord = (): string => pick([
      () => `(${sp()}${num()},${sp()}${num()}${sp()})`, () => `(${num()},${num()})`, () => `(${len()},${len()})`, () => `(${len()},${num()})`, () => `(${num()},${len()})`,
      () => `(${int(-180, 360)}:${pick([num, len])()})`, () => `(${int(0, 90)}:${num()} and ${num()})`, () => `(${pick(["up", "down", "left", "right", "north east", "south west"])}:${len()})`,
      () => `(${num()},${num()} |- ${num()},${num()})`, () => `(${num()},${num()}-|${num()},${num()})`,
      () => (names.length ? `(${pick(names)}${pick(["", "", ".center", ".north", " |- 1,1", " -| 0,2"])})` : `(${num()},${num()})`),
    ])()
    const target = () => pick([coord, coord, coord, () => `+${coord()}`, () => `++${coord()}`])()
    const color = () => pick(["red", "blue!30", "green!50!black", "mine", "dark", "ink", "mid", "gray", "cyan", "."])
    const transform = () => pick([`xshift=${len()}`, `yshift=${len()}`, `scale=${pick(["2", "0.5", "1.5", "-1"])}`, `rotate=${int(-90, 90)}`, `xscale=${pick(["2", "0.5"])}`,
      `shift={(${num()},${num()})}`, `xslant=${pick(["0.5", "-1", "0.2"])}`, `yslant=${pick(["0.3", "1"])}`])
    const option = () => pick([
      () => pick(["thick", "thin", "very thick", "ultra thin", "semithick", `line width=${int(0, 3)}.${digits(1)}pt`, "help lines"]),
      () => pick(["dashed", "dotted", "densely dotted", "loosely dashed", "dash dot", "solid", "dash pattern=on 2pt off 1pt", "dash phase=1pt"]),
      () => pick([`draw=${color()}`, `fill=${color()}`, `color=${color()}`, color().replace(".", "red"), "draw", "fill", "draw=none", "fill=none"]),
      transform,
    ])()
    const options = () => (r() < 0.5 ? "" : `[${Array.from({ length: int(1, 3) }, option).join(",")}]`)
    const name = () => { const x = `${pick(["a", "b", "c", "p", "q"])}${k}`; pending.push(x); return x }
    const operation = (): string => pick([
      () => ` -- ${target()}`, () => ` -- ${target()}`, () => ` -| ${coord()}`, () => ` |- ${coord()}`, () => ` rectangle ${target()}`,
      () => ` circle (${pick([len, num])()})`, () => ` ellipse (${num()} and ${num()})`, () => ` circle[radius=${pick([len, num])()}${r() < 0.3 ? `,${transform()}` : ""}]`,
      () => " -- cycle", () => ` to${r() < 0.2 ? `[${option()}]` : ""} ${target()}`, () => ` ${coord()}`, () => ` [${option()}]`,
      () => ` coordinate${r() < 0.2 ? `[${transform()}]` : ""} (${name()})`, () => ` {[${option()}] -- ${target()}}`,
    ])()
    const path = () => {
      names.push(...pending.splice(0))
      if (r() < 0.12) return `\\coordinate${r() < 0.2 ? `[${transform()}]` : ""} (${name()}) at ${target()};`
      // (a clipping path takes no options: TeX's error, kept to the fixed pictures)
      const cmd = pick(["\\draw", "\\draw", "\\fill", "\\filldraw", "\\path", "\\clip", "\\useasboundingbox"])
      const ops = Array.from({ length: int(1, 5) }, operation).join("")
      return `${cmd}${cmd === "\\clip" ? "" : options()} ${coord()}${cmd === "\\clip" ? ops.replace(/ \[[^\]]*\]/g, "") : ops};`
    }
    const body = (depth: number): string => {
      let out = ""
      for (let k = int(1, 4); k > 0; k--) {
        out += depth < 2 && r() < 0.15 ? pick([() => `\\begin{scope}${options()}${body(depth + 1)}\\end{scope}`, () => `{${body(depth + 1)}}`])() : path()
        out += pick(["", "", "\n", " "])
      }
      return out
    }
    const pictureOptions = () => (r() < 0.2 ? `[baseline=${len()}]` : options())
    return pick([
      () => `\\tikz${pictureOptions()} ${path()}`,
      () => `\\tikz${pictureOptions()}{${body(1)}}`,
      () => pic(body(0), pictureOptions()), () => pic(body(0), pictureOptions()), () => pic(body(0), pictureOptions()),
    ])()
  })
}

/** TeX's box for each picture (or its error), from one run per target, cached while the pictures stay the same */
function texBoxes(t: Target, pictures: string[]): (BoxNode | string)[] {
  mkdirSync(DIR, { recursive: true })
  const tex = [
    "\\documentclass{article}", "\\usepackage{tikz}", ...COLORS.map(([n, m, v]) => `\\definecolor{${n}}{${m}}{${v}}`),
    "\\showboxdepth=100 \\showboxbreadth=100000", "\\begin{document}",
    // (pgf's globals one picture leaves must not reach the next)
    ...pictures.map((x, i) => `\\immediate\\write16{C:${i}}\\makeatletter\\gdef\\pgfsyssoftpath@lastmoveto{{0pt}{0pt}}\\makeatother\\setbox0\\hbox{${x}}\\showbox0`), "\\end{document}", "",
  ].join("\n")
  const file = join(DIR, `${t.name}.tex`), log = join(DIR, `${t.name}.log`)
  if (!existsSync(file) || readFileSync(file, "utf8") !== tex || !existsSync(log) || !/^(No pages of output|Output written)/m.test(readFileSync(log, "latin1"))) {
    writeFileSync(file, tex)
    const run = spawnSync(t.program, ["-interaction=nonstopmode", `${t.name}.tex`], { cwd: DIR, env: texEnv({ max_print_line: "100000" }), stdio: "ignore", timeout: 900_000 })
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

/** the engine's box for a picture under a target */
export function enginePicture(src: string, t: Target, units: PgfUnits): Node[] {
  const s = new PgfState(units)
  const colors = new Colors()
  for (const [name, model, values] of COLORS) colors.define(name, model, values)
  const doc = new TikzDocument({ units, colors })
  doc.picture(src, s, t.driver(s), xcolor.normal)
  const box = hpack(s.out)
  if (t.name === "pdftex") pdftexColors(box)
  return [box]
}

export function tikzCheck(n: number, seed: number): number {
  const f = loadFont(dataFont("cmr10"), 10 * UNITY) // \pgfmath@selectfont: the document's \normalfont
  const units: PgfUnits = { em: f.params[QUAD], ex: f.params[X_HEIGHT] }
  const pictures = [...FIXED, ...makePictures(n, seed)]
  let failed = 0
  for (const src of REFUSED) {
    try {
      enginePicture(src, TARGETS[0], units)
      failed++
      console.log(`✗ the engine typesets what it does not model: ${src}`)
    } catch (e) {
      if (!(e instanceof Unsupported)) throw e
    }
  }
  for (const t of TARGETS) {
    const tex = texBoxes(t, pictures)
    let same = 0, refused = 0, unsupported = 0
    pictures.forEach((src, i) => {
      const expected = tex[i]
      if (expected === undefined) throw new Error(`TeX showed no box for picture ${i} (${DIR}/${t.name}.log)`)
      let problem: string
      try {
        const box = enginePicture(src, t, units)
        if (typeof expected === "string") problem = `${expected}\n    engine: no error`
        else {
          const d = compareBoxLists([expected], box.map(emitBoxes))
          if (!d) { same++; return }
          problem = `${d.path} ${d.field}\n    TeX:    ${JSON.stringify(d.expected)}\n    engine: ${JSON.stringify(d.actual)}`
        }
      } catch (e) {
        if (!(e instanceof Unsupported)) throw e
        // what TeX stops at with an error, the engine refuses; what the engine does not model yet, it refuses too
        if (typeof expected === "string") { same++; refused++; return }
        unsupported++
        problem = `engine: ${e.message}`
      }
      failed++
      if (failed <= 10) console.log(`✗ [${t.name}] #${i} ${src}\n    ${problem}`)
    })
    console.log(`${same}/${pictures.length} TikZ pictures identical to TeX under ${t.name} (seed ${seed})${refused ? `, ${refused} of them TeX errors the engine refuses` : ""}${unsupported ? `; ${unsupported} outside the subset` : ""}`)
  }
  return failed ? 1 : 0
}
