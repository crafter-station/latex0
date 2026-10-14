// Shared serializations, produced by both the TeX oracle (tools/oracle) and the
// engine emitters (emit/). Identical schemas make every comparison symmetric.
// All dimensions are integer scaled points (1pt = 65536sp).

/** Positions of everything drawn on each page (the DVI view of a document). */
export interface Trace { unit: "sp"; mag: number; pages: TracePage[] }
export interface TracePage { counts: number[]; glyphs: TraceGlyph[]; rules: TraceRule[]; specials: string[] }
/** A glyph's reference point: (h, v) is the left end of its baseline. */
export interface TraceGlyph { font: string; size: number; char: number; h: number; v: number; width: number }
/** A rule's bottom-left corner is (h, v). */
export interface TraceRule { h: number; v: number; width: number; height: number }

/** The box tree of a page (the \showbox view of a document). */
export type BoxNode =
  | { type: "hbox" | "vbox"; width: number; height: number; depth: number; shift: number; glueSet: number; glueSign: 0 | 1 | 2; glueOrder: 0 | 1 | 2 | 3; children: BoxNode[] }
  | { type: "char"; font: string; size: number; char: number }
  | { type: "glue"; width: number; stretch: number; stretchOrder: number; shrink: number; shrinkOrder: number }
  | { type: "kern"; width: number }
  | { type: "rule"; width: number | null; height: number | null; depth: number | null }
  | { type: "penalty"; penalty: number }

const isInt = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x)

/** Returns a list of schema violations (empty when valid). */
export function validateTrace(t: Trace): string[] {
  const errs: string[] = []
  if (t.unit !== "sp") errs.push("unit must be sp")
  if (!isInt(t.mag)) errs.push("mag must be an integer")
  t.pages.forEach((p, i) => {
    if (p.counts.length !== 10 || !p.counts.every(isInt)) errs.push(`page ${i}: counts must be 10 integers`)
    p.glyphs.forEach((g, j) => {
      for (const k of ["size", "char", "h", "v", "width"] as const) if (!isInt(g[k])) errs.push(`page ${i} glyph ${j}: ${k} not an integer`)
      if (typeof g.font !== "string" || !g.font) errs.push(`page ${i} glyph ${j}: font missing`)
    })
    p.rules.forEach((r, j) => {
      for (const k of ["h", "v", "width", "height"] as const) if (!isInt(r[k])) errs.push(`page ${i} rule ${j}: ${k} not an integer`)
    })
  })
  return errs
}

export function validateBoxes(n: BoxNode, path = "root"): string[] {
  const errs: string[] = []
  const ints = (o: Record<string, unknown>, keys: string[]) => keys.forEach((k) => { if (!isInt(o[k])) errs.push(`${path}: ${k} not an integer`) })
  switch (n.type) {
    case "hbox": case "vbox":
      ints(n, ["width", "height", "depth", "shift"])
      if (!Number.isFinite(n.glueSet)) errs.push(`${path}: glueSet not finite`)
      n.children.forEach((c, i) => errs.push(...validateBoxes(c, `${path}/${i}`)))
      break
    case "char": ints(n, ["size", "char"]); break
    case "glue": ints(n, ["width", "stretch", "stretchOrder", "shrink", "shrinkOrder"]); break
    case "kern": ints(n, ["width"]); break
    case "penalty": ints(n, ["penalty"]); break
    case "rule": for (const k of ["width", "height", "depth"] as const) if (n[k] !== null && !isInt(n[k])) errs.push(`${path}: ${k} not an integer or null`); break
    default: errs.push(`${path}: unknown node type`)
  }
  return errs
}

export interface Divergence { page: number; index: number; field: string; expected: unknown; actual: unknown }

/** First difference between two traces, or null when identical (0 sp tolerance). */
export function compareTraces(expected: Trace, actual: Trace): Divergence | null {
  if (expected.pages.length !== actual.pages.length) return { page: -1, index: -1, field: "pages.length", expected: expected.pages.length, actual: actual.pages.length }
  for (let p = 0; p < expected.pages.length; p++) {
    const e = expected.pages[p], a = actual.pages[p]
    const n = Math.max(e.glyphs.length, a.glyphs.length)
    for (let i = 0; i < n; i++) {
      const eg = e.glyphs[i], ag = a.glyphs[i]
      if (!eg || !ag) return { page: p, index: i, field: "glyph", expected: eg ?? null, actual: ag ?? null }
      for (const k of ["font", "size", "char", "h", "v", "width"] as const) {
        if (eg[k] !== ag[k]) return { page: p, index: i, field: `glyph.${k}`, expected: eg[k], actual: ag[k] }
      }
    }
    if (e.rules.length !== a.rules.length) return { page: p, index: -1, field: "rules.length", expected: e.rules.length, actual: a.rules.length }
    for (let i = 0; i < e.rules.length; i++) {
      for (const k of ["h", "v", "width", "height"] as const) {
        if (e.rules[i][k] !== a.rules[i][k]) return { page: p, index: i, field: `rule.${k}`, expected: e.rules[i][k], actual: a.rules[i][k] }
      }
    }
  }
  return null
}
