// cleveref: \refstepcounter records the counter's type with \@currentlabel (\cref@currentlabel), each \label
// writes a second \newlabel{key@cref} with it and the page, and \cref{keys} / \Cref{keys} (\cpageref, \crefrange …)
// print, from the run before, the keys grouped by type (\cref@processgroupall), each group sorted
// (\cref@stack@sort), runs of three or more consecutive numbers compressed into ranges
// (\cref@processconsecutive), in the type's formats (\crefformat, \crefmultiformat, \crefrangeformat …, built at
// \begin{document} from the names, \crefname): the name, \nobreakspace and the label; with hyperref the label (or
// the name and label, nameinlink) in a link to the label's anchor (\cref@hyperlink: \hyper@@link[link]).

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

/** A key@cref line the run before wrote: its \cref@currentlabel (null: empty) and its page,
 *  [\thepage at 1][\arabic{page}][]\thepage (the last as the page was shipped out) */
export interface CrefEntry { cref: CrefLabel | null; page: { style: string; arabic: number; label: string } }

/** The package options: sort, compress, capitalise, abbrev (noabbrev turns it off) and nameinlink */
export interface CrefOptions { sort: boolean; compress: boolean; capitalise: boolean; abbrev: boolean; nameinlink: boolean }

/** \crefname or \Crefname in the preamble: the variant, the type, the singular and plural names */
export type CrefNameDef = ["cref" | "Cref", string, string, string]

/** A type's names, singular and plural, for \cref and \Cref (null: undefined, \relax) */
interface Names { cref: [string | null, string | null]; Cref: [string | null, string | null] }

/** The english option's names (\crefname@preamble, \Crefname@preamble): singular, plural, by type */
const ENGLISH: Record<string, [string, string]> = {
  equation: ["equation", "equations"], figure: ["figure", "figures"], table: ["table", "tables"], page: ["page", "pages"],
  part: ["part", "parts"], chapter: ["chapter", "chapters"], section: ["section", "sections"], appendix: ["appendix", "appendices"],
  enumi: ["item", "items"], footnote: ["footnote", "footnotes"], theorem: ["theorem", "theorems"], lemma: ["lemma", "lemmas"],
  corollary: ["corollary", "corollaries"], proposition: ["proposition", "propositions"], definition: ["definition", "definitions"],
  result: ["result", "results"], example: ["example", "examples"], remark: ["remark", "remarks"], note: ["note", "notes"],
  algorithm: ["algorithm", "algorithms"], listing: ["listing", "listings"], line: ["line", "lines"],
}

/** the spanish option's names (\crefname@preamble, \Crefname@preamble; no abbreviations), singular and plural, by type
 *  (LaTeX source) */
const SPANISH: Record<string, [string, string]> = {
  equation: ["ecuaci\\'on", "ecuaciones"], figure: ["figura", "figuras"], table: ["cuadro", "cuadros"], page: ["p\\'agina", "p\\'aginas"],
  part: ["parte", "partes"], chapter: ["cap\\'itulo", "cap\\'itulos"], section: ["apartado", "apartados"], appendix: ["ap\\'endice", "ap\\'endices"],
  enumi: ["punto", "puntos"], footnote: ["nota", "notas"], theorem: ["teorema", "teoremas"], lemma: ["lema", "lemas"],
  corollary: ["corolario", "corolarios"], proposition: ["proposici\\'on", "proposiciones"], definition: ["definici\\'on", "definiciones"],
  result: ["resultado", "resultados"], example: ["ejemplo", "ejemplos"], remark: ["observaci\\'on", "observaciones"], note: ["nota", "notas"],
  algorithm: ["algoritmo", "algoritmos"], listing: ["listado", "listados"], line: ["l\\'inea", "l\\'ineas"],
}

/** \@crefcopyformats at \begin{document}: a type with no names of its own takes its parent's (and its formats) */
const COPIES: [string, string][] = [
  ["section", "subsection"], ["subsection", "subsubsection"], ["appendix", "subappendix"], ["subappendix", "subsubappendix"],
  ["figure", "subfigure"], ["table", "subtable"], ["equation", "subequation"], ["enumi", "enumii"], ["enumii", "enumiii"],
  ["enumiii", "enumiv"], ["enumiv", "enumv"],
]

const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
/** \MakeUppercase or \MakeLowercase of a name's first token: the rest after it is a new run of characters (no
 *  ligature or kern across, BREAK) */
const BREAK = "\u0000"
const MakeUppercase = (s: string) => s.charAt(0).toUpperCase() + BREAK + s.slice(1)
const MakeLowercase = (s: string) => s.charAt(0).toLowerCase() + BREAK + s.slice(1)

/** What \cref and friends print with: the options and each type's names, as \begin{document} leaves them */
export class CrefSetup {
  private readonly names = new Map<string, Names>()
  /** the conjunctions: \crefmiddleconjunction, \creflastconjunction (\crefpairconjunction alike), the group ones, \crefrangeconjunction */
  readonly conj: { middle: CrefOut[]; last: CrefOut[]; pairGroup: CrefOut[]; middleGroup: CrefOut[]; lastGroup: CrefOut[]; range: CrefOut[] }

  /** `spanish`: the spanish option, a class option with babel's spanish (its names, and the same again in \extrasspanish), and
   *  how its names' LaTeX source turns into text */
  constructor(readonly options: CrefOptions, thms: Map<string, TheoremDef>, defs: CrefNameDef[], spanish?: (src: string) => string) {
    const { capitalise } = options
    const abbrev = options.abbrev && !spanish
    // (spanish.ldf's \extrasspanish \crefname and \Crefname, after the preamble's)
    if (spanish && defs.length) throw new Unsupported("\\crefname with cleveref's spanish")
    const and = spanish ? " y" : " and"
    this.conj = { middle: [text(", ")], last: [text(and), TIE], pairGroup: [text(and), TIE], middleGroup: [text(", ")], lastGroup: [text(spanish ? " y" : ", and"), TIE], range: [text(spanish ? " a" : " to"), TIE] }
    // \crefname and \Crefname in the preamble: the other variant's name, if it has none yet, the first token's case changed
    // (\MakeUppercase; \MakeLowercase unless capitalise), from the singular and plural each
    const own = new Map<string, Partial<Names>>()
    for (const [variant, type, s, p] of defs) {
      for (const n of [s, p]) if (!/^[A-Za-z.][A-Za-z. -]*$|^$/.test(n)) throw new Unsupported(`\\${variant}name{${type}}{${s}}{${p}}`)
      const o = own.get(type) ?? {}
      o[variant] = [s, p]
      const other = variant === "cref" ? "Cref" : "cref"
      if (!o[other]) {
        const change = variant === "cref" ? MakeUppercase : capitalise ? (x: string) => x : MakeLowercase
        o[other] = s === "" ? [s, p] : [change(s), change(p)]
      }
      own.set(type, o)
    }
    // the @preamble names: a theorem declared after cleveref (\@othm, \@xnthm, \@ynthm: the title's first token in
    // lower case, upper case with capitalise, and for \Cref; no plural), then the english option's (in its
    // \AtBeginDocument, after them)
    const preamble = new Map<string, Names>()
    for (const [type, d] of thms) {
      if (!d.crefNamed) continue
      if (!/^[A-Za-z]*$/.test(d.title)) throw new Unsupported(`cleveref: the name of ${type}`)
      const t = d.title
      preamble.set(type, t === "" ? { cref: ["", null], Cref: ["", null] } : { cref: [capitalise ? MakeUppercase(t) : MakeLowercase(t), null], Cref: [MakeUppercase(t), null] })
    }
    for (const [type, [s0, p0]] of Object.entries(spanish ? SPANISH : ENGLISH)) {
      const s = spanish ? spanish(s0) : s0, p = spanish ? spanish(p0) : p0
      // (abbreviated, unless noabbrev: eq. and fig.)
      const c: [string, string] = abbrev && type === "equation" ? ["eq.", "eqs."] : abbrev && type === "figure" ? ["fig.", "figs."] : [s, p]
      preamble.set(type, { cref: capitalise ? [upperFirst(c[0]), upperFirst(c[1])] : c, Cref: [upperFirst(s), upperFirst(p)] })
    }
    // each type of \cref@label@types: the names of its own, else the @preamble ones (a \relax plural: undefined)
    for (const type of new Set([...own.keys(), ...preamble.keys()])) {
      const o = own.get(type), pr = preamble.get(type)
      this.names.set(type, { cref: o?.cref ?? pr?.cref ?? [null, null], Cref: o?.Cref ?? pr?.Cref ?? [null, null] })
    }
    for (const [parent, child] of COPIES) {
      if (own.has(child)) continue
      const p = this.names.get(parent)
      if (p) this.names.set(child, p)
    }
  }

  /** The name a format starts with (null: no such format), for the single (`plural` false) or multi and range formats */
  name(type: string, variant: "cref" | "Cref", plural: boolean): string | null {
    const n = this.names.get(type)
    // (\@crefdefineformat and the others define a format, for both variants, when \cref's name is defined)
    if (!n || n.cref[plural ? 1 : 0] === null) return null
    const v = n[variant][plural ? 1 : 0]
    if (v === null) throw new Unsupported(`cleveref: no \\${variant} name for ${type}`)
    return v
  }

  /** Whether the label format is equation's (\creflabelformat{equation}: \textup{(…)}) */
  equation(type: string): boolean {
    return type === "equation" || type === "subequation"
  }

  /** \cref@isrefsametype: the expansion of each one's \cref@<type>@format (every undefined one \relax{…}{…}{…}) */
  formatKey(type: string): string {
    const n = this.name(type, "cref", false)
    return n === null ? "\\relax" : `${n}|${this.equation(type)}`
  }

  /** The same for the range formats (\crefrange@<type>@format) */
  rangeKey(type: string, variant: "cref" | "Cref"): string {
    const n = this.name(type, variant, true)
    return n === null ? "\\relax" : `${n}|${this.name(type, variant, false)}|${this.equation(type)}`
  }
}

/** What a reference prints: text in the current font, \nobreakspace, a bold ?? (\nfss@text{\reset@font\bfseries ??}),
 *  a link to a label's anchor around its contents (\cref@hyperlink), \textup{…} */
export type CrefOut = { t: "text"; s: string /* (BREAK: a new run) */ } | { t: "tie" } | { t: "qq" } | { t: "link"; key: string; out: CrefOut[] } | { t: "textup"; src: string; out: CrefOut[] }

type Family = "cref" | "Cref"
type Pos = "" | "@first" | "@middle" | "@last"

const text = (s: string): CrefOut => ({ t: "text", s })
const TIE: CrefOut = { t: "tie" }

/** One reference's fields, \cref@getlabel and friends (or \cpageref@…: the page's) */
interface Ref { key: string; type: string; counter: number; prefix: string; label: string }

/**
 * \cref, \Cref, \cpageref or \Cpageref of a list of keys (\@cref), from the run before's key@cref lines; `links`:
 * hyperref's links (not \cref*)
 */
export function crefOutput(setup: CrefSetup, prev: Map<string, CrefEntry> | null, keys: string[], variant: "cref" | "Cref" | "cpageref" | "Cpageref", links: boolean): CrefOut[] {
  const page = variant === "cpageref" || variant === "Cpageref"
  const ref = (key: string): Ref | null => {
    const e = prev?.get(key)
    if (!e) return null
    if (page) return { key, type: e.page.style, counter: e.page.arabic, prefix: "", label: e.page.label }
    if (!e.cref) {
      if (keys.length > 1) throw new Unsupported(`\\${variant} of a label with no counter, among others`) // (\ifnum on an empty counter)
      return { key, type: "", counter: 0, prefix: "", label: "" }
    }
    return { key, type: e.cref.type, counter: e.cref.arabic, prefix: e.cref.prefix, label: e.cref.label }
  }
  const refs = keys.map((k) => ({ key: k, r: ref(k) }))
  // \cref@isrefsametype (\cpageref@…: the page's \thepage at 1); undefined ones are alike
  const same = (a: Ref | null, b: Ref | null) => !a || !b ? !a && !b : page ? a.type === b.type : setup.formatKey(a.type) === setup.formatKey(b.type)
  // \@cref@countercmp: 1 when a comes first, 2 when b does, 0 when equal (the prefix's counters, then the counter)
  const cmp = (a: Ref, b: Ref): number => {
    const xs = [...(a.prefix ? a.prefix.split(",").map(Number) : []), a.counter], ys = [...(b.prefix ? b.prefix.split(",").map(Number) : []), b.counter]
    for (let i = 0; ; i++) {
      if (i >= xs.length) return i >= ys.length ? 0 : 1
      if (i >= ys.length) return 2
      if (xs[i] !== ys[i]) return xs[i] < ys[i] ? 1 : 2
    }
  }
  // \cref@isrefconsecutive: the same prefix, the counter the same or one more
  const consecutive = (a: Ref | null, b: Ref | null) => !!a && !!b && a.prefix === b.prefix && (b.counter === a.counter || b.counter === a.counter + 1)
  const { sort, compress } = setup.options
  const out: CrefOut[] = []
  let stack = refs, group = 1, family: Family = variant === "Cref" || variant === "Cpageref" ? "Cref" : "cref"
  while (stack.length) {
    let sub: typeof refs
    if (sort) {
      // \cref@processgroupall: the refs of the first one's type, in order; then \cref@stack@sort, each inserted before
      // the first one already there that comes after it (undefined ones, all ??, in any order)
      const first = stack[0].r
      sub = stack.filter((x) => same(first, x.r)); stack = stack.filter((x) => !same(first, x.r))
      if (first) {
        const sorted: typeof refs = []
        for (const x of sub) {
          const at = sorted.findIndex((y) => cmp(y.r!, x.r!) === 2)
          if (at < 0) sorted.push(x); else sorted.splice(at, 0, x)
        }
        sub = sorted
      }
    } else {
      // \cref@processgroup: the refs of the first one's type up to the first of another
      let n = 1
      while (n < stack.length && same(stack[0].r, stack[n].r)) n++
      sub = stack.slice(0, n); stack = stack.slice(n)
    }
    if (group === 1) group++
    else {
      out.push(...(stack.length ? setup.conj.middleGroup : group === 2 ? setup.conj.pairGroup : setup.conj.lastGroup))
      group++
      family = "cref" // (\lowercase{\def\cref@variant{#1}})
    }
    // the group's refs, a run of consecutive ones a range: of the same label, the first alone; of two, each on its own
    // (the second pushed back, with an empty one after it that keeps it from the next: it was not consecutive to it)
    const queue = sub.slice()
    for (let n = 1; queue.length; n++) {
      const begin = queue.shift()!
      let end: typeof begin | null = null, count = 1
      if (compress) while (queue.length && consecutive((end ?? begin).r, queue[0].r)) { count++; end = queue.shift()! }
      if (count > 1 && begin.r!.label === end!.r!.label) { end = null; count = 1 }
      if (count === 2) { queue.unshift(end!); end = null; count = 1 }
      // (the second of two is @second, the last of more @last: \crefpairconjunction and \creflastconjunction, the same)
      const pos: Pos = queue.length ? (n === 1 ? "@first" : "@middle") : n === 1 ? "" : "@last"
      if (count === 1) out.push(...single(setup, family, begin.r, pos, page, links))
      else {
        // (\@setcpagerefrange is not defined: \relax, and the arguments typeset)
        if (page) throw new Unsupported(`\\${variant} of three consecutive pages`)
        out.push(...range(setup, family, begin.r!, end!.r!, pos, links))
      }
    }
  }
  return out
}

/** \crefrange, \Crefrange, \cpagerefrange or \Cpagerefrange (\@@setcrefrange, \@@setcpagerefrange) */
export function crefRangeOutput(setup: CrefSetup, prev: Map<string, CrefEntry> | null, a: string, b: string, family: Family, page: boolean, links: boolean): CrefOut[] {
  const ref = (key: string): Ref | null => {
    const e = prev?.get(key)
    if (!e) return null
    if (page) return { key, type: "page", counter: e.page.arabic, prefix: "", label: e.page.label }
    if (!e.cref) return { key, type: "", counter: 0, prefix: "", label: "" }
    return { key, type: e.cref.type, counter: e.cref.arabic, prefix: e.cref.prefix, label: e.cref.label }
  }
  const ra = ref(a), rb = ref(b)
  if (!ra) return rb ? [{ t: "qq" }, text(`--${rb.label}`)] : [{ t: "qq" }, text("--"), { t: "qq" }]
  if (!rb) return [text(`${ra.label}--`), { t: "qq" }]
  if (setup.name(ra.type, family, true) === null || setup.rangeKey(ra.type, family) !== setup.rangeKey(rb.type, family)) return [{ t: "qq" }, TIE, text(`${ra.label}--${rb.label}`)]
  return range(setup, family, ra, rb, "", links)
}

/** The label in its format (\cref@default@label #2#1#3, equation's \textup{(#2#1#3)}, with nameinlink #2\textup{(#1)}#3):
 *  `start` the link's start (#2), `end` its end (#3) */
function labelFormat(setup: CrefSetup, r: Ref, start: boolean, end: boolean, links: boolean): CrefOut[] {
  // the link's contents run from #2 to #3: here with the label, or (nameinlink, first) the name before it
  const wrap = (xs: CrefOut[]): CrefOut[] => !links ? xs : start ? [{ t: "link", key: r.key, out: xs }] : end ? [{ t: "link", key: "", out: xs }] : xs
  if (!setup.equation(r.type) || r.type === "page") return wrap([text(r.label)])
  const up = (xs: CrefOut[]): CrefOut => ({ t: "textup", src: `(${r.label})`, out: xs })
  if (setup.options.nameinlink) return wrap([up([text(`(${r.label})`)])])
  return [up([text("("), ...wrap([text(r.label)]), text(")")])]
}

/** A link's contents that began before (nameinlink: the name, \nobreakspace) joined to the label's */
function joinLink(key: string, before: CrefOut[], rest: CrefOut[]): CrefOut[] {
  const [first, ...more] = rest
  if (first?.t !== "link" || first.key !== "") throw new Error("cleveref: a name in a link with no label after it")
  return [{ t: "link", key, out: [...before, ...first.out] }, ...more]
}

/** \@@setcref (\@@setcpageref): ?? for an undefined key, ??~label for a type with no format, else the format */
function single(setup: CrefSetup, family: Family, r: Ref | null, pos: Pos, page: boolean, links: boolean): CrefOut[] {
  if (!r) return [{ t: "qq" }]
  const type = page ? "page" : r.type
  const name = setup.name(type, family, pos !== "")
  if (name === null) return [{ t: "qq" }, TIE, text(r.label)]
  const pr = page ? { ...r, type: "page" } : r
  if (pos === "@middle" || pos === "@last") return [...(pos === "@middle" ? setup.conj.middle : setup.conj.last), ...labelFormat(setup, pr, true, true, links)]
  // the first: the name (an empty one: the label alone), \nobreakspace, the label
  if (name === "") return labelFormat(setup, pr, true, true, links)
  if (setup.options.nameinlink && links) return joinLink(r.key, [text(name), TIE], labelFormat(setup, pr, false, true, links))
  return [text(name), TIE, ...labelFormat(setup, pr, true, true, links)]
}

/** \@@@setcrefrange: the range format, \crefrangepreconjunction label \crefrangeconjunction label \crefrangepostconjunction */
function range(setup: CrefSetup, family: Family, a: Ref, b: Ref, pos: Pos, links: boolean): CrefOut[] {
  const name = setup.name(a.type, family, true)
  if (name === null) return [{ t: "qq" }, TIE, text(`${a.label}--${b.label}`)]
  const second = [...setup.conj.range, ...labelFormat(setup, b, true, true, links)]
  if (pos === "@middle" || pos === "@last") return [...(pos === "@middle" ? setup.conj.middle : setup.conj.last), ...labelFormat(setup, a, true, true, links), ...second]
  // (the single range format leaves out the name when the singular one is empty, the multi one when the plural is)
  if ((pos === "" ? setup.name(a.type, family, false) : name) === "") return [...labelFormat(setup, a, true, true, links), ...second]
  if (setup.options.nameinlink && links) return [...joinLink(a.key, [text(name), TIE], labelFormat(setup, a, false, true, links)), ...second]
  return [text(name), TIE, ...labelFormat(setup, a, true, true, links), ...second]
}

/** cleveref's second write, \newlabel{key@cref}{{\cref@currentlabel}{[\thepage at 1][\arabic{page}][]\thepage}}; the
 *  page counter is the one when the \label was read, filled in once the pages are built (`at`: how much of the main
 *  vertical list there was then, the page builder having seen all of it but a paragraph's \parskip only `inPara`) */
export interface CrefWrite { node: Node & { kind: "whatsit" }; key: string; cref: CrefLabel | null; at: number; inPara: boolean; page?: { style: string; arabic: number } }

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
    w.page = { style: roman ? "i" : "1", arabic: page }
    w.node.text = `\\write1{\\newlabel{${w.key}@cref}{{${label}}{[${w.page.style}][${page}][]\\thepage }{}{}{}}}`
  }
}
