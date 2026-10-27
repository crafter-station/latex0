// zlib's inflate (RFC 1950, RFC 1951): what a PDF's FlateDecode streams hold. The PDF reader (pdf.ts) needs it for
// the compressed object and cross-reference streams in which most PDF writers put a page's boxes. Stored, fixed
// and dynamic Huffman blocks; a bad stream throws, and the caller reports the file as one it cannot read.

/** A Huffman code as canonical code lengths give it: counts per length, symbols in code order */
interface Huffman { counts: Uint16Array; symbols: Uint16Array }

function huffman(lengths: ArrayLike<number>, n: number): Huffman {
  const counts = new Uint16Array(16), offs = new Uint16Array(16), symbols = new Uint16Array(n)
  for (let i = 0; i < n; i++) counts[lengths[i]]++
  counts[0] = 0
  for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + counts[i - 1]
  for (let i = 0; i < n; i++) if (lengths[i]) symbols[offs[lengths[i]]++] = i
  return { counts, symbols }
}

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]
const ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]

let fixed: { lit: Huffman; dist: Huffman } | null = null

/** The data a zlib stream holds (its header checked, its Adler-32 trailer not); bytes after its end are ignored */
export function inflate(src: Uint8Array): Uint8Array {
  if (src.length < 2 || (src[0] & 0x0f) !== 8 || ((src[0] << 8) | src[1]) % 31 !== 0 || src[1] & 0x20) throw new Error("not a zlib stream")
  let pos = 2, bitBuf = 0, bitCnt = 0
  let out = new Uint8Array(Math.max(1024, src.length * 4)), n = 0
  const need = (k: number) => {
    if (n + k <= out.length) return
    let size = out.length * 2
    while (size < n + k) size *= 2
    const grown = new Uint8Array(size); grown.set(out.subarray(0, n)); out = grown
  }
  const bits = (k: number): number => {
    while (bitCnt < k) {
      if (pos >= src.length) throw new Error("zlib stream ends early")
      bitBuf |= src[pos++] << bitCnt; bitCnt += 8
    }
    const v = bitBuf & ((1 << k) - 1)
    bitBuf >>>= k; bitCnt -= k
    return v
  }
  const decode = (h: Huffman): number => {
    let code = 0, first = 0, index = 0
    for (let len = 1; len < 16; len++) {
      code |= bits(1)
      const count = h.counts[len]
      if (code - count < first) return h.symbols[index + (code - first)]
      index += count; first += count; first <<= 1; code <<= 1
    }
    throw new Error("bad Huffman code")
  }
  for (let last = 0; !last;) {
    last = bits(1)
    const type = bits(2)
    if (type === 0) {
      bitBuf = 0; bitCnt = 0
      if (pos + 4 > src.length) throw new Error("zlib stream ends early")
      const len = src[pos] | (src[pos + 1] << 8), nlen = src[pos + 2] | (src[pos + 3] << 8)
      if (len !== (~nlen & 0xffff) || pos + 4 + len > src.length) throw new Error("bad stored block")
      need(len); out.set(src.subarray(pos + 4, pos + 4 + len), n); n += len; pos += 4 + len
      continue
    }
    let lit: Huffman, dist: Huffman
    if (type === 1) {
      if (!fixed) {
        const l = new Uint8Array(288)
        l.fill(8, 0, 144); l.fill(9, 144, 256); l.fill(7, 256, 280); l.fill(8, 280, 288)
        fixed = { lit: huffman(l, 288), dist: huffman(new Uint8Array(30).fill(5), 30) }
      }
      ({ lit, dist } = fixed)
    } else if (type === 2) {
      const nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4
      const lengths = new Uint8Array(320)
      for (let i = 0; i < ncode; i++) lengths[ORDER[i]] = bits(3)
      const lencode = huffman(lengths, 19)
      lengths.fill(0)
      for (let i = 0; i < nlen + ndist;) {
        const sym = decode(lencode)
        if (sym < 16) { lengths[i++] = sym; continue }
        let len = 0, rep: number
        if (sym === 16) { if (!i) throw new Error("bad length repeat"); len = lengths[i - 1]; rep = 3 + bits(2) }
        else if (sym === 17) rep = 3 + bits(3)
        else rep = 11 + bits(7)
        if (i + rep > nlen + ndist) throw new Error("bad length repeat")
        while (rep--) lengths[i++] = len
      }
      lit = huffman(lengths, nlen)
      dist = huffman(lengths.subarray(nlen), ndist)
    } else throw new Error("bad block type")
    for (;;) {
      const sym = decode(lit)
      if (sym < 256) { need(1); out[n++] = sym; continue }
      if (sym === 256) break
      const li = sym - 257
      if (li >= 29) throw new Error("bad length code")
      const len = LEN_BASE[li] + bits(LEN_EXTRA[li])
      const di = decode(dist)
      if (di >= 30) throw new Error("bad distance code")
      const d = DIST_BASE[di] + bits(DIST_EXTRA[di])
      if (d > n) throw new Error("distance too far back")
      need(len)
      for (let k = 0; k < len; k++, n++) out[n] = out[n - d]
    }
  }
  return out.slice(0, n)
}
