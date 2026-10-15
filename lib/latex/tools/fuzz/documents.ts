// Document fuzzer (#30): random whole documents in what the document adapter
// lays out — classes and sizes, page styles, paragraphs with inline math and
// footnotes, \section to \subsubsection (starred or not), itemize and enumerate
// lists started in or out of a paragraph, with text right after them or after a
// blank line — each compared with TeX as a fixture is: every glyph, every line
// and page decision, every page's box tree.
//
//   bun engine fuzz:documents [--n 30] [--seed 1]

import { mkdirSync, writeFileSync } from "node:fs"
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
  const math = () => pick(["$x$", "$x^2+y^2=z^2$", "$a_i\\leq b_i$", "$\\frac{1}{2}$", "$f(x)=\\sum_{i=1}^n a_i x^i$", "$\\alpha\\to\\beta$"])
  const display = () => pick(["x^2+y^2=z^2", "\\sum_{i=1}^n i=\\frac{n(n+1)}{2}", "\\int_0^1 f(x)", "E=mc^2", "a_1+a_2+\\cdots", "f(x)=\\sum_{k=0}^\\infty a_k x^k",
    "\\prod_{k=1}^{m}\\frac{1}{k}", "x", words(1).replace(/[^a-z]/g, "") || "y", Array.from({ length: 30 }, () => pick(["a+b", "x^2", "\\alpha", "-"])).join("+")]).replace("\\cdots", "\\alpha")
  const text = (n: number) => {
    const ws = words(n).split(" ")
    for (let i = 0; i < ws.length; i++) {
      if (r() < 0.05) ws[i] += " " + math()
      if (r() < 0.015) ws[i] += `\\footnote{${words(3 + Math.floor(r() * 40))}}`
    }
    return ws.join(" ")
  }
  const cls = pick(["article", "article", "report"])
  const out = [`\\documentclass${pick(["", "[11pt]", "[12pt]"])}{${cls}}`]
  if (r() < 0.25) out.push("\\pagestyle{empty}")
  const ams = r() < 0.35
  if (ams) out.push("\\usepackage{amsmath}")
  const titled = cls === "article" && r() < 0.5
  if (titled) {
    const name = () => words(1 + Math.floor(r() * 3))
    out.push(`\\title{${words(r() < 0.2 ? 15 + Math.floor(r() * 15) : 2 + Math.floor(r() * 6))}}`)
    out.push(`\\author{${Array.from({ length: 1 + Math.floor(r() * 3) }, () => Array.from({ length: 1 + Math.floor(r() * 2) }, name).join(" \\\\ ")).join(" \\and ")}}`)
    const d = r()
    if (d < 0.3) out.push("\\date{}")
    else if (d < 0.6) out.push(`\\date{${words(3)}}`)
  }
  out.push("\\begin{document}")
  if (titled) out.push("\\maketitle")
  let afterPar = false
  for (let b = 20 + Math.floor(r() * 40); b > 0; b--) {
    const x = r()
    if (x < 0.15) {
      const level = pick(["section", "section", "subsection", "subsubsection"])
      out.push("", `\\${level}${r() < 0.15 ? "*" : ""}{${r() < 0.1 ? words(12) : words(1 + Math.floor(r() * 4))}}`)
      afterPar = false
    } else if (x < 0.3) {
      const env = pick(["itemize", "enumerate"])
      if (!afterPar || r() < 0.6) out.push("")
      out.push(`\\begin{${env}}`)
      for (let i = 1 + Math.floor(r() * (env === "enumerate" ? 12 : 6)); i > 0; i--) out.push(`\\item ${text(r() < 0.3 ? 30 + Math.floor(r() * 50) : 2 + Math.floor(r() * 10))}`)
      out.push(`\\end{${env}}`)
      afterPar = false
      if (r() < 0.3) { out.push(text(10 + Math.floor(r() * 40))); afterPar = true } // text right after the list
    } else {
      // a paragraph, maybe with displays in it or opening it
      const parts = [r() < 0.12 ? "" : text(10 + Math.floor(r() * 120))]
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
        } else parts.push(env === "bracket" ? `\\[ ${f} \\]` : env === "dollars" ? `$$${f}$$` : `\\begin{${env}} ${f} \\end{${env}}`)
        parts.push(r() < 0.3 ? "" : text(5 + Math.floor(r() * 60)))
      }
      if (!parts.join("").trim()) parts[0] = text(10)
      out.push("", parts.join("\n"))
      afterPar = true
    }
  }
  out.push("\\end{document}", "")
  return out.join("\n")
}

export function fuzzDocuments(n: number, seed: number): number {
  const r = rng(seed)
  const dir = ".cache/fuzzdoc"
  mkdirSync(dir, { recursive: true })
  let pass = 0, glyphs = 0
  const failures: string[] = []
  for (let i = 0; i < n; i++) {
    const file = join(dir, `doc-${seed}-${i}.tex`)
    writeFileSync(file, "% engine: document\n" + makeDocument(r))
    const res = runFixture(file)
    glyphs += res.glyphs
    if (res.status === "pass") pass++
    else failures.push(`${file}: ${res.status} ${res.message ?? ""}${res.divergence ? ` ${JSON.stringify(res.divergence)}` : ""}${res.boxDivergence ? ` ${JSON.stringify(res.boxDivergence)}` : ""}${res.decisionDivergence ? ` ${JSON.stringify(res.decisionDivergence).slice(0, 300)}` : ""}`)
  }
  for (const f of failures.slice(0, 5)) console.log("✗ " + f)
  console.log(`${pass}/${n} random documents identical to TeX (seed ${seed}; ${glyphs} glyphs)`)
  return pass === n ? 0 : 1
}
