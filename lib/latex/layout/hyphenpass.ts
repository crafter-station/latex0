// Hyphenating the words of a paragraph during the second pass of the line
// breaker: finding the word after a glue (§§ 894–899), Liang's patterns
// (hyphenate.ts), and reconstituting ligatures and kerns around each
// discretionary hyphen (§§ 903–918). Integer-exact, node-for-node.
//
// Fonts with a boundary character (bchar_label, font_bchar) are not supported
// yet; Computer Modern text fonts have none. Such a font throws.

import type { Font } from "./font"
import { lcCode, type Hyphenator } from "./hyphenate"
import { HYPHEN_CHAR } from "./hmode"
import type { CharNode, DiscNode, KernNode, Node } from "./nodes"

const NON_CHAR = 256
const STOP_FLAG = 128, KERN_FLAG = 128

export interface HyphenContext {
  hyphenator: Hyphenator
  fontOf: (name: string, size: number) => Font
  lHyf: number
  rHyf: number
  ucHyph: number
}

const isLigature = (n: CharNode) => n.text.length !== 1 || n.text.charCodeAt(0) !== n.char
const odd = (x: number) => (x & 1) === 1
const fontKey = (n: CharNode) => `${n.font}@${n.size}`

function charNode(f: Font, c: number, text = String.fromCharCode(c)): CharNode {
  const m = f.chars.get(c)
  if (!m) throw new Error(`char ${c} missing in ${f.name}`)
  return { kind: "char", font: f.name, size: f.size, char: c, width: m.width, height: m.height, depth: m.depth, text }
}

/** Hyphenate the word that follows the glue at list[k], in place (§ 894). */
export function hyphenateFollowingWord(list: Node[], k: number, ctx: HyphenContext): void {
  // § 894: skip to the first letter
  let prevS = k
  let s = k + 1
  let hf: Font | null = null
  let hfKey = ""
  for (;;) {
    const n = list[s]
    if (!n) return
    let c: number
    if (n.kind === "char") {
      if (isLigature(n)) { if (n.text.length === 0) { prevS = s; s++; continue } c = n.text.charCodeAt(0) }
      else c = n.char
      hf = ctx.fontOf(n.font, n.size); hfKey = fontKey(n)
    } else if (n.kind === "kern" && !n.explicit) { prevS = s; s++; continue }
    else return // done1
    const lc = lcCode(c)
    if (lc !== 0) { if (lc === c || ctx.ucHyph > 0) break; else return }
    prevS = s; s++
  }
  // done2
  const hyfChar = HYPHEN_CHAR
  const font = hf!
  if (font.chars.size && boundaryChar(font) !== null) throw new Error(`${font.name}: fonts with a boundary character are not supported yet`)
  const ha = prevS

  // § 896: collect letters into hu/hc up to hb
  if (ctx.lHyf + ctx.rHyf > 63) return
  const hu: number[] = [0], hc: number[] = [0]
  let hn = 0, hb = -1
  let hyfBchar = NON_CHAR
  for (;;) {
    const n = list[s]
    if (n && n.kind === "char" && !isLigature(n)) {
      if (fontKey(n) !== hfKey) break
      hyfBchar = n.char
      const lc = lcCode(n.char)
      if (lc === 0) break
      if (hn === 63) break
      hb = s; hn++; hu[hn] = n.char; hc[hn] = lc; hyfBchar = NON_CHAR
    } else if (n && n.kind === "char") { // § 898 ligature
      if (fontKey(n) !== hfKey) break
      let j = hn
      if (n.text.length) hyfBchar = n.text.charCodeAt(0)
      let ok = true
      for (const ch of n.text) {
        const c = ch.charCodeAt(0), lc = lcCode(c)
        if (lc === 0 || j === 63) { ok = false; break }
        j++; hu[j] = c; hc[j] = lc
      }
      if (!ok) break
      hb = s; hn = j; hyfBchar = NON_CHAR // no right boundary in fonts without bchar
    } else if (n && n.kind === "kern" && !n.explicit) { hb = s; hyfBchar = NON_CHAR }
    else break
    s++
  }
  // § 899: what follows must permit hyphenation
  if (hn < ctx.lHyf + ctx.rHyf) return
  for (;;) {
    const n = list[s]
    if (!n) return
    if (n.kind === "char") { s++; continue }
    if (n.kind === "kern") { if (n.explicit) break; s++; continue }
    if (n.kind === "glue" || n.kind === "penalty") break
    return // boxes, rules, discretionaries: no hyphenation
  }

  // § 923: patterns
  const hyf = ctx.hyphenator.hyf(hc, ctx.lHyf, ctx.rHyf)
  let any = false
  for (let j = ctx.lHyf; j <= hn - ctx.rHyf; j++) if (odd(hyf[j])) { any = true; break }
  if (!any) return

  // § 903: replace nodes ha..hb with the reconstituted word
  const haNode = list[ha]
  let start: number, j0: number
  let initList: number[] = [], initLig = false
  if (haNode.kind === "char" && !isLigature(haNode)) {
    if (fontKey(haNode) !== hfKey) { start = ha + 1; j0 = 0; hu[0] = NON_CHAR }
    else { initList = [haNode.char]; hu[0] = haNode.char; start = ha; j0 = 0 }
  } else if (haNode.kind === "char") {
    if (fontKey(haNode) !== hfKey) { start = ha + 1; j0 = 0; hu[0] = NON_CHAR }
    else { initList = [...haNode.text].map((c) => c.charCodeAt(0)); initLig = true; hu[0] = haNode.char; start = ha; j0 = 0 }
  } else { start = ha + 1; j0 = 1 }

  const r = new Reconstitutor(font, hu, hyf, initList, initLig)
  const bchar = hyfBchar
  const result: Node[] = []
  let j = j0, l: number
  do {
    l = j
    j = r.run(j, hn, bchar, hyfChar) + 1
    if (r.hyphenPassed === 0) {
      result.push(...r.hold)
      if (odd(hyf[j - 1])) { l = j; r.hyphenPassed = j - 1; r.hold = [] }
    }
    if (r.hyphenPassed > 0) {
      // § 914: a discretionary, developing both branches until they agree
      do {
        const major: Node[] = [...r.hold]
        let rCount = major.length
        let i = r.hyphenPassed
        hyf[i] = 0
        // § 915: pre-break: hu[l..i] and a hyphen
        const pre: Node[] = []
        const hasHyf = font.chars.has(hyfChar)
        let saved = 0
        if (hasHyf) { i++; saved = hu[i]; hu[i] = hyfChar }
        while (l <= i) { l = r.run(l, i, NON_CHAR, NON_CHAR) + 1; pre.push(...r.hold) }
        if (hasHyf) { hu[i] = saved; l = i; i-- }
        // § 916: post-break: hu[i+1..], until synchronized with the main branch
        const post: Node[] = []
        while (l < j) {
          do { l = r.run(l, hn, bchar, NON_CHAR) + 1; post.push(...r.hold) } while (l < j)
          while (l > j) { // § 917
            j = r.run(j, hn, bchar, NON_CHAR) + 1
            major.push(...r.hold); rCount += r.hold.length
          }
        }
        // § 918
        if (rCount > 127) result.push(...major)
        else { const d: DiscNode = { kind: "disc", pre, post, replaceCount: rCount }; result.push(d, ...major) }
        r.hyphenPassed = j - 1; r.hold = []
      } while (odd(hyf[j - 1]))
    }
  } while (j <= hn)
  list.splice(start, hb - start + 1, ...result)
}

function boundaryChar(f: Font): number | null {
  // A TFM boundary character is declared by a first lig/kern instruction with skip_byte = 255 (§ 545).
  if (!f.ligKern.length) return null
  const first = f.ligKern[0]
  return first >>> 24 === 255 ? (first >>> 16) & 255 : null
}

interface LigItem { char: number; ptr: number | null }

/** reconstitute (§§ 905–911) over hu[], with TeX's cursor and ligature-stack logic. */
class Reconstitutor {
  hyphenPassed = 0
  hold: Node[] = []
  constructor(private f: Font, private hu: number[], private hyf: number[], private initList: number[], private initLig: boolean) {}

  run(jIn: number, n: number, bcharIn: number, hcharIn: number): number {
    const { f, hu, hyf } = this
    let j = jIn, bchar = bcharIn, hchar = hcharIn
    this.hyphenPassed = 0
    const out: Node[] = []
    let w = 0
    let ligaturePresent = false
    let curQ: number
    let curL = hu[j]
    let curR = NON_CHAR, curRh = NON_CHAR
    const lig: LigItem[] = [] // top = last
    const append = (c: number) => out.push(charNode(f, c))
    const setCurR = () => { curR = j < n ? hu[j + 1] : bchar; curRh = odd(hyf[j]) ? hchar : NON_CHAR }
    const wrapLig = () => {
      if (!ligaturePresent) return
      const chars = out.splice(curQ) as CharNode[]
      out.push(charNode(f, curL, chars.map((c) => c.text).join("")))
      ligaturePresent = false
    }
    const popLig = () => {
      const top = lig.pop()!
      if (top.ptr !== null) { append(top.ptr); j++ }
      if (!lig.length) setCurR(); else curR = lig[lig.length - 1].char
    }

    // § 908
    curQ = out.length
    if (j === 0) { ligaturePresent = this.initLig; for (const c of this.initList) append(c) }
    else if (curL < NON_CHAR) append(curL)
    setCurR()

    main: for (;;) {
      // § 909
      done: {
        if (curL === NON_CHAR) break done // no boundary-char program
        const ci = f.chars.get(curL)
        if (!ci || ci.tag !== 1) break done
        let k = ci.remainder
        let q = decode(f.ligKern[k])
        if (q.skip > STOP_FLAG) { k = 256 * q.op + q.rem; q = decode(f.ligKern[k]) }
        const test = curRh < NON_CHAR ? curRh : curR
        for (;;) {
          if (q.next === test && q.skip <= STOP_FLAG) {
            if (curRh < NON_CHAR) { this.hyphenPassed = j; hchar = NON_CHAR; curRh = NON_CHAR; continue main }
            if (hchar < NON_CHAR && odd(hyf[j])) { this.hyphenPassed = j; hchar = NON_CHAR }
            if (q.op < KERN_FLAG) {
              // § 911: ligature replacement
              if (j === n && lig.length === 0) { /* rt_hit: only matters with boundary chars */ }
              switch (q.op) {
                case 1: case 5: curL = q.rem; ligaturePresent = true; break
                case 2: case 6:
                  curR = q.rem
                  if (lig.length) lig[lig.length - 1].char = curR
                  else { lig.push({ char: curR, ptr: j === n ? null : hu[j + 1] }); if (j === n) bchar = NON_CHAR }
                  break
                case 3: curR = q.rem; lig.push({ char: curR, ptr: null }); break
                case 7: case 11: wrapLig(); curQ = out.length; curL = q.rem; ligaturePresent = true; break
                default:
                  curL = q.rem; ligaturePresent = true
                  if (lig.length) popLig()
                  else if (j === n) break done
                  else { append(curR); j++; setCurR() }
              }
              if (q.op > 4 && q.op !== 7) break done
              continue main
            }
            w = f.kerns[256 * (q.op - KERN_FLAG) + q.rem]
            break done
          }
          if (q.skip >= STOP_FLAG) {
            if (curRh === NON_CHAR) break done
            curRh = NON_CHAR; continue main
          }
          k += q.skip + 1
          q = decode(f.ligKern[k])
        }
      }
      // § 910
      wrapLig()
      if (w !== 0) { const kn: KernNode = { kind: "kern", width: w }; out.push(kn); w = 0 }
      if (lig.length) { curQ = out.length; curL = lig[lig.length - 1].char; ligaturePresent = true; popLig(); continue main }
      break
    }
    this.hold = out
    return j
  }
}

function decode(w: number) {
  return { skip: w >>> 24, next: (w >>> 16) & 255, op: (w >>> 8) & 255, rem: w & 255 }
}
