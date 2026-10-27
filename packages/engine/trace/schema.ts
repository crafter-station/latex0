// Shared serializations, produced by both the TeX oracle (tools/oracle) and the
// engine emitters (emit/). Identical schemas make every comparison symmetric.
// All dimensions are integer scaled points (1pt = 65536sp).

/** Positions of everything drawn on each page (the DVI view of a document). */
export interface Trace { unit: "sp"; mag: number; pages: TracePage[] }
export interface TracePage { counts: number[]; glyphs: TraceGlyph[]; rules: TraceRule[]; specials: TraceSpecial[] }
/** A glyph's reference point: (h, v) is the left end of its baseline. */
export interface TraceGlyph { font: string; size: number; char: number; h: number; v: number; width: number }
/** A rule's bottom-left corner is (h, v). */
export interface TraceRule { h: number; v: number; width: number; height: number }
/** What a page sends the driver where ship_out meets it (§ 1368 special_out, pdfTeX's pdf_out_what), as a box
 *  dump prints the whatsit: \\special{…} for a DVI, also \\pdfliteral, \\pdfcolorstack, \\pdfdest … for pdfTeX */
export interface TraceSpecial { text: string; h: number; v: number }

/** The box tree of a page (the \showbox view of a document). */
export type BoxNode =
  | { type: "hbox" | "vbox"; width: number; height: number; depth: number; shift: number; glueSet: number; glueSign: 0 | 1 | 2; glueOrder: 0 | 1 | 2 | 3; children: BoxNode[]; /** e-TeX's ", display" box of display math */ display?: boolean }
  | { type: "char"; font: string; size: number; char: number; /** original characters of a ligature */ lig?: string
      /** the font's file and size when TeX printed them (\pdftracingfonts): `at` absent for the design size */ tfm?: string; at?: number }
  | { type: "glue"; width: number; stretch: number; stretchOrder: number; shrink: number; shrinkOrder: number; /** skip parameter, e.g. "rightskip" */ param?: string }
  | { type: "kern"; width: number; explicit?: boolean }
  | { type: "rule"; width: number | null; height: number | null; depth: number | null }
  | { type: "penalty"; penalty: number }
  | { type: "disc"; pre: BoxNode[]; post: BoxNode[]; replaceCount: number }
  /** Anything the engine does not model yet (\\write, \\special, marks, …), kept verbatim. */
  | { type: "other"; text: string; /** inserts, leaders, \\vadjust … carry material */ children?: BoxNode[] }

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
    p.specials.forEach((x, j) => {
      for (const k of ["h", "v"] as const) if (!isInt(x[k])) errs.push(`page ${i} special ${j}: ${k} not an integer`)
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
    case "disc":
      ints(n, ["replaceCount"])
      n.pre.forEach((c, i) => errs.push(...validateBoxes(c, `${path}/pre/${i}`)))
      n.post.forEach((c, i) => errs.push(...validateBoxes(c, `${path}/post/${i}`)))
      break
    case "other": break
    case "rule": for (const k of ["width", "height", "depth"] as const) if (n[k] !== null && !isInt(n[k])) errs.push(`${path}: ${k} not an integer or null`); break
    default: errs.push(`${path}: unknown node type`)
  }
  return errs
}

export interface Divergence { page: number; index: number; field: string; expected: unknown; actual: unknown }

/** First difference between two traces, or null when identical (0 sp tolerance); each page's specials only
 *  when asked (a fixture's `% specials: compare`) */
export function compareTraces(expected: Trace, actual: Trace, opts: { specials?: boolean } = {}): Divergence | null {
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
    if (!opts.specials) continue
    const m = Math.max(e.specials.length, a.specials.length)
    for (let i = 0; i < m; i++) {
      const es = e.specials[i], as = a.specials[i]
      if (!es || !as) return { page: p, index: i, field: "special", expected: es ?? null, actual: as ?? null }
      for (const k of ["text", "h", "v"] as const) {
        if (es[k] !== as[k]) return { page: p, index: i, field: `special.${k}`, expected: es[k], actual: as[k] }
      }
    }
  }
  return null
}

export interface BoxDivergence { path: string; field: string; expected: unknown; actual: unknown }

/**
 * First difference between two box trees. Fonts are compared through a mapping
 * that must stay consistent (TeX shows "OT1/cmr/m/n/10" where the engine has
 * "cmr10"), so every font identifier must correspond to exactly one engine font.
 * Glue set ratios are compared as TeX prints them: round(65536 × ratio).
 */
export function compareBoxLists(expected: BoxNode[], actual: BoxNode[], fonts = new Map<string, string>(), path = ""): BoxDivergence | null {
  const n = Math.max(expected.length, actual.length)
  for (let i = 0; i < n; i++) {
    const e = expected[i], a = actual[i], at = `${path}/${i}`
    if (!e || !a) return { path: at, field: "node", expected: e ? describe(e) : null, actual: a ? describe(a) : null }
    if (e.type !== a.type) return { path: at, field: "type", expected: describe(e), actual: describe(a) }
    const d = compareNode(e, a, fonts, at)
    if (d) return d
  }
  return null
}

function compareNode(e: BoxNode, a: BoxNode, fonts: Map<string, string>, path: string): BoxDivergence | null {
  const diff = (field: string, x: unknown, y: unknown): BoxDivergence | null => (x === y ? null : { path, field, expected: x, actual: y })
  switch (e.type) {
    case "hbox": case "vbox": {
      const b = a as typeof e
      for (const k of ["width", "height", "depth", "shift"] as const) { const d = diff(k, e[k], b[k]); if (d) return d }
      // as TeX prints it (§ 186): the glue setting only when the sign is not normal and the ratio not
      // zero (an overfull box with no shrink keeps ratio 1.0 under a normal sign, § 664; an alignment
      // cell with nothing to stretch is "stretching" by 0, § 810), and ratios beyond ±20000 as
      // >20000 / < -20000
      // (expected comes from TeX's printout, so a printed "glue set 0.0" keeps its sign; for the
      // engine's box the exact ratio decides whether TeX would have printed it)
      const shown = (x: typeof e, printed: boolean) => (x.glueSign === 0 || (!printed && x.glueSet === 0) ? [0, 0, 0] : [x.glueSign, x.glueOrder, Math.round(65536 * Math.max(-20000, Math.min(20000, x.glueSet)))])
      const [se, sb] = [shown(e, true), shown(b, false)]
      const d = diff("glueSign", se[0], sb[0]) ?? diff("glueOrder", se[1], sb[1]) ?? diff("glueSet", se[2], sb[2]) ?? diff("display", !!e.display, !!b.display)
      return d ?? compareBoxLists(e.children, b.children, fonts, path)
    }
    case "char": {
      const c = a as typeof e
      const engineFont = `${c.font}@${c.size}`
      const mapped = fonts.get(e.font)
      if (mapped === undefined) {
        if ([...fonts.values()].includes(engineFont)) return { path, field: "font", expected: e.font, actual: engineFont }
        fonts.set(e.font, engineFont)
      } else if (mapped !== engineFont) return { path, field: "font", expected: `${e.font} (= ${mapped})`, actual: engineFont }
      return diff("char", e.char, c.char) ?? diff("ligature", e.lig ?? null, c.lig ?? null)
    }
    case "glue": {
      const g = a as typeof e
      for (const k of ["width", "stretch", "stretchOrder", "shrink", "shrinkOrder"] as const) { const d = diff(k, e[k], g[k]); if (d) return d }
      return diff("param", e.param ?? null, g.param ?? null)
    }
    case "kern": { const k = a as typeof e; return diff("width", e.width, k.width) ?? diff("explicit", !!e.explicit, !!k.explicit) }
    case "penalty": return diff("penalty", e.penalty, (a as typeof e).penalty)
    case "rule": { const r = a as typeof e; return diff("width", e.width, r.width) ?? diff("height", e.height, r.height) ?? diff("depth", e.depth, r.depth) }
    case "disc": {
      const d = a as typeof e
      return diff("replaceCount", e.replaceCount, d.replaceCount) ?? compareBoxLists(e.pre, d.pre, fonts, `${path}/pre`) ?? compareBoxLists(e.post, d.post, fonts, `${path}/post`)
    }
    case "other": { const o = a as typeof e; return diff("text", e.text, o.text) ?? compareBoxLists(e.children ?? [], o.children ?? [], fonts, path) }
  }
}

function describe(n: BoxNode): string {
  switch (n.type) {
    case "hbox": case "vbox": return `${n.type}(${n.height}+${n.depth})x${n.width}`
    case "char": return `char ${n.char}${n.lig ? ` (ligature ${n.lig})` : ""}`
    case "glue": return `glue${n.param ? `(${n.param})` : ""} ${n.width}`
    case "kern": return `kern${n.explicit ? " " : ""}${n.width}`
    case "penalty": return `penalty ${n.penalty}`
    case "rule": return "rule"
    case "disc": return `disc replacing ${n.replaceCount}`
    case "other": return n.text
  }
}
