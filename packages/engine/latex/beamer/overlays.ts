// beamer's overlays (beamerbaseoverlay.sty, beamerbasedecode.sty): a frame is typeset
// once per slide, each slide its own page, until no overlay specification asks for a
// later slide (\ifbeamer@anotherslide). Material not shown on a slide is still typeset,
// between pgf's \pgfsys@begininvisible and \pgfsys@endinvisible (beamer's "invisible"
// covering); material shown gets an empty pair of them where the covering would begin
// or end (\beamer@spacingcover). Every such action is \beamer@smuggle'd past a skip
// that ends the list, and leaves one more empty pair \aftergroup.

import type { Node } from "../../layout/nodes"
import { DvipsDriver } from "../../pgf/drivers/dvips"
import { PgfState } from "../../pgf/state"
import { Unsupported } from "../unsupported"
import { plain, type VerticalList } from "../vlist"

/** The overlay state while a slide of a frame is typeset */
export interface Overlay {
  /** \beamer@slideinframe */
  slide: number
  /** \c@beamerpauses */
  pauses: number
  /** \beamer@endpause: what the next \pause (or the frame's end) does first: nothing, the empty pair (after a shown
   *  part) or \beamer@endcovered (after a covered one) */
  endpause: "" | "spacing" | "covered"
  /** the \aftergroup'd empty pairs waiting for the end of the current group */
  queue: number
  /** \ifbeamer@anotherslide: some specification named a later slide */
  another: boolean
}

export const newOverlay = (slide: number): Overlay => ({ slide, pauses: 1, endpause: "", queue: 0, another: false })

/**
 * \beamer@masterdecode{spec}: whether the slide is one the specification names (\beamer@doifinframe), noting a later
 * slide it names in `another`. "+" is \c@beamerpauses, stepped after the specification. Modes, actions, "." and
 * relative offsets throw Unsupported.
 */
export function inSpec(o: Overlay, spec: string): boolean {
  if (/[:|@().]/.test(spec)) throw new Unsupported(`beamer: the overlay specification <${spec}>`)
  let plus = false
  const s = spec.replace(/\s+/g, "").replace(/\+/g, () => { plus = true; return String(o.pauses) })
  let shown = false
  for (const item of s.split(",")) {
    const m = item.match(/^(\*)$|^(\d+)$|^(\d+)-$|^-(\d+)$|^(\d+)-(\d+)$/)
    if (!m) throw new Unsupported(`beamer: the overlay specification <${spec}>`)
    const n = (i: number) => Number(m[i])
    if (m[1]) shown = true
    else if (m[2]) { if (n(2) > o.slide) o.another = true; if (n(2) === o.slide) shown = true }
    else if (m[3]) { if (n(3) > o.slide) o.another = true; else shown = true }
    else if (m[4]) { if (n(4) > o.slide) o.another = true; if (o.slide <= n(4)) shown = true }
    else {
      if (n(5) > o.slide || n(6) > o.slide) o.another = true
      if (n(5) <= o.slide && n(6) >= o.slide) shown = true
    }
  }
  if (plus) o.pauses++
  return shown
}

/** \pgfsys@begininvisible or \pgfsys@endinvisible (dvips): the specials */
function invisible(begin: boolean): Node[] {
  const d = new DvipsDriver(new PgfState())
  if (begin) d.beginInvisible(); else d.endInvisible()
  return d.state.out
}
export const beginInvisible = () => invisible(true)
export const endInvisible = () => invisible(false)
/** \beamer@@spacingcover's \pgfsys@begininvisible\pgfsys@endinvisible */
export const emptyPair = () => [...beginInvisible(), ...endInvisible()]

/** \beamer@smuggle in vertical mode: a \lastskip other than 0.0pt is taken off before the nodes and put back after
 *  them (\vskip\lastskip: plain glue) */
export function smuggle(v: VerticalList, nodes: Node[]) {
  const i = v.nodes.findLastIndex((x) => !(x.kind === "whatsit" && x.hook))
  const last = v.nodes[i]
  if (last?.kind === "glue" && (last.width || last.stretch || last.shrink)) {
    v.nodes.splice(i, 1)
    v.nodes.push(...nodes, plain(last))
  } else v.nodes.push(...nodes)
}

/** \beamer@endpause: the empty pair after a shown part, \pgfsys@endinvisible after a covered one; each leaves a pair
 *  for the group */
function endpause(o: Overlay): Node[] {
  if (!o.endpause) return []
  o.queue++
  return o.endpause === "spacing" ? emptyPair() : endInvisible()
}

/** \pause[to] in vertical mode (\onslide<\c@beamerpauses->): \beamer@endpause, then the empty pair where the rest is
 *  shown, else \beamer@startcovered's \pgfsys@begininvisible; either leaves a pair for the group */
export function pause(o: Overlay, v: VerticalList, to?: number) {
  o.pauses = to ?? o.pauses + 1
  const nodes = endpause(o)
  const shown = inSpec(o, `${o.pauses}-`)
  o.endpause = shown ? "spacing" : "covered"
  o.queue++
  smuggle(v, [...nodes, ...(shown ? emptyPair() : beginInvisible())])
}

/** The end of a group (\beamer@framepauses at the frame's end: \beamer@endpause first): the pairs it waits for */
export function groupEnd(o: Overlay, frame: boolean): Node[] {
  const nodes = frame ? endpause(o) : []
  for (; o.queue > 0; o.queue--) nodes.push(...emptyPair())
  return nodes
}

/** uncoverenv (actionenv's, around a list item) begun: the empty pair where shown, else \pgfsys@begininvisible */
export const coverBegin = (shown: boolean): Node[] => (shown ? emptyPair() : beginInvisible())
/** and ended: the empty pair or \pgfsys@endinvisible, then the two pairs \aftergroup'd to its group's end */
export const coverEnd = (shown: boolean): Node[] => [...(shown ? emptyPair() : endInvisible()), ...emptyPair(), ...emptyPair()]

/** the overlay commands read in a frame's text */
const COMMAND = /\\(only|alt|temporal|uncover|visible|invisible|onslide)(?![A-Za-z])/

/** What an overlay command at the start of `text` does: `begin`, the specials it puts before its argument (null for
 *  \only, \alt and \temporal, which put none), then `text`, the material that takes its place (its \LXsmuggle{n}
 *  placeholders for the specials after it, registered in `smuggled`), and `end`, where it ends in `text` */
export function overlayCommand(o: Overlay, text: string, smuggled: Node[][]): { begin: Node[] | null; text: string; end: number } {
  const m = text.match(COMMAND)
  if (!m || m.index !== 0) throw new Error("no overlay command")
  let i = m[0].length, name = m[1]
  if (name === "onslide" && (text[i] === "+" || text[i] === "*")) name += text[i++]
  while (/\s/.test(text[i] ?? "")) i++ // (\@ifnextchar< skips spaces)
  if (text[i] !== "<") throw new Unsupported(`beamer: \\${name} without an overlay specification first`)
  const close = text.indexOf(">", i)
  if (close < 0) throw new Unsupported(`beamer: \\${name}'s overlay specification`)
  const spec = text.slice(i + 1, close)
  i = close + 1
  const arg = () => {
    while (/\s/.test(text[i] ?? "")) i++
    if (text[i] !== "{") throw new Unsupported(`beamer: \\${name} without a braced argument`)
    let depth = 0
    for (let j = i; j < text.length; j++) {
      if (text[j] === "\\") { j++; continue }
      if (text[j] === "{") depth++
      else if (text[j] === "}" && --depth === 0) { const a = text.slice(i + 1, j); i = j + 1; return a }
    }
    throw new Unsupported(`beamer: \\${name}'s argument not closed`)
  }
  const mark = (nodes: Node[]) => { smuggled.push(nodes); return `\\LXsmuggle{${smuggled.length - 1}}` }
  // the argument read after the specification is decoded, its own overlay commands as it is
  const inner = (t: string) => overlayText(o, t, smuggled)
  if (name === "only" || name === "onslide*") { const a = arg(); return { begin: null, text: inSpec(o, spec) ? inner(a) : "", end: i } }
  if (name === "alt") { const a = arg(), b = arg(); return { begin: null, text: inner(inSpec(o, spec) ? a : b), end: i } }
  if (name === "temporal") {
    // the text before the slides named (some named slide is later: \ifbeamer@localanotherslide), on them, after them
    const before = arg(), on = arg(), after = arg()
    const another = o.another
    o.another = false
    const shown = inSpec(o, spec), later = o.another
    o.another ||= another
    return { begin: null, text: inner(shown ? on : later ? before : after), end: i }
  }
  // \onslide<spec> without an argument (\beamer@noargsonslide, \beamer@noargsvisibleonslide): as \pause
  if (name.startsWith("onslide") && !/^\s*\{/.test(text.slice(i))) {
    const nodes = endpause(o)
    const shown = inSpec(o, spec)
    o.endpause = shown ? "spacing" : "covered"
    o.queue++
    return { begin: [...nodes, ...(shown ? emptyPair() : beginInvisible())], text: "", end: i }
  }
  // \uncover (\onslide), \visible (\onslide+): shown, \beamer@fakeinvisible's empty pairs around the argument, else
  // \beamer@makecovered's or \beamer@reallymakeinvisible's \pgfsys@begininvisible and \pgfsys@endinvisible (the same
  // with beamer's invisible covering); \invisible the other way round. Each leaves a pair for the group.
  const shown = inSpec(o, spec) !== (name === "invisible")
  const a = arg()
  o.queue += 2
  return { begin: shown ? emptyPair() : beginInvisible(), text: inner(a) + mark(shown ? emptyPair() : endInvisible()), end: i }
}

/** Paragraph text with its overlay commands done for the slide: \only, \alt and \temporal leave the text they choose
 *  after an empty group (their assignments end a ligature or a kern as one does), the others \LXsmuggle{n}'s */
export function overlayText(o: Overlay, text: string, smuggled: Node[][]): string {
  let out = ""
  for (let rest = text; ;) {
    const m = rest.match(COMMAND)
    if (!m) return out + rest
    out += rest.slice(0, m.index)
    const c = overlayCommand(o, rest.slice(m.index), smuggled)
    out += c.begin ? `\\LXsmuggle{${smuggled.push(c.begin) - 1}}${c.text}` : `{}${c.text}`
    rest = rest.slice(m.index! + c.end)
  }
}
