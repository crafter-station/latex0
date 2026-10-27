// TikZ option oracle (#302): random option lists through TeX's \tikzset inside a tikzpicture and through
// tikz/options.ts. Before each list, random style definitions (\tikzset with .style, .append style,
// .prefix style, .code, .initial, .default, .is choice, nested styles; \tikzstyle); then the list. TeX prints
// TikZ's state with \meaning and \the: \pgflinewidth, \tikz@options, \tikz@mode, \tikz@transform (made a
// macro first, so that transformations are collected rather than applied), the three colors (and their
// values through xcolor's \extractcolorspecs), the dash pattern and phase, \pgf@corner@arc, the node macros
// (anchor, auto anchor, shape, node distance, \tikz@node@at, positioning's shift and on grid, text width,
// font, text action, halign header), pgf's node keys (inner and outer sep, minimum sizes), the arrow tip
// sequences and \pgf@ar@means@>, and the values of the keys the definitions made. The engine's state must
// print the same, field by field. Two documents: TikZ alone, and with the positioning and arrows.meta
// libraries (and nodes a and b to place against).
//   bun engine tikzkeys:check [--n 3000] [--seed 1]

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { printScaled, UNITY } from "../../layout/arith"
import { loadFont, QUAD, X_HEIGHT } from "../../layout/font"
import { Colors } from "../../latex/xcolor"
import type { PgfUnits } from "../../pgf/mathparser"
import { tipsMeaning, type Tip } from "../../tikz/arrows"
import { Tikz, type NodeAt, type OptionCall, type TextAction, type TikzState, type TransformCall } from "../../tikz/options"
import { meaning, tokenize, type Toks } from "../../tikz/tokens"
import { dataFont } from "../fonts"
import { texEnv } from "../tex"

const DIR = ".cache/tikzkeys"

type Lib = "core" | "lib"
/** a definition before the picture: \tikzset{text} or \tikzstyle text */
interface Def { kind: "set" | "style"; text: string }
/** `inner` and `after` (when given): \tikzset{options}\begingroup\tikzset{inner}\endgroup\tikzset{after} */
/** `error`: TeX reports an error (the engine must refuse); `unsupported`: TeX goes on, the engine must refuse */
interface Case { lib: Lib; defs: Def[]; options: string; reads: string[]; inner?: string; after?: string; error?: true; unsupported?: true }

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

/** the colors both sides define */
const COLORS: [string, string, string][] = [["mine", "HTML", "3A7FC0"], ["ink", "cmyk", "0.5,0,.25,1"]]

const COLOR_EXPRS = ["red", "blue", "green!50!black", "blue!20!white", "orange", "black!40", "gray", "cyan", "mine", "red!50", "violet!30", "ink", "teal!70!blue", "white"]
const DIMS = ["2pt", "0.5mm", "1.5", "3pt", "1em", "0.8ex", "2mm", "0pt", "1cm", "-1pt", "1.2pt", "1pt+2pt", "2*1.5pt", ".75pt", "4bp", "1in/10"]
const LENGTHS = ["1cm", "2mm", "5pt", "0.5cm", "2em", "1.5ex", "0pt", "3pt"]

/** an option item for a document; `lib` adds the libraries' */
function optionItem(r: () => number, lib: Lib, styles: string[]): string {
  const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)]
  const sp = () => (r() < 0.15 ? " " : "")
  const choices: (() => string)[] = [
    () => pick(["draw", "fill", "draw=none", "fill=none", "draw =none"]),
    () => `${pick(["draw", "fill", "color", "text"])}=${sp()}${pick(COLOR_EXPRS)}`,
    () => pick(COLOR_EXPRS),
    () => pick(["ultra thin", "very thin", "thin", "semithick", "thick", "very thick", "ultra thick", "help lines"]),
    () => `line width=${sp()}${pick(DIMS)}`,
    () => pick(["dashed", "dotted", "densely dotted", "loosely dotted", "densely dashed", "loosely dashed", "dashdotted", "dash dot", "densely dash dot", "loosely dashdotted", "dashdotdotted", "densely dash dot dot", "solid"]),
    () => `dash pattern=${pick(["on 2pt off 1pt", "{on 4pt off 2pt on 1pt off 2pt}", "on 1mm off 0.5mm", "", "on \\pgflinewidth off 3pt", "on 3pt  off 1pt ", "on{2pt}off{1pt}"])}`,
    () => `dash phase=${pick(["1pt", "0.5mm", "2pt"])}`,
    () => pick(["rounded corners", "sharp corners", `rounded corners=${pick(DIMS)}`]),
    () => `anchor=${pick(["north", "south west", "base", "center", "east"])}`,
    () => `${pick(["inner sep", "inner xsep", "inner ysep", "outer sep", "outer xsep", "outer ysep", "minimum width", "minimum height", "minimum size", "/pgf/inner sep", "/pgf/minimum width"])}=${pick(LENGTHS)}`,
    () => `text width=${pick(LENGTHS)}`,
    () => `align=${pick(["left", "center", "right", "flush left", "flush center", "flush right", "justify", "none"])}`,
    () => `font=${pick(["\\bfseries", "\\small\\itshape", "\\tiny", "{\\sffamily}", "{\\bfseries}{\\itshape}"])}`,
    () => pick(["text ragged", "text centered", "text badly centered", "text justified", "text ragged left", "text badly ragged"]),
    () => pick(["circle", "rectangle", "coordinate", "shape=circle", "shape=rectangle"]),
    () => `node distance=${pick(["2cm", "1.5cm and 2cm", "5mm", "1", "3em"])}`,
    () => pick(["auto", "auto=right", "auto=left", "auto=false", "swap", "'"]),
    () => `${pick(["above", "below", "left", "right", "above left", "above right", "below left", "below right"])}${r() < 0.4 ? "" : `=${pick(LENGTHS)}`}`,
    () => `${pick(["right of", "above of", "below left of", "left of", "above right of"])}=${pick(["a", "b"])}`,
    () => pick(["->", "<-", "<->", "-latex", "stealth-", "|-|", "->>", "-To", "-to", "latex-latex", "-", "<<-", "-.", "- >", "-{to}", ">-<", "|<-", "<|-", ">|-", "->|", "-|>", ".<-"]),
    () => `arrows=${pick(["-to", "<->", "stealth-stealth", "-"])}`,
    () => `>=${pick(["stealth", "latex", "To", "to", ">", "|"])}`,
    () => `${pick(["scale", "xscale", "yscale", "rotate", "xshift", "yshift"])}=${pick(["2", "-1", "0.5", "30", "1cm", "-2pt", "45"])}`,
    () => `shift={${pick(["(1,2)", "(a)", "(0.5cm,-1pt)"])}}`,
    () => pick(["/tikz/draw=red", "/tikz/thick", "every node", "every path", "nodes={fill=red}", "centered"]),
    // \pgfkeys@spdef: a blank each side, and the braces of a whole group (twice after a trailing blank)
    () => pick(["draw={{red}} ", "line width= {{2pt}} ", "font={{\\bfseries}} ", "fill={blue} ", "text= {{red}} ", "anchor={ north }"]),
  ]
  if (lib === "lib") {
    choices.push(
      () => `${pick(["above", "below", "left", "right", "above left", "below right", "above right", "base left", "mid right"])}=${pick(["of a", "2cm of b", "of b", "1 and 2 of a", "1cm and 5mm of a", "of  a", "0.5", "1cm", "1cm and 2cm", ""])}`,
      () => pick(["on grid", "on grid=false", "on grid=true"]),
      () => pick(["-Stealth", "-Latex", "Latex-Latex", "-{Stealth}", "Stealth-", ">=Stealth", ">=Latex", "Hooks-Kite", "-Triangle", "LaTeX-", "Bracket-Parenthesis", "-Rays", ">=Implies", "|<->|", ">|-|<"]),
    )
  }
  if (styles.length) choices.push(() => pick(styles), () => pick(styles))
  return pick(choices)()
}

/** style definitions, the names they define for the list, and the value keys to read */
function makeDefs(r: () => number): { defs: Def[]; styles: string[]; reads: string[] } {
  const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)]
  const defs: Def[] = [], styles: string[] = [], reads: string[] = []
  const all: (() => void)[] = [
    () => { defs.push({ kind: "set", text: `mystyle/.style={${pick(["draw=red,thick", "dashed", "fill=blue!20,rounded corners", "->"])}}` }); styles.push("mystyle") },
    () => { defs.push({ kind: "set", text: "box/.style={draw,minimum size=#1}, box/.default=1cm" }); styles.push("box", "box=2cm") },
    () => { defs.push({ kind: "set", text: "mystyle/.style={draw}, mystyle/.append style={dotted}" }); styles.push("mystyle") },
    () => { defs.push({ kind: "set", text: `${pick(["thick", "draw", "dashed"])}/.append style={${pick(["red", "fill=green", "rounded corners"])}}` }) },
    () => { defs.push({ kind: "set", text: `${pick(["thick", "draw", "solid"])}/.prefix style={${pick(["thin", "blue", "sharp corners"])}}` }) },
    () => { defs.push({ kind: "set", text: "myval/.initial=3pt" }); styles.push("myval=5pt", "myval={2cm}"); reads.push("/tikz/myval") },
    () => { defs.push({ kind: "set", text: "kind/.is choice, kind/a/.style={red}, kind/b/.style={blue,thick}" }); styles.push("kind=a", "kind=b") },
    () => { defs.push({ kind: "set", text: "st/.code={\\pgfkeysalso{draw=#1,thin}}" }); styles.push("st=blue", "st=") },
    () => { defs.push({ kind: "set", text: "st2/.code=\\tikzset{fill=#1}" }); styles.push("st2=red!10") },
    () => { defs.push({ kind: "set", text: "outer/.style={inner/.style={draw=##1}, inner=#1}" }); styles.push("outer=red", "outer=blue!50") },
    () => { defs.push({ kind: "set", text: `every node/.style={${pick(["draw", "fill=red", "circle"])}}` }) },
    () => { defs.push({ kind: "set", text: `every path/.style={${pick(["thick", "dashed"])}}` }) },
    () => { defs.push({ kind: "set", text: "pv/.initial=, pv/.default=x" }); styles.push("pv", "pv=y"); reads.push("/tikz/pv") },
    () => { defs.push({ kind: "set", text: "/pgf/inner sep=1pt" }) },
    () => { defs.push({ kind: "style", text: `{old}=[${pick(["draw,dotted", "fill=red", "thick,->"])}]` }); styles.push("old") },
    () => { defs.push({ kind: "style", text: "{old}=[draw]" }, { kind: "style", text: "{old}+=[thick]" }); styles.push("old") },
    () => { defs.push({ kind: "style", text: "{oldw}[2pt]=[line width=#1]" }); styles.push("oldw", "oldw=3pt") },
    () => { defs.push({ kind: "style", text: "plain=[fill=blue]" }); styles.push("plain") },
    () => { defs.push({ kind: "set", text: "fam/.is family, fam/x/.style={/tikz/line width=3pt}" }); styles.push("fam/x", "/tikz/fam/x", "fam,x,/tikz/.cd", "fam/.cd,x,/tikz/.cd") },
    () => { defs.push({ kind: "set", text: "sty/.style={draw=#1}" }); styles.push("sty", "sty=green") },
    () => { defs.push({ kind: "set", text: "/pgf/myp/.code={\\pgfkeysalso{/tikz/line width=#1}}, /pgf/myp/.default=2pt" }); styles.push("myp", "myp=3pt") },
    () => { defs.push({ kind: "set", text: "newk/.append style={draw}" }); styles.push("newk=5", "newk={a,b}", "newk"); reads.push("/tikz/newk") },
    () => { defs.push({ kind: "set", text: "st3/.code={\\pgfkeys{tikz/.cd,thick}\\pgfkeysalso{dashed}}" }); styles.push("st3") },
  ]
  for (let k = Math.floor(r() * 3); k > 0; k--) pick(all)()
  return { defs, styles, reads }
}

/** option lists outside the subset: TeX has the keys, the engine refuses them */
const UNSUPPORTED = ["outer sep=auto", "stroke", "x=2cm", "cap=round", "double", "text opacity=0.5", "dash=on 1pt off 1pt phase 0pt", "text height=1ex", "-{Stealth[length=2pt]}", "line width=2\\pgflinewidth"]

/** option lists TeX reports an error for (each in a document of its own: TeX goes on in a state of its own) */
const ERRORS: [Lib, string][] = [
  ["core", "foo"], ["core", "line width"], ["core", "dash pattern=off 2pt on 1pt"], ["core", "-nonexist"], ["core", ">=nonexist"],
  ["core", "arrows=xyz"], ["core", "draw=red,line width="], ["core", "shape"], ["core", "rounded corners=x"], ["core", "anchor"],
  ["core", "node distance"], ["core", "-Stealth"], ["lib", "right=of zz"], ["lib", "on grid=maybe"], ["core", "draw,{foo}"],
]

export function makeCases(n: number, seed: number): Case[] {
  const r = rng(seed)
  const out: Case[] = []
  while (out.length < n) {
    const lib: Lib = r() < 0.5 ? "core" : "lib"
    const { defs, styles, reads } = makeDefs(r)
    const k = 1 + Math.floor(r() * 6)
    const items = Array.from({ length: k }, () => optionItem(r, lib, styles))
    // a trailing comma, blanks and the pgf family switched to at the end
    // blanks, line ends and comments between the items (TeX's input processor)
    let options = items.join([",", ",", ",", " , ", ",\n", ",%\n", ", % a comment\n  ", "\n,"][Math.floor(r() * 8)])
    if (r() < 0.05) options += ","
    if (r() < 0.05) options += ",/pgf/.cd, inner sep=4pt"
    const c: Case = { lib, defs, options, reads }
    if (r() < 0.2) {
      // a group: what is set inside it (styles too) is gone after it
      const local = r() < 0.4 ? "gs/.style={thick,fill=red}," : ""
      c.inner = local + Array.from({ length: 1 + Math.floor(r() * 3) }, () => optionItem(r, lib, styles)).join(",")
      c.after = Array.from({ length: Math.floor(r() * 3) }, () => optionItem(r, lib, styles)).join(",")
      if (local && r() < 0.5) c.inner += ",gs"
    }
    out.push(c)
  }
  return out
}

/** fixed cases: one per key family, the edges of the scanners */
export function edgeCases(): Case[] {
  const opts = [
    "", "draw", "draw=red!50", "fill,draw", "draw=none", "red", "blue!20!white", "mine", "color=orange", "text=blue",
    "thick", "line width=2pt", "line width=1.5", "line width=1em", "dashed", "dotted", "dashdotted", "thick,dashdotted", "solid",
    "dash pattern=on 2pt off 1pt", "dash phase=1pt", "dashed,dash phase=2pt", "dash pattern=on \\pgflinewidth off 3pt",
    "rounded corners", "rounded corners=2mm", "sharp corners", "rounded corners=0pt",
    "anchor=north", "inner sep=2pt", "inner xsep=1mm", "outer sep=1pt", "minimum size=2em", "minimum width=1cm",
    "text width=3cm", "font=\\  x", "font={\\bfseries}{\\itshape}", "font=\\bfseries   \\small", "align=center", "align=flush right", "align=none", "font=\\bfseries", "text centered",
    "circle", "coordinate", "shape=circle", "node distance=2cm", "auto", "auto=right", "swap", "auto,swap", "'",
    "above", "below=3pt", "left=1cm", "above right=2mm", "below left", "right of=a", "above of=b", "node distance=2cm,right of=a",
    "auto,auto=false", "auto,auto=foo", "auto=foo", "auto=right,swap,swap", "swap,swap", "|<-", "<|-", "->|", "-|>",
    "->", "<-", "<->", "-latex", "stealth-", "|-|", "->>", "-To", "arrows=-to", "-", ">=stealth,->", ">=latex", "-.", "- >", ">-<",
    "scale=2", "xscale=-1", "rotate=30", "xshift=1cm", "yshift=-2pt", "shift={(1,2)}",
    "/tikz/draw=red", "nodes={fill=red}", "every node", "help lines", "centered", " draw , fill ", "draw,,fill", "{draw=red}",
    "/pgf/.cd,inner sep=3pt", "/pgf/minimum height=4pt", "draw={{red}} ", "line width= {{2pt}} ", "text= {{red}} ",
  ]
  const lib = [
    "above=of a", "right=2cm of b", "below right=of a", "above left=1 and 2 of a", "right=1cm", "left=1cm and 2cm", "on grid,right=of a",
    "on grid,above right=of b", "node distance=2cm,above right=of a", "node distance=2cm and 1cm,below left=of a", "base left=of a",
    "mid right", "above", "-Stealth", "-Latex", "Latex-Latex", ">=Stealth,->", "-{Stealth}", "right=0.5", "below=",
  ]
  const defs: [Def[], string][] = [
    [[{ kind: "set", text: "mystyle/.style={draw=red,thick}" }], "mystyle"],
    [[{ kind: "set", text: "box/.style={draw,minimum size=#1}, box/.default=1cm" }], "box,box=2cm"],
    [[{ kind: "set", text: "thick/.append style={red}" }], "thick"],
    [[{ kind: "set", text: "draw/.prefix style={thin}" }], "draw=blue"],
    [[{ kind: "set", text: "kind/.is choice, kind/a/.style={red}, kind/b/.style={blue,thick}" }], "kind=b"],
    [[{ kind: "set", text: "outer/.style={inner/.style={draw=##1}, inner=#1}" }], "outer=red"],
    [[{ kind: "set", text: "st/.code={\\pgfkeysalso{draw=#1,thin}}" }], "st=blue"],
    [[{ kind: "style", text: "{old}=[draw,dotted]" }, { kind: "style", text: "{old}+=[thick]" }], "old"],
    [[{ kind: "style", text: "{oldw}[2pt]=[line width=#1]" }], "oldw"],
    [[{ kind: "set", text: "every node/.style={draw}" }], "every node"],
    [[{ kind: "set", text: "fam/.is family, fam/x/.style={/tikz/line width=3pt}" }], "fam/.cd,x,/tikz/.cd,thick"],
    [[{ kind: "set", text: "fam/.is family, fam/x/.style={/tikz/line width=3pt}" }], "fam,x,/tikz/.cd,thick"],
    [[{ kind: "set", text: "fam/.is family, st2/.code=\\tikzset{fill=#1}" }], "fam/.cd,/tikz/st2=red,/tikz/.cd"],
    [[{ kind: "set", text: "/pgf/myp/.code={\\pgfkeysalso{/tikz/line width=#1}}, /pgf/myp/.default=2pt" }], "myp"],
    [[], "dash pattern=on{2pt}off{1pt}"],
    [[{ kind: "set", text: "st3/.code={\\pgfkeys{tikz/.cd,thick}\\pgfkeysalso{dashed}}" }], "st3"],
  ]
  return [
    ...opts.map((options) => ({ lib: "core" as const, defs: [], options, reads: [] })),
    ...lib.map((options) => ({ lib: "lib" as const, defs: [], options, reads: [] })),
    ...defs.map(([d, options]) => ({ lib: "core" as const, defs: d, options, reads: [] })),
    { lib: "core", defs: [{ kind: "set", text: "myval/.initial=3pt" }], options: "myval=5pt", reads: ["/tikz/myval"] },
    { lib: "core", defs: [{ kind: "set", text: "newk/.append style={draw}" }], options: "newk=5", reads: ["/tikz/newk"] },
    { lib: "core", defs: [], options: "thick", inner: "gs/.style={red},gs,dashed,->", after: "dotted", reads: [] },
    { lib: "core", defs: [], options: "thick", inner: "myval/.initial=1pt,myval=2pt", after: "", reads: ["/tikz/myval"] },
    { lib: "lib", defs: [], options: "draw", inner: "on grid,right=of a,>=Stealth,->", after: "->", reads: [] },
    ...ERRORS.map(([lib, options]) => ({ lib, defs: [], options, reads: [], error: true as const })),
    ...UNSUPPORTED.map((options) => ({ lib: "lib" as const, defs: [], options, reads: [], unsupported: true as const })),
    { lib: "core", defs: [{ kind: "set", text: "kind/.is choice, kind/a/.style={red}" }], options: "kind=c", reads: [], error: true },
    { lib: "core", defs: [], options: "thick", inner: "gs/.style={red}", after: "gs", reads: [], error: true },
  ]
}

/** what \tkzshow prints, one line per field */
const SHOW = [
  "\\def\\tkzspec#1#2{\\ifx#1\\pgfutil@empty\\def#2{}\\else\\extractcolorspecs{#1}\\tkzm\\tkzv\\edef#2{\\tkzm{\\tkzv}}\\fi}",
  "\\def\\tkzk#1{\\expandafter\\meaning\\csname pgfk@/pgf/#1\\endcsname}",
  "\\def\\tkzshow{%",
  "\\immediate\\write16{L:\\the\\pgflinewidth}%",
  "\\immediate\\write16{O:\\meaning\\tikz@options}%",
  "\\immediate\\write16{M:\\meaning\\tikz@mode}%",
  "\\immediate\\write16{T:\\meaning\\tikz@transform}%",
  "\\immediate\\write16{K:\\meaning\\tikz@textcolor|\\meaning\\tikz@strokecolor|\\meaning\\tikz@fillcolor}%",
  "\\tkzspec\\tikz@textcolor\\tkza\\tkzspec\\tikz@strokecolor\\tkzb\\tkzspec\\tikz@fillcolor\\tkzc",
  "\\immediate\\write16{V:\\tkza|\\tkzb|\\tkzc}%",
  "\\immediate\\write16{D:\\meaning\\tikz@dashpattern|\\meaning\\tikz@dashphase}%",
  "\\immediate\\write16{R:\\meaning\\pgf@corner@arc|\\ifpgf@arccorners T\\else F\\fi}%",
  "\\immediate\\write16{N:\\meaning\\tikz@anchor|\\meaning\\tikz@do@auto@anchor|\\tikz@auto@anchor@direction|\\meaning\\tikz@shape|\\meaning\\tikz@node@distance}%",
  "\\immediate\\write16{P:\\meaning\\tikz@node@at|\\meaning\\tikz@lib@pos@call|\\iftikz@lib@ignore@size T\\else F\\fi}%",
  "\\immediate\\write16{X:\\meaning\\tikz@text@width|\\meaning\\tikz@textfont|\\meaning\\tikz@text@action|\\expandafter\\meaning\\csname pgfk@/tikz/node halign header\\endcsname}%",
  "\\immediate\\write16{S:\\tkzk{inner xsep}|\\tkzk{inner ysep}|\\tkzk{outer xsep}|\\tkzk{outer ysep}|\\tkzk{minimum width}|\\tkzk{minimum height}}%",
  "\\immediate\\write16{A:\\meaning\\pgf@start@tip@sequence|\\meaning\\pgf@end@tip@sequence|\\meaning\\tikz@current@arrows|\\expandafter\\meaning\\csname pgf@ar@means@>\\endcsname}%",
  "}",
]

function texDocument(lib: Lib, cases: { c: Case; i: number }[]): string {
  const lines = [
    "\\documentclass{article}", "\\usepackage{tikz}", ...(lib === "lib" ? ["\\usetikzlibrary{positioning,arrows.meta}"] : []),
    ...COLORS.map(([n, m, v]) => `\\definecolor{${n}}{${m}}{${v}}`),
    "\\begin{document}", "\\makeatletter", ...SHOW,
    ...(lib === "core" ? ["\\newif\\iftikz@lib@ignore@size"] : []),
    "\\makeatother",
  ]
  for (const { c, i } of cases) {
    const defs = c.defs.map((d) => (d.kind === "set" ? `\\tikzset{${d.text}}` : `\\tikzstyle ${d.text}`)).join("")
    const reads = c.reads.map((p) => `\\immediate\\write16{U:\\expandafter\\meaning\\csname pgfk@${p}\\endcsname}`).join("")
    lines.push(
      `\\setbox0\\hbox{\\immediate\\write16{C:${i}}${defs}\\begin{tikzpicture}${lib === "lib" ? "\\path (0,0) node (a) {} (1,1) node (b) {};" : ""}%`,
      "\\makeatletter\\let\\tikz@options\\pgfutil@empty\\let\\tikz@mode\\pgfutil@empty\\def\\tikz@transform{}\\let\\tikz@lib@pos@call\\relax\\makeatother",
      `\\tikzset{${c.options}}${c.inner !== undefined ? `\\begingroup\\tikzset{${c.inner}}\\endgroup\\tikzset{${c.after}}` : ""}%`,
      `\\makeatletter\\tkzshow\\makeatother${reads}\\end{tikzpicture}}`,
    )
  }
  lines.push("\\end{document}", "")
  return lines.join("\n")
}

/** TeX's lines for each case: tag → text */
function texOutcomes(all: Case[]): Map<number, { lines: Map<string, string[]>; errors: string[] }> {
  mkdirSync(DIR, { recursive: true })
  const out = new Map<number, { lines: Map<string, string[]>; errors: string[] }>()
  const docs: { name: string; lib: Lib; cases: { c: Case; i: number }[] }[] = (["core", "lib"] as const).map((lib) => ({ name: lib, lib, cases: all.map((c, i) => ({ c, i })).filter(({ c }) => c.lib === lib && !c.error) }))
  all.forEach((c, i) => { if (c.error) docs.push({ name: `error-${docs.length - 2}`, lib: c.lib, cases: [{ c, i }] }) })
  for (const { name, lib, cases } of docs) {
    const tex = texDocument(lib, cases)
    const file = join(DIR, `${name}.tex`), log = join(DIR, `${name}.log`)
    // the same cases as last time, and TeX finished (an error case may stop it early: its log is its outcome)
    if (!existsSync(file) || readFileSync(file, "utf8") !== tex || !existsSync(log) || !(cases[0]?.c.error || /^(No pages of output|Output written)/m.test(readFileSync(log, "latin1")))) {
      writeFileSync(file, tex)
      const run = spawnSync("latex", ["-interaction=nonstopmode", `${name}.tex`], { cwd: DIR, env: texEnv({ max_print_line: "100000", error_line: "254", half_error_line: "238" }), stdio: "ignore", timeout: 1_200_000 })
      if (run.error) throw run.error
    }
    let cur: { lines: Map<string, string[]>; errors: string[] } | null = null
    for (const line of readFileSync(log, "latin1").split("\n")) {
      let m: RegExpMatchArray | null
      if ((m = line.match(/^C:(\d+)$/))) { cur = { lines: new Map(), errors: [] }; out.set(Number(m[1]), cur); continue }
      if (!cur) continue
      if (line.startsWith("! ")) cur.errors.push(line.slice(2))
      else if ((m = line.match(/^([A-Z]):(.*)$/))) cur.lines.set(m[1], [...(cur.lines.get(m[1]) ?? []), m[2]])
    }
  }
  return out
}

const tex = (src: string) => tokenize(src, true)
const mac = (t: Toks, atLetter = false) => `macro:->${meaning(t, atLetter)}`
const ptText = (sp: number) => `${printScaled(sp)}pt`

/** tikz.code.tex 258–276, the color option's code */
const COLOR_CODE = `\\ifx\\tikz@fillcolor\\pgfutil@empty\\ifx\\tikz@strokecolor\\pgfutil@empty\\else\\pgfsys@color@reset@inorderfalse
\\let\\tikz@strokecolor\\pgfutil@empty\\let\\tikz@fillcolor\\pgfutil@empty\\fi\\else\\pgfsys@color@reset@inorderfalse
\\let\\tikz@strokecolor\\pgfutil@empty\\let\\tikz@fillcolor\\pgfutil@empty\\fi`
const TEXT_ACTION: Record<TextAction, string> = {
  ragged: "\\pgfutil@raggedright\\rightskip0pt plus2em \\spaceskip.3333em \\xspaceskip.5em\\relax",
  "badly ragged": "\\pgfutil@raggedright\\relax",
  "ragged left": "\\pgfutil@raggedleft\\leftskip0pt plus2em \\spaceskip.3333em \\xspaceskip.5em\\relax",
  "badly ragged left": "\\pgfutil@raggedleft\\relax",
  justified: "\\leftskip0pt\\rightskip0pt\\relax",
  centered: "\\leftskip0pt plus2em%\n\\rightskip0pt plus2em%\n\\spaceskip.3333em \\xspaceskip.5em%\n\\parfillskip=0pt%\n\\iftikz@warn@for@narrow@centered\\else\\hbadness10000\\fi%\n\\let\\\\=\\@centercr% for latex\n\\relax",
  "badly centered": "\\let\\\\=\\@centercr% for latex\n\\parfillskip=0pt%\n\\rightskip\\pgfutil@flushglue%\n\\leftskip\\pgfutil@flushglue\\relax",
}

function optionText(o: OptionCall): string {
  switch (o.op) {
    case "linewidth": return `\\pgfsetlinewidth {${meaning(o.arg, false)}}`
    case "dash": return `\\pgfsetdash {${o.pattern.map((p) => `{${meaning(p, false)}}`).join("")}}{${o.phase ? meaning(o.phase, false) : "\\tikz@dashphase "}}`
    case "strokecolor": return `\\pgfsetstrokecolor {${meaning(o.color, false)}}`
    case "fillcolor": return `\\pgfsetfillcolor {${meaning(o.color, false)}}`
    case "compatcolor": return `\\tikz@compat@color@set {${o.color}}`
    case "cap": return `\\csname pgfset${o.kind}cap\\endcsname `
    case "join": return `\\csname pgfset${o.kind}join\\endcsname `
    case "miterlimit": return `\\pgfsetmiterlimit {${meaning(o.arg, false)}}`
    case "strokeopacity": return `\\pgfsetstrokeopacity {${meaning(o.arg, false)}}`
    case "fillopacity": return `\\pgfsetfillopacity {${meaning(o.arg, false)}}`
    case "color": return `${meaning(tex(COLOR_CODE))}\\pgfutil@colorlet {tikz@color}{${meaning(o.color, false)}}\\pgfutil@colorlet {.}{tikz@color}\\pgfsetcolor {.}\\pgfsys@color@reset@inordertrue `
  }
}

function transformText(t: TransformCall): string {
  switch (t.op) {
    case "shift": return `\\tikz@scan@one@point \\pgftransformshift ${meaning(t.point, false)}\\relax `
    case "poscall": return "\\tikz@lib@pos@call "
    case "point": return "a point"
    case "of": return `\\expandafter \\tikz@extract@node@dist \\tikz@node@distance and\\pgf@stop \\pgftransformshift {\\pgfpointpolar {${t.angle}}{\\tikz@extracted@node@distance }}`
    default: return `\\pgftransform${t.op} {${meaning(t.arg, false)}}`
  }
}

const nodeAtText = (n: NodeAt | null) => (n === null ? "undefined" : n.kind === "of" ? `macro:->\\pgfpointanchor {\\tikz@pp@name {${meaning(n.node, false)}}}{center}` : n.kind === "point" ? "a point" : `macro:->\\pgfpointanchor {${n.node}}{${n.anchor}}`)

/** \pgf@ar@means@> before >=… (the package's) */
const DEFAULT_MEANS = "macro:->\\pgf@arrow@handle@shorthand@empty {\\pgf@ar@means@To }"
const meansText = (m: Tip[] | undefined) => (m === undefined ? DEFAULT_MEANS : `macro:->${tipsMeaning(m)}`)

/** xcolor's \extractcolorspecs as `model{values}` from the driver's text */
function spec(colors: Colors, t: Toks): string {
  if (t.length === 0) return ""
  const [model, ...v] = colors.spec(t.join("")).split(" ")
  return `${model}{${v.join(",")}}`
}

function engineLines(c: Case, units: PgfUnits): Map<string, string[]> {
  const colors = new Colors()
  for (const [n, m, v] of COLORS) colors.define(n, m, v)
  const tz = new Tikz({ units, colors, positioning: c.lib === "lib", arrowsMeta: c.lib === "lib", scanOf: (t) => {
    const n = t.join("")
    if (n !== "a" && n !== "b") throw new Error(`tikzkeys:check: of ${n}`)
    return { point: () => ({ x: 0, y: 0 }), border: n }
  } })
  for (const d of c.defs) {
    if (d.kind === "set") tz.set(tokenize(d.text))
    else {
      const t = tokenize(d.text)
      if (tz.tikzstyle(t) !== t.length) throw new Error(`\\tikzstyle${d.text} left text`)
    }
  }
  tz.st.options = []
  tz.st.mode = []
  tz.st.transform = []
  tz.st.posCall = null
  tz.set(tokenize(c.options))
  if (c.inner !== undefined) {
    tz.begingroup()
    tz.set(tokenize(c.inner))
    tz.endgroup()
    tz.set(tokenize(c.after ?? ""))
  }
  const s: TikzState = tz.st
  const k = (p: string) => { const v = tz.keys.valueOf(`/pgf/${p}`); return v ? mac(v) : "\\relax" }
  const lines = new Map<string, string[]>([
    ["L", [ptText(s.lineWidth)]],
    ["O", [`macro:->${s.options.map(optionText).join("")}`]],
    ["M", [`macro:->${s.mode.map((m) => `\\tikz@mode@${m} `).join("")}`]],
    ["T", [`macro:->${(s.transform ?? []).map(transformText).join("")}`]],
    ["K", [[s.textColor, s.strokeColor, s.fillColor].map((x) => mac(x)).join("|")]],
    ["V", [[s.textColor, s.strokeColor, s.fillColor].map((x) => spec(colors, x)).join("|")]],
    ["D", [`macro:->${s.dashPattern.map((p) => `{${meaning(p, false)}}`).join("")}|${mac(s.dashPhase)}`]],
    ["R", [`${s.corner ? `macro:->{${ptText(s.corner.x)}}{${ptText(s.corner.y)}}` : "undefined"}|${s.arcCorners ? "T" : "F"}`]],
    ["N", [[mac(s.anchor), s.autoAnchor ? "macro:->\\csname tikz@auto@anchor@\\tikz@auto@anchor@direction \\endcsname " : "\\relax", s.autoDirection, `macro:->${s.shape}`, mac(s.nodeDistance)].join("|")]],
    ["P", [[nodeAtText(s.nodeAt), s.posCall ? `macro:->\\pgftransformshift {\\pgfqpoint {${ptText(s.posCall.x)}}{${ptText(s.posCall.y)}}}` : "\\relax", s.onGrid ? "T" : "F"].join("|")]],
    ["X", [[mac(s.textWidth), mac(s.textFont), `macro:->${meaning(tex(TEXT_ACTION[s.textAction]))}`, mac(tz.keys.valueOf("/tikz/node halign header") ?? [], true)].join("|")]],
    ["S", [["inner xsep", "inner ysep", "outer xsep", "outer ysep", "minimum width", "minimum height"].map(k).join("|")]],
    ["A", [[`macro:->${tipsMeaning(s.startTips)}`, `macro:->${tipsMeaning(s.endTips)}`, mac(s.currentArrows), meansText(s.arrowMeans)].join("|")]],
  ])
  if (c.reads.length) lines.set("U", c.reads.map((p) => { const v = tz.keys.valueOf(p); return v ? mac(v) : "\\relax" }))
  return lines
}

const label = (c: Case) => `${c.lib} [${c.defs.map((d) => d.text).join(" ; ")}] "${c.options}"${c.inner !== undefined ? ` {${c.inner}} "${c.after}"` : ""}`

export function tikzkeysCheck(n: number, seed: number): number {
  const f = loadFont(dataFont("cmr10"), 10 * UNITY)
  const units: PgfUnits = { em: f.params[QUAD], ex: f.params[X_HEIGHT] }
  const cases = [...edgeCases(), ...makeCases(n, seed)]
  const texOut = texOutcomes(cases)
  let failed = 0, unsupported = 0, texErrors = 0, refused = 0
  const fields = new Map<string, number>()
  cases.forEach((c, i) => {
    const t = texOut.get(i)
    if (!t) throw new Error(`TeX printed nothing for case ${i}: ${c.options} (${DIR}/${c.lib}.log)`)
    let mine: Map<string, string[]>
    try {
      mine = engineLines(c, units)
    } catch (e) {
      // the engine refuses: right only when TeX found an error too
      if (t.errors.length && c.error) { texErrors++; return }
      if (!t.errors.length && c.unsupported) { refused++; return }
      unsupported++
      failed++
      if (failed <= 12) console.log(`✗ ${label(c)}: engine: ${(e as Error).message}${t.errors.length ? ` (TeX: ${t.errors[0]}, a case not meant to be an error)` : ""}`)
      return
    }
    if (t.errors.length || c.error || c.unsupported) {
      failed++
      if (failed <= 12) console.log(`✗ ${label(c)}: ${c.error ? `TeX: ${t.errors[0] ?? "no error"}, engine had no error` : c.unsupported ? "outside the subset, but the engine took it" : `TeX: ${t.errors[0]} (a case not meant to be an error)`}`)
      return
    }
    const diffs = [...t.lines.keys(), ...mine.keys()].filter((tag, k, all) => all.indexOf(tag) === k && (t.lines.get(tag) ?? []).join("\n") !== (mine.get(tag) ?? []).join("\n"))
    if (!diffs.length) return
    failed++
    for (const d of diffs) fields.set(d, (fields.get(d) ?? 0) + 1)
    if (failed <= 12) {
      console.log(`✗ ${label(c)}`)
      for (const d of diffs) console.log(`    ${d} TeX:    ${(t.lines.get(d) ?? []).join(" / ")}\n    ${d} engine: ${(mine.get(d) ?? []).join(" / ")}`)
    }
  })
  console.log(`${cases.length - failed}/${cases.length} TikZ option lists identical to TeX (seed ${seed}; ${texErrors} TeX errors refused by both, ${refused} lists outside the subset refused${unsupported ? `, ${unsupported} refused by the engine alone` : ""})${fields.size ? `; differing fields: ${[...fields].map(([k, v]) => `${k} ×${v}`).join(", ")}` : ""}`)
  return failed ? 1 : 0
}
