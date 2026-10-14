// TeX's main loop for characters: "TeX: The Program" §§ 1034–1040, ported label
// by label. One call handles a run of consecutive characters in one font (a
// word): lig/kern programs, ligatures of every kind (=: =:| =:|> |=: |=:> |=:|
// |=:|> |=:|>>), kerns, left and right boundary characters, \noboundary, and
// the empty discretionary after an explicit hyphen in unrestricted mode.

import type { Font } from "./font"
import { emptyDisc, type CharNode, type Node } from "./nodes"

const NON_CHAR = 256
const STOP_FLAG = 128, KERN_FLAG = 128

export interface RunOptions {
  /** unrestricted horizontal mode (mode > 0): an explicit hyphen gets an empty discretionary */
  paragraph: boolean
  /** \hyphenchar of the font */
  hyphenChar: number
  /** \noboundary before the run: skip the left boundary program (cancel_boundary) */
  noBoundaryBefore?: boolean
  /** \noboundary after the run: no right boundary (§ 1038) */
  noBoundaryAfter?: boolean
  /** called for a character the font lacks (TeX's char_warning); the character is dropped */
  missing?: (c: number) => void
}

/** A lig_stack entry: a lookahead character node, or a lig item made by |=: ops (§ 144). */
type Item = { char: true; c: number } | { char: false; c: number; ptr: number | null }

const at = (f: Font, k: number) => {
  const w = f.ligKern[k] >>> 0
  return { skip: w >>> 24, next: (w >>> 16) & 255, op: (w >>> 8) & 255, rem: w & 255 }
}

/** Append the nodes for `codes` (one run of characters) to `out`. */
export function appendRun(out: Node[], codes: number[], f: Font, o: RunOptions): void {
  // a missing character is dropped and the loop is entered afresh after it (big_switch)
  for (let start = 0, first = true; start < codes.length; first = false) start = mainLoop(out, codes, start, f, o, first && !!o.noBoundaryBefore)
}

const charNode = (f: Font, c: number, text = String.fromCharCode(c)): CharNode => {
  const m = f.chars.get(c)!
  return { kind: "char", font: f.name, size: f.size, char: c, width: m.width, height: m.height, depth: m.depth, text }
}

/** One entry into the main loop at codes[start]; returns where the next entry starts (after a missing character) or codes.length. */
function mainLoop(out: Node[], codes: number[], start: number, f: Font, o: RunOptions, cancelBoundary: boolean): number {
  let pos = start
  let curChr = codes[pos]
  let bchar = f.bchar
  const falseBchar = f.falseBchar
  let curL: number, curR = NON_CHAR
  let curQ = out.length - 1 // index of cur_q; link(cur_q) = out.slice(curQ + 1)
  let ligStack: Item[] = [] // [0] is lig_stack; empty is null
  let mainK = 0
  let mainJ = at(f, 0)
  let mainI = f.chars.get(curChr)
  let ligaturePresent = false, lftHit = false, rtHit = false, insDisc = false

  const packLig = (z: boolean) => {
    const orig = out.splice(curQ + 1) as CharNode[]
    const lig: CharNode = { ...charNode(f, curL), text: orig.map((n) => n.text).join(""), ligature: true }
    let hits = 0
    if (lftHit) { hits = 2; lftHit = false }
    if (z && ligStack.length === 0) { hits++; rtHit = false }
    if (hits) lig.ligHits = hits
    out.push(lig)
    ligaturePresent = false
  }
  const wrapup = (z: boolean) => {
    if (curL < NON_CHAR) {
      const tail = out[out.length - 1]
      if (out.length - 1 > curQ && tail.kind === "char" && tail.char === o.hyphenChar) insDisc = true
      if (ligaturePresent) packLig(z)
      if (insDisc) { insDisc = false; if (o.paragraph) out.push(emptyDisc()) }
    }
  }

  // § 1034: the first character, with left boundary processing unless cancelled
  ligStack = [{ char: true, c: curChr }]
  curL = curChr
  type Label = "wrapup" | "move" | "move1" | "move2" | "lookahead" | "lookahead1" | "lig" | "lig1" | "lig2" | "moveLig"
  let L: Label
  if (cancelBoundary || f.bcharLabel === null) L = "move2"
  else { mainK = f.bcharLabel; curR = curL; curL = NON_CHAR; L = "lig1" }

  // TeX relies on check_interrupt here; a font with an infinite ligature loop
  // (which pltotf would reject) must not hang the engine
  let fuel = 64 * (codes.length - start + 2) + 4096
  for (;;) {
    if (--fuel < 0) throw new Error(`infinite ligature loop in font ${f.name}`)
    switch (L) {
      case "wrapup": // main_loop_wrapup (§ 1035)
        wrapup(rtHit)
        L = "move"; continue
      case "move": // main_loop_move (§ 1036)
        if (ligStack.length === 0) return codes.length // reswitch: the run is done
        curQ = out.length - 1
        curL = ligStack[0].c
        L = "move1"; continue
      case "move1":
        if (!ligStack[0].char) { L = "moveLig"; continue }
        L = "move2"; continue
      case "move2":
        mainI = f.chars.get(curL)
        if (!f.chars.has(curChr) || !mainI) { o.missing?.(curChr); return pos + 1 } // char_warning; big_switch
        out.push(charNode(f, ligStack[0].c)) // link(tail):=lig_stack: after =: this is the absorbed character, not cur_l
        L = "lookahead"; continue
      case "lookahead": // § 1038
        if (pos + 1 < codes.length) { curChr = codes[++pos]; L = "lookahead1"; continue }
        if (o.noBoundaryAfter) bchar = NON_CHAR
        curR = bchar; ligStack = []
        L = "lig"; continue
      case "lookahead1":
        ligStack = [{ char: true, c: curChr }]
        curR = curChr
        if (curR === falseBchar) curR = NON_CHAR // prevents spurious ligatures
        L = "lig"; continue
      case "lig": // main_lig_loop (§ 1039)
        if (!mainI || mainI.tag !== 1 || curR === NON_CHAR) { L = "wrapup"; continue }
        mainK = mainI.remainder
        mainJ = at(f, mainK)
        if (mainJ.skip <= STOP_FLAG) { L = "lig2"; continue }
        mainK = 256 * mainJ.op + mainJ.rem
        L = "lig1"; continue
      case "lig1":
        mainJ = at(f, mainK)
        L = "lig2"; continue
      case "lig2": {
        if (mainJ.next === curR && mainJ.skip <= STOP_FLAG) {
          // § 1040: do the ligature or kern command
          if (mainJ.op >= KERN_FLAG) {
            wrapup(rtHit)
            out.push({ kind: "kern", width: f.kerns[256 * (mainJ.op - KERN_FLAG) + mainJ.rem] })
            L = "move"; continue
          }
          if (curL === NON_CHAR) lftHit = true
          else if (ligStack.length === 0) rtHit = true
          switch (mainJ.op) {
            case 1: case 5: // =:|  =:|>
              curL = mainJ.rem; mainI = f.chars.get(curL); ligaturePresent = true
              break
            case 2: case 6: // |=:  |=:>
              curR = mainJ.rem
              if (ligStack.length === 0) { ligStack = [{ char: false, c: curR, ptr: null }]; bchar = NON_CHAR } // the right boundary is consumed
              else if (ligStack[0].char) ligStack[0] = { char: false, c: curR, ptr: ligStack[0].c }
              else ligStack[0].c = curR
              break
            case 3: // |=:|
              curR = mainJ.rem
              ligStack.unshift({ char: false, c: curR, ptr: null })
              break
            case 7: case 11: // |=:|>  |=:|>>
              wrapup(false)
              curQ = out.length - 1; curL = mainJ.rem; mainI = f.chars.get(curL); ligaturePresent = true
              break
            default: // =:
              curL = mainJ.rem; ligaturePresent = true
              if (ligStack.length === 0) { L = "wrapup"; continue }
              L = "move1"; continue
          }
          if (mainJ.op > 4 && mainJ.op !== 7) { L = "wrapup"; continue }
          if (curL < NON_CHAR) { L = "lig"; continue }
          mainK = f.bcharLabel!
          L = "lig1"; continue
        }
        if (mainJ.skip === 0) mainK++
        else { if (mainJ.skip >= STOP_FLAG) { L = "wrapup"; continue } mainK += mainJ.skip + 1 }
        L = "lig1"; continue
      }
      case "moveLig": { // main_loop_move_lig (§ 1037)
        const top = ligStack[0] as Extract<Item, { char: false }>
        const p = top.ptr
        if (p !== null) out.push(charNode(f, p))
        ligStack.shift()
        mainI = f.chars.get(curL); ligaturePresent = true
        if (ligStack.length === 0) {
          if (p !== null) { L = "lookahead"; continue }
          curR = bchar
        } else curR = ligStack[0].c
        L = "lig"; continue
      }
    }
  }
}

/** \/ (§ 1113): an explicit kern of the italic correction of a final character or ligature. */
export function appendItalicCorrection(out: Node[], fontOf: (name: string, size: number) => Font): void {
  const tail = out[out.length - 1]
  if (!tail || tail.kind !== "char") return
  const m = fontOf(tail.font, tail.size).chars.get(tail.char)
  out.push({ kind: "kern", width: m?.italic ?? 0, explicit: true })
}
