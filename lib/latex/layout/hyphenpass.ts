// Hyphenating the words of a paragraph during the second pass of the line
// breaker: finding the word after a glue (§§ 894–899), Liang's patterns
// (hyphenate.ts), and reconstituting ligatures and kerns around each
// discretionary hyphen (§§ 903–918). Integer-exact, node-for-node.
//
// Fonts with boundary characters (the EC fonts) are handled as TeX does: the
// font's right boundary after the word and the hyphen, its left boundary program
// at the start of a post-break, and ligatures that remember both (§§ 903–918).

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

const isLigature = (n: CharNode) => n.ligature === true || n.text.length !== 1 || n.text.charCodeAt(0) !== n.char
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
    } else if ((n.kind === "kern" && !n.explicit) || n.kind === "whatsit") { prevS = s; s++; continue }
    else return // done1: a formula, box, rule or glue
    const lc = lcCode(c)
    if (lc !== 0) { if (lc === c || ctx.ucHyph > 0) break; else return }
    prevS = s; s++
  }
  // done2
  const font = hf!
  const hyfChar = font.hyphenChar ?? HYPHEN_CHAR
  if (hyfChar < 0 || hyfChar > 255) return // done1
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
      hb = s; hn = j
      hyfBchar = odd(n.ligHits ?? 0) ? font.bchar : NON_CHAR
    } else if (n && n.kind === "kern" && !n.explicit) { hb = s; hyfBchar = font.bchar }
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
    if (n.kind === "glue" || n.kind === "penalty" || n.kind === "whatsit" || n.kind === "ins") break
    return // boxes, rules, discretionaries, formulas: no hyphenation
  }

  // § 923: patterns
  const hyf = ctx.hyphenator.hyf(hc, ctx.lHyf, ctx.rHyf)
  let any = false
  for (let j = ctx.lHyf; j <= hn - ctx.rHyf; j++) if (odd(hyf[j])) { any = true; break }
  if (!any) return

  // § 903: replace nodes ha..hb with the reconstituted word; hu[0] holds the punctuation before it
  // or a left boundary (256), and bchar a right boundary
  const haNode = list[ha]
  const bchar0 = hyfBchar
  let start: number, j0: number
  let initList: number[] = [], initLig = false, initLft = false
  const found2 = () => { start = ha + 1; j0 = 0; hu[0] = NON_CHAR; initLig = false; initList = [] }
  if (haNode.kind === "char" && !isLigature(haNode)) {
    if (fontKey(haNode) !== hfKey) found2()
    else { initList = [haNode.char]; hu[0] = haNode.char; start = ha; j0 = 0 }
  } else if (haNode.kind === "char") {
    if (fontKey(haNode) !== hfKey) found2()
    else {
      initList = [...haNode.text].map((c) => c.charCodeAt(0)); initLig = true; initLft = (haNode.ligHits ?? 0) > 1
      hu[0] = haNode.char
      if (!initList.length && initLft) { hu[0] = NON_CHAR; initLig = false } // a ligature made from scratch
      start = ha; j0 = 0
    }
  } else { // no punctuation: a left boundary ligature right after it is rebuilt from the boundary
    const r = list[ha + 1]
    if (r && r.kind === "char" && isLigature(r) && (r.ligHits ?? 0) > 1) found2()
    else { start = ha + 1; j0 = 1 }
  }

  const r = new Reconstitutor(font, hu, hyf, initList, initLig, initLft)
  const bchar = bchar0
  const result: Node[] = []
  let j = j0!, l: number
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
        // § 915: pre-break: hu[l..i] and a hyphen, with the font's right boundary after it
        const pre: Node[] = []
        const hasHyf = font.chars.has(hyfChar)
        let saved = 0
        if (hasHyf) { i++; saved = hu[i]; hu[i] = hyfChar }
        while (l <= i) { l = r.run(l, i, font.bchar, NON_CHAR) + 1; pre.push(...r.hold) }
        if (hasHyf) { hu[i] = saved; l = i; i-- }
        // § 916: post-break: hu[i+1..], with a left boundary at the start of the new line, until
        // synchronized with the main branch
        const post: Node[] = []
        let c = 0, cLoc = 0
        if (font.bcharLabel !== null) { l--; c = hu[l]; cLoc = l; hu[l] = NON_CHAR }
        while (l < j) {
          do {
            l = r.run(l, hn, bchar, NON_CHAR) + 1
            if (cLoc > 0) { hu[cLoc] = c; cLoc = 0 }
            post.push(...r.hold)
          } while (l < j)
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
  list.splice(start!, hb - start! + 1, ...result)
}

interface LigItem { char: number; ptr: number | null }

/** reconstitute (§§ 905–911) over hu[], with TeX's cursor and ligature-stack logic. */
class Reconstitutor {
  hyphenPassed = 0
  hold: Node[] = []
  /** lft_hit and rt_hit: global in TeX, so they carry from one call to the next */
  private lftHit = false
  private rtHit = false
  constructor(private f: Font, private hu: number[], private hyf: number[], private initList: number[], private initLig: boolean, private initLft: boolean) {}

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
    const wrapLig = (rt: boolean) => {
      if (!ligaturePresent) return
      const chars = out.splice(curQ) as CharNode[]
      const node: CharNode = { ...charNode(f, curL, chars.map((c) => c.text).join("")), ligature: true, ligHits: 0 }
      if (this.lftHit) { node.ligHits = 2; this.lftHit = false }
      if (rt && lig.length === 0) { node.ligHits!++; this.rtHit = false }
      out.push(node)
      ligaturePresent = false
    }
    const popLig = () => {
      const top = lig.pop()!
      if (top.ptr !== null) { append(top.ptr); j++ }
      if (!lig.length) setCurR(); else curR = lig[lig.length - 1].char
    }

    // § 908
    curQ = out.length
    if (j === 0) {
      ligaturePresent = this.initLig
      if (ligaturePresent) this.lftHit = this.initLft
      for (const c of this.initList) append(c)
    } else if (curL < NON_CHAR) append(curL)
    setCurR()

    main: for (;;) {
      // § 909
      done: {
        let k: number
        let q: ReturnType<typeof decode>
        if (curL === NON_CHAR) { // the left boundary's program
          if (f.bcharLabel === null) break done
          k = f.bcharLabel; q = decode(f.ligKern[k])
        } else {
          const ci = f.chars.get(curL)
          if (!ci || ci.tag !== 1) break done
          k = ci.remainder
          q = decode(f.ligKern[k])
          if (q.skip > STOP_FLAG) { k = 256 * q.op + q.rem; q = decode(f.ligKern[k]) }
        }
        const test = curRh < NON_CHAR ? curRh : curR
        for (;;) {
          if (q.next === test && q.skip <= STOP_FLAG) {
            if (curRh < NON_CHAR) { this.hyphenPassed = j; hchar = NON_CHAR; curRh = NON_CHAR; continue main }
            if (hchar < NON_CHAR && odd(hyf[j])) { this.hyphenPassed = j; hchar = NON_CHAR }
            if (q.op < KERN_FLAG) {
              // § 911: ligature replacement
              if (curL === NON_CHAR) this.lftHit = true
              if (j === n && lig.length === 0) this.rtHit = true
              switch (q.op) {
                case 1: case 5: curL = q.rem; ligaturePresent = true; break
                case 2: case 6:
                  curR = q.rem
                  if (lig.length) lig[lig.length - 1].char = curR
                  else { lig.push({ char: curR, ptr: j === n ? null : hu[j + 1] }); if (j === n) bchar = NON_CHAR }
                  break
                case 3: curR = q.rem; lig.push({ char: curR, ptr: null }); break
                case 7: case 11: wrapLig(false); curQ = out.length; curL = q.rem; ligaturePresent = true; break
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
      wrapLig(this.rtHit)
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
