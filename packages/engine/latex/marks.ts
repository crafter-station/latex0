// Running heads (\pagestyle{headings}). \markboth and \markright insert \marks
// of the classes 2e-left (1), 2e-right (2) and, for a value not empty,
// 2e-right-nonempty (3), each followed by \nobreak in vertical mode while
// \if@nobreak holds; \__mark_value:nn numbers them. At shipout, \leftmark is
// the page's last 2e-left mark and \rightmark its first 2e-right one.

import type { Font } from "../layout/font"
import { QUAD, SPACE, SPACE_SHRINK, SPACE_STRETCH } from "../layout/font"
import { ACCENT_COMMAND, appendText, sourceText } from "./encodings"
import { glue, penalty, type Node } from "../layout/nodes"
import type { Shipped } from "./output"
import { Unsupported } from "./unsupported"

/** A mark's value: what \marks holds (`print`), and what \leftmark or \rightmark typesets (\MakeUppercase'd when `upper`) */
export interface MarkValue { print: string; parts: ({ text: string } | { ctrl: true } | { quad: true })[]; upper: boolean }
export type Mark = [cls: 1 | 2 | 3, value: MarkValue]

export const EMPTY_MARK: MarkValue = { print: "", parts: [], upper: false }

/** a mark's value: the \protected@xdef'd text (\MakeUppercase prints as itself), and what it typesets */
export function markValue(parts: MarkValue["parts"], upper: boolean): MarkValue {
  // (text accents print as typed: \'{I}ndice, \'Indice)
  for (const p of parts) if ("text" in p && /[\\{}$^_~%&#]/.test(p.text.replace(new RegExp(ACCENT_COMMAND.source.slice(1), "g"), ""))) throw new Unsupported(`a running head for "${p.text}"`)
  // (a control word prints with a space after it: \'{\i }, \c {c}; spanish.ts's marks go)
  const text = parts.map((p) => ("text" in p ? p.text.replace(/\\([A-Za-z]+)\s*/g, "\\$1 ").replace(/\ue000/g, "") : "quad" in p ? "\\hskip 1em\\relax " : "\\ ")).join("")
  return { print: upper ? `\\MakeUppercase    []{${text}}` : text, parts, upper }
}

/** babel's \markboth and \markright: a value not blank in \foreignlanguage of the language then (\languagename) */
export const markLanguage: { name: string | null } = { name: null }
const babelMark = (v: MarkValue): MarkValue =>
  markLanguage.name && v.print ? { ...v, print: `\\protect \\foreignlanguage {${markLanguage.name}}{\\protect \\bbl@restore@actives ${v.print}}` } : v

export const markboth = (left: MarkValue, right: MarkValue): Mark[] => { left = babelMark(left); right = babelMark(right); return [[1, left], [2, right], ...(right.print ? [[3, right] as Mark] : [])] }
export const markright = (right: MarkValue): Mark[] => { right = babelMark(right); return [[2, right], ...(right.print ? [[3, right] as Mark] : [])] }

/**
 * \sectionmark and \subsectionmark (article: \thesection\quad title; report two-sided: \thesection. \ title);
 * fancyhdr's in article: \markboth{\MakeUppercase{\thesection\hskip 1em\relax title}}{} and
 * \markright{\thesubsection\hskip 1em\relax title}, one- or two-sided; in report and book its \sectionmark only
 */
export function sectionMarks(cls: string, twoside: boolean, level: number, number: string, title: string, by: "headings" | "fancyhdr" = "headings"): Mark[] {
  if (by === "fancyhdr" && cls !== "article") { // (report and book: \markright{\MakeUppercase{\thesection. \ title}})
    return level === 1 ? markright(markValue([{ text: `${number}. ` }, { ctrl: true }, { text: title }], true)) : []
  }
  if (by === "fancyhdr") {
    if (level === 1) return markboth(markValue([{ text: number }, { quad: true }, { text: title }], true), EMPTY_MARK)
    return level === 2 ? markright(markValue([{ text: number }, { quad: true }, { text: title }], false)) : []
  }
  if (cls === "article" && level === 1) {
    const v = markValue([{ text: number }, { quad: true }, { text: title }], true)
    return twoside ? markboth(v, EMPTY_MARK) : markright(v)
  }
  if (cls === "article" && level === 2 && twoside) return markright(markValue([{ text: number }, { quad: true }, { text: title }], false))
  if (cls !== "article" && level === 1 && twoside) return markright(markValue([{ text: `${number}. ` }, { ctrl: true }, { text: title }], true))
  return []
}

/** The \marks nodes of a run, numbered in order. */
export class MarkWriter {
  private count = 0
  insert(marks: Mark[], nobreak: boolean): Node[] {
    return marks.flatMap(([cls, value]) => {
      const node: Node = { kind: "whatsit", text: `\\marks${cls}{\\__mark_value:nn {${++this.count}}{${value.print}}}`, mark: { cls, value } }
      return nobreak ? [node, penalty(10000)] : [node]
    })
  }
}

/** Each page's \leftmark and \rightmark: from the marks at the top level of its material, or the values the pages
 *  before left (\topmarks); a page of floats has none of its own */
export function pageMarks(pages: Shipped[]): { left: MarkValue | undefined; right: MarkValue | undefined }[] {
  const carried = new Map<number, MarkValue>()
  return pages.map((pg) => {
    const marks = pg.kind === "text" ? pg.page.nodes.flatMap((n) => (n.kind === "whatsit" && n.mark ? [n.mark as { cls: number; value: MarkValue }] : [])) : []
    const first = (c: number) => marks.find((m) => m.cls === c)?.value ?? carried.get(c)
    const last = (c: number) => marks.findLast((m) => m.cls === c)?.value ?? carried.get(c)
    const head = { left: last(1), right: first(2) }
    for (const c of [1, 2, 3]) { const l = last(c); if (l) carried.set(c, l) }
    return head
  })
}

/** What a mark typesets in the running head, in its (slanted) font. */
export function markText(m: MarkValue | undefined, font: Font): Node[] {
  const out: Node[] = [], state = { spaceFactor: 1000 }
  for (const p of m?.parts ?? []) {
    if ("text" in p) appendText(out, m!.upper ? sourceText(p.text).toUpperCase() : sourceText(p.text), font, state, false)
    else if ("ctrl" in p) out.push(glue(font.params[SPACE], font.params[SPACE_STRETCH], 0, font.params[SPACE_SHRINK], 0)) // \
    else out.push(glue(font.params[QUAD])) // \hskip 1em
  }
  return out
}
