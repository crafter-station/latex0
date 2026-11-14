// The packages whose effect the pipeline already has load silently, options ignored (#71)
import "../tools/data"
import { describe, expect, test } from "bun:test"
import { readPreamble } from "./preamble"
import { Unsupported } from "./unsupported"

const doc = (pkg: string) => `\\documentclass{article}\n${pkg}\n\\begin{document}x\\end{document}`

describe("no-op packages", () => {
  // loading one changes nothing: the preamble reads exactly as without it
  const baseline = readPreamble(doc(""))
  for (const pkg of [
    String.raw`\usepackage[utf8]{inputenc}`,
    String.raw`\usepackage{inputenc}`,
    String.raw`\usepackage{fontenc}`,
    String.raw`\usepackage{latexsym}`,
    String.raw`\usepackage{fixltx2e}`,
    String.raw`\usepackage{etex}`,
    String.raw`\usepackage{textcomp}`,
  ]) {
    test(pkg, () => {
      expect(readPreamble(doc(pkg))).toEqual(baseline)
    })
  }

  // not no-ops: loud failure rather than silently different output
  for (const pkg of [
    String.raw`\usepackage[latin1]{inputenc}`,
    String.raw`\usepackage{microtype}`,
    String.raw`\usepackage[protrusion=true]{microtype}`,
  ]) {
    test(`${pkg} is unsupported`, () => {
      expect(() => readPreamble(doc(pkg))).toThrow(Unsupported)
    })
  }
})
