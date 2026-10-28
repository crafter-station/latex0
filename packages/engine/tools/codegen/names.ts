// Codegen (#344): the commands LaTeX itself defines, by class and package, as data. A document's
// \renewcommand, \def or \let of one of them changes LaTeX, which the engine's bindings do not read, and its
// \providecommand of one does nothing; the expander (expand/document.ts) needs to know which names those are.
// The candidates are every name in LuaTeX's hash table after loading (tex.hashtokens, which lists names TeX
// builds with \csname too) and every name in the files `latex` reads; `latex` then says which of them are
// defined at \begin{document} (not undefined, not \relax: what \@ifundefined calls defined). Only names of
// letters: a document's own definitions are of those.
//   bun engine codegen [--check]

import { spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { texEnv } from "../tex"

const OUT = "packages/engine/expand/defined.ts"
const DIR = ".cache/namesdata"

/** the classes beside article, and the packages (with options) whose names are measured */
const CLASSES = ["report", "book", "letter", "beamer", "amsart", "scrartcl", "scrreprt", "memoir"]
const PACKAGES: Record<string, string> = {
  amsmath: "", amssymb: "", amsfonts: "", amsthm: "", mathtools: "", graphicx: "", hyperref: "", nameref: "", cleveref: "", url: "",
  enumitem: "", listings: "", xcolor: "", booktabs: "", fancyhdr: "", titlesec: "", algorithm: "", algpseudocode: "", multirow: "",
  array: "", siunitx: "", caption: "", subcaption: "", tikz: "", float: "", geometry: "", natbib: "", setspace: "",
  parskip: "", fontenc: "T1", inputenc: "utf8", lmodern: "", times: "", helvet: "", courier: "", palatino: "", mathptmx: "", multicol: "", tabularx: "",
  longtable: "", dcolumn: "", cite: "", xspace: "", ifthen: "", colortbl: "", verbatim: "", fancyvrb: "", textcomp: "",
  babel: "english,spanish,portuguese,french,ngerman,german", microtype: "", "scrlayer-scrpage": "",
}

/** a document that loads `pre`, then writes the names in `file` that are defined */
const probe = (pre: string, lua: boolean) => [
  pre, "\\begin{document}",
  lua ? "\\directlua{dofile('hash.lua')}"
    : "\\makeatletter\\newread\\nm@in\\openin\\nm@in=cands.txt\\endlinechar=-1 \\loop\\unless\\ifeof\\nm@in\\read\\nm@in to\\nm@line" +
      "\\ifx\\nm@line\\@empty\\else\\expandafter\\ifx\\csname\\nm@line\\endcsname\\relax\\else\\immediate\\write16{D-\\nm@line}\\fi\\fi\\repeat",
  "\\end{document}", "",
].join("\n")

/** run a TeX program in `dir`; it fails on an error */
const tex = (prog: string, args: string[], dir: string, env = {}) => new Promise<void>((done, fail) => {
  const p = spawn(prog, ["-interaction=batchmode", ...args], { cwd: dir, env: texEnv(env), stdio: "ignore" })
  p.on("exit", (code) => (code === 0 ? done() : fail(new Error(`names codegen: ${prog} ${args.join(" ")} failed in ${dir}`))))
})

/** the names of letters defined at \begin{document} after `pre`: the candidates are the names that `latex` reads in the
 *  files `pre` loads and that LuaTeX's hash table has after loading it */
async function defined(pre: string, dir: string): Promise<Set<string>> {
  mkdirSync(dir, { recursive: true })
  const cands = new Set<string>()
  writeFileSync(join(dir, "hash.lua"), "local t = {} for _, v in ipairs(tex.hashtokens()) do if v:match('^[A-Za-z]+$') then t[#t + 1] = v end end\n" +
    "local f = io.open('hash.txt', 'w') f:write(table.concat(t, '\\n')) f:close()\n")
  writeFileSync(join(dir, "lua.tex"), probe(pre, true))
  writeFileSync(join(dir, "files.tex"), probe(pre, false).replace(/\\begin\{document\}[^]*/, "\\begin{document}\\end{document}\n"))
  await Promise.all([tex("lualatex", ["lua.tex"], dir), tex("latex", ["-recorder", "files.tex"], dir)])
  for (const n of readFileSync(join(dir, "hash.txt"), "latin1").split("\n")) if (n) cands.add(n)
  for (const line of readFileSync(join(dir, "files.fls"), "latin1").split("\n")) {
    const f = line.match(/^INPUT (.*\.(?:sty|cls|clo|def|ltx|cfg|tex|ldf))$/)?.[1]
    if (f && existsSync(f)) for (const m of readFileSync(f, "latin1").matchAll(/\\([A-Za-z]+)/g)) cands.add(m[1])
  }
  writeFileSync(join(dir, "cands.txt"), [...cands].sort().join("\n") + "\n")
  writeFileSync(join(dir, "names.tex"), probe(pre, false))
  await tex("latex", ["-halt-on-error", "names.tex"], dir, { max_print_line: "100000" })
  const out = new Set<string>()
  for (const line of readFileSync(join(dir, "names.log"), "latin1").split("\n")) { const m = line.match(/^D-([A-Za-z]+)$/); if (m) out.add(m[1]) }
  if (!out.has("textbf")) throw new Error(`names codegen: TeX reported no names for ${pre}`)
  return out
}

export async function codegenNames(check: boolean): Promise<number> {
  const configs: [string, string][] = [["article", "\\documentclass{article}"], ...CLASSES.map((c): [string, string] => [c, `\\documentclass{${c}}`]),
    ...Object.entries(PACKAGES).map(([p, o]): [string, string] => [p, `\\documentclass{article}\\usepackage${o ? `[${o}]` : ""}{${p}}`])]
  const sets = new Map<string, Set<string>>()
  for (let i = 0; i < configs.length; i += 8) { // (eight TeX runs at a time)
    await Promise.all(configs.slice(i, i + 8).map(async ([name, pre]) => sets.set(name, await defined(pre, join(DIR, name)))))
  }
  const base = sets.get("article")!
  const extra = (name: string) => [...sets.get(name)!].filter((n) => !base.has(n)).sort()
  const classes = Object.fromEntries(CLASSES.map((c) => [c, extra(c)]))
  const packages = Object.fromEntries(Object.keys(PACKAGES).map((p) => [p, extra(p)]))
  const list = (names: string[]) => JSON.stringify(names.join(" "))
  const body = [
    "// Generated by `bun engine codegen` (tools/codegen/names.ts): the commands (names of letters) LaTeX defines",
    "// at \\begin{document}: with article, then what each other class and each package adds. Do not edit.",
    "",
    `export const ARTICLE = ${list([...base].sort())}`,
    "",
    "export const CLASSES: Record<string, string> = {",
    ...Object.entries(classes).map(([c, n]) => `  ${JSON.stringify(c)}: ${list(n)},`),
    "}",
    "",
    "export const PACKAGES: Record<string, string> = {",
    ...Object.entries(packages).map(([p, n]) => `  ${JSON.stringify(p)}: ${list(n)},`),
    "}",
    "",
  ].join("\n")
  const same = existsSync(OUT) && readFileSync(OUT, "utf8") === body
  if (check) { console.log(same ? "names data up to date" : "names data out of date: run bun engine codegen"); return same ? 0 : 1 }
  writeFileSync(OUT, body)
  console.log(`wrote ${OUT} (${base.size} names with article)`)
  return 0
}
