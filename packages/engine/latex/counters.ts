// LaTeX's counters as the layout reads them: the sectioning counters, equation,
// figure and table, the document's own (\newcounter{name}[within]), and the
// counter commands in text, which act in order (\stepcounter and friends) or
// print (\the<name>, \arabic{name} …).

import type { CrefLabel } from "./cleveref"
import { Unsupported } from "./unsupported"
import { spanishAlph, spanishLayout } from "./spanish"

/** The sectioning counters, outermost first: \c@chapter … \c@subparagraph. */
export const SECTIONAL = ["chapter", "section", "subsection", "subsubsection", "paragraph", "subparagraph"] as const

/** The counter commands, as text that leaves no node behind (and `{}`, what each one leaves). */
export const COUNTER_COMMANDS = /\\(?:setcounter|addtocounter|stepcounter|refstepcounter)\s*\{[^{}]*\}(?:\s*\{(?:[^{}]|\{[^{}]*\})*\})?|\{\}/g

/** \arabic, \roman, \Roman, \alph, \Alph of a value. */
export function representation(style: string, n: number): string {
  if (style === "arabic") return String(n)
  // (spanish.ldf's layout: \@roman in small capitals, \es@scroman's \hbox; \@alph and \@Alph with \~n after n)
  if (spanishLayout.on && style === "roman") throw new Unsupported(`spanish.ldf's \\${style} of ${n}`)
  if (spanishLayout.on && (style === "alph" || style === "Alph") && n > 0) return spanishAlph(n, style === "Alph", true)
  if (style === "roman" || style === "Roman") {
    let out = "", x = n
    for (const [v, r] of [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]] as const) while (x >= v) { out += r; x -= v }
    return style === "Roman" ? out.toUpperCase() : out
  }
  if (n === 0) return "" // \ifcase 0: nothing
  if (n < 0 || n > 26) throw new Unsupported(`\\${style} of ${n}`) // LaTeX: Counter too large
  return String.fromCharCode((style === "alph" ? 96 : 64) + n)
}

export class Counters {
  /** \c@chapter … \c@subparagraph (SECTIONAL) */
  readonly sectional = SECTIONAL.map(() => 0)
  equation = 0
  figure = 0
  table = 0
  /** float.sty's \newfloat{algorithm}: \arabic{algorithm}, within nothing */
  algorithm = 0
  /** cleveref's \cref@currentlabel of each \refstepcounter of a document's counter, by its \@currentHref */
  readonly crefs = new Map<string, CrefLabel>()
  /** the document's counters (\newcounter), with the counter that resets each */
  private readonly user = new Map<string, { value: number; within: string | null }>()

  /**
   * The preamble's \renewcommand of a \the<counter> (source.ts, preamble.ts): its body by counter, evaluated where LaTeX
   * expands it (format())
   */
  private readonly formats: ReadonlyMap<string, string>

  /** \counterwithin (amsmath's \numberwithin) of equation, figure or table: the sectioning counter that resets it (its
   *  \@addtoreset, which also makes \theH<counter> \theH<within>.\the\value{counter}) */
  private readonly within: ReadonlyMap<string, string>

  constructor(private readonly cls: string, declared: [name: string, within: string | null][], private readonly footnote: () => number, formats: ReadonlyMap<string, string> = new Map(), within: ReadonlyMap<string, string> = new Map()) {
    this.formats = formats
    this.within = within
    for (const [name, within] of declared) this.user.set(name, { value: 0, within })
  }

  /**
   * \appendix: \thesection (article) or \thechapter (report, book) is \@Alph from then on. With hyperref, \theHsection
   * or \theHchapter is too (\Hy@AlphNoErr), and the anchors of that level are of type appendix (\Hy@chapapp); the
   * kernel's \theH… (\@definecounter, \@addtoreset) stay arabic
   */
  appendix: { hyper: boolean } | null = null

  /** \theH<counter> (hyperref's \@currentHref after \refstepcounter): report and book number within the chapter */
  href(counter: string, n: number): string {
    const w = this.within.get(counter)
    if (w !== undefined) return `${counter}.${this.theH(w)}.${n}`
    return this.cls === "article" || this.cls === "letter" ? `${counter}.${n}` : `${counter}.${this.sectionalString(0, true)}.${n}`
  }

  /** \theequation, \thefigure, \thetable (of the value n): in report and book, prefixed by the chapter once there is one */
  the(counter: "equation" | "figure" | "table", n: number): string {
    const f = this.format(counter)
    if (f !== null) return f
    return this.cls !== "article" && this.sectional[0] > 0 ? `${this.theSectional(0)}.${n}` : String(n)
  }

  /** \thechapter … : article's sections are not within a chapter; \appendix redefines the outermost (\gdef), over the
   *  preamble's definition; a deeper one is the one outside it, a period, its value */
  theSectional(level: number): string {
    const outer = this.cls === "article" ? 1 : 0
    if (!(this.appendix && level === outer)) { const f = this.format(SECTIONAL[level]); if (f !== null) return f }
    if (level <= outer) return this.sectionalString(level, false)
    return `${this.theSectional(level - 1)}.${this.sectional[level]}`
  }

  /** the counters whose \the<counter> format() is evaluating (one inside its own: TeX would loop) */
  private readonly evaluating = new Set<string>()

  /**
   * \the<counter> as the preamble redefined it, or null: its body with \arabic{c} (\roman, \Roman, \alph, \Alph) and
   * \the<c> expanded; what remains is set as text and written to
   * the files as it is, so it must be characters only
   */
  private format(name: string): string | null {
    const body = this.formats.get(name)
    if (body === undefined) return null
    if (this.evaluating.has(name)) throw new Unsupported(`\\the${name} in its own definition`)
    this.evaluating.add(name)
    try {
      const out = body.replace(/\\(arabic|roman|Roman|alph|Alph)\s*\{\s*([A-Za-z]+)\s*\}|\\the([A-Za-z]+)(?![A-Za-z])\s*/g, (_, style: string | undefined, c: string, t: string) =>
        style ? representation(style, this.value(c)) : this.theOf(t))
      if (!/^[A-Za-z0-9.,:;()\-\/]*$/.test(out)) throw new Unsupported(`\\the${name} defined as ${body}`)
      return out
    } finally { this.evaluating.delete(name) }
  }

  /** \the<name> of any counter the engine keeps */
  private theOf(name: string): string {
    if (this.user.has(name)) return this.theUser(name)
    const l = this.sectionalLevel(name)
    if (l >= 0) return this.theSectional(l)
    if (name === "equation" || name === "figure" || name === "table") return this.the(name, this[name])
    throw new Unsupported(`\\the${name}`)
  }

  /** \theHchapter …, which \@currentHref of a heading has after its type */
  theHSectional(level: number): string {
    return this.sectionalString(level, true)
  }

  /**
   * the sectioning counters to `level`, the outermost (article's section, report's chapter) in \@Alph after \appendix;
   * in an anchor, hyperref's \hyper@makecurrent makes an \@Alph that is not the kernel's (spanish.ldf's layout) Alph\number
   */
  private sectionalString(level: number, h: boolean): string {
    const alph = this.appendix && (!h || this.appendix.hyper)
    const outer = (n: number) => (h && spanishLayout.on ? `Alph${n}` : representation("Alph", n))
    return (this.cls === "article" ? this.sectional.slice(1, level + 1) : this.sectional.slice(0, level + 1)).map((n, i) => (i === 0 && alph ? outer(n) : String(n))).join(".")
  }

  /** the type of a heading's anchor: hyperref's \Hy@chapapp after \appendix for the outermost level */
  anchorType(level: number): string {
    return this.appendix?.hyper && level === (this.cls === "article" ? 1 : 0) ? "appendix" : SECTIONAL[level]
  }

  /** \stepcounter of a sectioning counter: the deeper ones reset, and the document's counters within it or a
   *  deeper one (\@stpelt steps them, so the reset goes down the chain); a chapter resets every counter within one */
  stepSectional(level: number): void {
    this.sectional[level]++
    for (let l = level + 1; l < this.sectional.length; l++) this.sectional[l] = 0
    const levels: readonly string[] = SECTIONAL.slice(level)
    for (const u of this.user.values()) if (u.within !== null && (level === 0 || levels.includes(u.within))) u.value = 0
    // (report and book number these within the chapter; \counterwithin within a level)
    for (const c of ["equation", "figure", "table"] as const) if (level === 0 || levels.includes(this.within.get(c) ?? "")) this[c] = 0
  }

  /** \refstepcounter of a document's counter: \the<counter>, after \the<within> when it has one */
  stepNumbered(name: string): string {
    const c = this.user.get(name)
    if (!c) throw new Unsupported(`counter ${name}`)
    c.value++
    const f = this.format(name)
    if (f !== null) return f
    const level = c.within === null ? -1 : SECTIONAL.indexOf(c.within as typeof SECTIONAL[number])
    return level >= 0 ? `${this.theSectional(level)}.${c.value}` : String(c.value)
  }

  /** \@currentHref after \refstepcounter of a document's counter: <counter>.\theH<counter> (not \the<counter>) */
  currentHref(name: string): string { return `${name}.${this.theH(name)}` }

  /** \theH<counter> of a document's counter (\@newctr): \theH<within>.\arabic{counter}, or \arabic{counter} */
  private theH(name: string): string {
    const u = this.user.get(name)
    if (!u) {
      const l = SECTIONAL.slice(0, 4).indexOf(name as typeof SECTIONAL[number])
      if (l < 0 || (l === 0 && this.cls === "article")) throw new Unsupported(`\theH${name}`)
      return this.theHSectional(l)
    }
    return u.within === null ? String(u.value) : `${this.theH(u.within)}.${u.value}`
  }

  /** cleveref's \cref@constructprefix: the values of the counters that reset `name` (\cl@… lists), outermost first */
  crefPrefix(name: string): string {
    const out: number[] = []
    for (let c = this.resetBy(name); c; c = this.resetBy(c)) out.unshift(this.value(c))
    return out.join(",")
  }

  private resetBy(name: string): string | null {
    const chapters = this.cls === "report" || this.cls === "book"
    const l = SECTIONAL.indexOf(name as typeof SECTIONAL[number])
    if (l > 1 || (l === 1 && chapters)) return SECTIONAL[l - 1]
    if (l >= 0) return null
    // (\cref@resetby looks in \cl@subsubsection, \cl@subsection, \cl@section, \cl@chapter in turn: \counterwithin's first)
    if (this.within.has(name)) return this.within.get(name)!
    if (["equation", "figure", "table", "footnote"].includes(name)) return chapters ? "chapter" : null
    const u = this.user.get(name)
    if (u) return u.within
    throw new Unsupported(`cleveref: the counter ${name}`)
  }

  value(name: string): number {
    const u = this.user.get(name)
    if (u) return u.value
    const i = SECTIONAL.slice(0, 4).indexOf(name as typeof SECTIONAL[number])
    if (i >= 0) return this.sectional[i]
    if (name === "equation" || name === "figure" || name === "table") return this[name]
    if (name === "footnote") return this.footnote()
    throw new Unsupported(`counter ${name}`)
  }

  /** \setcounter and \addtocounter: the document's counters, the class's sectioning counters to subsubsection, equation,
   *  figure, table (no other is reset: only \stepcounter resets) */
  private set(name: string, value: number): void {
    const u = this.user.get(name)
    if (u) { u.value = value; return }
    const l = this.sectionalLevel(name)
    if (l >= 0) { this.sectional[l] = value; return }
    if (name === "equation" || name === "figure" || name === "table") { this[name] = value; return }
    throw new Unsupported(`\\setcounter of LaTeX's ${name}`)
  }

  /** a sectioning counter, chapter to subsubsection: its level, or -1 (article's chapter is no counter: LaTeX says so) */
  private sectionalLevel(name: string): number { return SECTIONAL.slice(0, 4).indexOf(name as typeof SECTIONAL[number]) }

  /** \the<counter> of a document's counter: \arabic (\newcounter{c}[parent] only resets it; \counterwithin would change \the) */
  private theUser(name: string): string {
    const u = this.user.get(name)
    if (!u) throw new Unsupported(`\\the${name}`)
    return this.format(name) ?? String(u.value)
  }

  /**
   * Counter commands in text, in order: \setcounter, \addtocounter, \stepcounter and \refstepcounter act, \the…
   * and \arabic… print. A \refstepcounter outside text calls `refstep` with \@currentlabel and \@currentHref;
   * in text (`inText`) it stays where it stands, as \LXcurrentlabel{label}{href}{}.
   */
  counted(text: string, inText: boolean, refstep: (label: string, href: string) => void): string {
    return text.replace(/\\(setcounter|addtocounter|stepcounter|refstepcounter)\s*\{([^{}]*)\}(?:\s*\{((?:[^{}]|\{[^{}]*\})*)\})?|\\(arabic|roman|Roman|alph|Alph)\s*\{([^{}]*)\}|\\the([a-zA-Z]+)\b\s*/g, (all, cmd, name, arg, style, cname, tname) => {
      if (cmd) {
        const val = (x: string | undefined) => {
          const vm = x?.match(/^\s*\\value\s*\{([^{}]*)\}\s*$/)
          if (vm) return this.value(vm[1])
          if (x === undefined || !/^\s*-?\d+\s*$/.test(x)) throw new Unsupported(`\\${cmd} value "${x}"`)
          return Number(x)
        }
        if (cmd === "setcounter") this.set(name, val(arg))
        else if (cmd === "addtocounter") this.set(name, this.value(name) + val(arg))
        else if (cmd === "stepcounter" && this.sectionalLevel(name) > 0) this.stepSectional(this.sectionalLevel(name)) // (\@stpelt: the deeper ones and the document's within reset)
        else {
          if (!this.user.has(name)) throw new Unsupported(`\\${cmd}{${name}}`)
          this.set(name, this.value(name) + 1)
          for (const u of this.user.values()) if (u.within === name) u.value = 0
          if (cmd === "refstepcounter") {
            const label = this.theUser(name), href = `${name}.${this.theH(name)}`
            this.crefs.set(href, { type: name, arabic: this.value(name), prefix: this.crefPrefix(name), label })
            if (inText) return `\\LXcurrentlabel{${label}}{${href}}{}`
            refstep(label, href)
          }
          if (arg !== undefined) return `{${arg}}`
        }
        return "{}" // no node, but the spaces around it stay apart
      }
      if (style) return representation(style, this.value(cname))
      if (this.user.has(tname)) return this.theUser(tname)
      // (the class's: \thesection … with the chapter's or section's before it, \theequation, \thefigure, \thetable)
      if (this.sectionalLevel(tname) >= 0) return this.theSectional(this.sectionalLevel(tname))
      if (tname === "equation" || tname === "figure" || tname === "table") return this.the(tname, this[tname as "figure"])
      return all
    })
  }
}
