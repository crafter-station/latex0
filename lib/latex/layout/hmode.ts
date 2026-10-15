// Horizontal-mode list building for character text (§§ 1030–1044): words become
// lig/kern runs, spaces become interword glue adjusted by the space factor.

import { xnOverD } from "./arith"
import { EXTRA_SPACE, SPACE, SPACE_SHRINK, SPACE_STRETCH, type Font } from "./font"
import { appendRun } from "./mainloop"
import { glue, type Node } from "./nodes"

/** \sfcode table as set by LaTeX's \nonfrenchspacing (plain.tex / latex.ltx). */
export function sfCode(c: number): number {
  if (c >= 65 && c <= 90) return 999 // uppercase letters
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
export function appendText(list: Node[], text: string, font: Font, state: { spaceFactor: number }, paragraph = true, hyphenChar = font.hyphenChar ?? HYPHEN_CHAR) {
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
    const s = sfCode(c) // adjust_space_factor (§ 1034)
    if (s === 1000) state.spaceFactor = 1000
    else if (s < 1000) { if (s > 0) state.spaceFactor = s }
    else if (state.spaceFactor < 1000) state.spaceFactor = 1000
    else state.spaceFactor = s
  }
  flush()
}
