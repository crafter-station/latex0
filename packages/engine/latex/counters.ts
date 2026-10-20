// LaTeX's counters as the layout reads them: the sectioning counters, equation,
// figure and table, the document's own (\newcounter{name}[within]), and the
// counter commands in text, which act in order (\stepcounter and friends) or
// print (\the<name>, \arabic{name} …).

import type { CrefLabel } from "./cleveref"
import { Unsupported } from "./unsupported"

/** The sectioning counters, outermost first: \c@chapter … \c@subparagraph. */
export const SECTIONAL = ["chapter", "section", "subsection", "subsubsection", "paragraph", "subparagraph"] as const

/** The counter commands, as text that leaves no node behind (and `{}`, what each one leaves). */
export const COUNTER_COMMANDS = /\\(?:setcounter|addtocounter|stepcounter|refstepcounter)\s*\{[^{}]*\}(?:\s*\{[^{}]*\})?|\{\}/g

/** \arabic, \roman, \Roman, \alph, \Alph of a value. */
export function representation(style: string, n: number): string {
  if (style === "arabic") return String(n)
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

  constructor(private readonly cls: string, declared: [name: string, within: string | null][], private readonly footnote: () => number) {
    for (const [name, within] of declared) this.user.set(name, { value: 0, within })
  }

  /** \theH<counter> (hyperref's \@currentHref after \refstepcounter): report and book number within the chapter */
  href(counter: string, n: number): string {
    return this.cls === "article" || this.cls === "letter" ? `${counter}.${n}` : `${counter}.${this.sectional[0]}.${n}`
  }

  /** \theequation, \thefigure, \thetable: in report and book, prefixed by the chapter once there is one */
  the(n: number): string {
    return this.cls !== "article" && this.sectional[0] > 0 ? `${this.sectional[0]}.${n}` : String(n)
  }

  /** \thechapter … : article's sections are not within a chapter */
  theSectional(level: number): string {
    return (this.cls === "article" ? this.sectional.slice(1, level + 1) : this.sectional.slice(0, level + 1)).join(".")
  }

  /** \stepcounter of a sectioning counter: the deeper ones reset, and the document's counters within it or a
   *  deeper one (\@stpelt steps them, so the reset goes down the chain); a chapter resets every counter within one */
  stepSectional(level: number): void {
    this.sectional[level]++
    for (let l = level + 1; l < this.sectional.length; l++) this.sectional[l] = 0
    const levels: readonly string[] = SECTIONAL.slice(level)
    for (const u of this.user.values()) if (u.within !== null && (level === 0 || levels.includes(u.within))) u.value = 0
    // (report and book number these within the chapter)
    if (level === 0) this.equation = this.figure = this.table = 0
  }

  /** \refstepcounter of a document's counter: \the<counter>, after \the<within> when it has one */
  stepNumbered(name: string): string {
    const c = this.user.get(name)
    if (!c) throw new Unsupported(`counter ${name}`)
    c.value++
    const level = c.within === null ? -1 : SECTIONAL.indexOf(c.within as typeof SECTIONAL[number])
    return level >= 0 ? `${this.theSectional(level)}.${c.value}` : String(c.value)
  }

  /** \theH<counter> of a document's counter (\@newctr): \theH<within>.\arabic{counter}, or \arabic{counter} */
  private theH(name: string): string {
    const u = this.user.get(name)
    if (!u) {
      const l = SECTIONAL.slice(0, 4).indexOf(name as typeof SECTIONAL[number])
      if (l < 0 || (l === 0 && this.cls === "article")) throw new Unsupported(`\theH${name}`)
      return this.theSectional(l)
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

  private set(name: string, value: number): void {
    const u = this.user.get(name)
    if (!u) throw new Unsupported(`\\setcounter of LaTeX's ${name}`)
    u.value = value
  }

  /** \the<counter> of a document's counter: \arabic (\newcounter{c}[parent] only resets it; \counterwithin would change \the) */
  private theUser(name: string): string {
    const u = this.user.get(name)
    if (!u) throw new Unsupported(`\\the${name}`)
    return String(u.value)
  }

  /**
   * Counter commands in text, in order: \setcounter, \addtocounter, \stepcounter and \refstepcounter act, \the…
   * and \arabic… print. A \refstepcounter outside text calls `refstep` with \@currentlabel and \@currentHref;
   * in text (`inText`) it stays where it stands, as \LXcurrentlabel{label}{href}{}.
   */
  counted(text: string, inText: boolean, refstep: (label: string, href: string) => void): string {
    return text.replace(/\\(setcounter|addtocounter|stepcounter|refstepcounter)\s*\{([^{}]*)\}(?:\s*\{([^{}]*)\})?|\\(arabic|roman|Roman|alph|Alph)\s*\{([^{}]*)\}|\\the([a-zA-Z]+)\b\s*/g, (all, cmd, name, arg, style, cname, tname) => {
      if (cmd) {
        const val = (x: string | undefined) => {
          const vm = x?.match(/^\s*\\value\s*\{([^{}]*)\}\s*$/)
          if (vm) return this.value(vm[1])
          if (x === undefined || !/^\s*-?\d+\s*$/.test(x)) throw new Unsupported(`\\${cmd} value "${x}"`)
          return Number(x)
        }
        if (cmd === "setcounter") this.set(name, val(arg))
        else if (cmd === "addtocounter") this.set(name, this.value(name) + val(arg))
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
      return all
    })
  }
}
