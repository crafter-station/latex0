// TeX Font Metric (TFM) reader. Zero dependencies. Dev tooling: the engine
// itself consumes generated metrics data, never .tfm files (issue #42).
// Spec: "TeX: The Program" §§ 539–576 and tftopl.web.

import type { FixWordFont } from "../../layout/font"
export { scaled } from "../../layout/arith"

export type Tfm = FixWordFont

export function parseTfm(buf: Uint8Array, name = ""): Tfm {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const half = (i: number) => dv.getUint16(i * 2)
  const [lf, lh, bc, ec, nw, nh, nd, ni, nl, nk, ne, np] = Array.from({ length: 12 }, (_, i) => half(i))
  if (lf * 4 !== buf.byteLength) throw new Error(`TFM length mismatch: lf=${lf} bytes=${buf.byteLength}`)
  if (lf !== 6 + lh + (ec - bc + 1) + nw + nh + nd + ni + nl + nk + ne + np) throw new Error("TFM header inconsistent")

  const word = (w: number) => dv.getInt32(w * 4)
  const uword = (w: number) => dv.getUint32(w * 4)
  let p = 6
  const header = p; p += lh
  const charInfo = p; p += ec - bc + 1
  const widthBase = p; p += nw
  const heightBase = p; p += nh
  const depthBase = p; p += nd
  const italicBase = p; p += ni
  const ligBase = p; p += nl
  const kernBase = p; p += nk
  p += ne
  const paramBase = p

  const chars: Tfm["chars"] = new Map()
  for (let c = bc; c <= ec; c++) {
    const ci = (charInfo + (c - bc)) * 4
    const b0 = buf[ci], b1 = buf[ci + 1], b2 = buf[ci + 2], b3 = buf[ci + 3]
    if (b0 === 0) continue // width index 0 = char absent
    chars.set(c, {
      width: word(widthBase + b0),
      height: word(heightBase + (b1 >> 4)),
      depth: word(depthBase + (b1 & 15)),
      italic: word(italicBase + (b2 >> 2)),
      tag: b2 & 3,
      remainder: b3,
    })
  }
  return {
    name,
    checksum: uword(header),
    designSize: word(header + 1),
    chars,
    ligKern: Array.from({ length: nl }, (_, i) => uword(ligBase + i)),
    kerns: Array.from({ length: nk }, (_, i) => word(kernBase + i)),
    params: [0, ...Array.from({ length: np }, (_, i) => word(paramBase + i))],
  }
}
