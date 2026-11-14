// tikz-cd (tikzlibrarycd.code.tex [2021/05/04 v1.0], line numbers cite it): the keys of /tikz/commutative
// diagrams as bindings on TikZ's (tikz/options.ts), the direction parser of an arrow's target, the arrow
// commands of a diagram's cells (\arrow, \ar and the \rar family, in the new syntax and the old one) and the
// arrow tips the library declares on arrows.meta's. A diagram is a tikzpicture holding a matrix of math nodes
// (tikz/path.ts makes it, with pgf's matrix) whose cells' arrows are saved and drawn after it, each a path
// `(cell) to (target)` under `every arrow` and its own options; a quoted label goes to the to path's
// `every to` and from there to the edge's nodes. Not modeled, each refused by name: math mode=false, the
// arrow styles other than the Computer Modern one, squiggly arrows, crossing over, the nodes' transformations
// (shift, xshift, yshift, transform nodes, an anchor's own), execute before arrows, and a center yshift or
// background color other than the initial ones.

import { Unsupported } from "../latex/unsupported"
import { chars, type Keys } from "./keys"
import type { Tikz } from "./options"
import { groupEnd, plain, type Tok, type Toks } from "./tokens"

/** the key path */
export const CD = "/tikz/commutative diagrams"

/** \tikzcd@forward@quotes: the handler of a key that starts with " while a diagram's arrows are drawn (153) */
export const FORWARD_QUOTES = "\\tikzcd@forward@quotes"

/** \tikzcd@ar@start\tikzcd@startanchor and \tikzcd@ar@target\tikzcd@endanchor in an arrow's path (149–150) */
export const CD_START = "\\tikzcd@ar@start", CD_TARGET = "\\tikzcd@ar@target"

/** `\everymath\expandafter{\the\everymath\scriptstyle}`: the font of every label (479), which makes its math script style */
export const SCRIPT_FONT = "\\everymath\\expandafter{\\the\\everymath\\scriptstyle}"

/** what the keys need of the picture they are set in */
export interface CdHooks {
  /** \pgfsetarrows{start-end}, or \pgfsetarrowsstart, \pgfsetarrowsend alone (null: left as it is) */
  tips(start: string | null, end: string | null): void
  /** whether a node of this name exists (\pgfutil@ifundefined{pgf@sh@ns@…}) */
  hasNode(name: string): boolean
}

/** the styles made of keys alone (15–46, 349, 472–505) */
const STYLES = `arrows/.code=\\tikzcdset{every arrow/.append style={#1}},
  labels/.code=\\tikzcdset{every label/.append style={#1}},
  cells/.code=\\tikzcdset{every cell/.append style={#1}},
  diagrams/.code=\\tikzcdset{every diagram/.append style={#1}},
  shorten/.style={/tikz/shorten <=#1,/tikz/shorten >=#1},
  description/.style={/tikz/anchor=center,/tikz/fill=white},
  marking/.style={/tikz/font=,/tikz/sloped,/tikz/shape=asymmetrical rectangle,/tikz/anchor=center},
  phantom/.style={/tikz/draw=none,/tikz/commutative diagrams/labels={/tikz/font=,/tikz/anchor=center}},
  cramped/.code=\\tikzcdset{every matrix/.append style={inner sep=+-0.3em},every cell/.append style={inner sep=+0.3em}},
  sep/.code=\\tikzcdset{row sep={#1},column sep={#1}},
  double line/.code=\\tikzset{double equal sign distance,double=white},
  dashed/.style={/tikz/dash pattern={on 7\\pgflinewidth off 4\\pgflinewidth}},
  every arrow/.style={/tikz/draw,/tikz/line width=rule_thickness,/tikz/commutative diagrams/rightarrow},
  every label/.style={/tikz/auto,/tikz/font=${SCRIPT_FONT},/tikz/inner sep=+0.5ex},
  every cell/.style={/tikz/shape={asymmetrical rectangle},/tikz/inner xsep=+1ex,/tikz/inner ysep=+0.85ex},
  every matrix/.style={/tikz/inner sep=+0pt},
  every diagram/.style={/tikz/commutative diagrams/row sep=normal,/tikz/commutative diagrams/column sep=normal,/tikz/baseline=+0pt},
  row sep/huge/.initial=+3.6em, row sep/large/.initial=+2.7em, row sep/normal/.initial=+1.8em,
  row sep/scriptsize/.initial=+1.35em, row sep/small/.initial=+0.9em, row sep/tiny/.initial=+0.45em,
  column sep/huge/.initial=+4.8em, column sep/large/.initial=+3.6em, column sep/normal/.initial=+2.4em,
  column sep/scriptsize/.initial=+1.8em, column sep/small/.initial=+1.2em, column sep/tiny/.initial=+0.6em,
  dashrightarrow/.code=\\tikzcdset{rightarrow,dashed}, dashleftarrow/.code=\\tikzcdset{leftarrow,dashed},
  equals/.code=\\tikzcdset{equal}`

/** the arrow styles (351–398): [the keys before \pgfsetarrows, the start tip, the end tip] (null: left as it is) */
const TIPS: Record<string, [boolean, string | null, string | null]> = {
  "no tail": [false, "tikzcd cap", null],
  "to head": [false, null, "tikzcd to"],
  "maps to": [false, "tikzcd bar", null],
  hook: [false, "tikzcd right hook", null],
  "hook'": [false, "tikzcd left hook", null],
  harpoon: [false, null, "tikzcd left to"],
  "harpoon'": [false, null, "tikzcd right to"],
  "two heads": [false, null, "tikzcd double to"],
  tail: [false, "tikzcd to reversed", null],
  rightarrow: [false, "tikzcd cap", "tikzcd to"],
  Rightarrow: [true, "tikzcd implies cap", "tikzcd implies"],
  leftarrow: [false, "tikzcd to", "tikzcd cap"],
  Leftarrow: [true, "tikzcd implies", "tikzcd implies cap"],
  leftrightarrow: [false, "tikzcd to", "tikzcd to"],
  Leftrightarrow: [true, "tikzcd implies", "tikzcd implies"],
  mapsto: [false, "tikzcd bar", "tikzcd to"],
  mapsfrom: [false, "tikzcd to", "tikzcd bar"],
  Mapsto: [true, "tikzcd implies bar", "tikzcd implies"],
  Mapsfrom: [true, "tikzcd implies", "tikzcd implies bar"],
  hookrightarrow: [false, "tikzcd right hook", "tikzcd to"],
  hookleftarrow: [false, "tikzcd to", "tikzcd left hook"],
  rightharpoonup: [false, "tikzcd cap", "tikzcd left to"],
  rightharpoondown: [false, "tikzcd cap", "tikzcd right to"],
  leftharpoonup: [false, "tikzcd right to", "tikzcd cap"],
  leftharpoondown: [false, "tikzcd left to", "tikzcd cap"],
  rightarrowtail: [false, "tikzcd to reversed", "tikzcd to"],
  leftarrowtail: [false, "tikzcd to", "tikzcd to reversed"],
  twoheadrightarrow: [false, "tikzcd cap", "tikzcd double to"],
  twoheadleftarrow: [false, "tikzcd double to", "tikzcd cap"],
  "no head": [false, null, "tikzcd cap"],
  dash: [false, "tikzcd cap", "tikzcd cap"],
  equal: [true, "tikzcd implies cap", "tikzcd implies cap"],
}

/** the keys whose code is not modeled */
const REFUSED = [
  "execute before arrows", "crossing over", "crossing over clearance", "arrow style", "squiggly", "rightsquigarrow", "leftsquigarrow",
  "leftrightsquigarrow", "transform nodes", "shift", "xshift", "yshift", "center yshift", "background color",
]

/** the arrow tips the library declares, in order (285–298, 331–342): name and what it means */
export const CD_TIPS: [string, string][] = [
  ["cm to", "Computer Modern Rightarrow[length=+0pt 6.2]"],
  ["cm bold to", "cm to[scale=0.667]"],
  ["cm double to", "cm to[sep=+0pt -2.6]cm to"],
  ["cm bar", "Bar[width=+0pt 8.2 0.89,line cap=round]"],
  ["cm left hook", "Hooks[width=+0pt 10.8,length=+0pt 3.6,harpoon,line cap=round]"],
  ["cm implies", "Implies"],
  ["cm left to", "cm to[left]"],
  ["cm right to", "cm to[right]"],
  ["cm right hook", "cm left hook[swap]"],
  ["cm to reversed", "cm to[reversed]"],
  ["cm *", "Circle[length=+0pt 7.6]"],
  ["cm o", "cm *[open]"],
  ["cm |", "cm bar"],
  ["tikzcd to", "cm to"],
  ["tikzcd bar", "cm bar"],
  ["tikzcd left hook", "cm left hook"],
  ["tikzcd double to", "cm double to"],
  ["tikzcd implies", "Implies"],
  ["tikzcd right hook", "tikzcd left hook[swap]"],
  ["tikzcd left to", "tikzcd to[harpoon]"],
  ["tikzcd right to", "tikzcd left to[swap]"],
  ["tikzcd to reversed", "tikzcd to[reversed]"],
  ["tikzcd cap", ""],
  ["tikzcd implies cap", ""],
  ["tikzcd implies bar", "tikzcd bar"],
]

/** \tikzcd@parse (87–94): a direction's rows down and columns right, or null when a character is none of r, d, l, u */
export function direction(name: string): { rows: number; columns: number } | null {
  let rows = 0, columns = 0
  for (const c of name) {
    if (c === "r") columns++
    else if (c === "d") rows++
    else if (c === "l") columns--
    else if (c === "u") rows--
    else return null
  }
  return { rows, columns }
}

/** the library's keys on TikZ's */
export function installCd(tz: Tikz, k: Keys, hooks: () => CdHooks) {
  const st = () => tz.st
  k.pgfkeys(`${CD}/.is family`)
  k.pgfqkeys(CD, STYLES)
  const code = (name: string, run: (v: Toks | undefined) => void) => k.define(`${CD}/${name}`, [{ kind: "native", run: (_k, v) => run(v) }])
  /** the cell an arrow's direction is counted from */
  const cell = () => {
    if (!tz.cdCell) throw new Unsupported("tikz-cd: an arrow's key outside an arrow")
    return tz.cdCell
  }
  const relative = (name: string): string | null => {
    const d = direction(name)
    if (!d) return null
    const c = cell()
    return `${tz.cdMatrix}-${c.row + d.rows}-${c.column + d.columns}`
  }
  // \tikzcd@sep (48–52): a named size's value, or the value given
  for (const which of ["row", "column"]) {
    code(`${which} sep`, (v) => {
      if (v === undefined) throw new Unsupported(`pgfkeys: the key '${CD}/${which} sep' requires a value`)
      const named = v.some((t) => t.length > 1 || t === "{" || t === "}") ? undefined : k.valueOf(`${CD}/${which} sep/${v.join("")}`)
      k.also([...chars(`/tikz/${which} sep=`), "{", ...(named ?? v), "}"])
    })
  }
  // \tikzcd@setarrowend (54–70): a cell `row-column` of the diagram, a direction from the arrow's cell, or a node's name
  for (const [name, field] of [["to", "cdTarget"], ["from", "cdStart"]] as const) {
    code(name, (v) => {
      const t = plain(v ?? [], name)
      st()[field] = hooks().hasNode(`${tz.cdMatrix}-${t}`) ? `${tz.cdMatrix}-${t}` : relative(t) ?? t
    })
  }
  // the unknown key handler (73–85): a direction is the arrow's target, another key TikZ's
  code(".unknown", (v) => {
    if (!k.addedDefaultPath) throw new Unsupported(`pgfkeys: I do not know the key '${k.key}'`)
    const name = k.name
    const target = direction(name) && tz.cdCell ? relative(name) : null
    if (target !== null) { st().cdTarget = target; return }
    if (direction(name)) cell()
    k.pgfqkeys("/tikz", v === undefined ? chars(name) : [...chars(name), "=", "{", ...v, "}"])
  })
  // math mode/.is if=tikzcd@mathmode
  code("math mode", (v) => {
    const b = plain(v ?? chars("true"), "math mode")
    if (b !== "true" && b !== "false") throw new Unsupported(`tikz-cd: math mode=${b}`)
    st().cdMathMode = b === "true"
  })
  // start anchor, end anchor (155–163, 180–185): `[transformation]anchor`
  for (const [name, field] of [["start anchor", "cdStartAnchor"], ["end anchor", "cdEndAnchor"]] as const) {
    code(name, (v) => {
      const t = (v ?? []).filter((x, i) => x !== " " || i > 0)
      if (t[0] === "[") throw new Unsupported(`tikz-cd: ${name} with a transformation`)
      const a = plain(t, name)
      st()[field] = a === "" ? "" : `.${a}`
    })
  }
  // shift left, shift right (186–200): the ends moved when the to path begins
  code("shift left", (v) => { st().atBeginTo.push({ kind: "shift left", amount: v ?? chars("+0.56ex") }) })
  code("shift right", (v) => { st().atBeginTo.push({ kind: "shift left", amount: ["-", "(", ...(v ?? ["1"]), ")"] }) })
  for (const [name, [double, start, end]] of Object.entries(TIPS)) {
    code(name, () => {
      if (double) k.pgfqkeys(CD, "double line")
      hooks().tips(start, end)
    })
  }
  for (const name of REFUSED) code(name, () => { throw new Unsupported(`tikz-cd: ${name}`) })
  // 1-row diagram/.style={/tikz/baseline/.expanded=(\tikzcdmatrixname.base)}
  code("1-row diagram", () => { k.pgfqkeys("/tikz", [...chars("baseline="), "{", "(", ...chars(`${tz.cdMatrix}.base`), ")", "}"]) })
}

/**
 * edge quotes mean (128–131) while a diagram's arrows are drawn: the label a node in math mode, under every label
 * and its own options
 */
export function cdEdgeQuotes(math: boolean): (text: Toks, options: Toks) => Tok[] {
  const mode = math ? "execute at begin node=$,execute at end node=$," : ""
  return (text, options) => [...chars("edge node="), "{", ...chars(`node [${mode}${CD}/.cd,every label,`), ...options, "]", "{", ...text, "}", "}"]
}

/** an arrow of a cell: its options, as \tikzcd@ar@new gets them (117–119) */
export interface CdArrow { row: number; column: number; options: Tok[] }

/** the arrow commands and the direction \tikzcd@xar gives each (101–108) */
const ARROWS: Record<string, string | null> = {
  "\\arrow": null, "\\ar": null, "\\rar": "r", "\\lar": "l", "\\dar": "d", "\\uar": "u", "\\urar": "ur", "\\ular": "ul", "\\drar": "dr", "\\dlar": "dl",
}

/**
 * A cell's text without its arrow commands, and the arrows' options (\tikzcd@arrow … \tikzcd@ar@getlabel,
 * 110–142): `\arrow[options]`, or the old syntax `\arrow[options]{direction}[label options]{label}…`, where each
 * bracket or brace is looked for past blanks (\pgfutil@ifnextchar).
 */
export function cellArrows(cell: Toks): { text: Tok[]; arrows: Tok[][] } {
  const text: Tok[] = [], arrows: Tok[][] = []
  let depth = 0
  for (let i = 0; i < cell.length; i++) {
    const t = cell[i]
    if (t === "{") depth++
    else if (t === "}") depth--
    if (depth > 0 || !(t in ARROWS)) { text.push(t); continue }
    let j = i + 1
    const skip = () => { while (cell[j] === " ") j++ }
    const bracket = (): Tok[] | null => {
      skip()
      if (cell[j] !== "[") return null
      let e = j + 1, d = 0
      for (; e < cell.length; e++) {
        if (cell[e] === "{") d++
        else if (cell[e] === "}") d--
        else if (cell[e] === "]" && d === 0) break
      }
      if (e >= cell.length) throw new Unsupported("tikz-cd: an arrow's options without ]")
      const out = cell.slice(j + 1, e)
      j = e + 1
      return out
    }
    const brace = (): Tok[] | null => {
      skip()
      if (cell[j] !== "{") return null
      const e = groupEnd(cell, j)
      if (e < 0) throw new Unsupported("tikz: unbalanced braces")
      const out = cell.slice(j + 1, e)
      j = e + 1
      return out
    }
    // \tikzcd@xar{dir}: `\tikzcd@arrow[options]{dir}`
    const fixed = ARROWS[t]
    const first = bracket()
    let options: Tok[] = first ?? []
    let dir = fixed !== null ? chars(fixed) : brace()
    if (dir === null && first === null) {
      // \tikzcd@ar@old[]#2: the direction an undelimited argument
      skip()
      if (j >= cell.length || cell[j] === "}") throw new Unsupported("tikz-cd: an arrow without a direction")
      dir = [cell[j++]]
    }
    if (dir !== null) {
      // the old syntax: to={dir}, then the labels
      options = [...chars("to="), "{", ...dir, "}", ",", ...options]
      for (;;) {
        const labelOptions = bracket()
        const label = brace()
        if (label === null) {
          if (labelOptions !== null) throw new Unsupported("tikz-cd: an arrow's label options without a label")
          break
        }
        options.push(",", "\"", "{", ...label, "}", "\"", "{", ...(labelOptions ?? []), "}")
      }
    }
    arrows.push(options)
    i = j - 1
  }
  return { text, arrows }
}
