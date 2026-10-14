// Ligature/kern program interpreter for one run of characters in one font
// (§§ 1034–1040, tftopl.web "lig/kern programs"). Produces char nodes (with the
// source characters they stand for) interleaved with font kerns.
// Not yet handled: boundary characters (§ 1035), which Computer Modern text
// fonts do not use. Tracked under the glyph-runs issue.

import type { Font } from "./font"
import type { CharNode, KernNode } from "./nodes"

const STOP_FLAG = 128, KERN_FLAG = 128

interface Instr { skip: number; next: number; op: number; rem: number }
const decode = (w: number): Instr => ({ skip: w >>> 24, next: (w >>> 16) & 255, op: (w >>> 8) & 255, rem: w & 255 })

/** Find the lig/kern instruction for the pair (left, right), if any. */
function lookup(font: Font, left: number, right: number): Instr | null {
  const m = font.chars.get(left)
  if (!m || m.tag !== 1) return null
  let i = m.remainder
  let ins = decode(font.ligKern[i])
  if (ins.skip > STOP_FLAG) { i = 256 * ins.op + ins.rem; ins = decode(font.ligKern[i]) } // indirect start (§ 545)
  for (;;) {
    if (ins.next === right && ins.skip <= STOP_FLAG) return ins
    if (ins.skip >= STOP_FLAG) return null
    i += ins.skip + 1
    ins = decode(font.ligKern[i])
  }
}

export function ligKern(codes: number[], font: Font): (CharNode | KernNode)[] {
  const seq = codes.map((c) => ({ c, text: String.fromCharCode(c) }))
  const kernAfter = new Map<number, number>() // index in final seq -> kern width
  const out: (CharNode | KernNode)[] = []
  let k = 0
  while (k < seq.length) {
    if (k + 1 >= seq.length) { k++; continue }
    const ins = lookup(font, seq[k].c, seq[k + 1].c)
    if (!ins) { k++; continue }
    if (ins.op >= KERN_FLAG) {
      kernAfter.set(k, font.kerns[256 * (ins.op - KERN_FLAG) + ins.rem])
      k++
      continue
    }
    const lig = { c: ins.rem, text: "" }
    switch (ins.op) {
      case 0: lig.text = seq[k].text + seq[k + 1].text; seq.splice(k, 2, lig); break // =:
      case 1: lig.text = seq[k].text; seq[k] = lig; break // =:|
      case 5: lig.text = seq[k].text; seq[k] = lig; k++; break // =:|>
      case 2: lig.text = seq[k + 1].text; seq[k + 1] = lig; break // |=:
      case 6: lig.text = seq[k + 1].text; seq[k + 1] = lig; k++; break // |=:>
      case 3: seq.splice(k + 1, 0, lig); break // |=:|
      case 7: seq.splice(k + 1, 0, lig); k++; break // |=:|>
      case 11: seq.splice(k + 1, 0, lig); k += 2; break // |=:|>>
      default: throw new Error(`lig/kern: invalid op ${ins.op} in ${font.name}`)
    }
  }
  seq.forEach((s, i) => {
    const m = font.chars.get(s.c)
    if (!m) throw new Error(`char ${s.c} missing in ${font.name}`)
    out.push({ kind: "char", font: font.name, size: font.size, char: s.c, width: m.width, height: m.height, depth: m.depth, text: s.text })
    const kw = kernAfter.get(i)
    if (kw !== undefined) out.push({ kind: "kern", width: kw })
  })
  return out
}
