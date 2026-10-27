// Box-tree oracle (#27): parse TeX's \tracingoutput page dumps (show_box,
// "TeX: The Program" §§ 173–198) into the shared BoxNode schema. Requires
// \showboxdepth and \showboxbreadth large enough that nothing is elided.

import type { BoxNode } from "../../trace/schema"
import { parseScaled } from "./tracing"

const ORDER: Record<string, number> = { "": 0, fil: 1, fill: 2, filll: 3 }

/** print_ASCII (§ 68): ^^@..^^_, ^^?, ^^xx; everything else is literal. */
function decodeChar(s: string): number {
  if (s.length === 1) return s.charCodeAt(0)
  let m = s.match(/^\^\^([0-9a-f]{2})$/)
  if (m) return parseInt(m[1], 16)
  m = s.match(/^\^\^(.)$/)
  if (m) { const c = m[1].charCodeAt(0); return c < 64 ? c + 64 : c - 64 }
  throw new Error(`cannot decode character "${s}"`)
}

/** "3.33333 plus 1.66666fil minus 1.11111" → glue fields (print_spec, § 178). */
function parseSpec(s: string) {
  const m = s.match(/^(-?[\d.]+)(?: plus (-?[\d.]+)(fil{1,3})?)?(?: minus (-?[\d.]+)(fil{1,3})?)?$/)
  if (!m) throw new Error(`cannot parse glue "${s}"`)
  return {
    width: parseScaled(m[1]),
    stretch: m[2] ? parseScaled(m[2]) : 0, stretchOrder: ORDER[m[3] ?? ""],
    shrink: m[4] ? parseScaled(m[4]) : 0, shrinkOrder: ORDER[m[5] ?? ""],
  }
}

export function parseLine(text: string): BoxNode {
  let m: RegExpMatchArray | null
  if ((m = text.match(/^\\([hv])box\((-?[\d.]+)\+(-?[\d.]+)\)x(-?[\d.]+)(?:, glue set (- )?(>|< -)?(-?[\d.]+)(fil{1,3})?)?(?:, shifted (-?[\d.]+))?(, display)?$/))) {
    // § 186: |ratio| > 20000 prints as ">20000.0" or "< -20000.0"; keep the printed value
    const sign = m[7] === undefined ? 0 : m[5] || m[6] === "< -" ? 2 : 1
    const box: BoxNode = {
      type: m[1] === "h" ? "hbox" : "vbox",
      height: parseScaled(m[2]), depth: parseScaled(m[3]), width: parseScaled(m[4]),
      // TeX prints round(unity × glue_set); keep that exact integer as a ratio
      glueSet: m[7] ? parseScaled(m[7]) / 65536 : 0, glueSign: sign as 0 | 1 | 2, glueOrder: ORDER[m[8] ?? ""] as 0 | 1 | 2 | 3,
      shift: m[9] ? parseScaled(m[9]) : 0, children: [],
    }
    if (m[10]) box.display = true
    return box
  }
  if ((m = text.match(/^\\glue(?:\(\\([a-z]+)\))? (.*)$/))) {
    const g: BoxNode = { type: "glue", ...parseSpec(m[2]) }
    return m[1] ? { ...g, param: m[1] } : g
  }
  if ((m = text.match(/^\\kern( ?)(-?[\d.]+)$/))) return m[1] ? { type: "kern", width: parseScaled(m[2]), explicit: true } : { type: "kern", width: parseScaled(m[2]) }
  if ((m = text.match(/^\\penalty (-?\d+)$/))) return { type: "penalty", penalty: Number(m[1]) }
  if ((m = text.match(/^\\discretionary(?: replacing (\d+))?$/))) return { type: "disc", pre: [], post: [], replaceCount: Number(m[1] ?? 0) }
  if ((m = text.match(/^\\rule\((\*|-?[\d.]+)\+(\*|-?[\d.]+)\)x(\*|-?[\d.]+)$/))) {
    const d = (x: string) => (x === "*" ? null : parseScaled(x))
    return { type: "rule", height: d(m[1]), depth: d(m[2]), width: d(m[3]) }
  }
  // font character or ligature: "\OT1/cmr/m/n/10 w" or "\OT1/cmr/m/n/10 ^^O (ligature ffl)", with \pdftracingfonts
  // the font's file and size after the identifier ("\OT1/cmr/m/n/10.95 (cmr10@10.95pt) w"); the ligature text keeps
  // § 193's | marks for boundary hits
  if ((m = text.match(/^\\([^\s{}]+)(?: \(([^@()\s]+)(?:@(-?[\d.]+)pt)?\))? (\^\^[0-9a-f]{2}|\^\^.|[^])(?: \(ligature (.*)\))?$/))) {
    const c: BoxNode = { type: "char", font: m[1], size: 0, char: decodeChar(m[4]) }
    if (m[2]) { c.tfm = m[2]; if (m[3]) c.at = parseScaled(m[3]) }
    return m[5] !== undefined ? { ...c, lig: m[5] } : c
  }
  return { type: "other", text }
}

/** A box display (show_box) whose first line is lines[i]; ends at an empty line. */
export function parseBoxDump(lines: string[], i: number): { box: BoxNode; end: number } {
  // stack of (depth, list to append to); disc children go to pre or post by the "|" marker
  const root = parseLine(lines[i])
  const stack: { depth: number; node: BoxNode }[] = [{ depth: 0, node: root }]
  for (i++; i < lines.length && lines[i] !== ""; i++) {
    let line = lines[i]
    // character 10 is LaTeX's \newlinechar, so print_ASCII ends the line there (§ 58)
    if (/^[.|]*\\\S+(?: \([^()\s]+\))? $/.test(line) && i + 1 < lines.length) line += "\n" + lines[++i]
    const prefix = line.match(/^[.|]*/)![0]
    const depth = prefix.length
    // a line inside a box display always starts with its depth's dots: one without them goes on with the last
    // (a \special's text broken at \newlinechar)
    if (depth === 0) { const last = stack[stack.length - 1].node; if (last.type === "other") last.text += "\n" + line; continue }
    const node = parseLine(line.slice(depth))
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop()
    const parent = stack[stack.length - 1].node
    if (parent.type === "hbox" || parent.type === "vbox") parent.children.push(node)
    else if (parent.type === "disc") (prefix.endsWith("|") ? parent.post : parent.pre).push(node)
    else if (parent.type === "other") (parent.children ??= []).push(node)
    else throw new Error(`box dump: ${parent.type} cannot have children (line ${i + 1})`)
    stack.push({ depth, node })
  }
  return { box: root, end: i }
}

/** Every "Completed box being shipped out [n]" page in the log, as box trees (pdfTeX's \pdfxform forms, which pgf's
 *  shadings make, print the same line without a page number: not pages). */
export function parseShipouts(log: string): BoxNode[] {
  const pages: BoxNode[] = []
  const lines = log.split("\n")
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("Completed box being shipped out [")) continue
    const { box, end } = parseBoxDump(lines, i + 1)
    pages.push(box)
    i = end
  }
  return pages
}

/** The main vertical list of a page: the vbox whose children start (after whatsits) with \glue(\topskip). */
export function findColumn(page: BoxNode): BoxNode[] | null {
  if (page.type !== "hbox" && page.type !== "vbox") return null
  const k = page.children.findIndex((c) => c.type === "glue" && c.param === "topskip")
  if (k >= 0) return page.children.slice(k)
  for (const c of page.children) { const found = findColumn(c); if (found) return found }
  return null
}
