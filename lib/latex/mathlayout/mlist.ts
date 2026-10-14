// Math lists to horizontal lists: "TeX: The Program" §§ 719–767 (Appendix G),
// for character noads without scripts: mathcode classes (§ 1151), rule 5's bin
// demotion (§§ 728–729), make_ord's kerns and ligatures between characters of
// one family (§§ 749–753), the character node with its italic correction
// (§ 755), and the inter-atom spacing and penalties of the second pass
// (§§ 760–767). Scripts, fractions, radicals, operators and delimiters follow
// in #76–#80.

import { xnOverD } from "../layout/arith"
import type { GlueSpec } from "../layout/dimen"
import { QUAD, SPACE, type Font } from "../layout/font"
import { glue, kern, paramGlue, penalty, type CharNode, type Node } from "../layout/nodes"

export const ORD = 0, OP = 1, BIN = 2, REL = 3, OPEN = 4, CLOSE = 5, PUNCT = 6, INNER = 7
export type NoadType = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7

/** A noad whose nucleus is a math character (math_char or math_text_char). */
export interface CharNoad { noad: NoadType; fam: number; char: number; textChar?: boolean }
/** An mlist: noads, and plain nodes (kerns from make_ord, glue, penalties). */
export type MItem = CharNoad | Node

const isNoad = (x: MItem): x is CharNoad => "noad" in x

/** set_math_char (§ 1155): a mathcode becomes a noad; class 7 takes \\fam when it is a valid family. */
export function mathCharNoad(mathcode: number, fam = -1): CharNoad {
  if (mathcode >= 0x8000) throw new Error("active math character")
  const cls = mathcode >> 12
  const f = (mathcode >> 8) & 15
  return { noad: (cls === 7 ? ORD : cls) as NoadType, fam: cls === 7 && fam >= 0 && fam < 16 ? fam : f, char: mathcode & 255 }
}

export interface MathEnv {
  /** fonts of families 0–15 at the current size (fam_fnt(fam + cur_size)) */
  fonts: (Font | undefined)[]
  /** \\thinmuskip, \\medmuskip, \\thickmuskip in mu */
  muskips: { thinmuskip: GlueSpec; medmuskip: GlueSpec; thickmuskip: GlueSpec }
  binoppenalty: number
  relpenalty: number
  /** inline math in a paragraph (mlist_penalties, § 1194) */
  penalties: boolean
  /** cur_style < script_style */
  textStyle: boolean
  /** called for a character the font lacks (char_warning) */
  missing?: (fam: number, c: number) => void
}

// § 764: the spacing table, rows by the preceding noad's type, columns by this one
const MATH_SPACING = "02340001" + "22*40001" + "33**3**3" + "44*04004" + "00*00000" + "02340001" + "11*11111" + "12341011"

/** x_over_n (§ 106): quotient and remainder, truncating toward zero */
function xOverN(x: number, n: number): [number, number] {
  if (n === 0) throw new Error("x_over_n: division by zero")
  if (n < 0) { x = -x; n = -n }
  if (x >= 0) return [Math.floor(x / n), x % n]
  return [-Math.floor(-x / n), -((-x) % n)]
}

/** nx_plus_y (mult_and_add with max 2^30-1, § 105) */
function nxPlusY(n: number, x: number, y: number): number {
  if (n < 0) { x = -x; n = -n }
  if (n === 0) return y
  const max = 0o7777777777
  if (x <= Math.trunc((max - y) / n) && -x <= Math.trunc((max + y) / n)) return n * x + y
  throw new Error("arithmetic overflow in math glue")
}

/** math_glue (§ 716): mu glue to pt glue for a math unit m */
export function mathGlue(g: GlueSpec, m: number): GlueSpec {
  let [n, f] = xOverN(m, 0o200000)
  if (f < 0) { n--; f += 0o200000 }
  const mult = (x: number) => nxPlusY(n, x, xnOverD(x, f, 0o200000))
  return {
    width: mult(g.width),
    stretch: g.stretchOrder === 0 ? mult(g.stretch) : g.stretch, stretchOrder: g.stretchOrder,
    shrink: g.shrinkOrder === 0 ? mult(g.shrink) : g.shrink, shrinkOrder: g.shrinkOrder,
  }
}

/** mlist_to_hlist (§ 726) for an mlist of character noads in one style. */
export function mlistToHlist(mlist: MItem[], env: MathEnv): Node[] {
  const list = mlist.slice()
  const hl = new Map<CharNoad, Node[]>() // new_hlist(q)
  const fetch = (q: CharNoad) => { // § 722
    const f = env.fonts[q.fam]
    if (!f) throw new Error(`\\textfont ${q.fam} is undefined (character ${String.fromCharCode(q.char)})`)
    const m = f.chars.get(q.char)
    if (!m) env.missing?.(q.fam, q.char)
    return { f, m }
  }

  // first pass (§§ 727–755)
  let r: CharNoad | null = null
  let rType: NoadType = OP
  for (let i = 0; i < list.length; i++) {
    const q = list[i]
    if (!isNoad(q)) continue // nodes are done with (§ 730)
    if (q.noad === BIN && (rType === BIN || rType === OP || rType === REL || rType === OPEN || rType === PUNCT)) q.noad = ORD // § 729
    if ((q.noad === REL || q.noad === CLOSE || q.noad === PUNCT) && rType === BIN && r) r.noad = ORD
    if (q.noad === ORD) makeOrd(list, i, env)
    // § 755: the character node, with the italic correction as a kern
    const { f, m } = fetch(q)
    if (m) {
      let delta = m.italic
      const p: Node[] = [charNode(f, q.char)]
      if (q.textChar && f.params[SPACE] !== 0) delta = 0 // no italic correction in mid-word of a text font
      if (delta !== 0) p.push(kern(delta))
      hl.set(q, p)
    } else hl.set(q, [])
    r = q; rType = q.noad
  }
  if (rType === BIN && r) r.noad = ORD // § 729: a final bin

  // second pass (§§ 760–767)
  const out: Node[] = []
  const mu = xOverN(env.fonts[2]?.params[QUAD] ?? 0, 18)[0] // § 703: cur_mu = math_quad / 18
  let prev = -1 // r_type; -1 before the first noad
  for (let i = 0; i < list.length; i++) {
    const q = list[i]
    if (!isNoad(q)) { out.push(q); continue }
    const t = q.noad
    if (prev >= 0) {
      const code = MATH_SPACING[prev * 8 + t]
      const which = code === "1" ? (env.textStyle ? "thinmuskip" : null) : code === "2" ? "thinmuskip"
        : code === "3" ? (env.textStyle ? "medmuskip" : null) : code === "4" ? (env.textStyle ? "thickmuskip" : null) : null
      if (code === "*") throw new Error("mlist4: impossible noad sequence")
      if (which) { const g = mathGlue(env.muskips[which], mu); out.push(paramGlue(which, glue(g.width, g.stretch, g.stretchOrder, g.shrink, g.shrinkOrder))) }
    }
    out.push(...(hl.get(q) ?? []))
    const pen = t === BIN ? env.binoppenalty : t === REL ? env.relpenalty : 10000
    if (env.penalties && pen < 10000 && i + 1 < list.length) {
      const nx = list[i + 1]
      if (!(!isNoad(nx) && nx.kind === "penalty") && !(isNoad(nx) && nx.noad === REL)) out.push(penalty(pen))
    }
    prev = t
  }
  return out
}

function charNode(f: Font, c: number): CharNode {
  const m = f.chars.get(c)!
  return { kind: "char", font: f.name, size: f.size, char: c, width: m.width, height: m.height, depth: m.depth, text: String.fromCharCode(c) }
}

/** make_ord (§§ 749–753): kerns and ligatures between adjacent characters of one family. */
function makeOrd(list: MItem[], i: number, env: MathEnv) {
  for (;;) { // restart
    const q = list[i] as CharNoad
    const p = list[i + 1]
    // both nuclei must be math_char: a noad made by |=:|>> is math_text_char and does not combine
    if (q.textChar || !p || !isNoad(p) || p.textChar || p.noad > PUNCT || p.fam !== q.fam) return
    q.textChar = true
    const f = env.fonts[q.fam]
    const ci = f?.chars.get(q.char)
    if (!f || !ci || ci.tag !== 1) return
    let a = ci.remainder
    let w = f.ligKern[a] >>> 0
    if (w >>> 24 > 128) { a = 256 * ((w >>> 8) & 255) + (w & 255); w = f.ligKern[a] >>> 0 }
    for (;;) {
      const skip = w >>> 24, next = (w >>> 16) & 255, op = (w >>> 8) & 255, rem = w & 255
      if (next === p.char && skip <= 128) {
        if (op >= 128) { list.splice(i + 1, 0, kern(f.kerns[256 * (op - 128) + rem])); return }
        switch (op) {
          case 1: case 5: q.char = rem; break // =:|  =:|>
          case 2: case 6: p.char = rem; break // |=:  |=:>
          case 3: case 7: case 11: { // |=:|  |=:|>  |=:|>>
            const r: CharNoad = { noad: ORD, fam: q.fam, char: rem, ...(op === 11 ? { textChar: true } : {}) }
            list.splice(i + 1, 0, r)
            break
          }
          default: list.splice(i + 1, 1); q.char = rem // =:
        }
        if (op > 3) return
        q.textChar = false
        break // restart
      }
      if (skip >= 128) return
      a += skip + 1
      w = f.ligKern[a] >>> 0
    }
  }
}
