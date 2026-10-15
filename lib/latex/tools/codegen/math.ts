// Codegen (#74): LaTeX's math setup as data — \mathcode of every 7-bit
// character, the \mathchar of each symbol command, the mu skips, and the math penalties and dimensions — read from
// TeX in a document body.
//   bun engine codegen [--check]

import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Scanner } from "../../layout/dimen"
import type { MathData } from "../../mathlayout/data"
import { parseScaled } from "../oracle/tracing"
import { texEnv } from "../tex"

const OUT = "lib/latex/data/math"
const INTS = ["binoppenalty", "relpenalty", "delimiterfactor"]
const DIMENS = ["mathsurround", "delimitershortfall", "nulldelimiterspace", "scriptspace"]
const MUSKIPS = ["thinmuskip", "medmuskip", "thickmuskip"]
// candidate symbol commands (fontmath.ltx); those that are \mathchar become data
const SYMBOLS = (
  "alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi varpi rho varrho sigma varsigma " +
  "tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega " +
  "aleph imath jmath ell wp Re Im partial infty prime emptyset nabla top bot triangle forall exists neg lnot flat natural sharp " +
  "clubsuit diamondsuit heartsuit spadesuit " +
  "pm mp setminus cdot times ast star diamond circ bullet div cap cup uplus sqcap sqcup triangleleft triangleright wr " +
  "bigcirc bigtriangleup bigtriangledown vee lor wedge land oplus ominus otimes oslash odot dagger ddagger amalg " +
  "leq le geq ge equiv models prec succ sim perp preceq succeq simeq mid ll gg asymp parallel subset supset approx smile frown " +
  "subseteq supseteq sqsubseteq sqsupseteq propto vdash dashv in ni owns " +
  "leftarrow gets rightarrow to uparrow downarrow leftrightarrow Leftarrow Rightarrow Uparrow Downarrow Leftrightarrow " +
  "nearrow searrow swarrow nwarrow leftharpoonup leftharpoondown rightharpoonup rightharpoondown rightleftharpoons " +
  "sum prod coprod intop ointop bigcup bigcap bigsqcup bigvee bigwedge bigodot bigotimes bigoplus biguplus " +
  "ldotp cdotp colon"
).split(" ")
// \delimiter commands (fontmath.ltx): what \left takes, a math character elsewhere
const DELIMITERS = (
  "langle rangle lbrace rbrace lfloor rfloor lceil rceil vert Vert backslash uparrow downarrow updownarrow " +
  "Uparrow Downarrow Updownarrow lgroup rgroup lmoustache rmoustache arrowvert Arrowvert bracevert"
).split(" ")

export function codegenMath(check: boolean): number {
  const dir = ".cache/mathdata"
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "probe.tex"), [
    "\\documentclass{article}", "\\begin{document}",
    "\\count255=0 \\loop\\immediate\\write16{C:\\the\\count255=\\the\\mathcode\\count255}\\advance\\count255 1 \\ifnum\\count255<128 \\repeat",
    "\\count255=0 \\loop\\immediate\\write16{L:\\the\\count255=\\the\\delcode\\count255}\\advance\\count255 1 \\ifnum\\count255<128 \\repeat",
    ...DELIMITERS.map((x) => `\\immediate\\write16{E:${x}=\\meaning\\${x}}`),
    ...INTS.map((x) => `\\immediate\\write16{I:${x}=\\the\\${x}}`),
    ...DIMENS.map((x) => `\\immediate\\write16{D:${x}=\\the\\${x}}`),
    ...MUSKIPS.map((x) => `\\immediate\\write16{M:${x}=\\the\\${x}}`),
    ...SYMBOLS.map((x) => `\\immediate\\write16{S:${x}=\\meaning\\${x}}`),
    "\\end{document}", "",
  ].join("\n"))
  execFileSync("latex", ["-interaction=batchmode", "-halt-on-error", "probe.tex"], { cwd: dir, env: texEnv({ max_print_line: "100000" }) })
  const data: MathData = { mathcodes: [], delcodes: [], ints: {}, dimens: {}, muskips: {}, symbols: {}, delimiters: {} }
  for (const line of readFileSync(join(dir, "probe.log"), "latin1").split("\n")) {
    let m: RegExpMatchArray | null
    if ((m = line.match(/^C:(\d+)=(\d+)$/))) data.mathcodes[Number(m[1])] = Number(m[2])
    else if ((m = line.match(/^L:(\d+)=(-?\d+)$/))) data.delcodes[Number(m[1])] = Number(m[2])
    else if ((m = line.match(/^E:(\w+)=(?:\\protected macro:->)?\\delimiter ?"([0-9A-F]+)\s*$/))) data.delimiters[m[1]] = parseInt(m[2], 16)
    else if ((m = line.match(/^I:(\w+)=(-?\d+)$/))) data.ints[m[1]] = Number(m[2])
    else if ((m = line.match(/^D:(\w+)=(-?[\d.]+)pt$/))) data.dimens[m[1]] = parseScaled(m[2])
    else if ((m = line.match(/^M:(\w+)=(.*)$/))) data.muskips[m[1]] = new Scanner(m[2], { em: 0, ex: 0 }).scanGlue(true)
    else if ((m = line.match(/^S:(\w+)=\\mathchar"([0-9A-F]+)$/))) data.symbols[m[1]] = parseInt(m[2], 16)
  }
  if (data.mathcodes.length !== 128 || data.delcodes.length !== 128 || Object.keys(data.delimiters).length !== DELIMITERS.length || Object.keys(data.muskips).length !== 3) throw new Error("math codegen: TeX did not report every value")
  const body = JSON.stringify(data) + "\n"
  const file = join(OUT, "latex.json")
  const same = existsSync(file) && readFileSync(file, "utf8") === body
  if (check) { console.log(same ? "math data up to date" : "math data out of date: run bun engine codegen"); return same ? 0 : 1 }
  mkdirSync(OUT, { recursive: true })
  writeFileSync(file, body)
  console.log(`wrote ${file}`)
  return 0
}
