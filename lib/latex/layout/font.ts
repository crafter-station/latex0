// Font metrics as the engine consumes them. The engine never reads font files:
// metrics arrive as data (generated JSON, issue #42) in TFM fix_word units and
// are scaled to a size here with TeX's exact algorithm.

import { scaled } from "./arith"

/** Unscaled metrics in TFM fix_word units, exactly as stored in a .tfm file. */
export interface FixWordFont {
  name: string
  checksum: number
  designSize: number
  chars: Map<number, { width: number; height: number; depth: number; italic: number; tag: number; remainder: number }>
  ligKern: number[] // 4-byte instructions packed big-endian into uint32
  kerns: number[]
  params: number[] // 1-based; params[0] unused
}

export interface CharMetrics { width: number; height: number; depth: number; italic: number; tag: number; remainder: number }

/** A font loaded at a size: every dimension in sp. */
export interface Font {
  name: string
  size: number
  chars: Map<number, CharMetrics>
  ligKern: number[]
  kerns: number[]
  params: number[]
  /** right boundary character (font_bchar), or 256 for none (§ 576) */
  bchar: number
  /** bchar when it is not a real character of the font, else 256 (font_false_bchar) */
  falseBchar: number
  /** start of the left boundary program in ligKern (bchar_label), or null */
  bcharLabel: number | null
}

/** Boundary-character data from a lig/kern program (§§ 573, 576). */
function boundaries(ligKern: number[], chars: Map<number, unknown>) {
  let bchar = 256, label: number | null = null
  if (ligKern.length) {
    const first = ligKern[0] >>> 0, last = ligKern[ligKern.length - 1] >>> 0
    if (first >>> 24 === 255) bchar = (first >>> 16) & 255
    if (last >>> 24 === 255) { const l = 256 * ((last >>> 8) & 255) + (last & 255); if (l < ligKern.length) label = l }
  }
  return { bchar, falseBchar: bchar < 256 && chars.has(bchar) ? 256 : bchar, bcharLabel: label }
}

export function loadFont(f: FixWordFont, size: number): Font {
  const chars = new Map<number, CharMetrics>()
  for (const [c, m] of f.chars) {
    chars.set(c, { width: scaled(m.width, size), height: scaled(m.height, size), depth: scaled(m.depth, size), italic: scaled(m.italic, size), tag: m.tag, remainder: m.remainder })
  }
  // Param 1 (slant) is a pure number and is not scaled (§ 575).
  const params = f.params.map((p, i) => (i <= 1 ? p : scaled(p, size)))
  return { name: f.name, size, chars, ligKern: f.ligKern, kerns: f.kerns.map((k) => scaled(k, size)), params, ...boundaries(f.ligKern, f.chars) }
}

// Named font parameters (§ 547).
export const SLANT = 1, SPACE = 2, SPACE_STRETCH = 3, SPACE_SHRINK = 4, X_HEIGHT = 5, QUAD = 6, EXTRA_SPACE = 7
