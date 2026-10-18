// Document fuzzer (#30): random whole documents in what the document adapter
// lays out — classes, sizes, papers, one or two sides, the geometry package, OT1 or T1 fonts, page styles, paragraphs with inline math,
// \textbf and the other font commands, and footnotes, \chapter (report) and \section to \subsubsection (starred or not), itemize and enumerate
// lists (nested, \item[label]), description, quote, quotation, verse, center, flushleft,
// flushright and abstract, started in or out of a paragraph, with text right after them or after a
// blank line, displays (numbered equations, amsmath's too), figures and tables
// of any height and placement (here, top, bottom, float pages) with tabulars in
// them, \label in both — each compared with TeX as a fixture is: every glyph, every line
// and page decision, every page's box tree.
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
  const words = (n: number) => Array.from({ length: n }, () => pick(WORDS)).join(" ")
  const math = () => { const m = pick(["$x$", "$x^2+y^2=z^2$", "$a_i\\leq b_i$", "$\\frac{1}{2}$", "$f(x)=\\sum_{i=1}^n a_i x^i$", "$\\alpha\\to\\beta$", "$\\left(\\frac{a}{b}\\right)^2$", "$\\langle u, v\\rangle$", "$\\mathbf{v}_\\mathrm{max}$", "$\\mathcal{A}\\cup\\mathit{diff}$", "$\\mathsf{G}^{\\mathbf{2}}_{\\mathtt{k1}}$", "$\\frac{\\mathrm{d}y}{\\mathrm{d}x}$", "$\\sqrt{2}$", "$\\sqrt{x^2+y^2}$", "$x^{\\sqrt{\\frac{1}{2}}}$"]); return r() < 0.2 ? `\\(${m.slice(1, -1)}\\)` : m }
  const display = () => pick(["x^2+y^2=z^2", "\\sum_{i=1}^n i=\\frac{n(n+1)}{2}", "\\int_0^1 f(x)", "E=mc^2", "a_1+a_2+\\cdots", "f(x)=\\sum_{k=0}^\\infty a_k x^k",
    "\\prod_{k=1}^{m}\\frac{1}{k}", "\\left[\\frac{\\frac{1}{2}}{\\sum_{i=1}^n x_i}\\right]", "\\left\\{ x \\right|_{a}^{b}", "\\mathbf{F}=m\\mathbf{a}", "\\sqrt{\\frac{a}{b}}+\\sqrt{\\sum_{i=1}^n x_i^2}", "\\mathrm{e}^{\\mathrm{i}\\pi}+\\mathnormal{1}=\\mathsf{0}", ...(ams ? ["\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}", "A=\\begin{bmatrix} 1 & 0 & x^2 \\\\ \\frac{1}{2} & y \\end{bmatrix}", "\\begin{vmatrix} a \\\\ b \\end{vmatrix}"] : []), "x", words(1).replace(/[^a-z]/g, "") || "y", Array.from({ length: 30 }, () => pick(["a+b", "x^2", "\\alpha", "-"])).join("+")]).replace("\\cdots", "\\alpha")
  // hyperref (its anchors and links for a bibliography are not laid out yet)
  let hyper = false
  const key = () => pick(["s:1", "s:2", "s:3", "t:1", "t:2", "figure:30", "figure:20", "nowhere"])
  // top: a paragraph at the outer level, where \\ is \newline
  let isLetter = false, lstOn = false, colorOn = false, btOn = false, urlOn = false, amsOn = false, graphOn = false
  // xcolor's expressions: base colors, the document's own, mixes, complements, explicit models
  const color = () => pick(["red", "blue", "gray", "darkgray", "orange", "teal", "cyan", "olive", "magenta", "brown", "violet", "black", "fz", "blue!50", "red!30!black", "gray!20", "green!60!blue", "fz!40", "orange!75!white", "-red", "cyan!25", "black!60"])
  const colorArg = () => r() < 0.85 ? `{${color()}}` : pick(["[rgb]{0.2,0.4,0.6}", "[rgb]{.5, 0.25 ,1}", "[RGB]{10,200,30}", "[HTML]{1F77B4}", "[gray]{0.6}", "[cmyk]{0,1,0.5,0}"])
  // a tabular: l, c, r and p{width} columns with | and || rules, @{} and @{text}, *{n}{cols}; entries in fonts, formulas, empty;
  // \multicolumn with rules of its own, \hline (sometimes doubled), \cline, \\[skip]
  const tabular = (pos = "") => {
    const n = 1 + Math.floor(r() * 4)
    const rule = () => (r() < 0.3 ? (r() < 0.2 ? "||" : "|") : "")
    let spec = r() < 0.2 ? pick(["@{}", "@{~}", "@{: }"]) : rule()
    const kinds = Array.from({ length: n }, () => r() < 0.12 ? `p{${pick(["2cm", "3cm", "25mm", "1.2in", "5em", "0.3\\textwidth"])}}` : pick(["l", "c", "r"]))
    for (let j = 0; j < n; j++) spec += kinds[j] + (j < n - 1 ? (r() < 0.1 ? pick(["@{}", "@{ -- }", "@{\\quad}"]) : rule()) : "")
    spec += r() < 0.2 ? "@{}" : rule()
    if (r() < 0.1) spec = `${rule()}*{${n}}{${pick(["c", "l|", "r"])}}`
    const cell = (long = false) => {
      const x = r()
      if (x < 0.15) return ""
      if (x < 0.25) return math()
      const w = words(1 + Math.floor(r() * (long ? 12 : 3))).replace(/[^A-Za-z ]/g, "").trim() || "x"
      return x < 0.4 ? `\\${pick(["textbf", "textit", "emph", "texttt"])}{${w}}` : w
    }
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
        if (span) { cells.push(`\\multicolumn{${span}}{${pick(["c", "|c|", "l", "r|", "|l", "p{3cm}"])}}{${cell()}}`); j += span } else { cells.push(cell(kinds[j].startsWith("p"))); j++ }
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
  const minipage = (pos = "", inline = false, cap = "") => {
    const par = () => words(3 + Math.floor(r() * 25)).split(" ").map((w) => r() < 0.04 ? `${w} ${math()}` : r() < 0.03 ? `\\textbf{${w}}` : w).join(" ")
    const body = [(r() < 0.3 ? "\\centering\n" : "") + par() + (r() < 0.12 ? ` ${tabular()}` : "")]
    if (!inline && r() < 0.3) body.push("", par()) // (in text, perhaps a command's argument: no \\par)
    // in a float: a caption (and a label), after the text or first
    if (cap && r() < 0.6) { const c = `\\caption{${words(1 + Math.floor(r() * (r() < 0.3 ? 14 : 4)))}}${r() < 0.5 ? `\\label{${cap}}` : ""}`; if (r() < 0.75) body.push(c); else body.unshift(c) }
    return `\\begin{minipage}${pos}{${pick(["3cm", "4cm", "0.4\\textwidth", "0.45\\linewidth", ".3\\linewidth", "5em", "2.5in"])}}\n${body.join("\n")}\n\\end{minipage}`
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
      if (r() < 0.006) ws[i] += pick([" \\hfill", " \\quad", "\\qquad", ` {\\${pick(["small", "large", "Large", "footnotesize"])} ${words(1 + Math.floor(r() * 4))}}`])
      if (top && r() < 0.005) ws[i] += pick(["\\\\", " \\\\", "\\\\*", `\\\\[${2 + Math.floor(r() * 10)}pt]`])
      if (r() < 0.05) ws[i] += " " + math()
      if (r() < 0.01) ws[i] += pick(["\\%", " \\& ", " \\#1", " \\$5"])
      if (r() < 0.004) ws[i] += pick([" 90\\textdegree", " 5\\,\\textdegree C", " 21\\textdegree{}", "\\,\\textdegree.", " \\textdegree"])
      if (r() < 0.002) ws[i] += " " + tabular(pick(["", "[t]", "[b]", "[c]"]))
      if (r() < 0.0015) ws[i] += " " + minipage(pick(["", "[t]", "[b]", "[c]"]), true)
      // \underline: words, sometimes a font change or a formula, in an \hbox
      if (r() < 0.004) ws[i] += ` \\underline{${pick(["", "", " "])}${words(1 + Math.floor(r() * 3))}${pick(["", "", ` \\textit{${words(1)}}`, ` ${math()}`])}}`
      if (r() < 0.015 && !isLetter) ws[i] += `\\footnote{${words(3 + Math.floor(r() * 40))}}`
      // cross-references (read from the .aux file the first run writes) and labels, ties
      if (r() < 0.012) ws[i] += pick([`~\\ref{${key()}}`, ` \\ref{${key()}}`, ` on page~\\pageref{${key()}}`, ` \\label{${key()}}`, `\\label{${key()}}`, "~"])
      if (r() < 0.006 && !hyper) ws[i] += pick(["~\\cite{b1}", " \\cite{b2,b1}", " \\cite{b3}", "~\\cite{nobody}"]) // numbers from the .aux file
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
  if (r() < 0.3) {
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
  else if (style < 0.4 && !isLetter) out.push("\\pagestyle{headings}") // running heads from the section marks
  const t1 = r() < 0.3
  if (t1) out.push("\\usepackage[utf8]{inputenc}", "\\usepackage[T1]{fontenc}") // the EC fonts
  const ams = r() < 0.35
  amsOn = ams
  if (ams) out.push(pick(["\\usepackage{amsmath}", "\\usepackage{amsmath,amssymb}"]))
  // enumitem; \setlength in the preamble
  const enumitem = r() < 0.15
  if (enumitem) out.push("\\usepackage{enumitem}")
  // listings: code with keywords, comments, strings, spaces and tabulators, in the styles and columns it offers
  const lst = r() < 0.2 && !t1
  colorOn = r() < 0.25
  btOn = r() < 0.3
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
  if (colorOn) out.push(`\\definecolor{fz}${pick(["{rgb}{0.1,0.5,0.9}", "{RGB}{255,136,0}", "{HTML}{2CA02C}", "{gray}{.35}", "{cmyk}{0,.5,1,0}", "{rgb}{1.0,0.25,.5}"])}`)
  const code = (hash: boolean) => { // (C's directives are not laid out yet)
    const tok = () => pick(["def", "for", "in", "range", "print", "return", "x", "y2", "my_var", "__init__", "self", "if", "else", words(1).replace(/[^a-z]/g, "") || "z",
      "0", "42", "3.14", "=", "==", "+", "-", "*", "/", "<", ">", "(", ")", "[", "]", "{", "}", ":", ",", ".", ";", "!", "?", "@", "$", "%", "&", "|", "^", "~", "`", "\\", "\\\\", "_",
      "'abc'", "'a b'", "\"it's\"", "\"x\\\"y\"", "'q\\'s'", "# note", "# a \"comment\" here", "\"\"\"doc\"\"\"", "'''", "fi", "ff", "--", "<<", "''", "``",
      "//", "// line", "/*", "*/", "/* block */", "/*/", "class", "int", "void", "public", "static", "bool", "char", "new", "nullptr", "template<T>", "std::cout"]).replace(/#/g, hash ? "#" : "@")
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
  if (hyper) out.push("\\usepackage{hyperref}")
  urlOn = !hyper && r() < 0.15
  if (urlOn) out.splice(1 + Math.floor(r() * (out.length - 1)), 0, "\\usepackage{url}")
  const titled = r() < 0.5 && !isLetter // report: a title page
  if (isLetter) out.push(`\\signature{${words(2)}}`, `\\address{${words(2)} \\\\ ${words(3)}${r() < 0.5 ? ` \\\\ ${words(2)}` : ""}}`, ...(r() < 0.3 ? [`\\date{${words(3)}}`] : []))
  if (titled) {
    const name = () => words(1 + Math.floor(r() * 3))
    out.push(`\\title{${words(r() < 0.2 ? 15 + Math.floor(r() * 15) : 2 + Math.floor(r() * 6))}}`)
    out.push(`\\author{${Array.from({ length: 1 + Math.floor(r() * 3) }, () => Array.from({ length: 1 + Math.floor(r() * 2) }, name).join(" \\\\ ")).join(" \\and ")}}`)
    const d = r()
    if (d < 0.3) out.push("\\date{}")
    else if (d < 0.6) out.push(`\\date{${words(3)}}`)
  }
  // a counter and a macro that steps it and makes a run-in heading, as homework templates do
  const macros = r() < 0.3 && !isLetter
  if (macros) out.push("\\newcounter{thm}", "\\newcommand{\\thm}{\\stepcounter{thm}\\paragraph{Theorem \\thethm.}}")
  // amsthm: theorem-like environments in the three styles, numbered alone, within sections, sharing a counter, or not at all
  const thms: string[] = []
  if (r() < 0.25 && !isLetter && !hyper) {
    out.push("\\usepackage{amsthm}", `\\newtheorem{theorem}{Theorem}${pick(["", "", "[section]"])}`, "\\newtheorem{lemma}[theorem]{Lemma}", "\\newtheorem*{claim}{Claim}",
      "\\theoremstyle{definition}", "\\newtheorem{definition}{Definition}", "\\theoremstyle{remark}", "\\newtheorem*{remark}{Remark}", "\\newtheorem{note}{Note}")
    thms.push("theorem", "lemma", "claim", "definition", "remark", "note")
  }
  out.push("\\begin{document}")
  // book: front matter (roman page numbers, unnumbered chapters) before the main matter
  const front = cls === "book" && r() < 0.5
  if (front) out.push("\\frontmatter")
  if (titled) out.push("\\maketitle")
  if (r() < 0.25 && !isLetter) out.push("\\tableofcontents") // laid out from the .toc file the first run writes
  if (isLetter) out.push(`\\begin{letter}{${words(2)} \\\\ ${words(3)}}`, `\\opening{${words(3)},}`)
  if (front && r() < 0.3) out.push(`\\chapter{${words(2)}}`, text(30))
  if (front) out.push("\\mainmatter")
  if (cls === "article" && r() < 0.3) out.push("\\begin{abstract}", text(20 + Math.floor(r() * 60)), ...(r() < 0.4 ? ["", text(10 + Math.floor(r() * 30))] : []), "\\end{abstract}")
  let afterPar = false
  for (let b = 20 + Math.floor(r() * 40); b > 0; b--) {
    const x0 = r(), x = isLetter && x0 < 0.2 ? 0.5 : x0 // (a letter has no floats or headings)
    if (x < 0.1) {
      // a float between paragraphs: a caption, maybe a label, maybe tall (\vspace), anywhere it may go
      const env = pick(["figure", "table"])
      const space = r() < 0.5 ? `\\vspace{${Math.floor(r() * (r() < 0.2 ? 700 : 250))}pt}` : ""
      const table = graphOn && r() < 0.4 ? [graphic(), ...(r() < 0.3 ? [pick(["\\hfill", "\\quad", "~"]), graphic()] : [])].join("\n") : r() < 0.3 ? tabular() : r() < 0.2 ? `${minipage(pick(["", "[t]", "[b]"]), false, `${env}:${b}a`)}${pick(["\\hfill", "\\quad", "~", ""])}\n${minipage(pick(["", "[t]", "[b]"]), false, `${env}:${b}b`)}` : ""
      const caption = `\\caption{${words(1 + Math.floor(r() * 8))}}`, label = r() < 0.5 ? `\\label{${env}:${b}}` : ""
      const below = table && r() < 0.5
      out.push("", `\\begin{${env}}${pick(["[htbp]", "[h]", "[!h]", "[ht]", "[hb]", "[htbp]", "[t]", "[b]", "[p]", "[tb]", "[!t]", "[!b]", "[tp]", "[bp]", "[!htbp]", ""])}`, r() < 0.7 ? "\\centering" : "",
        space, ...(below ? [table, caption, label] : [caption, label, table]), `\\end{${env}}`)
      afterPar = false
    } else if (x < 0.2) {
      const level = pick(["section", "section", "subsection", "subsubsection", "paragraph", "subparagraph", ...(cls !== "article" ? ["chapter"] : [])])
      if (macros && r() < 0.3) { out.push("", r() < 0.5 ? "\\thm" : `\\thm ${text(5 + Math.floor(r() * 30))}`); afterPar = false; continue }
      out.push("", `\\${level}${r() < 0.15 ? "*" : ""}{${r() < 0.1 ? words(12) : words(1 + Math.floor(r() * 4))}}${r() < 0.3 && !level.endsWith("paragraph") ? `\\label{${key()}}` : ""}`)
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
        const nest = () => {
          if (deeper < 6 && r() < 0.25 / depth) {
            list(deeper + (deeper === depth ? 1 : 0), items + (env === "itemize" ? 1 : 0), enums + (env === "enumerate" ? 1 : 0))
            if (r() < 0.3) out.push(text(3 + Math.floor(r() * 20)))
          }
        }
        // enumitem's options
        const opts = enumitem && env === "itemize" && r() < 0.5 ? `[${pick(["nosep", "noitemsep", "leftmargin=*", "nosep, leftmargin=*", "leftmargin=2em"])}]` : ""
        out.push(`\\begin{${env}}${opts}`)
        if (env === "itemize" || env === "enumerate" || env === "description") {
          for (let i = 1 + Math.floor(r() * (env === "enumerate" ? (depth === 1 ? 12 : 5) : 6)); i > 0; i--) {
            const label = env === "description" ? (r() < 0.9 ? `[${words(1 + Math.floor(r() * 3))}]` : "") : r() < 0.1 ? `[${pick(["--", "Note:", "(a)", "", "*", "first one"])}]` : ""
            out.push(`\\item${label} ${text(r() < 0.3 ? 30 + Math.floor(r() * 50) : 2 + Math.floor(r() * 10))}`)
            nest()
          }
        } else {
          const crs = ["center", "flushleft", "flushright", "verse"].includes(env)
          for (let i = 1 + Math.floor(r() * 3); i > 0; i--) {
            const lines = Array.from({ length: crs ? 1 + Math.floor(r() * 3) : 1 }, () => text(r() < 0.3 ? 20 + Math.floor(r() * 40) : 2 + Math.floor(r() * 10)))
            out.push(lines.join(" \\\\\n") + (crs && r() < 0.15 ? " \\\\" : ""))
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
      out.push(`\\begin{${env}}${r() < 0.3 ? `[${words(1 + Math.floor(r() * 3))}]` : ""}${r() < 0.3 ? `\\label{thm:${b}}` : ""} ${text(10 + Math.floor(r() * 60))}`, ...(r() < 0.3 ? ["", text(5 + Math.floor(r() * 30))] : []), `\\end{${env}}`)
      if (r() < 0.5) out.push(`\\begin{proof}${r() < 0.3 ? `[${pick(["Sketch", "Proof of the claim", `Proof of Theorem~\\ref{thm:${b}}`, "Idea!"])}]` : ""} ${text(10 + Math.floor(r() * 50))}`, ...(r() < 0.3 ? ["", text(5 + Math.floor(r() * 30))] : []), "\\end{proof}")
      afterPar = false
      if (r() < 0.4) { out.push(text(10 + Math.floor(r() * 40))); afterPar = true }
    } else if (lst && x < 0.36) {
      // a listing, maybe right after text, maybe with a caption and a label, maybe text right after it
      if (!afterPar || r() < 0.5) out.push("")
      const keys = lstKeys(true)
      if (cls === "article" && !hyper && r() < 0.3) keys.push(`caption={${words(1 + Math.floor(r() * 6))}}`, ...(r() < 0.5 ? [`label=lst:${b}`] : []))
      out.push(`\\begin{lstlisting}${keys.length ? `[${keys.join(",")}]` : ""}`, ...code(!/language=\{?(\[\w+\])?C/.test(keys.join(",") + lstsetKeys)), "\\end{lstlisting}")
      afterPar = false
      if (r() < 0.4) { out.push(text(10 + Math.floor(r() * 40))); afterPar = true }
    } else if (x > 0.97 && !isLetter) {
      // a tabular centered on its own
      out.push("", "\\begin{center}", tabular(), "\\end{center}")
      if (r() < 0.4) { out.push(text(10 + Math.floor(r() * 40))); afterPar = true } else afterPar = false
    } else {
      // a paragraph, maybe with displays in it or opening it
      const parts = [r() < 0.12 ? "" : text(10 + Math.floor(r() * 120), true)]
      for (let d = r() < 0.3 ? 1 + Math.floor(r() * 2) : 0; d > 0; d--) {
        const f = display()
        const env = ams ? pick(["bracket", "align", "align", "align*", "dollars"]) : pick(["bracket", "bracket", "equation", "dollars", "displaymath"])
        if (env === "align" || env === "align*") {
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
      out.push("", parts.join("\n"))
      afterPar = true
    }
  }
  // a bibliography: \section*{References} (\chapter*{Bibliography}) and its numbered list
  if (isLetter) out.push(`\\closing{${words(2)},}`, ...(r() < 0.5 ? [""] : []), "\\end{letter}")
  if (r() < 0.2 && !hyper && !isLetter) {
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
    writeFileSync(file, "% engine: document\n" + makeDocument(r))
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
