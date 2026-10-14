// Paragraph fuzzer (#112, #41): N seeded random paragraphs in one document, each
// with its own width, tolerances, \looseness, \emergencystretch and hanging
// indentation. TeX breaks them once; the engine breaks each one; every
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
    const len = 20 + Math.floor(r() * 120)
    const words = Array.from({ length: len }, () => pick(WORDS))
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
  const texDecisions = oracleRun(file).decisions
  const tex = texDecisions.paragraphs
  if (tex.length !== n) throw new Error(`TeX traced ${tex.length} paragraphs, expected ${n}`)
  let failed = 0
  bodies.forEach((body, i) => {
    const { list, params } = paragraphInput(body)
    const d = compareParagraphs([tex[i]], [lineBreak(list, params).trace])
    if (!d) return
    failed++
    if (failed <= 5) console.log(`✗ paragraph ${i}: ${d.what}\n    TeX:    ${JSON.stringify(d.expected)}\n    engine: ${JSON.stringify(d.actual)}\n    ${body.slice(0, 160)}…`)
  })
  // the same paragraphs as one document: every page-break decision must match too
  const { pageTrace } = typesetBody(bodies.map((text) => ({ size: "normalsize" as const, text })), classData("article", "10pt"))
  const texPages = documentPages(texDecisions.pages)
  const pd = comparePages(texPages, pageTrace)
  if (pd) { failed++; console.log(`✗ pages: ${pd.what}\n    TeX:    ${JSON.stringify(pd.expected)}\n    engine: ${JSON.stringify(pd.actual)}`) }
  else console.log(`${texPages.length} pages: every page-break decision identical to TeX (${texPages.reduce((n, p) => n + p.candidates.length, 0)} candidates)`)
  const passes = tex.flatMap((p) => p.passes.map((x) => x.pass))
  const count = (k: string) => passes.filter((x) => x === k).length
  console.log(`${n - failed}/${n} paragraphs identical to TeX (seed ${seed}; passes: ${count("first")} first, ${count("second")} second, ${count("emergency")} emergency; ${tex.filter((p) => p.looseness).length} with \\looseness)`)
  return failed ? 1 : 0
}
