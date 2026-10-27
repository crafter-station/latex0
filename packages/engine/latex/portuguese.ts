// portuges.ldf (babel-portuges 1.2u), the main language portuguese, portuges, brazil or brazilian (#63): what it
// changes beyond its captions and date (babel.ts): the shorthands of its active ", while it is selected. (\- and \ord
// are not modeled.)

import type { ClassOptionData, SizeCommand } from "../layout/classdata"
import { Scanner } from "../layout/dimen"
import { QUAD, X_HEIGHT, type Font } from "../layout/font"
import { glue, penalty, type Node } from "../layout/nodes"
import { hpack } from "../layout/pack"
import { mlistToHlist, TEXT } from "../mathlayout/mlist"
import { appendText } from "./encodings"
import { mathEnv, parseFormula } from "./paragraph"
import { Unsupported } from "./unsupported"

/** portuges.ldf's shorthands are on: the language selected is one of its options (\extras<lang>) */
export const isPortuguese = (lang: string) => ["portuguese", "portuges", "brazil", "brazilian"].includes(lang)

/** a shorthand: "" (\hskip\z@skip), "- (\nobreak-\bbl@allowhyphens), "< and "> (\textormath{\guillemotleft}…) */
export type PortugueseShorthand = { kind: "babelskip" } | { kind: "babelhyphen" } | { kind: "guillemet"; right: boolean; quoting: false }

/** portuges.ldf's " at two characters (the others, "| and an undeclared ", are not modeled) */
export function portugueseShorthand(two: string): PortugueseShorthand {
  if (two === '""') return { kind: "babelskip" }
  if (two === '"-') return { kind: "babelhyphen" }
  if (two === '"<' || two === '">') return { kind: "guillemet", right: two === '">', quoting: false }
  throw new Unsupported(`portuges.ldf's shorthand ${two}`)
}

/** "-: \nobreak-\bbl@allowhyphens (the hyphen's discretionary after it, in a paragraph) */
export function portugueseHyphen(font: Font, state: { spaceFactor: number }, paragraph: boolean): Node[] {
  const out: Node[] = [penalty(10000)]
  appendText(out, "-", font, state, paragraph)
  out.push(penalty(10000), glue(0))
  return out
}

/**
 * babel's \guillemotleft and \guillemotright in OT1: \save@sf@q{\nobreak\raise.2ex\hbox{$\scriptscriptstyle\ll$}
 * \bbl@allowhyphens} (\gg; the space factor stays); in T1 the character, alone.
 */
export function babelGuillemet(right: boolean, enc: string, k: ClassOptionData, size: SizeCommand, font: Font, state: { spaceFactor: number }, amsmath: boolean): Node[] {
  if (enc === "T1") { const l: Node[] = []; appendText(l, right ? "»" : "«", font, state, false); return l }
  const formula = mlistToHlist(parseFormula(right ? "\\scriptscriptstyle\\gg" : "\\scriptscriptstyle\\ll", amsmath, font.params[QUAD]), mathEnv(k, size, amsmath), TEXT, false)
  const box = hpack([{ kind: "math", on: true, width: 0 }, ...formula, { kind: "math", on: false, width: 0 }])
  box.shift = -new Scanner(".2ex", { em: font.params[QUAD], ex: font.params[X_HEIGHT] }).scanDimen().value
  return [penalty(10000), box, penalty(10000), glue(0)]
}
