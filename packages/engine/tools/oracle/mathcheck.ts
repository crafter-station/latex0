// Math oracle (#74–#77): random formulas typeset by TeX in \hbox{$…$} and shown
// with \showbox, against the engine's mlist_to_hlist (mathlayout/mlist.ts).
// Formulas are random trees of math characters, symbols, groups, fractions and
// big operators with \limits and \nolimits, \overline, \underline and \sqrt, math alphabets (with amsmath:
// amssymb's symbols, \mathbb, \mathfrak and mathrsfs's \mathscr), \dots and its kin, \colon, \bmod, \pmod,
// \mathbin and the other classes, math accents (with amsmath, never one inside another: \mathaccentV's nested accents
// are not modeled), with superscripts, subscripts and
// primes, under \displaystyle, \textstyle, \scriptstyle and
// \scriptscriptstyle. Each tree is printed as LaTeX, typeset by TeX, and read
// for the engine by its math parser (mathlayout/parse.ts).
// Articles at 10, 11, 12pt.
//   bun engine math:check [--n 3000] [--seed 1]

import { spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { emitBoxes } from "../../emit/boxes"
import { loadFont } from "../../layout/font"
import { hpack } from "../../layout/pack"
import type { Node } from "../../layout/nodes"
import { mlistToHlist, TEXT } from "../../mathlayout/mlist"
import { framed, mathEnv, mathFonts, mathText, parseFormula } from "../../latex/paragraph"
import { compareBoxLists, type BoxNode } from "../../trace/schema"
import { classData } from "../classes"
import { mathData } from "../../latex/data"
import { dataFont } from "../fonts"
import { texEnv } from "../tex"
import { parseBoxDump } from "./boxes"

const DIR = ".cache/mathcheck"
const SPECIAL = new Set([..."#$%&\\^_{}~'"].map((c) => c.charCodeAt(0)))
const OPERATORS = ["sum", "prod", "int", "oint", "bigcup", "coprod"]
const STYLES = ["displaystyle", "textstyle", "scriptstyle", "scriptscriptstyle"]
// what \left and \right take: characters with a \delcode, \delimiter commands, the null delimiter
const FENCES = ["(", ")", "[", "]", "|", "/", ".", "<", ">", "\\{", "\\}", "\\|", "\\langle ", "\\rangle ", "\\lfloor ", "\\rceil ", "\\vert ", "\\Vert ",
  "\\uparrow ", "\\Downarrow ", "\\updownarrow ", "\\backslash ", "\\lgroup ", "\\rmoustache ", "\\arrowvert ", "\\bracevert "]

/** A formula as a tree: what the generator draws, printed for TeX and built for the engine. */
type Nucleus =
  | { kind: "char"; code: number } | { kind: "sym"; name: string }
  | { kind: "group"; items: Item[] } | { kind: "frac"; num: Item[]; den: Item[] }
  | { kind: "op"; name: string; limits?: "limits" | "nolimits" }
  | { kind: "fence"; left: string; items: Item[]; right: string; /** e-TeX's \middle and what follows it */ middle?: { delim: string; items: Item[] } }
  /** a generalized fraction: {num \over den} and its kin (\above's thickness, …withdelims' delimiters), amsmath's \genfrac
   *  and the commands it defines, \cfrac */
  | { kind: "genfrac"; cs: string; num: Item[]; den: Item[]; delims?: [string, string]; thickness?: string; style?: string }
  /** text in a formula: \mbox, \textrm …, amsmath's \text */
  | { kind: "text"; cs: string; text: string }
  /** a math accent and its argument (with amsmath none inside: \macc@nested) */
  /** \big … \Biggr and a delimiter */
  | { kind: "big"; cs: string; delim: string }
  | { kind: "matrix"; env: string; rows: Item[][][]; cr: boolean }
  | { kind: "line"; cs: "overline" | "underline" | "sqrt"; arg: Script; /** \sqrt[index] */ index?: Item[] }
  | { kind: "accent"; cs: string; arg: Script }
  /** a command, with an argument or not: \dots, \colon, \pmod{…}, \mathbin{…} */
  | { kind: "cmd"; cs: string; arg?: Item[]; /** more arguments: \overset{…}{…} */ args?: Item[][] }
  /** a math alphabet: \mathbf{…}, \mathbb{…} */
  | { kind: "alphabet"; cs: string; items: Item[] }
type Script = { kind: "char"; code: number } | { kind: "sym"; name: string } | { kind: "group"; items: Item[] }
type Item =
  | { kind: "atom"; nucleus: Nucleus | null; sup?: Script; sub?: Script; primes: number; subFirst: boolean }
  | { kind: "style"; style: number }
  | { kind: "space"; cs: string }

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

/** \tmspace's commands in math (\mskip), \quad and \qquad (\hskip in em) */
const SPACES = [",", ":", ">", ";", "!", "thinspace", "negthinspace", "medspace", "negmedspace", "thickspace", "negthickspace", "quad", "qquad"]
const MATRICES = ["matrix", "pmatrix", "bmatrix", "Bmatrix", "vmatrix", "Vmatrix"]

/** LaTeX's math alphabets, and those amsfonts (\mathbb, \mathfrak) and mathrsfs (\mathscr) add */
const ALPHABETS = ["mathrm", "mathnormal", "mathcal", "mathbf", "mathit", "mathsf", "mathtt"]
const AMS_ALPHABETS = ["mathbb", "mathfrak", "mathscr"]
/** commands without an argument (amsmath's: its \dots and kin, \colon), and with one */
const COMMANDS = ["dots", "ldots", "cdots", "mathellipsis", "vdots", "ddots", "bmod", "$", "#", "%", "&", "mathstrut", "relbar", "Relbar", "joinrel", "doteq",
  ..."longrightarrow Longrightarrow longleftarrow Longleftarrow longleftrightarrow Longleftrightarrow mapsto longmapsto hookrightarrow hookleftarrow iff models bowtie".split(" ")]
const AMS_COMMANDS = ["dotsb", "dotsc", "dotsm", "dotso", "dotsi", "colon", "implies", "impliedby", "iint", "iiint", "iiiint", "idotsint", "iint\\limits", "idotsint\\limits"]
const ARG_COMMANDS = ["pmod", "smash", "phantom", "hphantom", "vphantom", "mathord", "mathop", "mathbin", "mathrel", "mathopen", "mathclose", "mathpunct", "mathinner"]
const AMS_ARG_COMMANDS = ["pod", "mod", "smash[t]", "smash[b]", "smash[tb]"]
/** mathtools's \DeclarePairedDelimiter'd commands (the engine reads them as preamble.ts writes them: \LXpaired) */
const PAIRED = [["pdA", "\\lvert", "\\rvert"], ["pdB", "\\lVert", "\\rVert"], ["pdC", "(", ")"], ["pdD", ".", "\\rangle"]]
const paired = (f: string) => PAIRED.reduce((x, [n, l, r]) => x.replace(new RegExp(`\\\\${n}(?![A-Za-z])`, "g"), `\\LXpaired{${l}}{${r}}`), f)
const MT_COLONS = "vcentcolon dblcolon coloneqq Coloneqq coloneq Coloneq eqqcolon Eqqcolon eqcolon Eqcolon colonapprox Colonapprox approxcolon Approxcolon colonsim Colonsim simcolon Simcolon colondash Colondash dashcolon Dashcolon".split(" ")
const MT_ARG = ["mathllap", "mathrlap", "mathclap", "mathclap[\\scriptstyle]", "mathllap[\\displaystyle]", "pdA", "pdB", "pdC", "pdD", "pdA*", "pdC*", "pdB[\\big]", "pdA[\\Bigg]", "pdC[]"]
/** text commands in math (amsmath adds \text) */
const TEXT_COMMANDS = ["mbox", "textrm", "textbf", "textit", "textsf", "texttt", "textsl", "textsc", "textnormal", "textup", "textmd"]
/** the generalized fraction primitives and LaTeX's \choose, \brack, \brace; amsmath's \genfrac family */
const PRIMITIVE_FRACTIONS = ["over", "atop", "above", "overwithdelims", "atopwithdelims", "abovewithdelims", "choose", "brack", "brace"]
const AMS_FRACTIONS = ["genfrac", "dfrac", "tfrac", "binom", "dbinom", "tbinom", "cfrac"]
const ACCENTS = "hat check tilde acute grave dot ddot breve bar vec mathring widehat widetilde".split(" ")
const AMS_ACCENTS = "Hat Check Tilde Acute Grave Dot Ddot Breve Bar Vec".split(" ")

function generator(r: () => number, pool: number[], busy: number[], symbols: (ams: boolean) => string[], ams: () => boolean) {
  const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)]
  // (amsmath's \colon, \nobreak\mskip2mu\mathpunct{}…, is no script: a command, with the others)
  const char = (): Nucleus & Script => {
    if (r() < 0.15) { let name = pick(symbols(ams())); if (name === "colon" && ams()) name = "cdotp"; return { kind: "sym", name } }
    return { kind: "char", code: r() < 0.45 ? pick(busy) : pick(pool) }
  }
  const script = (depth: number): Script => (depth < 3 && r() < 0.3 ? { kind: "group", items: list(depth + 1, 3) } : char())
  const nucleus = (depth: number): Nucleus => {
    const x = r()
    if (depth < 3 && x < 0.12) return { kind: "group", items: list(depth + 1, 3) }
    if (depth < 3 && x < 0.2) return { kind: "frac", num: list(depth + 1, 3), den: list(depth + 1, 3) }
    if (depth < 4 && x < 0.24) return { kind: "fence", left: pick(FENCES), items: list(depth + 1, 4), right: pick(FENCES), ...(r() < 0.3 ? { middle: { delim: pick(FENCES), items: list(depth + 1, 3) } } : {}) }
    if (depth < 3 && x >= 0.5 && x < 0.55) {
      const cs = pick(ams() ? [...ACCENTS, ...AMS_ACCENTS] : ACCENTS)
      for (;;) { const arg = script(depth); if (!ams() || !/\\(hat|check|tilde|acute|grave|dot|ddot|breve|bar|vec|mathring|Hat|Check|Tilde|Acute|Grave|Dot|Ddot|Breve|Bar|Vec)(?![a-zA-Z])/.test(arg.kind === "group" ? print(arg.items) : "")) return { kind: "accent", cs, arg } }
    }
    if (depth < 3 && x >= 0.55 && x < 0.6) {
      const cs = pick([...PRIMITIVE_FRACTIONS, ...(ams() ? AMS_FRACTIONS : [])])
      const delims: [string, string] | undefined = cs.endsWith("withdelims") || (cs === "genfrac" && r() < 0.6) ? [pick(FENCES), pick(FENCES)] : undefined
      return { kind: "genfrac", cs, num: list(depth + 1, 3), den: list(depth + 1, 3), delims,
        thickness: cs.startsWith("above") || cs === "genfrac" ? pick(["", "0pt", "0.4pt", "1pt", "2.5pt"].slice(cs === "genfrac" ? 0 : 1)) : undefined,
        style: cs === "genfrac" ? pick(["", "0", "1", "2", "3"]) : cs === "cfrac" ? pick(["", "[l]", "[r]", "[c]"]) : undefined }
    }
    if (x >= 0.6 && x < 0.63) {
      const word = () => pick(["if", "and", "for all", "x", "max", "a b", "fi", "--", "$x$", "$y^2$ and", "\\textbf{B}", "AV", "1,2"])
      return { kind: "text", cs: pick([...TEXT_COMMANDS, ...(ams() ? ["text", "text", "text"] : [])]), text: Array.from({ length: 1 + Math.floor(r() * 3) }, word).join(pick([" ", "", " "])) }
    }
    if (x >= 0.47 && x < 0.5) return { kind: "big", cs: pick(["big", "Big", "bigg", "Bigg"]) + pick(["", "l", "r", "m"]), delim: pick(FENCES) }
    if (depth < 3 && x < 0.28 && ams()) { // amsmath's matrix environments: rows of cells, sometimes ragged, sometimes a final \\
      const cols = 1 + Math.floor(r() * 3)
      const rows = Array.from({ length: 1 + Math.floor(r() * 3) }, () => Array.from({ length: r() < 0.2 ? 1 + Math.floor(r() * cols) : cols }, () => list(depth + 1, 2, true)))
      return { kind: "matrix", env: pick(MATRICES), rows, cr: r() < 0.3 }
    }
    if (depth < 3 && x >= 0.28 && x < 0.33) {
      const cs = pick(["overline", "underline", "sqrt"] as const)
      return { kind: "line", cs, arg: r() < 0.7 ? { kind: "group", items: list(depth + 1, 3) } : char(), ...(cs === "sqrt" && r() < 0.5 ? { index: rootIndex(depth + 1) } : {}) }
    }
    if (depth < 3 && x >= 0.37 && x < 0.39) return { kind: "cmd", cs: pick(ams() ? [...ARG_COMMANDS, ...AMS_ARG_COMMANDS, ...MT_ARG] : ARG_COMMANDS), arg: list(depth + 1, 3, true) }
    if (depth < 3 && x >= 0.63 && x < 0.66) { // commands with more arguments (the last one is `arg`)
      const [cs, n] = pick([["stackrel", 1], ["mathchoice", 3], ...(ams() ? [["overset", 1], ["underset", 1], ["overunderset", 2], ["boxed", 0]] as [string, number][] : [])] as [string, number][])
      return { kind: "cmd", cs, args: Array.from({ length: n }, () => list(depth + 1, 2, true)), arg: list(depth + 1, 3, true) }
    }
    if (x >= 0.39 && x < 0.47) return { kind: "cmd", cs: r() < 0.5 ? "dots" : pick(ams() ? [...COMMANDS, ...AMS_COMMANDS, ...MT_COLONS] : COMMANDS) }
    if (depth < 3 && x >= 0.33 && x < 0.37) return { kind: "alphabet", cs: pick(ams() ? [...ALPHABETS, ...AMS_ALPHABETS] : ALPHABETS), items: list(depth + 1, 3, true) }
    if (x < 0.28) return { kind: "op", name: pick(OPERATORS), limits: r() < 0.3 ? "limits" : r() < 0.2 ? "nolimits" : undefined }
    return char()
  }
  // a \sqrt index without matrices (amsmath's \root cannot take their & and \\)
  const rootIndex = (depth: number): Item[] => { for (;;) { const l = list(depth, 2, true); if (!print(l).includes("\\begin")) return l } }
  // a bare script (empty nucleus) only where TeX inserts a dummy noad: at the start of a list or after a style change
  const list = (depth: number, max: number, noBare = false): Item[] => {
    const out: Item[] = []
    const n = Math.floor(r() * (max + 1))
    for (let i = 0; i < n; i++) {
      const prev = out[out.length - 1]
      if (r() < 0.08) { out.push({ kind: "style", style: 2 * Math.floor(r() * 4) }); continue }
      if (r() < 0.06) { out.push({ kind: "space", cs: pick(SPACES) }); continue }
      const bare = (!prev || prev.kind === "style") && r() < 0.1 && !noBare
      const primes = r() < 0.12 ? 1 + Math.floor(r() * 2) : 0
      const s = r()
      const nuc = bare ? null : nucleus(depth)
      const atom: Item = {
        kind: "atom", nucleus: nuc, primes, subFirst: r() < 0.5,
        ...(s < 0.25 || (bare && s < 0.6) ? { sup: script(depth) } : {}),
        ...((s > 0.15 && s < 0.4) || (bare && s >= 0.6) ? { sub: script(depth) } : {}),
      }
      // (amsmath's \mod{#1} ends with #1, whose last atom would take the scripts too; a group of one accent noad becomes
      // that noad, § 1187: its scripts and the group's would be doubled)
      if ((nuc?.kind === "cmd" && nuc.cs === "mod") || loneAccent(nuc)) { atom.primes = 0; delete atom.sup; delete atom.sub }
      out.push(atom)
    }
    return out
  }
  return () => list(0, 8)
}

/** a group, alphabet or \mathord whose list is a lone accent noad (or such a group, in turn): the noad replaces its ord */
function loneAccent(n: Nucleus | null): boolean {
  const inside = n?.kind === "group" || n?.kind === "alphabet" ? n.items : n?.kind === "cmd" && n.cs === "mathord" ? n.arg! : []
  return inside.length === 1 && inside[0].kind === "atom" && (inside[0].nucleus?.kind === "accent" || loneAccent(inside[0].nucleus))
}

function print(items: Item[]): string {
  const ch = (x: Nucleus | Script) => x.kind === "char" ? String.fromCharCode(x.code) + " " : x.kind === "sym" ? `\\${x.name} ` : ""
  const arg = (s: Script) => (s.kind === "group" ? `{${print(s.items)}}` : ch(s))
  return items.map((it) => {
    if (it.kind === "style") return `\\${STYLES[it.style / 2]} `
    if (it.kind === "space") return `\\${it.cs}${/^[a-z]/.test(it.cs) ? " " : ""}`
    const n = it.nucleus
    let out = !n ? "" : n.kind === "group" ? `{${print(n.items)}}` : n.kind === "frac" ? `\\frac{${print(n.num)}}{${print(n.den)}}`
      : n.kind === "op" ? `\\${n.name}${n.limits ? `\\${n.limits}` : ""} ` : n.kind === "fence" ? `\\left${n.left}${print(n.items)}${n.middle ? `\\middle${n.middle.delim}${print(n.middle.items)}` : ""}\\right${n.right}`
      // a space after \\: amsmath's \new@ifnextchar then sees no [ or *
      // (\sqrt's \@ifnextchar would take a [ as its optional argument: braced)
      // (\sqrt[index]: braced when the index holds a ], which would end it, or a matrix's &, which an outer alignment would
      // see; \@sqrt strips the braces)
      : n.kind === "line" && n.index ? `\\sqrt[${/[\]&]/.test(print(n.index)) ? `{${print(n.index)}}` : print(n.index)}]${n.arg.kind === "group" ? arg(n.arg) : `{${arg(n.arg)}}`}`
      : n.kind === "line" ? `\\${n.cs}${n.arg.kind === "group" ? arg(n.arg) : n.cs === "sqrt" && n.arg.kind === "char" && n.arg.code === 91 ? `{${arg(n.arg)}}` : ` ${arg(n.arg)}`}`
      : n.kind === "genfrac" ? (n.cs === "genfrac" ? `\\genfrac{${n.delims?.[0] ?? ""}}{${n.delims?.[1] ?? ""}}{${n.thickness}}{${n.style}}{${print(n.num)}}{${print(n.den)}}`
        : n.cs === "cfrac" ? `\\cfrac${n.style}{${print(n.num)}}{${print(n.den)}}`
        : AMS_FRACTIONS.includes(n.cs) ? `\\${n.cs}{${print(n.num)}}{${print(n.den)}}`
        : `{${print(n.num)}\\${n.cs}${n.delims ? n.delims.join("") : ""}${n.thickness ? ` ${n.thickness}` : ""} ${print(n.den)}}`)
      : n.kind === "text" ? `\\${n.cs}{${n.text}}`
      : n.kind === "accent" ? `\\${n.cs}${n.arg.kind === "group" ? arg(n.arg) : `{${arg(n.arg)}}`}`
      : n.kind === "big" ? `\\${n.cs}${n.delim}`
      : n.kind === "cmd" ? `\\${n.cs}${/^[a-z]/i.test(n.cs) ? " " : ""}${n.args ? n.args.map((a) => `{${print(a)}}`).join("") : ""}${n.arg ? `{${print(n.arg)}}` : ""}`
      : n.kind === "alphabet" ? `\\${n.cs}{${print(n.items)}}`
      : n.kind === "matrix" ? `\\begin{${n.env}}${n.rows.map((row) => row.map(print).join("&")).join("\\\\ ")}${n.cr ? "\\\\ " : ""}\\end{${n.env}}` : ch(n)
    const sup = it.sup ? `^${arg(it.sup)}` : "", sub = it.sub ? `_${arg(it.sub)}` : ""
    const primes = "'".repeat(it.primes)
    out += it.subFirst ? sub + primes + sup : primes + sup + sub
    return out
  }).join("")
}

export function mathCheck(n: number, seed: number): number {
  mkdirSync(DIR, { recursive: true })
  const data = mathData()
  const pool = Array.from({ length: 94 }, (_, i) => 33 + i).filter((c) => !SPECIAL.has(c) && data.mathcodes[c] < 0x8000)
  const r = rng(seed)
  // operators and punctuation weigh more, so spacing and rule 5 come up often
  const busy = pool.filter((c) => (data.mathcodes[c] >> 12) !== 7 && (data.mathcodes[c] >> 12) !== 0)
  // big operators come as nuclei; with amsmath, amssymb's symbols too
  const symbolsOf = (s: Record<string, number>, d: Record<string, number>) => [...Object.keys(s).filter((x) => (s[x] >> 12) !== 1), ...Object.keys(d)]
  const plain = symbolsOf(data.symbols, data.delimiters)
  const withAmssymb = [...new Set([...plain, ...["amsmath", "amsfonts", "amssymb"].flatMap((p) => symbolsOf(data.packages![p].symbols, data.packages![p].delimiters))])]
  const symbols = (ams: boolean) => (ams ? withAmssymb : plain)
  let ams = false
  const gen = generator(r, pool, busy, symbols, () => ams)
  let failed = 0, total = 0
  const seen = new Map<string, number>()
  // each size without and with amsmath (its fonts, its matrix environments)
  for (const [option, withAms] of [["10pt", false], ["11pt", false], ["12pt", false], ["10pt", true], ["11pt", true], ["12pt", true]] as const) {
    ams = withAms
    const name = `math-${option}${withAms ? "-ams" : ""}`
    const k = classData("article", option)
    mathFonts.letters = null
    mathFonts.packages = withAms ? { amsfonts: true, amssymb: true, mathrsfs: true, mathtools: true } : {}
    const env = mathEnv(k, "normalsize", withAms)
    const cases = Array.from({ length: Math.ceil(n / 6) }, () => ({ style: Math.floor(r() * 4) * 2, items: gen() }))
    writeFileSync(join(DIR, `${name}.tex`), [
      `\\documentclass[${option}]{article}`, ...(withAms ? ["\\usepackage{amsmath,amssymb,mathrsfs,mathtools}", ...PAIRED.map(([n, l, r]) => `\\DeclarePairedDelimiter\\${n}{${l}}{${r}}`)] : []), "\\showboxdepth=100 \\showboxbreadth=100000", "\\begin{document}",
      ...cases.map((c) => `\\setbox0\\hbox{$\\${STYLES[c.style / 2]} ${print(c.items)}$}\\showbox0`), "\\end{document}", "",
    ].join("\n"))
    const run = spawnSync("latex", ["-interaction=nonstopmode", `${name}.tex`], { cwd: DIR, env: texEnv({ max_print_line: "100000" }), stdio: "ignore", timeout: 300_000 })
    if (run.error) throw run.error
    const log = readFileSync(join(DIR, `${name}.log`), "latin1")
    const err = log.match(/^! (?!OK\.).*$/m)
    if (err) throw new Error(`TeX error in ${DIR}/${name}.log: ${err[0]}`)
    const lines = log.split("\n")
    const boxes: BoxNode[] = []
    for (let i = 0; i < lines.length; i++) if (lines[i] === "> \\box0=") { const { box, end } = parseBoxDump(lines, i + 1); boxes.push(box); i = end }
    if (boxes.length !== cases.length) throw new Error(`TeX showed ${boxes.length} boxes for ${cases.length} formulas (${DIR}/${name}.log)`)
    const count = (b: BoxNode) => {
      if (b.type === "glue" && b.param) seen.set(b.param, (seen.get(b.param) ?? 0) + 1)
      if (b.type === "rule") seen.set("fraction rule", (seen.get("fraction rule") ?? 0) + 1)
      if (b.type === "hbox" || b.type === "vbox") { if (b.shift) seen.set("shifted box", (seen.get("shifted box") ?? 0) + 1); b.children.forEach(count) }
    }
    cases.forEach((c, i) => {
      total++
      // (\quad's em: the text font, cmr at the size, as family 0's)
      const hl = mlistToHlist(parseFormula(paired(`\\${STYLES[c.style / 2]} ${print(c.items)}`), withAms, env.fonts[0][0]!.params[6], undefined, { dollarNext: true, font: env.fonts[0][0]!, text: mathText(k, "normalsize", { footnote: 0 }, { enc: "OT1", fam: "cmr", ser: "m", shape: "n" }, withAms), frame: (b) => framed(b, []), env }), env, TEXT, false)
      const list: Node[] = [{ kind: "math", on: true, width: data.dimens.mathsurround }, ...hl, { kind: "math", on: false, width: data.dimens.mathsurround }]
      const engine = emitBoxes(hpack(list))
      const tex = boxes[i]
      count(tex)
      const d = compareBoxLists([tex], [engine])
      if (!d) return
      failed++
      if (failed <= 8) console.log(`✗ [${name}] $\\${STYLES[c.style / 2]} ${print(c.items)}$: ${d.path} ${d.field}\n    TeX:    ${JSON.stringify(d.expected)}\n    engine: ${JSON.stringify(d.actual)}`)
    })
  }
  console.log(`${total - failed}/${total} formulas identical to TeX (seed ${seed}; ${[...seen].map(([k, v]) => `${k} ×${v}`).join(", ")})`)
  return failed ? 1 : 0
}
