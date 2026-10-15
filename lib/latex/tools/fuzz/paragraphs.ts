// Paragraph fuzzer (#112, #41, #86): N seeded random paragraphs in one
// document, each with its own width, tolerances, \looseness, \emergencystretch
// and hanging indentation, some with inline formulas (breakable at their
// relation and binary-operator penalties, and after \mathoff), and some with
// footnotes, short or long enough to be split across pages (#115). TeX breaks them once; the engine breaks each one; every
// paragraph's \tracingparagraphs decisions must be identical.
//
//   bun engine fuzz:paragraphs [--n 200] [--seed 1]

import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { lineBreak } from "../../layout/linebreak"
import { compareParagraphs, comparePages, documentPages } from "../../trace/decisions"
import { oracleRun } from "../oracle/oracle"
import { classData } from "../classes"
import { paragraphInput, typesetBody } from "../unit/adapters/paragraph"
import { makeColumns } from "../unit/adapters/output"
import { emitBoxes } from "../../emit/boxes"
import { compareBoxLists } from "../../trace/schema"
import { findColumn } from "../oracle/boxes"

// Fixed vocabulary, so a seed means the same text on every machine. It mixes
// ligatures (fi ff ffl), kerns, capitals, punctuation that changes the space
// factor, explicit hyphens and dashes.
const WORDS = `the of and a to in is was that for it as with on by be at from this which are or an
have but not they were his her one all their there been has more when will would
who so no if out up into than them can only other new some could time these two may first
then do any like my now over such our man me even most made after also did many before
must through back years where much your way well down should because each just those people
how too little state good very make world still own see men work long get here between both
life being under never day same another know while last might us great old year off come
since against go came right used take three office official efficient difficult different
affluent baffled scaffold sufficient fluffy offline staff stuff fifty fifteen afflict
Typesetting composition arranging physical digital equivalents stored letters symbols
retrieved ordered according orthography language visual display breaking paragraphs lines
small part craft decides evenly words spread easily moves next. Nobody, however, noticed;
Yes! Really? (indeed) well-known self-evident 1990--2000 pages 12--19 mother-in-law
Knuth Plass TeX Alice Bob Wednesday Paris London. Mr. Dr. e.g. i.e. U.S.A. NASA.
quickly brown fox jumps lazy dog patient cat watches warm windowsill noise garden stays
calm evening light slowly fades quiet gentle night town characteristically incomprehensibilities
internationalization representation hyphenation algorithm demerits badness tolerance
fitness loose tight decent stretch shrink glue penalty discretionary ligature kerning`.split(/\s+/)

// inline math: atoms joined into formulas with relations and binary operators
const MATH_ATOMS = ["x", "y", "n", "a_i", "x^2", "2", "10", "(x)", "f(x)", "\\alpha", "\\beta_k", "\\frac{1}{2}", "x'", "\\sum_{i=1}^n a_i", "e^{i\\pi}", "\\infty"]
const MATH_OPS = ["+", "-", "=", "<", ">", "\\leq", "\\cdot", "\\times", "\\in", "\\to", ",", "\\nobreak=", "\\allowbreak,", "+\\penalty-50"]

/** mulberry32: small, fast, deterministic PRNG */
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

export function makeParagraphs(n: number, seed: number): string[] {
  const r = rng(seed)
  const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)]
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    const a: string[] = []
    if (r() < 0.15) a.push("\\noindent")
    const width = pick([345, 345, 300, 250, 200, 160, 120])
    if (width !== 345) a.push(`\\parshape 1 0pt ${width}pt`)
    else if (r() < 0.2) a.push(`\\hangindent=${pick([-40, 20, 30, 60])}pt`, `\\hangafter=${pick([-3, -1, 0, 1, 2])}`)
    if (r() < 0.3) a.push(`\\pretolerance=${pick([-1, 0, 50, 1000])}`)
    if (r() < 0.4) a.push(`\\tolerance=${pick([10, 50, 100, 500, 1000, 10000])}`)
    if (r() < 0.25) a.push(`\\looseness=${pick([-2, -1, 1, 2, 5])}`)
    if (r() < 0.25) a.push(`\\emergencystretch=${pick([1, 5, 10, 30])}pt`)
    if (r() < 0.1) a.push(`\\linepenalty=${pick([0, 100, 1000])}`)
    if (r() < 0.1) a.push(`\\adjdemerits=${pick([0, 100000])}`)
    if (r() < 0.1) a.push(`\\hyphenpenalty=${pick([-100, 0, 1000, 10000])}`)
    if (r() < 0.1) a.push(`\\mathsurround=${pick([1, 2, 5])}pt`)
    const len = 20 + Math.floor(r() * 120)
    const withMath = r() < 0.4
    const formula = () => {
      let f = pick(MATH_ATOMS)
      const join = (x: string) => { f += (/\\[A-Za-z]+$/.test(f) || r() < 0.5 ? " " : "") + x }
      for (let k = Math.floor(r() * 6); k > 0; k--) { join(pick(MATH_OPS)); join(pick(MATH_ATOMS)) }
      return `$${f}$`
    }
    // a formula as a word, glued to punctuation, or touching a word (which then is not hyphenated, § 899)
    const words = Array.from({ length: len }, () => !withMath || r() >= 0.15 ? pick(WORDS) : r() < 0.7 ? formula() + (r() < 0.2 ? pick([",", ".", ";"]) : "") : pick(WORDS) + formula())
    // footnotes after a word: mostly short, some long enough to split across pages
    for (let f = r() < 0.2 ? 1 + Math.floor(r() * 3) : 0; f > 0; f--) {
      const at = Math.floor(r() * words.length)
      const n = r() < 0.1 ? 150 + Math.floor(r() * 500) : 3 + Math.floor(r() * 60)
      words[at] += `\\footnote{${Array.from({ length: n }, () => (withMath && r() < 0.05 ? formula() : pick(WORDS))).join(" ")}}`
    }
    out.push([...a, words.join(" ")].join(" "))
  }
  return out
}

export function fuzzParagraphs(n: number, seed: number): number {
  const bodies = makeParagraphs(n, seed)
  const dir = ".cache/fuzz"
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `paragraphs-${seed}-${n}.tex`)
  writeFileSync(file, ["\\documentclass{article}", "\\pagestyle{empty}", "\\begin{document}", ...bodies.flatMap((b) => [`{${b}\\par}`, ""]), "\\end{document}", ""].join("\n"))
  const oracle = oracleRun(file)
  const texDecisions = oracle.decisions
  const tex = texDecisions.paragraphs
  // the engine's paragraphs in TeX's order: each footnote's paragraph before the one it is in
  const k = classData("article", "10pt")
  const doc = { footnote: 0 }
  const engine = bodies.flatMap((body, i) => {
    const { list, params, notes } = paragraphInput(body, k, "normalsize", doc)
    return [...notes, lineBreak(list, params).trace].map((trace) => ({ trace, i, body }))
  })
  if (tex.length !== engine.length) throw new Error(`TeX traced ${tex.length} paragraphs, the engine broke ${engine.length}`)
  let failed = 0
  engine.forEach(({ trace, i, body }, j) => {
    const d = compareParagraphs([tex[j]], [trace])
    if (!d) return
    failed++
    if (failed <= 5) console.log(`✗ paragraph ${i}: ${d.what}\n    TeX:    ${JSON.stringify(d.expected)}\n    engine: ${JSON.stringify(d.actual)}\n    ${body.slice(0, 160)}…`)
  })
  // the same paragraphs as one document: every page-break decision must match too
  const { pageTrace, pages } = typesetBody(bodies.map((text) => ({ size: "normalsize" as const, text })), k)
  const texPages = documentPages(texDecisions.pages)
  const pd = comparePages(texPages, pageTrace)
  if (pd) { failed++; console.log(`✗ pages: ${pd.what}\n    TeX:    ${JSON.stringify(pd.expected)}\n    engine: ${JSON.stringify(pd.actual)}`) }
  else console.log(`${texPages.length} pages: every page-break decision identical to TeX (${texPages.reduce((n, p) => n + p.candidates.length, 0)} candidates, ${texPages.reduce((n, p) => n + p.splits.length, 0)} footnote splits)`)
  // and every page's column as a box tree: text, footnote rule, footnotes and their split remainders
  const shipped = oracle.pages, columns = makeColumns(pages, k)
  for (const [i, c] of columns.entries()) {
    const tc = shipped[i] && findColumn(shipped[i])
    const bd = tc ? compareBoxLists(tc, c.column!.map(emitBoxes)) : { path: "", field: "page", expected: "a page", actual: null }
    if (bd) { failed++; console.log(`✗ page ${i + 1} box tree at ${bd.path}: ${bd.field}\n    TeX:    ${JSON.stringify(bd.expected)}\n    engine: ${JSON.stringify(bd.actual)}`); break }
  }
  if (shipped.length !== columns.length) { failed++; console.log(`✗ page count: TeX ${shipped.length}, engine ${columns.length}`) }
  const passes = tex.flatMap((p) => p.passes.map((x) => x.pass))
  const count = (k: string) => passes.filter((x) => x === k).length
  console.log(`${engine.length - failed}/${engine.length} paragraphs (${engine.length - n} in footnotes) identical to TeX (seed ${seed}; passes: ${count("first")} first, ${count("second")} second, ${count("emergency")} emergency; ${tex.filter((p) => p.looseness).length} with \\looseness)`)
  return failed ? 1 : 0
}
