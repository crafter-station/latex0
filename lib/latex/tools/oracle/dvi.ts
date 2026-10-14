// DVI reader → normalized position trace. Zero dependencies.
// Spec: dvitype.web (DVI format, §§ 1–30 of "The DVI file format"). With TeX's
// num/den/mag (25400000/473628672, 1000) one DVI unit is exactly 1 sp, so the
// trace is in scaled points with no rounding.

import { scaled, type Tfm } from "./tfm"

export interface TraceGlyph { font: string; size: number; char: number; h: number; v: number; width: number }
export interface TraceRule { h: number; v: number; width: number; height: number }
export interface TracePage { counts: number[]; glyphs: TraceGlyph[]; rules: TraceRule[]; specials: string[] }
export interface Trace { unit: "sp"; mag: number; pages: TracePage[] }

export type FontLoader = (name: string) => Tfm

const SP_NUM = 25400000, SP_DEN = 473628672

export function parseDvi(buf: Uint8Array, loadFont: FontLoader): Trace {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let p = 0
  const u = (n: number) => { let x = 0; for (let i = 0; i < n; i++) x = x * 256 + buf[p++]; return x }
  const s = (n: number) => { const x = u(n); const lim = 2 ** (8 * n - 1); return x >= lim ? x - 2 * lim : x }
  const i32 = () => { const x = dv.getInt32(p); p += 4; return x }

  if (buf[p++] !== 247 || buf[p++] !== 2) throw new Error("not a DVI file (id 2)")
  const num = i32(), den = i32(), mag = i32()
  if (num !== SP_NUM || den !== SP_DEN) throw new Error(`unexpected DVI units ${num}/${den}`)
  const k = u(1); p += k // comment (note: `p += u(1)` would read p before u advances it)

  interface Font { name: string; size: number; tfm: Tfm; widths: Map<number, number> }
  const fonts = new Map<number, Font>()
  const defineFont = (k: number) => {
    p += 4 // checksum (verified implicitly by widths)
    const size = i32()
    p += 4 // design size
    const a = u(1), l = u(1)
    const name = new TextDecoder().decode(buf.subarray(p + a, p + a + l)); p += a + l
    if (fonts.has(k)) return
    const tfm = loadFont(name)
    const widths = new Map<number, number>()
    for (const [c, ch] of tfm.chars) widths.set(c, scaled(ch.width, size))
    fonts.set(k, { name, size, tfm, widths })
  }

  const trace: Trace = { unit: "sp", mag, pages: [] }
  let page: TracePage | null = null
  let h = 0, v = 0, w = 0, x = 0, y = 0, z = 0
  const stack: number[][] = []
  let f: Font | undefined

  const glyph = (c: number, move: boolean) => {
    if (!f || !page) throw new Error("glyph outside page or without font")
    const width = f.widths.get(c)
    if (width === undefined) throw new Error(`char ${c} missing in ${f.name}`)
    page.glyphs.push({ font: f.name, size: f.size, char: c, h, v, width })
    if (move) h += width
  }
  const rule = (move: boolean) => {
    const height = i32(), width = i32()
    if (page && height > 0 && width > 0) page.rules.push({ h, v, width, height })
    if (move) h += width
  }

  for (;;) {
    const op = buf[p++]
    if (op <= 127) { glyph(op, true); continue }
    if (op >= 171 && op <= 234) { f = fonts.get(op - 171); continue }
    switch (op) {
      case 128: case 129: case 130: case 131: glyph(u(op - 127), true); break
      case 132: rule(true); break
      case 133: case 134: case 135: case 136: glyph(u(op - 132), false); break
      case 137: rule(false); break
      case 138: break
      case 139: {
        const counts = Array.from({ length: 10 }, () => i32()); p += 4
        page = { counts, glyphs: [], rules: [], specials: [] }
        h = v = w = x = y = z = 0; stack.length = 0
        break
      }
      case 140: if (page) trace.pages.push(page); page = null; break
      case 141: stack.push([h, v, w, x, y, z]); break
      case 142: [h, v, w, x, y, z] = stack.pop()!; break
      case 143: case 144: case 145: case 146: h += s(op - 142); break
      case 147: h += w; break
      case 148: case 149: case 150: case 151: w = s(op - 147); h += w; break
      case 152: h += x; break
      case 153: case 154: case 155: case 156: x = s(op - 152); h += x; break
      case 157: case 158: case 159: case 160: v += s(op - 156); break
      case 161: v += y; break
      case 162: case 163: case 164: case 165: y = s(op - 161); v += y; break
      case 166: v += z; break
      case 167: case 168: case 169: case 170: z = s(op - 166); v += z; break
      case 235: case 236: case 237: case 238: f = fonts.get(u(op - 234)); break
      case 239: case 240: case 241: case 242: {
        const k = u(op - 238); const text = new TextDecoder().decode(buf.subarray(p, p + k)); p += k
        page?.specials.push(text); break
      }
      case 243: case 244: case 245: case 246: defineFont(u(op - 242)); break
      case 248: return trace // postamble: all pages read
      default: throw new Error(`DVI opcode ${op} at ${p - 1}`)
    }
  }
}
