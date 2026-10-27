// cleveref: \refstepcounter records the counter's type with \@currentlabel (\cref@currentlabel), each \label
// writes a second \newlabel{key@cref} with it, and \cref{key} / \Cref{key} print the type's name, a
// \nobreakspace and the label in the type's format (\crefformat), from the run before.

import type { Node } from "../layout/nodes"
import type { TheoremDef } from "./preamble"
import { Unsupported } from "./unsupported"

/** \cref@currentlabel: [type][\arabic{counter}][prefix]\p@counter\thecounter */
export interface CrefLabel {
  type: string
  arabic: number
  /** \cref@constructprefix: the values of the counters that reset this one, outermost first */
  prefix: string
  label: string
}

/** The english names (\crefname, the default abbrev option, and \Crefname), by type */
const NAMES: Record<string, [string, string]> = {
  equation: ["eq.", "Equation"], figure: ["fig.", "Figure"], subfigure: ["fig.", "Figure"], table: ["table", "Table"], subtable: ["table", "Table"],
  page: ["page", "Page"], part: ["part", "Part"], chapter: ["chapter", "Chapter"],
  section: ["section", "Section"], subsection: ["section", "Section"], subsubsection: ["section", "Section"],
  appendix: ["appendix", "Appendix"], subappendix: ["appendix", "Appendix"], subsubappendix: ["appendix", "Appendix"], subsubsubappendix: ["appendix", "Appendix"],
  enumi: ["item", "Item"], enumii: ["item", "Item"], enumiii: ["item", "Item"], enumiv: ["item", "Item"], enumv: ["item", "Item"],
  footnote: ["footnote", "Footnote"], theorem: ["theorem", "Theorem"], lemma: ["lemma", "Lemma"], corollary: ["corollary", "Corollary"],
  proposition: ["proposition", "Proposition"], definition: ["definition", "Definition"], result: ["result", "Result"], example: ["example", "Example"],
  remark: ["remark", "Remark"], note: ["note", "Note"], algorithm: ["algorithm", "Algorithm"], listing: ["listing", "Listing"], line: ["line", "Line"],
}

/** The name \cref or \Cref prints for a type: the english default, else the title of a theorem declared after
 *  cleveref loaded, its first letter in lower or upper case (\MakeLowercase #3, \MakeUppercase #3: one token);
 *  null for a type with neither (its reference format undefined) */
export function crefName(type: string, capital: boolean, thms: Map<string, TheoremDef>): string | null {
  const named = [...thms].find(([name, d]) => name === type && d.crefNamed)?.[1]
  const fixed = NAMES[type]
  if (named && fixed && (named.title[0].toLowerCase() + named.title.slice(1) !== fixed[0])) throw new Unsupported(`cleveref: \\newtheorem{${type}}{${named.title}}`)
  if (fixed) return fixed[capital ? 1 : 0]
  if (!named) return null // (the reference format undefined)
  if (!/^[A-Za-z]+$/.test(named.title)) throw new Unsupported(`cleveref: the name of ${type}`)
  return (capital ? named.title[0].toUpperCase() : named.title[0].toLowerCase()) + named.title.slice(1)
}

/** cleveref's second write, \newlabel{key@cref}{{\cref@currentlabel}{[\thepage at 1][\arabic{page}][]\thepage}}; the
 *  page counter is the one when the \label was read, filled in once the pages are built (`at`: how much of the main
 *  vertical list there was then, the page builder having seen all of it but a paragraph's \parskip only `inPara`) */
export interface CrefWrite { node: Node & { kind: "whatsit" }; key: string; cref: CrefLabel | null; at: number; inPara: boolean }

export function crefWrite(writes: CrefWrite[], key: string, cref: CrefLabel | null, at: number, inPara: boolean): Node {
  const node = { kind: "whatsit" as const, text: "" }
  writes.push({ node, key, cref, at, inPara })
  return node
}

/** The page counter for each write: the number of the first page the page builder had not fired then, and \thepage
 *  with that counter at 1 (\pagenumbering changes only after a \cleardoublepage, so that page's numbering was in force) */
export function fillCrefWrites(writes: CrefWrite[], pages: { count: number; thepage: string; reached: number }[], parskipAt: (at: number) => boolean): void {
  for (const w of writes) {
    const fired = pages.filter((p) => p.reached < w.at || (p.reached === w.at && w.inPara && parskipAt(w.at)))
    // the next page's number (a title page sets the counter back to 1 after it)
    const page = pages[fired.length]?.count ?? (fired.length ? fired[fired.length - 1].count + 1 : 1)
    const roman = /^[ivxlcdm]+$/.test((pages[fired.length] ?? pages[pages.length - 1])?.thepage ?? "")
    const c = w.cref
    const label = c ? `[${c.type}][${c.arabic}][${c.prefix}]${c.label}` : ""
    w.node.text = `\\write1{\\newlabel{${w.key}@cref}{{${label}}{[${roman ? "i" : "1"}][${page}][]\\thepage }{}{}{}}}`
  }
}
