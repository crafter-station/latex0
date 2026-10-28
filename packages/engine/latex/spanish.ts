// spanish.ldf (babel-spanish 5.0q) with its defaults, as the main language (#63): what it changes beyond its
// captions and date (babel.ts). In text: OT1's \' and \~ end with \bbl@allowhyphens unless a space follows
// (\es@accent). Its layout (\layoutspanish): itemize's labels (\spanishsymbitems), enumerate's (\es@enumerate
// {1.}{a)}{1)}{a$'$}, with \theenumii and \theenumiv \emph{\alph}).

import type { ClassOptionData, SizeCommand } from "../layout/classdata"
import { Scanner } from "../layout/dimen"
import { QUAD, X_HEIGHT, type Font } from "../layout/font"
import { charNode, kern, penalty, ssGlue, type Node } from "../layout/nodes"
import { hpack } from "../layout/pack"
import { mlistToHlist, TEXT } from "../mathlayout/mlist"
import { ALLOW_HYPHENS, appendText } from "./encodings"
import { closingBrace, fontAt, mathEnv, parseFormula } from "./paragraph"
import { SI_COMMANDS } from "./siunitx"
import { Unsupported } from "./unsupported"

const TEXTBULLET = 136 // \textbullet in TS1

/** spanish.ldf is the document's main language (its layout, \layoutspanish, at \begin{document}) */
export const spanishLayout = { on: false }
/** spanish is the language selected (\extrasspanish: \textspanish, \mathspanish, its shorthands) */
export const spanishText = { on: false }

/** $\m@th …$ in a label: the formula between math nodes (\mathsurround 0pt) */
function formula(src: string, k: ClassOptionData, size: SizeCommand, font: Font, amsmath: boolean): Node[] {
  return [{ kind: "math", on: true, width: 0 }, ...mlistToHlist(parseFormula(src, amsmath, font.params[QUAD]), mathEnv(k, size, amsmath), TEXT, false), { kind: "math", on: false, width: 0 }]
}

/**
 * \spanishsymbitems' \labelitemi … iv: a square (\leavevmode\hbox to 1.2ex{\hss\vrule height .9ex width .7ex
 * depth -.2ex\hss}, in the item's font), \textbullet, $\m@th\circ$, $\m@th\diamond$
 */
export function spanishItemLabel(level: number, k: ClassOptionData, size: SizeCommand, font: Font, companion: Font, amsmath: boolean): Node[] {
  const ex = (x: string) => new Scanner(x, { em: font.params[QUAD], ex: font.params[X_HEIGHT] }).scanDimen().value
  if (level === 1) return [hpack([ssGlue(), { kind: "rule", width: ex(".7ex"), height: ex(".9ex"), depth: ex("-.2ex") }, ssGlue()], { exactly: ex("1.2ex") })]
  if (level === 2) return [charNode(companion, TEXTBULLET)]
  return formula(level === 3 ? "\\circ" : "\\diamond", k, size, font, amsmath)
}

/** \layoutspanish's \@alph (\@Alph): a … n, \~n, o … z (\~N and the capitals); its \~n in OT1 is \es@accent's, with
 *  \bbl@allowhyphens after it (what \futurelet sees next is \ifcase's \or, not a space); as text, or as `source` */
export function spanishAlph(n: number, upper = false, source = false): string {
  if (n < 1 || n > 27) throw new Unsupported(`spanish.ldf's \\alph of ${n}`) // (\@ctrerr)
  const N = upper ? "N" : "n"
  return n === 15 ? `${source ? `\\~${N}` : `${N}\u0303`}${ALLOW_HYPHENS}` : String.fromCharCode((upper ? 64 : 96) + n - (n > 15 ? 1 : 0))
}

/**
 * \es@enumerate{1.}{a)}{1)}{a$'$}'s \labelenumi … iv for item n: 1. \emph{a}) 1) \emph{a}$'$ (\emph's italic
 * correction before the ) or the formula); `italic`: the item's font in italic. \@alph's 15th letter is \~n.
 */
export function spanishEnumLabel(level: number, n: number, k: ClassOptionData, size: SizeCommand, font: Font, italic: Font, amsmath: boolean): Node[] {
  const l: Node[] = []
  if (level === 1 || level === 3) { appendText(l, `${n}${level === 1 ? "." : ")"}`, font, { spaceFactor: 1000 }, false); return l }
  appendText(l, spanishAlph(n), italic, { spaceFactor: 1000 }, false)
  const last = l[l.length - 1]
  if (last?.kind === "char") l.push(kern(italic.chars.get(last.char)!.italic, true)) // \/
  if (level === 2) appendText(l, ")", font, { spaceFactor: 1000 }, false)
  else l.push(...formula("'", k, size, font, amsmath))
  return l
}

/** \p@enum… \theenum…: what \label writes for item n (1, 1\emph{a}, 1\emph{a}1, 1\emph{a}1\emph{a}; \emph is robust) */
export function spanishEnumRef(level: number, values: number[]): string {
  const em = (n: number) => `\\protect \\emph  {${n === 15 ? "\\~n" : spanishAlph(n)}}` // (\emph is robust: its inner command is "\emph ")
  return [`${values[0]}`, `${values[0]}${em(values[1])}`, `${values[0]}${em(values[1])}${values[2]}`, `${values[0]}${em(values[1])}${values[2]}${em(values[3])}`][level - 1]
}

/**
 * The source with ALLOW_HYPHENS after each acute or tilde accent (\'a, \'{\i}, \~n, á, ñ …) whose next token is
 * not a space, where \es@accent's \futurelet looks (a control word's spaces are not tokens; math is left alone).
 */
export function markAccentHyphens(src: string): string {
  let out = ""
  for (let i = 0; i < src.length; ) {
    const c = src[i]
    if (c === "$") { const j = src.indexOf("$", i + 1); const end = j < 0 ? src.length : j + 1; out += src.slice(i, end); i = end; continue }
    let end = -1
    if (c === "\\") {
      const m = src.slice(i).match(/^\\['~]\s*(?:\{(?:\\[ij](?![A-Za-z])\s*|[A-Za-z])\}|\\[ij](?![A-Za-z])\s*|[A-Za-z])/)
      if (m) end = i + m[0].length
      else { out += src.slice(i, i + 2); i += 2; continue } // (\\, \' before something else, \$ …)
    } else if (c >= "\x80" && /[\u0301\u0303]/.test(c.normalize("NFD"))) end = i + 1
    if (end < 0) { out += c; i++; continue }
    out += src.slice(i, end)
    if (end < src.length && !/\s/.test(src[end]) && src[end] !== ALLOW_HYPHENS) out += ALLOW_HYPHENS
    i = end
  }
  return out
}

/**
 * spanish.ldf's \%: \es@sppercent (\leavevmode, \unskip after a skip of finite stretch, then $\m@th\,$) and
 * \percentsign{}, the character alone. Takes the skip off `list`; returns the rest.
 */
export function spanishPercent(list: Node[], k: ClassOptionData, size: SizeCommand, font: Font, amsmath: boolean, state: { spaceFactor: number }): Node[] {
  const last = list[list.length - 1]
  if (last?.kind === "glue" && last.stretchOrder === 0) list.pop()
  const out = formula("\\,", k, size, font, amsmath)
  appendText(out, "%", font, state, false)
  return out
}

/**
 * spanish.ldf's \es@operators (\mathspanish), \accentedoperators and \spacedoperators: \lim, \limsup, \liminf, \max,
 * \inf and \min as \mathop{\operator@font l\acute{\dotlessi}m}…, and \sen, \tg, \arcsen, \arccos, \arctg, \cotg, \cosec,
 * \senh, \tgh with \nolimits (the \, of arc\,cos is \es@op@sp)
 */
export const SPANISH_OPERATORS: Record<string, { name: string; nolimits: boolean }> = {
  lim: { name: "l\\acute{\\dotlessi}m", nolimits: false }, limsup: { name: "l\\acute{\\dotlessi}m\\,sup", nolimits: false },
  liminf: { name: "l\\acute{\\dotlessi}m\\,inf", nolimits: false }, max: { name: "m\\acute{a}x", nolimits: false },
  inf: { name: "\\acute{\\dotlessi}nf", nolimits: false }, min: { name: "m\\acute{\\dotlessi}n", nolimits: false },
  sen: { name: "sen", nolimits: true }, tg: { name: "tg", nolimits: true }, arcsen: { name: "arc\\,sen", nolimits: true },
  arccos: { name: "arc\\,cos", nolimits: true }, arctg: { name: "arc\\,tg", nolimits: true }, cotg: { name: "cotg", nolimits: true },
  cosec: { name: "cosec", nolimits: true }, senh: { name: "senh", nolimits: true }, tgh: { name: "tgh", nolimits: true },
}

/**
 * A formula with spanish.ldf's math: the decimal comma (. is active in math, \mathcode"8000: before a digit, after
 * any spaces, it is \es@decimal, {,}; elsewhere the period). \bmod, \pmod, \mod and \dotlessi are not modeled (nor
 * \% in math, \, \percentsign{}, nor text in a formula, where . is not active: the formula parser reads neither).
 */
export function spanishMath(src: string): string {
  if (/\\(?:bmod|pmod|mod|dotlessi)(?![A-Za-z])/.test(src)) throw new Unsupported("spanish.ldf's \\bmod, \\pmod, \\mod or \\dotlessi")
  let out = ""
  for (let i = 0; i < src.length; ) {
    // (siunitx's arguments are its input, tokens: siContext gives its decimal marker the comma)
    const si = src.slice(i).match(/^\\([A-Za-z]+)(?![A-Za-z])/)
    if (si && Object.hasOwn(SI_COMMANDS, si[1])) {
      let j = i + si[0].length
      for (let n = -1; n < SI_COMMANDS[si[1]]; n++) {
        const k = src.slice(j).match(/^\s*/)![0].length
        if (n < 0 && src[j + k] !== "[") continue
        const close = src[j + k] === "[" ? src.indexOf("]", j + k) : src[j + k] === "{" ? closingBrace(src, j + k) : -1
        if (close < 0) throw new Unsupported(`\\${si[1]} with spanish.ldf`)
        j = close + 1
      }
      out += src.slice(i, j); i = j; continue
    }
    if (src[i] === "\\") { const cs = src.slice(i).match(/^\\(?:[A-Za-z]+|.)/)![0]; out += cs; i += cs.length; continue }
    if (src[i] === "." && /^\s*[0-9]/.test(src.slice(i + 1))) { out += "{,}"; i++; continue }
    out += src[i++]
  }
  return out
}

/**
 * spanish.ldf's shorthands in text at two characters: << and >> (the quoting environment), "< and "> (\guillemotleft,
 * \guillemotright), "u "U "i "I (\"u, \"{\i}) and "c "C (\c{c}) as text; null for none. The others ("a, "-, "=, ~- …)
 * are not modeled.
 */
export function spanishShorthand(two: string): { kind: "guillemet"; right: boolean; quoting: boolean } | string | null {
  if (two === "<<" || two === ">>") return { kind: "guillemet", right: two === ">>", quoting: true }
  if (two === '"<' || two === '">') return { kind: "guillemet", right: two === '">', quoting: false }
  const letter: Record<string, string> = { u: "u\u0308", U: "U\u0308", i: "i\u0308", I: "I\u0308", c: "c\u0327", C: "C\u0327" } // ("i: \"{\i}, as \"i)
  if (two[0] === '"') { if (Object.hasOwn(letter, two[1] ?? "")) return letter[two[1]]; throw new Unsupported(`spanish.ldf's shorthand ${two}`) }
  if (two === "~-") throw new Unsupported("spanish.ldf's shorthand ~-")
  return null
}

/**
 * A guillemet: in OT1, \layoutspanish's \es@guillemot: \save@sf@q{\penalty\@M\leavevmode\hbox{\usefont{U}{lasy}{m}{n}
 * \char40 \kern-0.19em\char40 }} (41 for the right one; the space factor stays); in T1 the character, alone.
 */
export function spanishGuillemet(right: boolean, enc: string, k: ClassOptionData, size: SizeCommand, font: Font, state: { spaceFactor: number }): Node[] {
  if (enc === "T1") { const l: Node[] = []; appendText(l, right ? "»" : "«", font, state, false); return l }
  const at = k.sizes[size].size
  if (at < 10 * 65536) throw new Unsupported("spanish.ldf's guillemets below 10pt (lasy5–9)") // (ulasy.fd: lasy10 from 10pt)
  const lasy = fontAt("lasy10", at), c = right ? 41 : 40
  const sep = new Scanner("-0.19em", { em: lasy.params[QUAD], ex: lasy.params[X_HEIGHT] }).scanDimen().value
  return [penalty(10000), hpack([charNode(lasy, c), kern(sep, true), charNode(lasy, c)])]
}
