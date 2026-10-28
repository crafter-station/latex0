// babel-german (2.x, babel-german.def) for german (1901 spelling) and ngerman (1996), #338: what it changes beyond
// its captions and date (babel.ts) while selected: \umlautlow (encodings.ts: OT1's \"a \"o \"u lowered), \frenchspacing,
// and the shorthands of its active ".

import type { SizeCommand, ClassOptionData } from "../layout/classdata"
import { Scanner } from "../layout/dimen"
import { QUAD, X_HEIGHT, type Font } from "../layout/font"
import { appendText as appendCodes } from "../layout/hmode"
import { charNode, glue, kern, penalty, type Node } from "../layout/nodes"
import { hpack } from "../layout/pack"
import { appendText } from "./encodings"
import { Unsupported } from "./unsupported"

/** german and ngerman (\extrasgerman, \extrasngerman) */
export const isGerman = (lang: string) => lang === "german" || lang === "ngerman"

/** the document's fonts are T1's: babel's "` and "' (german's \quotedblbase, \textquotedblleft) and "< and "> (german's and
 *  portuges.ldf's \guillemetleft and \guillemetright) are characters there, in the run */
export const germanT1 = { on: false }

/** a shorthand that makes nodes: "- "= "~ "" "| "/ and OT1's quotes "` "' */
export type GermanShorthand = { kind: "deshort"; sh: string }

/**
 * german's " at two characters: text ("a "o "u "A "O "U "e "E "I as \"{…}, "i as \"{\i}, "s and "z \ss, "S SS, "Z SZ;
 * ngerman's "c "f "l "m "n "p "r "t and capitals their letters), a guillemet ("< "> \flqq \frqq), or nodes. german's
 * (1901) "c "f … (\discretionary) and ": "* "_ "x are not modeled.
 */
export function germanShorthand(two: string, lang: string): string | GermanShorthand | { kind: "guillemet"; right: boolean; quoting: false } {
  const c = two[1] ?? ""
  if ("aouAOUeEI".includes(c) && c) return `${c}̈`
  if (c === "i") return "ï"
  if (c === "s" || c === "z") return "ß"
  if (c === "S") return "SS"
  if (c === "Z") return "SZ"
  if (c === "<" || c === ">") return germanT1.on ? (c === "<" ? "«" : "»") : { kind: "guillemet", right: c === ">", quoting: false } // (T1's \guillemetleft: in the run)
  if (c && "cflmnprtCFLMNPRT".includes(c)) {
    if (lang !== "ngerman") throw new Unsupported(`german's shorthand ${two} (a \\discretionary in 1901 spelling)`)
    return c === "c" || c === "C" ? c : c + c // (\bbl@german@disc's #3)
  }
  if ((c === "`" || c === "'") && germanT1.on) return c === "`" ? "„" : "“"
  if (c && "-=~\"|/`'".includes(c)) return { kind: "deshort", sh: c }
  throw new Unsupported(`german's shorthand ${two}`)
}

/**
 * german's "- "= "~ "" "| "/ (\bbl@german@allowhyphenationbefore, \nobreak, then \-, -, \mbox{-}, \discretionary{}{}{},
 * \discretionary{-}{}{\kern.03em} or / and \discretionary{}{}{}, then \bbl@german@allowhyphenationafter, \nobreak\hskip
 * \z@skip), and "` "' (\glqq: \quotedblbase, \grqq), as nodes
 */
export function germanShorthandNodes(sh: string, enc: string, k: ClassOptionData, size: SizeCommand, font: Font, state: { spaceFactor: number }, paragraph: boolean, atStart: boolean): Node[] {
  const out: Node[] = []
  const em = (x: string) => new Scanner(x, { em: font.params[QUAD], ex: font.params[X_HEIGHT] }).scanDimen().value
  if (sh === "`" || sh === "'") {
    if (enc !== "OT1") throw new Unsupported(`german's "${sh} in ${enc}`)
    const saved = state.spaceFactor // (\save@sf@q)
    if (sh === "'") { // \grqq: \kern-.07em\textquotedblleft\kern.07em
      out.push(kern(-em(".07em"), true)); appendCodes(out, String.fromCharCode(92), font, state, paragraph); out.push(kern(em(".07em"), true))
    } else { // \glqq, \quotedblbase: \set@low@box{\textquotedblright\/}\box\z@\kern-.04em\bbl@allowhyphens
      const q = charNode(font, 34), comma = font.chars.get(44)!
      const inner = hpack([q, kern(font.chars.get(34)!.italic, true)])
      inner.shift = inner.height - comma.height
      const low = hpack([inner]); low.height = comma.height; low.depth = comma.depth
      out.push(low, kern(-em(".04em"), true), penalty(10000), glue(0))
    }
    state.spaceFactor = saved
    return out
  }
  if (atStart) throw new Unsupported(`german's "${sh} starting a paragraph`) // (\ifvmode: no \nobreak)
  out.push(penalty(10000))
  const hyphen = font.hyphenChar ?? 45
  if (sh === "-") out.push({ kind: "disc", pre: [charNode(font, hyphen)], post: [], replaceCount: 0 })
  else if (sh === "=") appendText(out, "-", font, state, paragraph)
  else if (sh === "~") { const l: Node[] = []; appendText(l, "-", font, { spaceFactor: 1000 }, false); out.push(hpack(l)) }
  else if (sh === "\"") out.push({ kind: "disc", pre: [], post: [], replaceCount: 0 })
  else if (sh === "|") out.push({ kind: "disc", pre: [charNode(font, 45)], post: [], replaceCount: 1 }, kern(em(".03em"), true))
  else { appendText(out, "/", font, state, paragraph); out.push({ kind: "disc", pre: [], post: [], replaceCount: 0 }) }
  out.push(penalty(10000), glue(0))
  return out
}
