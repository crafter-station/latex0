// Document fuzzer (#30): random whole documents in what the document adapter
// lays out — classes, sizes, papers, one or two sides, the geometry package, OT1 or T1 fonts, Latin Modern, Times, Helvetica, Courier and Palatino, page styles, paragraphs with inline math,
// \textbf and the other font commands, and footnotes, \chapter (report) and \section to \subsubsection (starred or not), itemize and enumerate
// lists (nested, \item[label]), description, quote, quotation, verse, center, flushleft,
// flushright and abstract, started in or out of a paragraph, with text right after them or after a
// blank line, displays (numbered equations, amsmath's too), figures and tables
// of any height and placement (here, top, bottom, float pages) with tabulars in
// them, \label in both, babel (english, british, american, portuguese, brazil, spanish: Spanish words with accents typed and in UTF-8,
// its shorthands << >> "< "> "u and \%, decimals and operators in math; french: French words, its punctuation, \og, \fg
// and \up; german and ngerman: German words, their shorthands; a second language that \foreignlanguage, \selectlanguage
// and otherlanguage select) — each compared with TeX as a fixture is:
// every glyph, every line and page decision, every page's box tree.
//
//   bun engine fuzz:documents [--n 30] [--seed 1]

import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { runFixture } from "../unit/run"

const WORDS = `the of and a to in is was that for it as with on by be at from this which are or an have but not they
were his her one all their there been has more when will would who so no if out up into than them can only other new
some could time these two may first then do any like my now over such our man even most made after also did many
before must through back years where much your way well down should because each just those people how too little
state good very make world still own see men work long get here between both life being under never day same another
know while last might great old year off come since against go came right used take three office official efficient
difficult different affluent baffled sufficient fluffy offline staff stuff fifty fifteen Typesetting composition
paragraphs hyphenation algorithm demerits badness tolerance Knuth Plass Paris London. Yes! Really? (indeed) well-known`.split(/\s+/)
/** Spanish words for babel's spanish: ASCII ones (headings and captions with hyperref, whose bookmarks take ASCII only) */
const ES_ASCII = `la de el y en los que una para con por del se las como estudio datos resultados metodo nuevo grande siempre
entre sobre desde hasta durante tiempo forma parte manera trabajo sistema proceso valor punto caso problema Madrid Lima.
cuarenta transformaciones establecida almacenamiento comunicaciones Bien! Claro?`.split(/\s+/)
/** French words for babel's french (with accents in UTF-8, elided articles) */
const FR_WORDS = `le la les de des du un une et en est que qui dans pour par sur avec plus tout comme mais nous vous ils elles
étude résultats méthode théorie système première données réseau élevé été très déjà où là être après problème l'information
d'abord qu'il aujourd'hui l'établissement transformationnelle communications Paris. Lyon. Oui! Vraiment?`.split(/\s+/)
/** German words for babel's german and ngerman: with its shorthands ("a "o "u "s) and in UTF-8 */
const DE_WORDS = `der die das und ist nicht mit von zu den des ein eine auf f"ur sich dem auch als wird bei nach aus "uber
Gr"o"se Stra"se Ma"sstab M"uller "Ubertragung Informationstheorie Rechtsschutzversicherungsgesellschaften Schifffahrt Grüße
Ergebnisse Methode Daten Berlin. Wien. Ja! Wirklich?`.split(/\s+/)
const ES_WORDS = [...ES_ASCII, ..."información teoría comunicación año niño también más está según qué él sí pingüino español acción último análisis método investigación transformación electrónica Pérez Índice ¿Qué? ¡Sí! canción".split(" ")]
/** Spanish words with accents typed as commands (text only: headings and captions take none) */
const ES_TYPED = ["\\'arbol", "ma\\~nana", "ca\\'{\\i}da", "acci\\'on", "\\'Unico", "ping\\\"uino", "pa\\'{\\i}s"]

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

export function makeDocument(r: () => number): string {
  const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)]
  // babel's spanish: Spanish words in the body (ASCII ones with hyperref)
  let es = false, esAscii = false, fr = false, de = false
  // babel's second language, which \foreignlanguage selects in text, and \selectlanguage and otherlanguage between
  // paragraphs (`switches`)
  let other: string | null = null, switches = false, babelMain: string | null = null
  const words = (n: number) => Array.from({ length: n }, () => pick(de ? DE_WORDS : fr ? FR_WORDS : es ? esAscii ? ES_ASCII : ES_WORDS : WORDS)).join(" ")
  // algpseudocode: statements, conditions and nested blocks, a procedure around them sometimes
  const algorithmic = (): string[] => {
    const lines: string[] = []
    const v = () => pick(["x", "y", "i", "n", "k", "A[i]", "lo", "hi"])
    const cond = () => r() < 0.6 ? `$${v()} ${pick(["<", ">", "\\le", "\\ne", "="])} ${v()}$` : words(1 + Math.floor(r() * 5))
    const stmt = () => pick([`$${v()} \\gets ${v()} + 1$`, words(1 + Math.floor(r() * (r() < 0.15 ? 40 : 8))), `\\Return $${v()}$`, `\\Call{${words(1)}}{${r() < 0.3 ? "" : `$${v()}$`}}`, `\\Return \\textproc{${words(1)}}`]) + (r() < 0.15 ? ` \\Comment{${words(1 + Math.floor(r() * 4))}}` : "")
    const block = (depth: number, n: number) => {
      const ind = "  ".repeat(depth)
      for (let i = 0; i < n; i++) {
        const x = r()
        if (depth < 4 && x < 0.15) {
          if (r() < 0.2) { lines.push(`${ind}\\If{${cond()}} \\State ${stmt()} \\EndIf`); continue }
          lines.push(`${ind}\\If{${cond()}}`); block(depth + 1, 1 + Math.floor(r() * 3))
          if (r() < 0.3) { lines.push(`${ind}\\ElsIf{${cond()}}`); block(depth + 1, 1 + Math.floor(r() * 2)) }
          if (r() < 0.4) { lines.push(`${ind}\\Else`); block(depth + 1, 1 + Math.floor(r() * 2)) }
          lines.push(`${ind}\\EndIf`)
        } else if (depth < 4 && x < 0.27) {
          const [open, close] = pick([["While", "EndWhile"], ["For", "EndFor"], ["ForAll", "EndFor"]])
          lines.push(`${ind}\\${open}{${cond()}}`); block(depth + 1, 1 + Math.floor(r() * 3)); lines.push(`${ind}\\${close}`)
        } else if (depth < 4 && x < 0.31) {
          const loop = r() < 0.5
          lines.push(`${ind}\\${loop ? "Loop" : "Repeat"}`); block(depth + 1, 1 + Math.floor(r() * 2))
          lines.push(loop ? `${ind}\\EndLoop` : `${ind}\\Until{${cond()}}`)
        } else if (x < 0.34) lines.push(`${ind}\\Statex`)
        else lines.push(`${ind}\\State ${stmt()}`)
      }
    }
    if (r() < 0.3) lines.push(`\\Require ${words(2 + Math.floor(r() * 4))}`)
    if (r() < 0.2) lines.push(`\\Ensure ${words(2 + Math.floor(r() * 4))}`)
    if (r() < 0.5) {
      const [open, close] = pick([["Procedure", "EndProcedure"], ["Function", "EndFunction"]])
      lines.push(`\\${open}{${words(1)}}{${r() < 0.2 ? "" : `$${v()}, ${v()}$`}}`); block(1, 1 + Math.floor(r() * 6)); lines.push(`\\${close}`)
    } else block(0, 1 + Math.floor(r() * 8))
    return [`\\begin{algorithmic}${pick(["[1]", "[1]", "", "[2]"])}`, ...lines, "\\end{algorithmic}"]
  }
  const math = () => { if (siOn && r() < 0.15) return `$${pick(["", "x = ", "E \\approx "])}${si()}$`; const m = pick(["$x$", "$x^2+y^2=z^2$", "$a_i\\leq b_i$", "$\\frac{1}{2}$", "$f(x)=\\sum_{i=1}^n a_i x^i$", "$\\alpha\\to\\beta$", "$\\left(\\frac{a}{b}\\right)^2$", "$\\langle u, v\\rangle$", "$\\mathbf{v}_\\mathrm{max}$", "$\\mathcal{A}\\cup\\mathit{diff}$", "$\\mathsf{G}^{\\mathbf{2}}_{\\mathtt{k1}}$", "$\\frac{\\mathrm{d}y}{\\mathrm{d}x}$", "$\\sqrt{2}$", "$\\sqrt{x^2+y^2}$", "$x^{\\sqrt{\\frac{1}{2}}}$", "$f(x)\\ne 0$", "$a\\,b\\:c\\;d\\!e$", "$x\\quad y\\qquad z$", "$\\int\\!\\!\\int f\\,dx\\,dy$", "$a_{i\\,j}\\neq b^{n\\;m}$", "$\\sqrt[3]{x}$", "$\\sqrt[n]{\\frac{a}{b}}^2$", "$\\sin x+\\log_2 n$", "$\\lim_{n\\to\\infty} a_n$", "$\\max_i x_i\\le\\det A$", "$\\cos^2\\theta$", "$\\lim\\limits_{x} f$", ...(ams ? ["$\\operatorname{tr} A$", "$\\operatorname*{arg\\,max}_x f$"] : []), ...(es ? ["$3.14$", "$0.5x$", "$\\sen x$", "$\\tg\\alpha$", "$x_{1.5}$", "$\\lim_{n} \\frac{1}{n}=0.5$", "$\\arccos 0 . 5$", "$\\min_i \\inf_j a_{ij}$"] : [])]); return r() < 0.2 ? `\\(${m.slice(1, -1)}\\)` : m }
  const display = () => siOn && r() < 0.15 ? `${pick(["", "F = ", "m \\ne "])}${si()}${pick(["", " + \\num{1.5}", ", \\quad x"])}` : pick(["x^2+y^2=z^2", "\\sum_{i=1}^n i=\\frac{n(n+1)}{2}", "\\int_0^1 f(x)", "E=mc^2", "a_1+a_2+\\cdots", "f(x)=\\sum_{k=0}^\\infty a_k x^k",
    "\\prod_{k=1}^{m}\\frac{1}{k}", "\\left[\\frac{\\frac{1}{2}}{\\sum_{i=1}^n x_i}\\right]", "\\left\\{ x \\right|_{a}^{b}", "\\mathbf{F}=m\\mathbf{a}", "\\sqrt{\\frac{a}{b}}+\\sqrt{\\sum_{i=1}^n x_i^2}", "\\mathrm{e}^{\\mathrm{i}\\pi}+\\mathnormal{1}=\\mathsf{0}", "\\sqrt[3]{\\frac{1}{1+\\sqrt[n]{x}}}=y^{\\sqrt[k]{2}}", "\\lim_{x\\to 0}\\frac{\\sin x}{x}=1", "\\max_{1\\le i\\le n}\\log x_i+\\limsup_{n} a_n", "\\sum_{i\\,=\\,1}^n x_i \\quad\\ne\\quad \\prod_{j} y_j \\qquad a\\!\\;b", ...(ams ? ["\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}", "A=\\begin{bmatrix} 1 & 0 & x^2 \\\\ \\frac{1}{2} & y \\end{bmatrix}", "\\begin{vmatrix} a \\\\ b \\end{vmatrix}"] : []), "x", words(1).replace(/[^a-z]/g, "") || "y", Array.from({ length: 30 }, () => pick(["a+b", "x^2", "\\alpha", "-"])).join("+")]).replace("\\cdots", "\\alpha")
  /** a display with no \\\\ of its own (a matrix's), for a row of a gather */
  const rowDisplay = () => { for (;;) { const f = display(); if (!f.includes("\\\\")) return f } }
  // a display in a list item, a theorem or a proof, maybe text after it (none: it ends the paragraph)
  let eqn = 0
  const listDisplay = () => {
    const env = pick(["bracket", "bracket", "dollars", "equation", ...(ams ? ["equation*", "align*", "align", "gather", "gather*", "multline", "multline*"] : [])])
    const f = env.startsWith("gather") || env.startsWith("multline") ? rowDisplay() : display()
    const d = env === "bracket" ? `\\[ ${f} \\]` : env === "dollars" ? `$$${f}$$` : env.startsWith("multline") ? `\\begin{${env}}\n${f} \\\\\n${r() < 0.4 ? `+ ${rowDisplay()} \\\\\n` : ""}= ${rowDisplay()}${r() < 0.2 ? " \\notag" : ""}\n\\end{${env}}` : env.startsWith("gather") ? `\\begin{${env}}\n${f}${r() < 0.7 ? ` \\\\\n${rowDisplay()}${r() < 0.3 ? " \\notag" : ""}` : ""}\n\\end{${env}}` : env.startsWith("align") ? `\\begin{${env}}\na &= ${pick(["x^2", "\\frac{1}{2}", "\\sum_{i=1}^n i", "f(x) + g(x)"])} \\\\\n &= b\n\\end{${env}}` : `\\begin{${env}}${env === "equation" && r() < 0.5 ? `\\label{eq:l${++eqn}}` : ""} ${f} \\end{${env}}`
    return `\n${d}\n${r() < 0.3 ? "" : text(3 + Math.floor(r() * 30))}`
  }
  // hyperref; cleveref
  let hyper = false, crefOn = false, tsOn = false, natOn = false, algOn = false, nrOn = false, floatOn = false
  const key = () => pick(["s:1", "s:2", "s:3", "t:1", "t:2", "figure:30", "figure:20", "nowhere"])
  // equations' keys (eq:none never defined): never a label with no counter, which \cref of several keys compares (\ifnum: TeX's Missing number)
  const ckey = () => pick(["eq:l1", "eq:l2", "eq:l3", "eq:3-1", "eq:6-1", "eq:2-1", "eq:10-1", "eq:none"])
  // top: a paragraph at the outer level, where \\ is \newline
  let isLetter = false, lstOn = false, colorOn = false, btOn = false, mrOn = false, arOn = false, siOn = false, capOn = false, capHang = false, subOn = false, urlOn = false, amsOn = false, graphOn = false, tikzOn = false
  // xcolor's expressions: base colors, the document's own, mixes, complements, explicit models
  const color = () => pick(["red", "blue", "gray", "darkgray", "orange", "teal", "cyan", "olive", "magenta", "brown", "violet", "black", "fz", "blue!50", "red!30!black", "gray!20", "green!60!blue", "fz!40", "orange!75!white", "-red", "cyan!25", "black!60"])
  const colorArg = () => r() < 0.85 ? `{${color()}}` : pick(["[rgb]{0.2,0.4,0.6}", "[rgb]{.5, 0.25 ,1}", "[RGB]{10,200,30}", "[HTML]{1F77B4}", "[gray]{0.6}", "[cmyk]{0,1,0.5,0}"])
  // siunitx: numbers (signs, decimals, groups, uncertainties, exponents), units (prefixes, powers, \per, literal), quantities,
  // ranges, lists and angles
  const siNum = () => pick(["0.75", "12345", "1234", "-3.5", "+2", "1.2e3", "1.2e-3", "e5", ".5", "1,5", "1.74 \\pm 0.02", "1.23 +- 0.045", "1.5(2)", "3.45d-4", "100", "0", "1234567.89012", "-0", "42", "6.022e23", "1.5 \\pm 1.2"])
  const siUnit = () => pick(["\\metre", "\\second", "\\kilo\\gram", "\\metre\\per\\second", "\\metre\\per\\second\\squared", "\\square\\metre", "\\cubic\\centi\\metre", "\\degreeCelsius",
    "\\ohm", "\\kilo\\ohm", "\\micro\\metre", "\\percent", "\\joule\\per\\kilogram\\per\\kelvin", "\\newton\\metre", "\\degree", "\\arcminute", "\\hertz", "\\mA", "\\kWh", "\\dB",
    "m/s", "kg.m/s^2", "\\volt\\ampere", "\\per\\second", "\\electronvolt", "\\milli\\litre", "\\metre\\tothe{3}", "\\us"])
  // its options: rounding, digit groups, markers and products, separate uncertainties, per-mode, phrases
  const siKeys = () => Array.from({ length: 1 + Math.floor(r() * 2) }, () => pick(["round-mode=places", "round-mode = places, round-precision = 1", "round-mode=figures, round-precision=3",
    "round-mode=places, round-pad=false, round-precision=3", "round-mode=places, round-zero-positive=false", "round-mode=figures, round-precision=1", "group-digits=none", "group-digits=integer",
    "group-separator={,}", "group-minimum-digits=4", "output-decimal-marker={,}", "exponent-product=\\cdot", "separate-uncertainty", "uncertainty-mode=separate", "per-mode=symbol",
    "per-mode=fraction", "inter-unit-product=\\cdot", "quantity-product={}", "range-phrase=--", "range-phrase={ -- }", "list-final-separator={ and finally }", "list-separator={; }",
    "list-pair-separator={ or }"])).join(", ")
  const siOpt = () => (r() < 0.25 ? `[${siKeys()}]` : "")
  const si = () => {
    const x = r()
    if (x < 0.2) return `\\num${siOpt()}{${siNum()}}`
    if (x < 0.35) return `\\${pick(["si", "unit"])}${siOpt()}{${siUnit()}}`
    if (x < 0.75) return `\\${pick(["SI", "qty"])}${siOpt()}{${siNum()}}{${siUnit()}}`
    if (x < 0.85) return pick([`\\numrange${siOpt()}{${siNum()}}{${siNum()}}`, `\\qtyrange{1}{${siNum()}}{${siUnit()}}`, `\\SIrange{2}{3}{${siUnit()}}`])
    if (x < 0.95) return pick(["\\numlist{1;2;3}", `\\SIlist${siOpt()}{${siNum()};${siNum()}}{${siUnit()}}`, `\\qtylist{1;2;3;4}{${siUnit()}}`, `\\numlist${siOpt()}{${siNum()}}`])
    return `\\ang{${pick(["45", "1;2;3", ";;3", "12.5;30"])}}`
  }
  // a tabular: l, c, r and p{width} columns with | and || rules, @{} and @{text}, *{n}{cols}; entries in fonts, formulas, empty;
  // \multicolumn with rules of its own, \hline (sometimes doubled), \cline, \\[skip]
  const tabular = (pos = "") => {
    const n = 1 + Math.floor(r() * 4)
    const rule = () => (r() < 0.3 ? (r() < 0.2 ? "||" : "|") : "")
    let spec = r() < 0.2 ? pick(es ? ["@{}", "@{: }"] : ["@{}", "@{~}", "@{: }"]) : rule() // (spanish.ldf's active ~ in a preamble: an error)
    const kinds = Array.from({ length: n }, () => r() < 0.12 ? `${arOn && r() < 0.4 ? pick(["m", "b"]) : "p"}{${pick(["2cm", "3cm", "25mm", "1.2in", "5em", "0.3\\textwidth"])}}` : arOn && r() < 0.1 ? pick(["C", "B"]) : siOn && r() < 0.2 ? pick(["S", "S", "S[table-format=2.2]", "S[table-format=3.1]", "S[table-format=-1.3]", "S[round-mode=places, round-precision=1]", "S[output-decimal-marker={,}]", "S[separate-uncertainty]"]) : pick(["l", "c", "r"]))
    // siunitx's S columns: numbers, text in braces, nothing
    const sCell = () => pick(["1.5", "12.25", "-0.5", "100", "", "{Value}", "{\\textbf{x}}", "1234.5678", ".5", "3", "1.2e3", "1.5(2)", "0.001", "99.99", "{---}", "-12"])
    // array.sty: >{decl} before a column, <{decl} after it, !{text} between columns
    const decl = (box: boolean) => pick(["\\bfseries", "\\itshape", "\\small", "\\ttfamily", ...(box ? ["\\centering\\arraybackslash", "\\raggedright\\arraybackslash", "\\raggedleft\\arraybackslash"] : ["\\sffamily", "\\slshape"])]) // (no >{$}: entries have formulas of their own)
    const col = (k: string) => {
      if (!arOn || k === "C" || k === "B" || k.startsWith("S")) return k
      const box = /^[pmb]/.test(k), pre = r() < 0.25 ? decl(box) : ""
      return (pre ? `>{${pre}}` : "") + k + (r() < 0.1 && !box ? `<{${pick(["\\,\\%", ":", "."])}}` : "")
    }
    const sep = () => arOn && r() < 0.08 ? pick(["!{:}", "!{\\quad}", "!{/}"]) : r() < 0.1 ? pick(["@{}", "@{ -- }", "@{\\quad}"]) : rule()
    for (let j = 0; j < n; j++) spec += col(kinds[j]) + (j < n - 1 ? sep() : "")
    spec += r() < 0.2 ? "@{}" : rule()
    if (r() < 0.1) spec = `${rule()}*{${n}}{${pick(["c", "l|", "r"])}}`
    const cell = (long = false) => {
      const x = r()
      if (x < 0.15) return ""
      if (x < 0.25) return math()
      if (siOn && x < 0.32) return si()
      const w = words(1 + Math.floor(r() * (long ? 12 : 3))).replace(/[^A-Za-z ]/g, "").trim() || "x"
      return x < 0.4 ? `\\${pick(["textbf", "textit", "emph", "texttt"])}{${w}}` : w
    }
    // multirow: \multirow[vpos]{rows}{*}{entry} (its rows below need not be empty)
    const entry = (p = false) => !p && mrOn && r() < 0.15 ? `\\multirow${pick(["", "", "[t]", "[b]", "[c]"])}{${1 + Math.floor(r() * 3)}}{*}{${cell() || "x"}}${r() < 0.2 ? pick([" more", " x", "~y"]) : ""}` : cell(p)
    const rows: string[] = []
    // booktabs: \toprule … \bottomrule, rules between rows (\cmidrule's with trims, \addlinespace, \specialrule)
    const bt = btOn && r() < 0.6
    const range = () => { const a = 1 + Math.floor(r() * n); return `{${a}-${a + Math.floor(r() * (n - a + 1))}}` }
    const btRule = () => pick(["\\midrule", "\\midrule", `\\cmidrule${pick(["", "(lr)", "(l)", "(r)", "[0.8pt]", "[1pt](rl)"])}${range()}`, `\\cmidrule${range()}\\cmidrule(l)${range()}`,
      `\\cmidrule${range()}\\morecmidrules\\cmidrule${range()}`, "\\addlinespace", "\\addlinespace[2pt]", "\\specialrule{.6pt}{1pt}{2pt}", "\\midrule\\midrule", "\\midrule[1pt]", "\\addlinespace\\midrule"])
    if (bt && r() < 0.85) rows.push(pick(["\\toprule", "\\toprule", "\\toprule[1.5pt]", "\\toprule\\addlinespace"]))
    for (let i = Math.floor(r() * 6); i >= 0; i--) {
      if (bt) { if (r() < 0.35 && rows.length) rows.push(btRule()) }
      else if (r() < 0.3) rows.push(r() < 0.2 ? "\\hline\\hline" : "\\hline")
      else if (r() < 0.1 && i > 0) { const a = 1 + Math.floor(r() * n); rows.push(`\\cline{${a}-${a + Math.floor(r() * (n - a + 1))}}`) }
      const cells: string[] = []
      for (let j = 0; j < n;) {
        const span = r() < 0.15 ? 1 + Math.floor(r() * (n - j)) : 0
        if (span) { const sp = pick(["c", "|c|", "l", "r|", "|l", "p{3cm}", ...(arOn ? [">{\\bfseries}c", "m{2cm}", "|>{\\itshape}l|"] : [])]); cells.push(`\\multicolumn{${span}}{${sp}}{${entry(/^[pmb]|\}[pmb]/.test(sp))}}`); j += span } else { cells.push(kinds[j].startsWith("S") ? sCell() : entry(/^[pmbC]/.test(kinds[j]))); j++ }
      }
      const end = r() < 0.1 ? pick(["[2pt]", "[-1pt]", "[1ex]", "[0pt]"]) : ""
      rows.push(cells.join(" & ") + ` \\\\${end}`)
    }
    if (bt) { if (r() < 0.85) rows.push(pick(["\\bottomrule", "\\bottomrule", "\\bottomrule[0.5pt]"])) }
    else if (r() < 0.5) rows.push("\\hline")
    else if (r() < 0.3 && rows[rows.length - 1].replace(/ \\\\(\[[^\]]*\])?$/, "").trim()) rows[rows.length - 1] = rows[rows.length - 1].replace(/ \\\\(\[[^\]]*\])?$/, "") // (not a blank line)
    return `\\begin{tabular}${pos}{${spec}}\n${rows.join("\n")}\n\\end{tabular}`
  }
  // a minipage: one or two paragraphs (words, formulas, fonts), sometimes \centering first or a tabular inside
  // caption.sty's keys: in the preamble at once (`at` "pre"), in a type's list or a float ("list"; name= and lengths
  // in \linewidth there), in a sub-float's list ("sub": no name=)
  const capKeys = (at: "pre" | "list" | "sub") => {
    const pool = [
      () => `font=${pick(["small", "footnotesize", "it", "sf", "{small,it}", "smaller"])}`, () => `labelfont=${pick(["bf", "it", "sf", "up", "{sf,bf}"])}`,
      () => `textfont=${pick(["it", "sl", "up", "small"])}`, () => `labelsep=${pick(["colon", "period", "space", "quad", "endash", "newline", "none"])}`,
      () => `format=${pick(["plain", "hang"])}`, () => `justification=${pick(["justified", "centering", "centerlast", "raggedright", "raggedleft"])}`,
      () => `singlelinecheck=${pick(["false", "true", "off"])}`, () => `skip=${Math.floor(r() * 15)}pt`, () => `position=${pick(["top", "bottom", "auto", "above", "below"])}`,
      () => `margin=${pick(["10pt", "1cm", "{5pt,15pt}", "0pt"])}`, () => `width=${at === "pre" ? pick(["200pt", "8cm"]) : pick([".8\\linewidth", "200pt", "0.6\\linewidth"])}`,
      () => `indention=${pick(["1em", "10pt"])}`, () => `labelformat=${pick(["simple", "parens", "empty", "brace", "original"])}`,
      () => "hypcap=false", () => "list=false",
      ...(at === "list" ? [() => `name=${pick(["Fig.", "Tab", "Plate"])}`] : at === "pre" ? [() => `${pick(["figurename", "tablename"])}=${pick(["Fig.", "Tab.", "Exhibit"])}`] : []),
    ]
    const keys = Array.from({ length: 1 + Math.floor(r() * 3) }, () => pick(pool)())
    // (newline with hang is caption's error, wherever each was set: a document has one or the other; a sub-float's
    // list= and hypcap= true are not modeled)
    return keys.filter((k) => k !== (capHang ? "labelsep=newline" : "format=hang")).join(",")
  }
  const minipage = (pos = "", inline = false, cap = "", env = "minipage") => {
    const par = () => words(3 + Math.floor(r() * 25)).split(" ").map((w) => r() < 0.04 ? `${w} ${math()}` : r() < 0.03 ? `\\textbf{${w}}` : w).join(" ")
    const body = [(r() < 0.3 ? "\\centering\n" : "") + par() + (r() < 0.12 ? ` ${tabular()}` : "")]
    if (!inline && r() < 0.3) body.push("", par()) // (in text, perhaps a command's argument: no \\par)
    // in a float: a caption (and a label), after the text or first
    if (cap && r() < (env === "minipage" ? 0.6 : 0.9)) { const c = `\\caption{${words(1 + Math.floor(r() * (r() < 0.3 ? 14 : 4)))}}${r() < 0.5 ? `\\label{${cap}}` : ""}`; if (r() < 0.75) body.push(c); else body.unshift(c) }
    // caption.sty: \captionof in a minipage in text, and \captionsetup in a minipage
    if (capOn && inline && r() < 0.3) body.push(`\\captionof{${pick(["figure", "table"])}}${r() < 0.2 ? "[short]" : ""}{${words(1 + Math.floor(r() * 10))}}`)
    if (capOn && (cap || inline) && r() < 0.2) body.unshift(`\\captionsetup{${capKeys(env === "minipage" && cap ? "list" : "sub")}}`)
    return `\\begin{${env}}${pos}{${pick(["3cm", "4cm", "0.4\\textwidth", "0.45\\linewidth", ".3\\linewidth", "5em", "2.5in"])}}\n${body.join("\n")}\n\\end{${env}}`
  }
  // TikZ pictures of paths and nodes (named ones, labels on paths, lines between nodes): a tikzpicture or \tikz
  const tikzPic = (inline: boolean) => {
    const num = () => pick(["0", "1", "2", "0.5", "-1", "1.5", "3"])
    const coord = () => pick([`(${num()},${num()})`, `(${num()}cm,${num()}pt)`, `(${pick(["30", "90", "-45", "180"])}:${num()})`, `+(${num()},${num()})`, `++(${num()},${num()})`])
    const nodeText = () => pick(["x", "In", "Out", "a b", "$y_1$", "Step 2", "", "A longer text, in a node."])
    const nodeOptions = () => pick(["", "", "[draw]", "[draw,circle]", "[fill=blue!10]", "[draw,rounded corners]", "[above]", "[below right]", "[inner sep=1pt]", "[font=\\small]", "[red,sloped,above]", "[auto]", "[near end,swap]",
      "[align=center]", "[draw,text width=2cm,align=center]", "[ellipse,draw]", "[text width=15mm]", "[node font=\\footnotesize,draw]", "[label=above:$a$]", "[draw,label={[red]right:r}]"])
    // (\\ only where lines are set: align= or a text width)
    const node = () => { const o = nodeOptions(); return `node${o} {${/align|text width/.test(o) && r() < 0.5 ? "Two\\\\lines" : nodeText()}}` }
    const names: string[] = []
    const target = () => (names.length && r() < 0.4 ? `(${pick(names)})` : coord())
    const op = () => pick([` -- ${target()}`, ` -- ${coord()}`, ` rectangle ${coord()}`, ` circle (${pick(["2pt", "0.5", "1mm"])})`, " -- cycle", ` -| ${target()}`, ` |- ${coord()}`, ` to ${target()}`,
      ` ${node()}`, ` -- ${node()} ${coord()}`, ` to ${node()} ${target()}`,
      ` .. controls ${coord()} and ${coord()} .. ${target()}`, ` to[${pick(["bend left", "out=90,in=180", "bend right=20"])}] ${target()}`, ` ${coord().replace(/^\+\+?/, "")} edge[->] ${target()}`,
      ` arc (${pick(["0:90", "30:200", "180:-45"])}:${pick(["1", "5mm", "0.5"])})`, ` grid${pick(["", "[step=0.5]"])} ${coord().replace(/^\+\+?/, "")}`,
      ` -- ($(${num()},${num()})!0.5!(${num()},${num()})$)`, ` -- ($(${num()},${num()})+(1,0)$)`,
      ` -- plot${pick(["", "[mark=*]"])} coordinates {${coord().replace(/^\+\+?/, "")} ${coord().replace(/^\+\+?/, "")}}`, ` -- plot[domain=0:1,samples=4] (\\x,{\\x*\\x})`])
    const path = () => `${pick(["\\draw", "\\draw", "\\fill", "\\filldraw"])}${pick(["", "", "[thick]", "[red]", "[dashed,blue]", "[fill=green!20]", "[line width=1pt]", "[->]", "[<->,thick]", "[opacity=0.5]", "[line cap=round,line join=round]", "[x=0.5cm]"])} ${names.length && r() < 0.3 ? `(${pick(names)})` : pick(["(0,0)", "(1,1)", "(0pt,2pt)"])}${Array.from({ length: 1 + Math.floor(r() * 4) }, op).join("")};`
    const named = () => {
      const name = `n${names.length}`
      const at = names.length && r() < 0.5 ? `[draw,${pick(["right", "below", "above"])} of=${pick(names)}]` : `${pick(["[draw]", "[draw,circle]", "[fill=yellow!20]", ""])} at ${coord().replace(/^\+\+?/, "")}`
      names.push(name)
      return `\\node${at} (${name}) {${nodeText()}};`
    }
    if (inline) return r() < 0.5 ? `\\tikz${pick(["", "[baseline=-0.5ex]", "[scale=0.3]"])} ${r() < 0.2 ? `\\node${nodeOptions()} {${nodeText()}};` : path()}` : `\\tikz[scale=0.2]{${path()}}`
    return `\\begin{tikzpicture}${pick(["", "[scale=0.5]", "[thick]", "[node distance=2cm]"])}\n${Array.from({ length: 1 + Math.floor(r() * 3) }, () => (r() < 0.4 ? named() : r() < 0.15 ? `\\foreach \\i in {${pick(["0,...,3", "1,2", "0,0.5,...,2"])}} ${path().replace("(0,0)", "(\\i,0)")}` : path())).join("\n")}\n\\end{tikzpicture}`
  }
  const graphic = () => `\\includegraphics${pick(["", "[width=0.8\\textwidth]", "[height=2cm]", "[scale=0.3]", "[width=3cm,height=1cm,keepaspectratio]", "[width=0.4\\linewidth]", "[width=2cm,height=2cm]"])}{${pick(["wide", "tall.eps", "wide.eps"])}}`
  // URLs with the characters \url lays out (no spaces, %, ~, `, or what a link's string would escape)
  const address = () => {
    const seg = () => pick(["docs", "a", "2024", "reports", "file_name", "x-y", "v1.2", "index.html", "Path", "q"])
    let a = pick(["https://", "http://", "ftp://", "", "www."]) + pick(["example.org", "data.example.com", "host.example.net:8080", "user@mail.example.org"])
    for (let k = Math.floor(r() * (r() < 0.2 ? 9 : 4)); k > 0; k--) a += "/" + seg()
    if (r() < 0.2) a += pick(["?a=1&b=2", "?q=x+y", "/", ";p=3", "!"])
    return a
  }
  const text = (n: number, top = false) => {
    const ws = words(n).split(" ")
    for (let i = 0; i < ws.length; i++) {
      // \hfill, \quad, size groups, and at the outer level \\ (with * or a skip)
      if (r() < 0.006) ws[i] += pick([" \\hfill", " \\quad", "\\qquad", ` {\\${pick(["small", "large", "Large", "footnotesize", "bfseries", "itshape", "Large\\bfseries", "bf", "em", "sffamily\\small", "scshape", "slshape\\bfseries"])} ${words(1 + Math.floor(r() * 4))}}`])
      if (top && r() < 0.005) ws[i] += pick(["\\\\", " \\\\", "\\\\*", `\\\\[${2 + Math.floor(r() * 10)}pt]`])
      if (r() < 0.05) ws[i] += " " + math()
      if (siOn && r() < 0.03) ws[i] += pick([" ", " ", "~"]) + si()
      if (subOn && r() < 0.004) ws[i] += ` \\subref{${pick(["figure", "table"])}:${20 + Math.floor(r() * 40)}${pick(["a", "b", "c"])}}`
      if (r() < 0.01) ws[i] += pick(["\\%", " \\& ", " \\#1", " \\$5"])
      // french's punctuation (its spaces), \og and \fg, \up
      if (fr && r() < 0.03) ws[i] = pick([`${ws[i]} ;`, `${ws[i]};`, `${ws[i]} :`, `${ws[i]} !`, `${ws[i]}?`, `\\og ${ws[i]}\\fg{}`, `\\og ${ws[i]} \\fg,`, `${ws[i]} 2\\up{e}`, `${ws[i]} \\No 3`, `${ws[i]} 1\\ier`])
      // german's other shorthands
      if (de && r() < 0.02) ws[i] = pick([`"\`${ws[i]}"'`, `"<${ws[i]}">`, `${ws[i]}"-${ws[i]}`, `${ws[i]}"=${ws[i]}`, `${ws[i]}""${ws[i]}`, `GRO"SE ${ws[i]}`])
      if (other && r() < 0.01) ws[i] += ` \\foreignlanguage{${pick([other, babelMain!])}}{${words(1 + Math.floor(r() * 6))}}`
      if (es && !esAscii && r() < 0.03) ws[i] = pick([`<<${ws[i]}>>`, `"<${ws[i]}">`, `${ws[i]} 50\\%`, `ping"uino ${ws[i]}`, `"U${ws[i]}`, `${pick(ES_TYPED)} ${ws[i]}`])
      if (r() < 0.004) ws[i] += pick([" 90\\textdegree", " 5\\,\\textdegree C", " 21\\textdegree{}", "\\,\\textdegree.", " \\textdegree"])
      // text symbols (own characters in the run, TS1's, OMS's, OML's) and logos
      if (r() < 0.006) ws[i] += pick([" \\textbullet{}", "\\S 3", " \\pounds 5", " \\textbar", "\\textbackslash{}", " \\{x\\}", " \\textless a\\textgreater", "\\_x", " Stra\\ss e", " \\ae\\ \\oe\\ \\o", "\\dag", " \\copyright\\ 2025", "\\texttrademark", " 3.\\textordmasculine", "\\ldots", "\\textellipsis{}", " input\\slash output", " \\TeX", " \\LaTeX{}", " \\LaTeXe", " \\textendash", "\\textemdash", " \\textquotedblleft q\\textquotedblright", " \\textexclamdown", " \\P 2", " \\textperiodcentered", " \\textasciitilde", " \\today"])
      if (r() < 0.002) ws[i] += " " + tabular(pick(["", "[t]", "[b]", "[c]"]))
      if (r() < 0.0015) ws[i] += " " + minipage(pick(["", "[t]", "[b]", "[c]"]), true)
      // rules, spaces, leaders and boxes in text
      if (r() < 0.006) ws[i] += pick([` \\rule{${1 + Math.floor(r() * 40)}pt}{${pick(["0.4pt", "1pt", "1ex", "3pt"])}}`, ` \\rule[-${Math.floor(r() * 4)}pt]{1em}{${pick(["2pt", "1.5ex"])}}`, `\\hspace{${pick(["1cm", "2em", "-3pt", "5pt plus 2pt", "\\fill"])}}`,
        ` \\hspace*{${pick(["1em", "4pt"])}}`, " \\hrulefill", " \\dotfill", "\\enspace", "\\thinspace", ` \\mbox{${words(1 + Math.floor(r() * 3))}}`, ` \\fbox{${words(1 + Math.floor(r() * 3))}}`,
        ` \\makebox[${pick(["3cm", "0pt", "2\\width", "1.5in"])}]${pick(["", "[l]", "[r]", "[c]"])}{${words(1 + Math.floor(r() * 2))}}`, ` \\framebox[${pick(["3cm", "1cm"])}]${pick(["", "[l]", "[r]"])}{${words(1)}}`,
        ` \\raisebox{${pick(["2pt", "-.5ex", "1ex"])}}${pick(["", "[0pt]", "[2ex][1pt]"])}{${words(1)}}`, ` \\parbox${pick(["", "[t]", "[b]", "[t][2cm][c]"])}{${pick(["3cm", "0.3\\linewidth", "\\dimexpr 4cm-2\\fboxsep"])}}{${words(2 + Math.floor(r() * 12))}}`,
        ...(colorOn ? [` \\colorbox{${color()}}{${words(1 + Math.floor(r() * 3))}}`, ` \\fcolorbox{${color()}}{${color()}}{${words(1)}}`] : [])])
      // \underline: words, sometimes a font change or a formula, in an \hbox
      if (r() < 0.004) ws[i] += ` \\underline{${pick(["", "", " "])}${words(1 + Math.floor(r() * 3))}${pick(["", "", ` \\textit{${words(1)}}`, ` ${math()}`])}}`
      if (r() < 0.015 && !isLetter) ws[i] += `\\footnote{${words(3 + Math.floor(r() * 40))}}`
      // cross-references (read from the .aux file the first run writes) and labels, ties
      // (spanish.ldf's active ~ before a } that ends a group: an error)
      if (r() < 0.012) ws[i] += pick([`~\\ref{${key()}}`, ` \\ref{${key()}}`, ` on page~\\pageref{${key()}}`, ` \\label{${key()}}`, `\\label{${key()}}`, es ? "~\\ " : "~"])
      // hyperref's \autoref and nameref's \nameref (with hyperref, or nameref alone)
      if ((hyper || nrOn) && r() < 0.01) {
        const k = r() < 0.6 ? key() : `${pick(["figure", "table", "thm"])}:${20 + Math.floor(r() * 40)}`
        ws[i] += hyper && r() < 0.5 ? pick([` \\autoref{${k}}`, `~\\autoref*{${k}}`]) : pick([` \\nameref{${k}}`, ` \\nameref*{${k}}`, ` \\Nameref{${k}}`, ` (\\nameref{${k}})`])
      }
      // (several keys: grouped, sorted, compressed; pages; ranges; with hyperref their links, \cref* none)
      if (crefOn && r() < 0.012) ws[i] += pick([` \\cref{${key()}}`, ` \\Cref{${key()}}`, "~\\cref{eq:3-1}", " \\Cref{eq:6-1}", " \\cref{thm:4}", ` \\cref{${pick(["s:1", "t:2"])}}.`,
        ` \\cref{${ckey()},${ckey()}}`, ` \\Cref{${ckey()},${ckey()},${ckey()}}`, " \\cref{eq:l1,eq:l2,eq:l3}", "~\\cref{eq:l2,eq:3-1,eq:l1}", ` \\cpageref{${key()}}`, ` \\Cpageref{${key()},${key()}}`,
        ` \\crefrange{${key()}}{${key()}}`, ` \\Crefrange{eq:l1}{eq:l${1 + Math.floor(r() * 4)}}`, ...(hyper ? [` \\cref*{${ckey()},${ckey()}}`] : [])])
      if (r() < 0.006) ws[i] += natOn // natbib with no .bbl: every key undefined
        ? pick([" \\citep{b1}", "~\\citet{b2,b1}", " \\cite{b3}", " \\citep[p.~4]{b1}", " \\citet[see][ch.~2]{b2}", " \\citealp{b1}", " \\citeauthor{b3}", " \\citeyearpar{b1}", "~\\cite[][p.~9]{nobody}", " (\\citealt{b1,b2})"])
        : pick(["~\\cite{b1}", " \\cite{b2,b1}", " \\cite{b3}", "~\\cite{nobody}"]) // numbers from the .aux file
      if (tikzOn && r() < 0.004) ws[i] += ` ${tikzPic(true)}`
      if (graphOn && r() < 0.003) ws[i] += ` \\includegraphics[${pick(["height=1em", "scale=0.05", "width=1cm"])}]{${pick(["wide", "tall"])}}`
      if (amsOn && r() < 0.005) ws[i] += pick([" \\eqref{eq:3-1}", "~\\eqref{eq:6-1}", " \\eqref{eq:10-1}", " (\\eqref{eq:15-1})", " \\eqref{eq:2-1}", " \\eqref{nowhere}"])
      // addresses: \url (url.sty or hyperref), \nolinkurl and \href (hyperref)
      if ((urlOn || hyper) && r() < 0.006) ws[i] += pick([" ", "~", " see "]) + `\\url{${address()}}`
      if (hyper && r() < 0.004) ws[i] += r() < 0.5 ? ` \\nolinkurl{${address()}}` : ` \\href{${address()}}{${words(1 + Math.floor(r() * 4))}}`
      if (lstOn && r() < 0.008) ws[i] += pick([" \\lstinline|x = y + 1|", " \\lstinline{print('a  b')}", " \\lstinline[basicstyle=\\ttfamily]!for i in range(n):!", " \\lstinline|a_b->c|", "~\\lstinline{def f(x): return x}", " \\lstinline[columns=fixed]|q  r|"])
    }
    // runs of words in color: \textcolor and {\color …} groups
    for (let i = 0; colorOn && i < ws.length; i++) {
      if (r() >= 0.02) continue
      const len = 1 + Math.floor(r() * 4)
      const inner = ws.slice(i, i + len).join(" ")
      ws.splice(i, len, r() < 0.6 ? `\\textcolor${colorArg()}{${inner}}` : `{\\color${colorArg()} ${inner}}`)
    }
    // runs of words in other fonts (\textbf, \emph, …), sometimes nested, sometimes before , or .
    const font = () => pick(["textbf", "textit", "emph", "emph", "textsl", "textsc", "texttt", "textsf", "textmd", "textup"])
    for (let i = 0; i < ws.length; i++) {
      if (r() >= 0.04) continue
      const len = 1 + Math.floor(r() * 4)
      let inner = ws.slice(i, i + len).join(" ")
      if (r() < 0.2) inner = `${inner} \\${font()}{${words(1 + Math.floor(r() * 2))}}`
      ws.splice(i, len, `\\${font()}{${inner}}${r() < 0.2 ? pick([",", "."]) : ""}`)
    }
    // page break hints and \newpage at the paragraph's own level (not in a group)
    if (top && !isLetter && r() < 0.12) ws.splice(Math.floor(r() * ws.length), 0, pick(["\\pagebreak[2]", "\\nopagebreak", "\\pagebreak", "\\newpage", "\\clearpage"]))
    // a comment that ends a line now and then (with or without a space before it)
    return ws.map((w, i) => (i && r() < 0.004 ? `${pick(["%", " %", "% note"])}\n${pick(["", "  "])}${w}` : w)).join(" ")
  }
  // letters (letter.cls: no headings, floats or bibliography; footnotes not laid out here yet)
  const cls = r() < 0.08 ? "letter" : pick(["article", "article", "report", "book"])
  isLetter = cls === "letter"
  // class options: the size, sometimes a paper and two-sided printing
  const copts = [pick(["", "11pt", "12pt"]), r() < 0.25 ? pick(["a4paper", "a5paper", "b5paper", "legalpaper", "executivepaper", "letterpaper"]) : "", r() < 0.2 && cls !== "letter" ? (cls === "book" ? "oneside" : "twoside") : ""].filter(Boolean)
  const out = [`\\documentclass${copts.length ? `[${copts.join(",")}]` : ""}{${cls}}`]
  // graphics: EPS files the document writes before \documentclass (filecontents*, prepended at the end, since the
  // preamble's lines are spliced in after out[0]), and graphicx
  const files: string[] = []
  graphOn = r() < 0.25 && !isLetter
  if (graphOn) {
    const eps = (name: string, bb: string) => [`\\begin{filecontents*}[overwrite]{${name}.eps}`, "%!PS-Adobe-3.0 EPSF-3.0", `%%BoundingBox: ${bb}`, "%%EndComments", "\\end{filecontents*}"]
    files.push(...eps("wide", "0 0 400 200"), ...eps("tall", "10 20 110.5 320.25"))
    out.push("\\usepackage{graphicx}")
  }
  // the geometry package: margins, body sizes, scales, ratios, head and foot, rounding
  const geo = r() < 0.3
  if (geo) {
    const len = () => pick([`${(0.5 + Math.floor(r() * 12) / 8).toFixed(3).replace(/0+$/, "")}in`, `${1 + Math.floor(r() * 30) / 10}cm`, `${20 + Math.floor(r() * 50)}mm`, `${40 + Math.floor(r() * 60)}pt`])
    const keys = pick([
      () => [`margin=${len()}`],
      () => [`left=${len()}`, `right=${len()}`, `top=${len()}`, `bottom=${len()}`],
      () => [`hmargin=${len()}`, `vmargin={${len()},${len()}}`],
      () => [`textwidth=${300 + Math.floor(r() * 150)}pt`, `textheight=${30 + Math.floor(r() * 15)}\\baselineskip`],
      () => [`hscale=0.${6 + Math.floor(r() * 3)}`, `vscale=0.${6 + Math.floor(r() * 3)}`],
      () => [`left=${len()}`, `width=${300 + Math.floor(r() * 120)}pt`, `top=${len()}`],
      () => [`right=${len()}`, `bottom=${len()}`],
      () => [`margin=${len()}`, `hmarginratio=${1 + Math.floor(r() * 3)}:${1 + Math.floor(r() * 3)}`],
    ])()
    if (r() < 0.2) keys.push(pick(["includehead", "includefoot", "includeheadfoot", "heightrounded", "a4paper", "landscape", "bindingoffset=1cm", "headsep=10pt", "footskip=20pt"]))
    if (r() < 0.5) out.push(`\\usepackage[${keys.join(",")}]{geometry}`)
    else out.push("\\usepackage{geometry}", `\\geometry{${keys.join(",")}}`)
  }
  const style = r()
  if (style < 0.2) out.push("\\pagestyle{empty}")
  else if (style < 0.4 && !isLetter) out.push(style < 0.32 ? "\\pagestyle{headings}" : "\\pagestyle{myheadings}") // running heads from the section marks, or \markboth's
  else if (style < 0.6 && !isLetter) { // fancyhdr: its fields, rules, \chaptermark and \sectionmark (after geometry)
    const field = () => pick(["MATH 201", "Problem Set 3", "\\textbf{Notes}", "\\emph{Draft} copy", "Page \\thepage", "\\thepage", "\\leftmark", "\\rightmark", "\\slshape\\rightmark",
      "\\rmfamily\\thepage", "A. Student -- \\today", "Lecture notes on typesetting, line breaking and the many ways a running head can grow too long for one line", ""])
    out.push("\\usepackage{fancyhdr}")
    if (r() < 0.85) out.push("\\pagestyle{fancy}")
    if (r() < 0.5) out.push("\\fancyhf{}")
    for (const hf of ["head", "foot"]) for (const pos of ["L", "C", "R"]) {
      if (r() < 0.4) out.push(`\\fancy${hf}[${r() < 0.3 ? pick([`${pos}E,${pos === "L" ? "R" : pos === "R" ? "L" : "C"}O`, `${pos}O`, pos.toLowerCase()]) : pos}]{${field()}}`)
    }
    if (r() < 0.2) out.push(`\\${pick(["l", "c", "r"])}${pick(["head", "foot"])}{${field()}}`)
    if (r() < 0.3) out.push(`\\renewcommand{\\headrulewidth}{${pick(["0pt", "1pt", "0.8pt"])}}`)
    if (r() < 0.2) out.push(`\\renewcommand{\\footrulewidth}{${pick(["0.4pt", "2pt"])}}`)
    if (r() < 0.2) out.push(`\\setlength{\\headheight}{${pick(["14pt", "24pt"])}}`)
  }
  const t1 = r() < 0.3
  if (t1) out.push("\\usepackage[utf8]{inputenc}", "\\usepackage[T1]{fontenc}") // the EC fonts
  // font packages: lmodern (the Latin Modern families and math fonts), times, helvet (scaled), courier and palatino (not with letter
  // or listings; first in the preamble)
  const fontPkg = !isLetter && r() < 0.2 ? pick(["\\usepackage{lmodern}", "\\usepackage{lmodern}", "\\usepackage{times}", "\\usepackage{helvet}",
    "\\usepackage[scaled=.92]{helvet}", "\\usepackage{courier}", "\\usepackage{times}\n\\usepackage[scaled]{helvet}", "\\usepackage{palatino}"]) : null
  const ams = r() < 0.35
  amsOn = ams
  if (ams) out.push(pick(["\\usepackage{amsmath}", "\\usepackage{amsmath,amssymb}"]))
  // enumitem; \setlength in the preamble
  const enumitem = r() < 0.15
  if (enumitem) out.push("\\usepackage{enumitem}")
  // listings: code with keywords, comments, strings, spaces and tabulators, in the styles and columns it offers
  const lst = r() < 0.2 && !t1 && !fontPkg
  colorOn = r() < 0.25
  btOn = r() < 0.3
  mrOn = r() < 0.2
  arOn = r() < 0.2
  siOn = r() < 0.2
  const lstStyle = (fam: boolean) => pick(["", "\\bfseries", "\\itshape", "\\slshape", ...(fam ? ["\\ttfamily", "\\ttfamily\\small", "\\footnotesize", "\\small\\ttfamily", "\\sffamily", "\\scriptsize\\ttfamily"] : ["\\ttfamily", "\\upshape", "\\mdseries"])]) +
    (colorOn && r() < 0.4 ? `\\color${lstEnv ? `{${color()}}` : colorArg()}` : "") // (no [ ] in the environment's options)
  let lstEnv = false
  const lstKeys = (env: boolean) => { // (no [ ] in a value of the environment's [options])
    lstEnv = env
    const keys: string[] = []
    if (r() < 0.6) keys.push(pick(["language=Python", "language=Python", env ? "language=Python" : "language={[2]Python}", "language=", "language=Java", "language=C", "language=C++", env ? "language=C++" : "language={[11]C++}"]))
    if (r() < 0.4) keys.push(`basicstyle=${lstStyle(true)}`)
    if (r() < 0.2) keys.push(`keywordstyle=${env ? "" : pick(["", "[2]", "[1]"])}${lstStyle(false) || "\\upshape"}`)
    if (r() < 0.2) keys.push(`commentstyle=${lstStyle(false)}`)
    if (r() < 0.2) keys.push(`stringstyle=${lstStyle(false)}`)
    if (r() < 0.1) keys.push(`identifierstyle=${lstStyle(false)}`)
    if (r() < 0.25) keys.push(`columns=${pick(["fixed", "flexible", "fullflexible", env ? "fixed" : "[c]fixed"])}`)
    if (r() < 0.2) keys.push(`showstringspaces=${pick(["false", "true"])}`)
    if (r() < 0.1) keys.push(`tabsize=${pick(["2", "4", "8", "3"])}`)
    if (r() < 0.25) keys.push(`numbers=${pick(["left", "left", "right", "none"])}`)
    if (r() < 0.1) keys.push(`numberstyle=${pick(["\\tiny", "\\footnotesize", "\\scriptsize\\ttfamily", "\\itshape"])}`)
    if (r() < 0.1) keys.push(`numbersep=${pick(["5pt", "1em", "12pt"])}`)
    if (r() < 0.05) keys.push(`stepnumber=${pick(["2", "3", "0"])}`)
    if (r() < 0.05) keys.push(`firstnumber=${pick(["3", "10", "auto"])}`)
    if (r() < 0.03) keys.push("numberblanklines=false", ...(r() < 0.5 ? ["numberfirstline=true"] : []))
    if (r() < 0.3) keys.push(`frame=${pick(["single", "single", "lines", "tb", "leftline", "topline", "bottomline", "none", "trb", "lr", "tbl"])}`)
    if (r() < 0.08) keys.push(`framerule=${pick(["0.8pt", "1pt", "0.2pt"])}`)
    if (r() < 0.08) keys.push(`framesep=${pick(["5pt", "1em", "0pt"])}`)
    if (r() < 0.05) keys.push(`rulesep=${pick(["4pt", "1pt"])}`)
    if (r() < 0.1) keys.push(`xleftmargin=${pick(["2em", "10pt", "15pt"])}`)
    if (r() < 0.05) keys.push(`xrightmargin=${pick(["1em", "10pt"])}`)
    if (r() < 0.05) keys.push(`framexleftmargin=${pick(["3pt", "1em"])}`)
    if (r() < 0.2) keys.push(`breaklines=${pick(["true", "true", "false"])}`)
    if (colorOn && r() < 0.3) keys.push(`backgroundcolor=\\color{${color()}}`)
    if (colorOn && r() < 0.15) keys.push(`rulecolor=\\color{${color()}}`)
    if (colorOn && r() < 0.05) keys.push(`${pick(["fillcolor", "rulesepcolor"])}=\\color{${color()}}`)
    if (r() < 0.05) keys.push(`breakatwhitespace=${pick(["true", "false"])}`)
    if (r() < 0.05) keys.push(`breakindent=${pick(["10pt", "0pt", "2em"])}`)
    if (r() < 0.05) keys.push(`breakautoindent=${pick(["true", "false"])}`)
    return keys
  }
  const lstsetKeys = lst && r() < 0.5 ? lstKeys(false).join(",").replace(/breaklines=true/, "breaklines=false") : "" // (\lstinline has no breaklines yet)
  lstOn = lst
  if (lst) out.push("\\usepackage{listings}", ...(lstsetKeys ? [`\\lstset{${lstsetKeys}}`] : []))
  if (colorOn) out.splice(1 + Math.floor(r() * (out.length - 1)), 0, "\\usepackage{xcolor}") // (anywhere in the preamble)
  if (btOn) out.splice(1 + Math.floor(r() * (out.length - 1)), 0, "\\usepackage{booktabs}")
  if (mrOn) out.splice(1 + Math.floor(r() * (out.length - 1)), 0, "\\usepackage{multirow}")
  if (siOn) {
    const pkg = r() < 0.2 ? `\\usepackage[${siKeys()}]{siunitx}` : "\\usepackage{siunitx}"
    out.splice(1 + Math.floor(r() * (out.length - 1)), 0, pkg)
    if (r() < 0.3) out.splice(out.indexOf(pkg) + 1, 0, `\\sisetup{${siKeys()}}`)
  }
  if (arOn) {
    out.splice(1 + Math.floor(r() * (out.length - 1)), 0, "\\usepackage{array}")
    const at = out.indexOf("\\usepackage{array}") + 1 // (after it: array.sty defines them)
    out.splice(at, 0, "\\newcolumntype{C}{>{\\centering\\arraybackslash}p{2.5cm}}", "\\newcolumntype{B}{>{\\bfseries}l}", ...(r() < 0.3 ? [`\\setlength{\\extrarowheight}{${pick(["2pt", "1ex", "4pt"])}}`] : []))
  }
  if (colorOn) out.push(`\\definecolor{fz}${pick(["{rgb}{0.1,0.5,0.9}", "{RGB}{255,136,0}", "{HTML}{2CA02C}", "{gray}{.35}", "{cmyk}{0,.5,1,0}", "{rgb}{1.0,0.25,.5}"])}`)
  const code = (hash: boolean) => { // (C's directives are not laid out yet)
    const tok = () => pick(["def", "for", "in", "range", "print", "return", "x", "y2", "my_var", "__init__", "self", "if", "else", words(1).replace(/[^a-z]/g, "") || "z",
      "0", "42", "3.14", "=", "==", "+", "-", "*", "/", "<", ">", "(", ")", "[", "]", "{", "}", ":", ",", ".", ";", "!", "?", "@", "$", "%", "&", "|", "^", "~", "`", "\\", "\\\\", "_",
      "'abc'", "'a b'", "\"it's\"", "\"x\\\"y\"", "'q\\'s'", "# note", "# a \"comment\" here", "\"\"\"doc\"\"\"", "'''", "fi", "ff", "--", "<<", "''", "``",
      "//", "// line", "/*", "*/", "/* block */", "/*/", "class", "int", "void", "public", "static", "bool", "char", "new", "nullptr", "template<T>", "std::cout"]).replace(/#/g, hash ? "#" : "@").replace(/%/g, es ? "&" : "%") // (spanish.ldf's \% in a listing: not modeled)
    const sep = () => pick([" ", " ", " ", "", "", "  ", "\t", "   "])
    const lines: string[] = []
    for (let n = 1 + Math.floor(r() * 12); n > 0; n--) {
      if (r() < 0.1) { lines.push(pick(["", "  ", "\t"])); continue }
      let l = pick(["", "", "    ", "  ", "\t", "\t  ", "        "])
      for (let t = 1 + Math.floor(r() * (r() < 0.1 ? 40 : 10)); t > 0; t--) l += tok() + sep()
      lines.push(l)
    }
    return lines
  }
  if (r() < 0.1) out.push(pick(["\\setlength{\\parindent}{0pt}", "\\setlength{\\parindent}{2em}", "\\setlength{\\parskip}{6pt plus 2pt}"]))
  hyper = r() < 0.25 && !isLetter
  if (hyper) {
    // its options or \hypersetup's: colorlinks and the link colors (color.sty's names, xcolor's with it), hidelinks,
    // pdfborder, the document information, bookmarksopen
    const names = colorOn ? ["red", "blue", "teal", "black", "blue!50!black", "magenta"] : ["red", "blue", "black", "cyan", "magenta", "green"]
    const keys = r() < 0.4 ? [...new Set(Array.from({ length: 1 + Math.floor(r() * 4) }, () => pick(["colorlinks", "colorlinks=true", "colorlinks=false", "hidelinks", "pdfborder={0 0 2}", "pdftitle={A Title}", "pdfauthor={A. Author}", "bookmarksopen", `linkcolor=${pick(names)}`, `citecolor=${pick(names)}`, `urlcolor=${pick(names)}`, `filecolor=${pick(names)}`])))] : []
    if (!keys.length) out.push("\\usepackage{hyperref}")
    else if (r() < 0.5) out.push(`\\usepackage[${keys.join(",")}]{hyperref}`)
    else out.push("\\usepackage{hyperref}", `\\hypersetup{${keys.join(", ")}}`)
  }
  // nameref alone (not with titlesec or cleveref yet)
  nrOn = !hyper && !isLetter && r() < 0.12
  if (nrOn) out.push("\\usepackage{nameref}")
  // titlesec (after hyperref): its defaults, or \titleformat's font, label, sep and \titlerule
  tsOn = cls === "article" && !nrOn && !out.includes("\\pagestyle{headings}") && !out.includes("\\usepackage{fancyhdr}") && r() < 0.2
  if (tsOn) {
    out.push("\\usepackage{titlesec}")
    for (const name of ["section", "subsection", "subsubsection"]) {
      if (r() < 0.5) continue
      const format = pick(["\\large\\bfseries", "\\normalfont\\Large\\bfseries", "\\normalsize\\bfseries", "\\Large", "\\bfseries"])
      const label = pick(["", `\\the${name}`, `\\the${name}\\quad`])
      out.push(`\\titleformat{\\${name}}${r() < 0.2 ? "[hang]" : ""}{${format}}{${label}}{${pick(["0em", "0pt", "1em", "6pt", ".5em"])}}{}${r() < 0.5 ? "[\\titlerule]" : ""}`)
    }
  }
  // natbib: its options, and a \bibliographystyle in the preamble or at the end (read back from the .aux)
  natOn = !isLetter && r() < 0.15
  const natStyle = natOn && r() < 0.6 ? pick(["plainnat", "plain", "chicago", "unsrtnat", "abbrv", "ieeetr"]) : null
  if (natOn) out.splice(1 + Math.floor(r() * (out.length - 1)), 0, `\\usepackage${pick(["", "", "[round]", "[square]", "[numbers]", "[authoryear]"])}{natbib}`)
  const natStyleAtEnd = r() < 0.5
  if (natStyle && !natStyleAtEnd) out.push(`\\bibliographystyle{${natStyle}}`)
  // setspace: an option, or a spacing command in the preamble
  if (r() < 0.15) {
    out.splice(1 + Math.floor(r() * (out.length - 1)), 0, `\\usepackage${pick(["", "", "[onehalfspacing]", "[doublespacing]", "[nodisplayskipstretch]"])}{setspace}`)
    const cmd = pick(["\\onehalfspacing", "\\doublespacing", "\\setstretch{1.3}", "\\setstretch{1.1}", "\\singlespacing", ""])
    if (cmd) out.push(cmd)
  }
  // algorithm floats with algpseudocode (noend sometimes)
  algOn = !isLetter && r() < 0.15
  // float.sty (algorithm.sty loads it): [H] for figures and tables too
  floatOn = algOn || !isLetter && r() < 0.1
  if (floatOn && !algOn) out.splice(1 + Math.floor(r() * (out.length - 1)), 0, "\\usepackage{float}")
  if (algOn) out.push(...(r() < 0.25 ? ["\\usepackage{algorithm}", "\\usepackage[noend]{algpseudocode}"] : r() < 0.4 ? ["\\usepackage{algorithm,algpseudocode}"] : ["\\usepackage{algorithm}", "\\usepackage{algpseudocode}"]))
  // caption.sty, and subcaption with it sometimes (with hyperref too: hypcap); with algorithms and listing captions
  capOn = !isLetter && r() < 0.2
  subOn = capOn && r() < 0.5
  capHang = capOn && r() < 0.5
  if (capOn) {
    // with options sometimes, and \captionsetup for all, a type or the sub-floats
    // (subcaption's options go to \captionsetup[sub]: no figurename= there)
    const both = subOn && r() < 0.5, opts = r() < 0.3 ? `[${capKeys(subOn && !both ? "sub" : "pre")}]` : ""
    out.splice(1 + Math.floor(r() * (out.length - 1)), 0, subOn ? both ? `\\usepackage${opts}{caption}\n\\usepackage{subcaption}` : `\\usepackage${opts}{subcaption}` : `\\usepackage${opts}{caption}`)
    if (r() < 0.3) out.push(`\\captionsetup{${capKeys("pre")}}`)
    // (a listing's or an algorithm's list: no name= there, no position=bottom for a listing)
    if (r() < 0.3) {
      const type = pick(["figure", "table", ...(lst ? ["lstlisting"] : []), ...(algOn ? ["algorithm"] : [])])
      const keys = capKeys("list").split(/,(?![^{]*\})/).filter((k) => type === "figure" || type === "table" || !/^(?:name|position)=/.test(k))
      if (keys.length) out.push(`\\captionsetup[${type}]{${keys.join(",")}}`)
    }
    if (subOn && r() < 0.3) out.push(`\\captionsetup[${pick(["sub", "subfigure", "subtable"])}]{${capKeys("sub")}}`)
  }
  urlOn = !hyper && r() < 0.15
  if (urlOn) out.splice(1 + Math.floor(r() * (out.length - 1)), 0, "\\usepackage{url}")
  // TikZ (which loads xcolor and graphicx)
  tikzOn = !isLetter && r() < 0.15
  if (tikzOn) out.splice(1 + Math.floor(r() * (out.length - 1)), 0, "\\usepackage{tikz}", "\\usetikzlibrary{calc,shapes.geometric}")
  const titled = r() < 0.5 && !isLetter // report: a title page
  if (isLetter) out.push(`\\signature{${words(2)}}`, `\\address{${words(2)} \\\\ ${words(3)}${r() < 0.5 ? ` \\\\ ${words(2)}` : ""}}`, ...(r() < 0.3 ? [`\\date{${words(3)}}`] : []))
  if (titled) {
    const name = () => words(1 + Math.floor(r() * 3))
    // (a subtitle after \\ at another size; \thanks in an article's, without hyperref)
    const thanks = () => (cls === "article" && !hyper && r() < 0.2 ? `\\thanks{${words(2 + Math.floor(r() * 20))}}` : "")
    out.push(`\\title{${words(r() < 0.2 ? 15 + Math.floor(r() * 15) : 2 + Math.floor(r() * 6))}${thanks()}${r() < 0.2 ? `\\\\${pick(["\\large ", "\\normalsize\\itshape ", "\\bfseries "])}${words(2 + Math.floor(r() * 5))}` : ""}}`)
    out.push(`\\author{${Array.from({ length: 1 + Math.floor(r() * 3) }, () => Array.from({ length: 1 + Math.floor(r() * 2) }, (_, i) => (i && r() < 0.3 ? "\\small " : "") + name()).join(" \\\\ ") + thanks()).join(" \\and ")}}`)
    const d = r()
    if (d < 0.3) out.push("\\date{}")
    else if (d < 0.6) out.push(`\\date{${words(3)}}`)
  }
  // a counter and a macro that steps it and makes a run-in heading, as homework templates do
  const macros = r() < 0.3 && !isLetter && !tsOn
  if (macros) out.push("\\newcounter{thm}", "\\newcommand{\\thm}{\\stepcounter{thm}\\paragraph{Theorem \\thethm.}}")
  // amsthm: theorem-like environments in the three styles, numbered alone, within sections, sharing a counter, or not at all
  // (with hyperref, numbered ones only)
  const thms: string[] = []
  if (r() < 0.25 && !isLetter) {
    out.push("\\usepackage{amsthm}", `\\newtheorem{theorem}{Theorem}${pick(["", "", "[section]"])}`, "\\newtheorem{lemma}[theorem]{Lemma}", ...(hyper ? [] : ["\\newtheorem*{claim}{Claim}"]),
      "\\theoremstyle{definition}", "\\newtheorem{definition}{Definition}", "\\theoremstyle{remark}", ...(hyper ? [] : ["\\newtheorem*{remark}{Remark}"]), "\\newtheorem{note}{Note}")
    thms.push("theorem", "lemma", ...(hyper ? [] : ["claim"]), "definition", ...(hyper ? [] : ["remark"]), "note")
  }
  // babel, its option or the class's (spanish not with TikZ, whose arrows are a TeX error with its active < and >; nor in letters)
  // (french: not with hyperref, natbib, caption.sty, TikZ or listings, nor cleveref: not modeled there; german not with
  // hyperref or listings)
  const frOk = !hyper && !natOn && !capOn && !tikzOn && !lstOn
  const lang = !isLetter && r() < 0.2 ? pick(["english", "british", "american", "portuguese", "brazil", ...(tikzOn ? [] : ["spanish", "spanish", "spanish"]), ...(frOk ? ["french", "french"] : []), ...(hyper || lstOn ? [] : ["ngerman", "german"])]) : null
  // cleveref, after amsmath and amsthm (before or after the theorems are declared)
  // (after hyperref; its options sometimes, and \crefname: not with cleveref's spanish, which redefines them)
  crefOn = !nrOn && !isLetter && lang !== "french" && r() < 0.2
  if (crefOn) {
    const opts = pick(["", "", "", "[capitalise]", "[noabbrev]", "[nameinlink]", "[nosort]", "[compress]", "[sort]", "[capitalise,noabbrev]"])
    const at = out.indexOf("\\usepackage{amsthm}")
    if (at >= 0 && r() < 0.5) out.splice(at + 1, 0, `\\usepackage${opts}{cleveref}`); else out.push(`\\usepackage${opts}{cleveref}`)
    if (r() < 0.2 && lang !== "spanish") out.push(pick(["\\crefname{section}{sec.}{secs.}", "\\Crefname{equation}{Eq.}{Eqs.}", "\\crefname{figure}{fig.}{figs.}"]))
  }
  if (lang) {
    // (not with cleveref or hyperref, whose names are the language's own, nor caption.sty or fancyhdr: not modeled there)
    other = r() < 0.4 ? pick(["english", "british", "portuguese", "brazil", ...(frOk && !crefOn ? ["french"] : []), ...(hyper || lstOn ? [] : ["ngerman"])].filter((l) => l !== lang)) : null
    switches = !!other && !crefOn && !hyper && !capOn && !out.includes("\\usepackage{fancyhdr}")
    babelMain = lang
    const langs = other ? `${other},${lang}` : lang
    if (r() < 0.25) { out[0] = out[0].replace(/^\\documentclass(?:\[([^\]]*)\])?/, (_, o: string | undefined) => `\\documentclass[${o ? `${o},` : ""}${langs}]`); out.splice(1 + Math.floor(r() * (out.length - 1)), 0, "\\usepackage{babel}") }
    else out.splice(1 + Math.floor(r() * (out.length - 1)), 0, `\\usepackage[${langs}]{babel}`)
    es = lang === "spanish"; esAscii = hyper; fr = lang === "french"; de = lang === "german" || lang === "ngerman"
  }
  if (fontPkg) out.splice(1, 0, fontPkg)
  // parskip.sty (not with titlesec or theorems yet), first in the preamble
  if (!isLetter && !tsOn && !thms.length && r() < 0.12) out.splice(1, 0, "\\usepackage{parskip}")
  out.push("\\begin{document}")
  // book: front matter (roman page numbers, unnumbered chapters) before the main matter (not in spanish: spanish.ldf's
  // \@roman in small capitals)
  const front = cls === "book" && !es && r() < 0.5
  if (front) out.push("\\frontmatter")
  if (titled && cls === "article" && r() < 0.25) { // a titlepage of its own: declarations, size groups that end their paragraphs, skips
    const sz = () => pick(["\\Large", "\\large", "\\huge\\bfseries", "\\LARGE\\bfseries", "\\itshape"])
    out.push("\\begin{titlepage}", ...(r() < 0.8 ? [pick(["\\centering", "\\raggedleft", "\\raggedright"])] : []), ...(r() < 0.4 ? [`\\vspace*{${1 + Math.floor(r() * 3)}cm}`] : []))
    for (let i = 1 + Math.floor(r() * 4); i > 0; i--) {
      out.push(r() < 0.8 ? `{${sz()} ${words(2 + Math.floor(r() * 12))}${r() < 0.2 ? `\\\\${words(2)}` : ""}\\par}` : words(3 + Math.floor(r() * 10)))
      out.push(pick(["\\vspace{1cm}", "\\vspace{2em}", "\\vfill", "\\bigskip", "\\medskip", "", "\\par"]))
    }
    out.push("\\end{titlepage}")
  } else if (titled) out.push("\\maketitle")
  if (r() < 0.25 && !isLetter) out.push("\\tableofcontents") // laid out from the .toc file the first run writes
  if (r() < 0.15 && !isLetter) out.push(...(r() < 0.5 ? ["\\listoffigures"] : []), "\\listoftables") // from the .lof and .lot files
  if (isLetter) out.push(`\\begin{letter}{${words(2)} \\\\ ${words(3)}}`, `\\opening{${words(3)},}`)
  if (front && r() < 0.3) out.push(`\\chapter{${words(2)}}`, text(30))
  if (front) out.push("\\mainmatter")
  if ((cls === "article" || cls === "report") && r() < 0.3) out.push("\\begin{abstract}", text(20 + Math.floor(r() * 60)), ...(r() < 0.4 ? ["", text(10 + Math.floor(r() * 30))] : []), "\\end{abstract}")
  let afterPar = false
  for (let b = 20 + Math.floor(r() * 40); b > 0; b--) {
    const x0 = r(), x = isLetter && x0 < 0.2 ? 0.5 : x0 // (a letter has no floats or headings)
    if (x < 0.1) {
      // a float between paragraphs: a caption, maybe a label, maybe tall (\vspace), anywhere it may go
      const env = pick(algOn ? ["figure", "table", "algorithm", "algorithm"] : ["figure", "table"])
      if (env === "algorithm") {
        const inPar: boolean = afterPar && r() < 0.4
        out.push(...(inPar ? [] : [""]), `\\begin{algorithm}${pick(["", "", "[H]", "[H]", "[h]", "[t]", "[b]", "[p]", "[htbp]", "[!t]", "[tbp]"])}`,
          ...(r() < 0.85 ? [`\\caption{${words(1 + Math.floor(r() * 6))}}`, ...(r() < 0.5 ? [`\\label{algorithm:${b}}`] : [])] : []), ...algorithmic(), "\\end{algorithm}")
        afterPar = inPar && r() < 0.6
        if (afterPar) out.push(text(3 + Math.floor(r() * 40)))
        continue
      }
      const space = r() < 0.5 ? `\\vspace{${Math.floor(r() * (r() < 0.2 ? 700 : 250))}pt}` : ""
      const table = tikzOn && r() < 0.3 ? tikzPic(false) : graphOn && r() < 0.4 ? [graphic(), ...(r() < 0.3 ? [pick(["\\hfill", "\\quad", "~"]), graphic()] : [])].join("\n") : r() < 0.3 ? tabular() : r() < 0.2 ? `${minipage(pick(["", "[t]", "[b]"]), false, `${env}:${b}a`)}${pick(["\\hfill", "\\quad", "~", ""])}\n${minipage(pick(["", "[t]", "[b]"]), false, `${env}:${b}b`)}` :
        subOn && r() < 0.5 ? Array.from({ length: 1 + Math.floor(r() * 3) }, (_, j) => minipage(pick(["", "", "[t]", "[b]", "[c]"]), false, `${env}:${b}${"abc"[j]}`, `sub${env}`)).join(pick(["\n", "%\n", "\n\\hfill\n", "\n\\quad\n"])) : ""
      // caption.sty: \caption* (no \label after it) and \caption[short], and a \captionsetup in the float
      const variant = capOn && r() < 0.3 ? pick(["*", "[]", `[${words(2)}]`]) : ""
      const caption = `\\caption${variant}{${words(1 + Math.floor(r() * 8))}}`, label = r() < 0.5 && variant !== "*" ? `\\label{${env}:${b}}` : ""
      const setup = capOn && r() < 0.25 ? `\\captionsetup{${capKeys("list")}}` : ""
      const below = table && r() < 0.5
      // a float that starts in the paragraph before it (no blank line), and the paragraph going on after it
      const inPar: boolean = afterPar && r() < 0.4
      out.push(...(inPar ? [] : [""]), `\\begin{${env}}${pick(["[htbp]", "[h]", "[!h]", "[ht]", "[hb]", "[htbp]", "[t]", "[b]", "[p]", "[tb]", "[!t]", "[!b]", "[tp]", "[bp]", "[!htbp]", "", ...(floatOn ? ["[H]", "[H]"] : [])])}`, r() < 0.7 ? "\\centering" : "",
        setup, space, ...(below ? [table, caption, label] : [caption, label, table]), `\\end{${env}}${inPar && r() < 0.3 ? "%" : ""}`)
      afterPar = inPar && r() < 0.6
      if (afterPar) out.push(text(3 + Math.floor(r() * 40)))
    } else if (x < 0.2) {
      const level = pick(["section", "section", "subsection", "subsubsection", ...(tsOn ? [] : ["paragraph", "subparagraph"]), ...(cls !== "article" ? ["chapter"] : [])])
      if (macros && r() < 0.3) { out.push("", r() < 0.5 ? "\\thm" : `\\thm ${text(5 + Math.floor(r() * 30))}`); afterPar = false; continue }
      const star = r() < 0.15
      out.push("", `\\${level}${star ? "*" : ""}{${r() < 0.1 ? words(12) : words(1 + Math.floor(r() * 4))}}${r() < 0.3 && !level.endsWith("paragraph") ? `\\label{${key()}}` : ""}`)
      if (star && !level.endsWith("paragraph") && r() < 0.5) out.push(`\\addcontentsline{toc}{${level}}{${words(1 + Math.floor(r() * 3))}}`)
      afterPar = false
    } else if (x < 0.3) {
      if (!afterPar || r() < 0.6) out.push("")
      // lists nested up to six deep (four of a kind), items with labels of their own, text after a nested list
      // environments nested up to six lists deep (four of a kind): lists with items (labels of their own,
      // text after a nested environment) and \item\relax ones with paragraphs and, where \\ ends a line, lines
      const list = (depth: number, items: number, enums: number) => {
        const env = pick(["itemize", "enumerate", "itemize", "enumerate", "description", "quote", "quotation", "verse", "center", "flushleft", "flushright"]
          .filter((e) => !(e === "itemize" && items >= 4) && !(e === "enumerate" && enums >= 4) && !(depth >= 6 && !["center", "flushleft", "flushright"].includes(e))))
        const deeper = ["center", "flushleft", "flushright"].includes(env) ? depth : depth + 1
        let lead = ""
        const nest = () => {
          if (!lead && deeper < 6 && r() < 0.25 / depth) {
            list(deeper + (deeper === depth ? 1 : 0), items + (env === "itemize" ? 1 : 0), enums + (env === "enumerate" ? 1 : 0))
            if (r() < 0.3) out.push(text(3 + Math.floor(r() * 20)))
          }
        }
        // enumitem's options
        const opts = enumitem && (env === "itemize" || env === "enumerate" || env === "description") && r() < 0.5 ? `[${pick({
          itemize: ["nosep", "noitemsep", "leftmargin=*", "nosep, leftmargin=*", "leftmargin=2em", "label=--", "label=$\\star$, labelsep=1em", "itemsep=1pt, topsep=0pt", "align=left, labelwidth=2em", "wide", "label=\\textbf{+}, leftmargin=*"],
          enumerate: ["label=(\\alph*)", "label=\\roman*., leftmargin=*", "label=\\textbf{\\arabic*.}, leftmargin=*", "start=3", "resume", "label=\\Alph*), align=left", "nosep, leftmargin=*", "label=(\\arabic*), labelsep=*", "wide=0pt", "font=\\bfseries", "label*=.\\arabic*", "label={[\\Roman*]}, parsep=2pt"],
          description: ["style=nextline, leftmargin=2cm", "style=sameline, leftmargin=3em", "leftmargin=*", "font=\\itshape", "style=unboxed", "labelwidth=1cm, align=right, leftmargin=2cm", "nosep"],
        }[env])}]` : ""
        out.push(`\\begin{${env}}${opts}`)
        if (env === "itemize" || env === "enumerate" || env === "description") {
          for (let i = 1 + Math.floor(r() * (env === "enumerate" ? (depth === 1 ? 12 : 5) : 6)); i > 0; i--) {
            const label = env === "description" ? (r() < 0.9 ? `[${words(1 + Math.floor(r() * 3))}]` : "") : r() < 0.1 ? `[${pick(["--", "Note:", "(a)", "", "*", "first one"])}]` : ""
            out.push(`\\item${label} ${text(r() < 0.3 ? 30 + Math.floor(r() * 50) : 2 + Math.floor(r() * 10))}${r() < 0.12 ? listDisplay() : ""}`)
            nest()
          }
        } else {
          const crs = ["center", "flushleft", "flushright", "verse"].includes(env)
          // (declarations in it, which last to its end)
          lead = r() < 0.15 ? pick(["\\large ", "\\bfseries ", "\\Large\\bfseries ", "\\small\\itshape ", "\\em "]) : ""
          for (let i = 1 + Math.floor(r() * 3); i > 0; i--) {
            const lines = Array.from({ length: crs ? 1 + Math.floor(r() * 3) : 1 }, () => text(r() < 0.3 ? 20 + Math.floor(r() * 40) : 2 + Math.floor(r() * 10)))
            out.push((i === 1 ? lead : "") + lines.join(" \\\\\n") + (crs && r() < 0.15 ? " \\\\" : ""))
            nest()
            if (i > 1) out.push("")
          }
        }
        out.push(`\\end{${env}}`)
      }
      list(1, 0, 0)
      afterPar = false
      if (r() < 0.3) { out.push(text(10 + Math.floor(r() * 40))); afterPar = true } // text right after the list
    } else if (thms.length && x < 0.42 && x >= 0.36) {
      // a theorem (a [note], a \label), its text in one or two paragraphs; maybe a proof after it
      if (!afterPar || r() < 0.5) out.push("")
      const env = pick(thms)
      out.push(`\\begin{${env}}${r() < 0.3 ? `[${words(1 + Math.floor(r() * 3))}]` : ""}${r() < 0.3 ? `\\label{thm:${b}}` : ""} ${text(10 + Math.floor(r() * 60))}${r() < 0.25 ? listDisplay() : ""}`, ...(r() < 0.3 ? ["", text(5 + Math.floor(r() * 30))] : []), `\\end{${env}}`)
      if (r() < 0.5) out.push(`\\begin{proof}${r() < 0.3 ? `[${pick(["Sketch", "Proof of the claim", `Proof of Theorem~\\ref{thm:${b}}`, "Idea!"])}]` : ""} ${text(10 + Math.floor(r() * 50))}${r() < 0.25 ? listDisplay() : ""}`, ...(r() < 0.3 ? ["", text(5 + Math.floor(r() * 30))] : []), "\\end{proof}")
      afterPar = false
      if (r() < 0.4) { out.push(text(10 + Math.floor(r() * 40))); afterPar = true }
    } else if (lst && x < 0.36) {
      // a listing, maybe right after text, maybe with a caption and a label, maybe text right after it
      if (!afterPar || r() < 0.5) out.push("")
      const keys = lstKeys(true)
      if (cls === "article" && r() < 0.3) keys.push(`caption={${words(1 + Math.floor(r() * 6))}}`, ...(r() < 0.5 ? [`label=lst:${b}`] : []))
      out.push(`\\begin{lstlisting}${keys.length ? `[${keys.join(",")}]` : ""}`, ...code(!/language=\{?(\[\w+\])?C/.test(keys.join(",") + lstsetKeys)), "\\end{lstlisting}")
      afterPar = false
      if (r() < 0.4) { out.push(text(10 + Math.floor(r() * 40))); afterPar = true }
    } else if (x > 0.97 && !isLetter) {
      // a tabular centered on its own
      out.push("", "\\begin{center}", tabular(), "\\end{center}")
      if (r() < 0.4) { out.push(text(10 + Math.floor(r() * 40))); afterPar = true } else afterPar = false
    } else if (switches && x < 0.53 && x >= 0.5) {
      // babel: \selectlanguage between paragraphs, or paragraphs in otherlanguage or otherlanguage*
      const l = pick([other!, babelMain!])
      // (spanish.ldf's operators, \sen …, are not defined in another language: Spanish words and formulas only in spanish)
      const wasEs = es
      if (l !== "spanish") es = false
      if (r() < 0.5) out.push("", `\\selectlanguage{${l}}`, text(5 + Math.floor(r() * 60)), ...(l !== babelMain ? ["", `\\selectlanguage{${babelMain}}`] : []))
      else { const star = r() < 0.4 ? "*" : ""; out.push("", `\\begin{otherlanguage${star}}{${l}}`, text(5 + Math.floor(r() * 60)), ...(r() < 0.4 ? ["", text(5 + Math.floor(r() * 30))] : []), `\\end{otherlanguage${star}}`) }
      es = wasEs
      afterPar = true
    } else {
      // a paragraph, maybe with displays in it or opening it
      const parts = [r() < 0.12 ? "" : text(10 + Math.floor(r() * 120), true)]
      for (let d = r() < 0.3 ? 1 + Math.floor(r() * 2) : 0; d > 0; d--) {
        const f = display()
        const env = ams ? pick(["bracket", "align", "align", "align*", "dollars", "gather", "gather*", "multline", "multline*"]) : pick(["bracket", "bracket", "equation", "dollars", "displaymath"])
        if (env === "multline" || env === "multline*") { // one formula broken in two to four rows
          const rows = Array.from({ length: 2 + Math.floor(r() * 3) }, (_, i) => (i ? "+ " : "") + rowDisplay())
          parts.push(`\\begin{${env}}\n${rows.join(" \\\\\n")}${r() < 0.2 ? " \\notag" : ""}\n\\end{${env}}`)
        } else if (env === "gather" || env === "gather*") { // rows of one formula each, some unnumbered
          const rows = Array.from({ length: 1 + Math.floor(r() * 3) }, () => rowDisplay() + (r() < 0.2 ? " \\nonumber" : ""))
          parts.push(`\\begin{${env}}\n${rows.join(" \\\\\n")}\n\\end{${env}}`)
        } else if (env === "align" || env === "align*") {
          // rows of 1 to 3 column pairs: right-aligned & left-aligned fields, some rows unnumbered
          const pairs = 1 + Math.floor(r() * 3)
          const field = () => pick(["x", "a+b", "f(x)", "\\alpha", "", "x^2", "\\sum_{i=1}^n i", "\\frac{1}{2}", "y_1"])
          const rows = Array.from({ length: 1 + Math.floor(r() * 4) }, () => {
            const fs: string[] = []
            for (let p = 0; p < pairs; p++) fs.push(field(), `${pick(["=", "\\leq", "+", ""])} ${field()}`)
            return fs.join(" & ") + (r() < 0.2 ? " \\nonumber" : "")
          })
          parts.push(`\\begin{${env}}\n${rows.join(" \\\\\n")}\n\\end{${env}}`)
        } else if (env === "equation" || (ams && r() < 0.3)) { // numbered, maybe labelled: amsmath writes the label after the tag
          const label = r() < 0.5 ? ` \\label{eq:${b}-${d}}` : ""
          parts.push(`\\begin{equation}${r() < 0.5 ? label + " " + f : f + label}\\end{equation}`)
        } else parts.push(env === "bracket" ? `\\[ ${f} \\]` : env === "dollars" ? `$$${f}$$` : `\\begin{${env}} ${f} \\end{${env}}`)
        parts.push(r() < 0.3 ? "" : text(5 + Math.floor(r() * 60)))
      }
      if (!parts.join("").trim()) parts[0] = text(10)
      // a group that ends its paragraph ({\large … \par}), \centering and friends in one, skips before it
      // (not right after a run-in heading)
      const v = /\\(?:sub)?paragraph\*?\{[^{}]*\}\s*$|^\\thm$/.test(out[out.length - 1] ?? "") ? 1 : r()
      if (parts.length === 1 && v < 0.06) parts[0] = `{${pick(["\\large", "\\small\\itshape", "\\centering", "\\raggedleft\\bfseries", "\\Large\\raggedright", "\\sffamily"])} ${parts[0]}\\par}`
      else if (parts.length === 1 && v < 0.1) parts[0] = `${pick(["\\bigskip", isLetter ? "\\bigskip" : "\\medskip", "\\smallskip", "\\vspace*{4pt}"])}\n${parts[0]}`
      // page breaks, page styles and marks between paragraphs
      else if (v < 0.14 && !isLetter) out.push("", pick(["\\newpage", "\\clearpage", "\\cleardoublepage", "\\pagebreak", "\\pagebreak[1]", "\\nopagebreak[3]", "\\thispagestyle{empty}", "\\thispagestyle{plain}", ...(hyper ? [] : ["\\setcounter{page}{7}"]),
        `\\markboth{${words(2)}}{${words(2)}}`, `\\markright{${words(2)}}`]))
      out.push("", parts.join("\n"))
      afterPar = true
    }
  }
  // appendices: \appendix, then a heading or two
  if (!isLetter && !crefOn && !tsOn && r() < 0.15) out.push("", "\\appendix", `\\${cls === "article" ? "section" : "chapter"}{${words(2)}}`, text(10 + Math.floor(r() * 40)), ...(r() < 0.4 ? [`\\section{${words(2)}}`, text(20)] : []))
  // a bibliography: \section*{References} (\chapter*{Bibliography}) and its numbered list
  if (isLetter) out.push(`\\closing{${words(2)},}`, ...(r() < 0.5 ? [""] : []), "\\end{letter}")
  if (natOn) out.push("", ...(natStyle && natStyleAtEnd ? [`\\bibliographystyle{${natStyle}}`] : []), ...(r() < 0.7 ? ["\\bibliography{refs}"] : []))
  else if (r() < 0.2 && !isLetter) {
    const n = 1 + Math.floor(r() * (r() < 0.2 ? 12 : 4))
    out.push("", `\\begin{thebibliography}{${n < 10 ? "9" : "99"}}`)
    for (let i = 1; i <= n; i++) out.push(`\\bibitem{b${i}} ${text(5 + Math.floor(r() * 40))}`)
    out.push("\\end{thebibliography}")
  }
  if (cls === "book" && r() < 0.3) out.push("\\backmatter", ...(r() < 0.5 ? [`\\chapter{${words(2)}}`, text(20)] : []))
  out.push("\\end{document}", "")
  return [...files, ...out].join("\n")
}

export function fuzzDocuments(n: number, seed: number): number {
  const r = rng(seed)
  const dir = ".cache/fuzzdoc"
  mkdirSync(dir, { recursive: true })
  let pass = 0, glyphs = 0, pending = 0
  const failures: string[] = []
  const reasons = new Map<string, number>()
  for (let i = 0; i < n; i++) {
    const file = join(dir, `doc-${seed}-${i}.tex`)
    // some under pdflatex (positions from its box dumps; its hyperref and xcolor nodes), unless they use EPS graphics
    const doc = makeDocument(r)
    writeFileSync(file, `% engine: document\n${!doc.includes("\\includegraphics") && r() < 0.3 ? "% oracle: pdflatex\n" : ""}` + doc)
    const res = runFixture(file)
    // TeX's work files (a log with \tracingassigns runs to tens of megabytes) and its saved reference are
    // kept only for differences
    if (res.status === "pass" || res.status === "skip") {
      rmSync(join(".cache/oracle", `doc-${seed}-${i}`), { recursive: true, force: true })
      for (const f of existsSync(".cache/oracle/refs") ? readdirSync(".cache/oracle/refs") : []) if (f.startsWith(`doc-${seed}-${i}.`)) rmSync(join(".cache/oracle/refs", f))
    }
    glyphs += res.glyphs
    if (res.status === "pass") pass++
    else if (res.status === "skip") { pending++; const k = (res.message ?? "").replace(/"[^"]*"/g, "…"); reasons.set(k, (reasons.get(k) ?? 0) + 1) } // a float LaTeX would move elsewhere: not laid out yet
    else failures.push(`${file}: ${res.status} ${res.message ?? ""}${res.divergence ? ` ${JSON.stringify(res.divergence)}` : ""}${res.boxDivergence ? ` ${JSON.stringify(res.boxDivergence)}` : ""}${res.decisionDivergence ? ` ${JSON.stringify(res.decisionDivergence).slice(0, 300)}` : ""}`)
  }
  for (const f of failures.slice(0, 5)) console.log("✗ " + f)
  console.log(`${pass}/${n} random documents identical to TeX, ${pending} not laid out yet${pending ? ` (${[...reasons].map(([k, v]) => `${k} ×${v}`).join("; ")})` : ""}, ${failures.length} different (seed ${seed}; ${glyphs} glyphs)`)
  return failures.length ? 1 : 0
}
