// TeX Font Metric (TFM) reader. Zero dependencies.
// Spec: "TeX: The Program" §§ 539–576 and tftopl.web. Dimensions are fix_words
// (signed, 20 fractional bits, in units of the design size). `scaled()` converts
// a fix_word to scaled points for a font loaded at size `s` sp using TeX's own
// integer algorithm (§ 571–572 store_scaled), so results are bit-exact.

export interface TfmChar {
  width: number // fix_word
  height: number
  depth: number
  italic: number
  tag: number // 0 none, 1 lig/kern, 2 list (next larger), 3 extensible
  remainder: number
}

export interface Tfm {
  checksum: number
  designSize: number // fix_word (pt * 2^20)
  bc: number
  ec: number
  chars: Map<number, TfmChar>
  ligKern: number[] // raw 4-byte instructions packed as uint32
  kerns: number[] // fix_words
  params: number[] // fix_words, params[1..np] (index 0 unused)
}

export function parseTfm(buf: Uint8Array): Tfm {
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

  const chars = new Map<number, TfmChar>()
  for (let c = bc; c <= ec; c++) {
    const ci = charInfo + (c - bc)
    const b0 = buf[ci * 4], b1 = buf[ci * 4 + 1], b2 = buf[ci * 4 + 2], b3 = buf[ci * 4 + 3]
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
    checksum: uword(header),
    designSize: word(header + 1),
    bc, ec, chars,
    ligKern: Array.from({ length: nl }, (_, i) => uword(ligBase + i)),
    kerns: Array.from({ length: nk }, (_, i) => word(kernBase + i)),
    params: [0, ...Array.from({ length: np }, (_, i) => word(paramBase + i))],
  }
}

/** Convert a fix_word to sp for a font at size `s` sp — TeX § 572, bit-exact. */
export function scaled(fix: number, s: number): number {
  let z = s
  let alpha = 16
  while (z >= 0o40000000) { z = Math.floor(z / 2); alpha += alpha }
  const beta = Math.floor(256 / alpha)
  alpha *= z
  const u = fix >>> 0
  const a = u >>> 24, b = (u >>> 16) & 255, c = (u >>> 8) & 255, d = u & 255
  const sw = Math.floor((Math.floor((Math.floor((d * z) / 256) + c * z) / 256) + b * z) / beta)
  if (a === 0) return sw
  if (a === 255) return sw - alpha
  throw new Error(`bad fix_word ${fix}`)
}
