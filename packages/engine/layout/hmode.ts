// Horizontal-mode list building for character text (§§ 1030–1044): words become
// lig/kern runs, spaces become interword glue adjusted by the space factor.

import { texRound, xnOverD } from "./arith"
import { EXTRA_SPACE, SLANT, SPACE, SPACE_SHRINK, SPACE_STRETCH, X_HEIGHT, type Font } from "./font"
import { appendRun } from "./mainloop"
import { charNode, glue, type Node } from "./nodes"
import { hpack } from "./pack"

/** \sfcode table as set by LaTeX's \nonfrenchspacing (plain.tex / latex.ltx). */
export function sfCode(c: number): number {
  // uppercase letters: A–Z and (latex.ltx, 8-bit) "80–"9C and "C0–"DF
  if (c >= 65 && c <= 90 || c >= 0x80 && c <= 0x9c || c >= 0xc0 && c <= 0xdf) return 999
  switch (String.fromCharCode(c)) {
    case ")": case "'": case "]": return 0
    case ".": case "?": case "!": return 3000
    case ":": return 2000
    case ";": return 1500
    case ",": return 1250
    default: return 1000
  }
}

/** Interword glue for the current space factor (§§ 1041–1044). */
export function spaceGlue(font: Font, sf: number): Node {
  const w = font.params[SPACE], st = font.params[SPACE_STRETCH], sh = font.params[SPACE_SHRINK]
  if (sf === 1000) return glue(w, st, 0, sh, 0)
  return glue(
    sf >= 2000 ? w + font.params[EXTRA_SPACE] : w,
    xnOverD(st, sf, 1000), 0,
    xnOverD(sh, 1000, sf), 0,
  )
}

/** \hyphenchar of every font (LaTeX's \defaulthyphenchar). */
export const HYPHEN_CHAR = 45

/**
 * Append `text` (already tokenized: one space between words) to `list`. Each
 * word goes through TeX's main loop (§§ 1034–1040); in a paragraph (unrestricted
 * horizontal mode) an explicit hyphen gets an empty discretionary.
 */
export function appendText(list: Node[], text: string, font: Font, state: { spaceFactor: number; /** \sfcode changes in force */ sfcodes?: Record<number, number> }, paragraph = true, hyphenChar = font.hyphenChar ?? HYPHEN_CHAR) {
  let run: number[] = []
  const flush = () => {
    if (!run.length) return
    appendRun(list, run, font, { paragraph, hyphenChar })
    run = []
  }
  for (const ch of text) {
    if (ch === " ") {
      flush()
      list.push(spaceGlue(font, state.spaceFactor))
      continue
    }
    const c = ch.codePointAt(0)!
    run.push(c)
    const s = state.sfcodes?.[c] ?? sfCode(c) // adjust_space_factor (§ 1034)
    if (s === 1000) state.spaceFactor = 1000
    else if (s < 1000) { if (s > 0) state.spaceFactor = s }
    else if (state.spaceFactor < 1000) state.spaceFactor = 1000
    else state.spaceFactor = s
  }
  flush()
}

/**
 * \accent a followed by the character `base` (make_accent, §§ 1123–1125): the accent shifted to the base's
 * height when that is not the x-height, between kerns that center it over the base (corrected by the font's
 * slant), then the base. Space factor 1000 after it.
 */
export function makeAccent(list: Node[], f: Font, a: number, base: number, state: { spaceFactor: number }) {
  const p = charNode(f, a), q = charNode(f, base)
  const x = f.params[X_HEIGHT], s = Math.floor(f.params[SLANT] / 16) / 65536 // (slant(f): the TFM's fix_word in sp)
  const h = q.height
  let acc: Node = p
  if (h !== x) { acc = hpack([p]); acc.shift = x - h }
  const delta = texRound((q.width - p.width) / 2 + h * s - x * s)
  list.push({ kind: "kern", width: delta, accent: true }, acc, { kind: "kern", width: -p.width - delta, accent: true }, q)
  state.spaceFactor = 1000
}
