// Text in a font encoding (#63): the accents and letters of LaTeX's OT1 and T1 encodings (ot1enc.def,
// t1enc.def) and what pdfLaTeX's UTF-8 input makes of a character (utf8.def with the .dfu files of the
// encodings the format loads: t1enc.dfu, ot1enc.dfu, ts1enc.dfu). A paragraph's text keeps an accented
// letter as its base and a combining mark (\'e, \'{e} and é alike: "e\u0301"; \'\i and í: "ı\u0301"),
// and the letters LaTeX names (\ss, \o, “) as their Unicode characters. encodeText puts such text in an
// encoding: characters of the font (T1's composites are characters, so they kern and ligature with their
// neighbours) or an accent over its base, \add@accent's \accent (§ 1123).

import { X_HEIGHT, type Font } from "../layout/font"
import { appendText as appendCodes, makeAccent, sfCode, type HState } from "../layout/hmode"
import { glue, penalty, type Node } from "../layout/nodes"
import { Unsupported } from "./unsupported"

/** each text accent command's combining mark */
export const ACCENT_MARKS: Record<string, string> = {
  "`": "\u0300", "'": "\u0301", "^": "\u0302", "~": "\u0303", "=": "\u0304", u: "\u0306", ".": "\u0307",
  '"': "\u0308", r: "\u030a", H: "\u030b", v: "\u030c", c: "\u0327", k: "\u0328",
}
const MARKS = new Set(Object.values(ACCENT_MARKS))

/** a text accent command on a letter, \i or \j (\'e, \'{e}, \'\i, \u{a} …) */
export const ACCENT_COMMAND = /^\\([`'^"~=.]|[uvHrck](?![A-Za-z]))\s*(?:\{(\\[ij](?![A-Za-z])\s*|[A-Za-z])\}|(\\[ij](?![A-Za-z])\s*)|([A-Za-z]))/
/** that command as text: the letter and the accent's combining mark */
export function accentText(m: RegExpMatchArray): string {
  const base = (m[2] ?? m[3] ?? m[4]).trim()
  return (base === "\\i" ? "ı" : base === "\\j" ? "ȷ" : base) + ACCENT_MARKS[m[1]]
}

/** the source without its text accents and letter commands (\'e, \'{\i}, \~n, \ss …): what checks for other commands see */
export function withoutTextCommands(src: string): string {
  return src.replace(new RegExp(ACCENT_COMMAND.source.slice(1), "g"), "")
    .replace(/\\([A-Za-z]+)(?![A-Za-z])\s*(\{\})?/g, (all, name: string) => (Object.hasOwn(TEXT_LETTERS, name) ? "" : all))
}

/** a text's tokens as TeX prints them (\write, \marks): a control word with one space after it (\'{\i }, \c {c}) */
export const printTokens = (src: string): string => src.replace(/\\([A-Za-z]+)\s*/g, "\\$1 ")

/** LaTeX source of letters and accents (a caption name, \'{I}ndice) as text */
export function sourceText(src: string): string {
  let out = ""
  for (let i = 0; i < src.length; ) {
    const acc = src.slice(i).match(ACCENT_COMMAND)
    if (acc) { out += accentText(acc); i += acc[0].length; continue }
    const letter = src.slice(i).match(/^\\([A-Za-z]+)(?![A-Za-z])\s*/)
    if (letter && Object.hasOwn(TEXT_LETTERS, letter[1])) { out += TEXT_LETTERS[letter[1]]; i += letter[0].length; continue }
    if ("\\{}~".includes(src[i])) throw new Unsupported(`text "${src}"`)
    out += src[i++]
  }
  return out
}

/** \DeclareTextAccent: each mark's accent character (\c and \k are text commands of their own) */
const ACCENTS: Record<"OT1" | "T1", Record<string, number>> = {
  OT1: { "\u0308": 127, "\u0301": 19, "\u0307": 95, "\u0304": 22, "\u0302": 94, "\u0300": 18, "\u0303": 126, "\u030b": 125, "\u0306": 21, "\u030c": 20, "\u030a": 23 },
  T1: { "\u0300": 0, "\u0301": 1, "\u0302": 2, "\u0303": 3, "\u0308": 4, "\u030b": 5, "\u030a": 6, "\u030c": 7, "\u0306": 8, "\u0304": 9, "\u0307": 10 },
}

/** t1enc.def's \DeclareTextComposite: the accented letter's character */
const T1_COMPOSITES: Record<string, number> = {
  Ă: 128, Ą: 129, Ć: 130, Č: 131, Ď: 132, Ě: 133, Ę: 134, Ğ: 135, Ĺ: 136, Ľ: 137, Ń: 139, Ň: 140, Ő: 142, Ŕ: 143, Ř: 144, Ś: 145,
  Š: 146, Ş: 147, Ť: 148, Ţ: 149, Ű: 150, Ů: 151, Ÿ: 152, Ź: 153, Ž: 154, Ż: 155, İ: 157, ă: 160, ą: 161, ć: 162, č: 163, ď: 164,
  ě: 165, ę: 166, ğ: 167, ĺ: 168, ľ: 169, ń: 171, ň: 172, ő: 174, ŕ: 175, ř: 176, ś: 177, š: 178, ş: 179, ť: 180, ţ: 181, ű: 182,
  ů: 183, ÿ: 184, ź: 185, ž: 186, ż: 187, À: 192, Á: 193, Â: 194, Ã: 195, Ä: 196, Å: 197, Ç: 199, È: 200, É: 201, Ê: 202, Ë: 203,
  Ì: 204, Í: 205, Î: 206, Ï: 207, Ñ: 209, Ò: 210, Ó: 211, Ô: 212, Õ: 213, Ö: 214, Ù: 217, Ú: 218, Û: 219, Ü: 220, Ý: 221, à: 224,
  á: 225, â: 226, ã: 227, ä: 228, å: 229, ç: 231, è: 232, é: 233, ê: 234, ë: 235, ì: 236, í: 237, î: 238, ï: 239, ñ: 241, ò: 242,
  ó: 243, ô: 244, õ: 245, ö: 246, ù: 249, ú: 250, û: 251, ü: 252, ý: 253,
}

/** \DeclareTextSymbol: the letters and punctuation a paragraph's text holds as Unicode characters (OT1's
 *  \textexclamdown and \textquestiondown are the ligatures !` and ?`) */
export const SYMBOLS: Record<"OT1" | "T1", Record<string, number | string>> = {
  OT1: { ß: 25, æ: 26, œ: 27, ø: 28, Æ: 29, Œ: 30, Ø: 31, ı: 16, ȷ: 17, "“": 92, "”": 34, "‘": 96, "’": 39, "–": 123, "—": 124, "¡": "!`", "¿": "?`" },
  T1: {
    ß: 255, æ: 230, œ: 247, ø: 248, Æ: 198, Œ: 215, Ø: 216, ı: 25, ȷ: 26, ł: 170, Ł: 138, ð: 240, Ð: 208, þ: 254, Þ: 222,
    "“": 16, "”": 17, "‘": 96, "’": 39, "–": 21, "—": 22, "¡": 189, "¿": 190, "«": 19, "»": 20,
  },
}

/** text commands for those letters and the characters they stand for */
export const TEXT_LETTERS: Record<string, string> = {
  ss: "ß", ae: "æ", AE: "Æ", oe: "œ", OE: "Œ", o: "ø", O: "Ø", i: "ı", j: "ȷ", l: "ł", L: "Ł", dh: "ð", DH: "Ð", th: "þ", TH: "Þ",
  aa: "a\u030a", AA: "A\u030a", textexclamdown: "¡", textquestiondown: "¿", textendash: "–", textemdash: "—", textquoteleft: "‘",
  textquoteright: "’", textquotedblleft: "“", textquotedblright: "”", guillemetleft: "«", guillemetright: "»",
  guillemotleft: "«", guillemotright: "»",
}

/**
 * A UTF-8 character as the paragraph's text holds it (`utf8.def`'s definitions): an accented letter as its
 * base and mark (í, ì, î, ï, ĩ, ī, ĭ are LaTeX's \i with the accent), a letter or punctuation of
 * TEXT_LETTERS as itself; null for one this does not read.
 */
export function utf8Text(ch: string): string | null {
  if (Object.values(TEXT_LETTERS).includes(ch) && ch.length === 1) return ch
  const d = ch.normalize("NFD")
  if (d.length !== 2 || !/[A-Za-z]/.test(d[0]) || !MARKS.has(d[1])) return null
  // (the code points LaTeX reads as \i or \j with the accent: not the dot above or the ogonek)
  return (d[0] === "i" && d[1] !== "\u0328" ? "ı" : d[0] === "j" ? "ȷ" : d[0]) + d[1]
}

/** a run of characters (a space is interword glue), or an accent over its base: \add@accent's (its
 *  \spacefactor after it is the base's) or \accent alone (OT1's \c: 1000) */
export type TextItem = { run: string } | { accent: number; base: number; baseSpaceFactor: boolean } | { allowhyphens: true }

/** in the text, after an accent: the next token is not a space (spanish.ldf's \es@accent then adds \bbl@allowhyphens) */
export const ALLOW_HYPHENS = "\ue000"
/** spanish.ldf's OT1 \' and \~ (\es@accent): after the accent, \bbl@allowhyphens (\nobreak\hskip\z@skip) unless a space follows */
export const accentHyphens = { on: false }
/** babel's OT1 \" on a e i \i o u A E I O U (\DeclareTextCompositeCommand at \begin{document}): \bbl@umlauta and
 *  \bbl@umlaute, \umlauthigh's \leavevmode\bgroup\accent127 #1\bbl@allowhyphens\egroup (space factor 1000); spanish.ldf's
 *  \bbl@umlauta (a o u A O U) is \es@umlaut, \add@accent{127}#1\bbl@allowhyphens */
export const babelUmlauts: { mode: null | "high" | "spanish" } = { mode: null }

/** The paragraph's text (Unicode, accents as marks) in the font's encoding. */
export function encodeText(text: string, enc: string, font: Font): TextItem[] {
  if (/^[\x00-\x7f]*$/.test(text)) return [{ run: text }]
  if (enc !== "OT1" && enc !== "T1") throw new Unsupported(`text "${text}" in ${enc}`)
  const out: TextItem[] = []
  let run = ""
  const accent = (a: number, base: string, own = true) => {
    const code = base === "ı" || base === "ȷ" ? SYMBOLS[enc][base] as number : base.charCodeAt(0)
    if (run) out.push({ run }); run = ""
    out.push({ accent: a, base: code, baseSpaceFactor: own })
  }
  // (UTF-8 from the source as it is: accented letters as base and mark)
  const chars = [...[...text].map((ch) => ch >= "\x80" && !MARKS.has(ch) ? utf8Text(ch) ?? ch : ch).join("")]
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i], mark = chars[i + 1]
    if (ch === ALLOW_HYPHENS) {
      const last = out.at(-1)
      if (!run && last && "accent" in last && accentHyphens.on && (last.accent === 19 || last.accent === 126)) out.push({ allowhyphens: true }) // (OT1's; T1's are 1 and 3)
      continue
    }
    if (mark !== undefined && MARKS.has(mark)) {
      i++
      // \'i, \`i, \^i, \"i and \=i are the same accents on \i (ot1enc.def's composites; t1enc.def's for \=)
      const base = ch === "i" && "\u0300\u0301\u0302\u0308\u0304".includes(mark) ? "ı" : ch
      if (!/^[A-Za-zıȷ]$/.test(base)) throw new Unsupported(`an accent on "${ch}"`)
      if (enc === "T1") {
        // a composite is its character (\.i and \.\i: `\i, which is `i); \c and \k without one are \ooalign's
        if (mark === "\u0307" && (ch === "i" || ch === "ı")) { run += "i"; continue }
        const key = (base === "ı" ? "i" : base) + mark
        const composite = T1_COMPOSITES[key.normalize("NFC")] // (\=\i has none)
        if (composite !== undefined) { run += String.fromCharCode(composite); continue }
        if (mark === "\u0327" || mark === "\u0328") throw new Unsupported(`\\${mark === "\u0327" ? "c" : "k"}{${ch}} in T1`)
        accent(ACCENTS.T1[mark], base)
        continue
      }
      if (mark === "\u0307" && (ch === "i" || ch === "ı")) { run += "i"; continue } // (\.i and \.\i: the composite `\i, which is `i)
      if (mark === "\u0328") throw new Unsupported(`\\k{${ch}} in OT1`)
      if (mark === "\u030a" && base === "A") throw new Unsupported("\\r{A} in OT1")
      if (mark === "\u0327") {
        // OT1's \c: \accent24 on a base 1ex high, else \ooalign
        const code = base === "ı" || base === "ȷ" ? SYMBOLS.OT1[base] as number : base.charCodeAt(0)
        if (font.chars.get(code)?.height !== font.params[X_HEIGHT]) throw new Unsupported(`\\c{${ch}} in OT1`)
        accent(24, base) // (\accent, not \add@accent: the space factor 1000, a lowercase base's)
        continue
      }
      if (mark === "\u0308" && babelUmlauts.mode && "aeıouAEIOU".includes(base)) {
        accent(127, base, babelUmlauts.mode === "spanish" && "aouAOU".includes(base))
        out.push({ allowhyphens: true })
        continue
      }
      accent(ACCENTS.OT1[mark], base)
      continue
    }
    if (ch.charCodeAt(0) < 128) { run += ch; continue }
    const s = SYMBOLS[enc][ch]
    if (s === undefined) throw new Unsupported(`"${ch}" in ${enc}`)
    run += typeof s === "string" ? s : String.fromCharCode(s)
  }
  if (run) out.push({ run })
  return out
}

/** A font's encoding, from its name: the EC fonts are T1's (Latin Modern's ec- ones too, and PSNFSS's 8t, fontinst's
 *  name for T1: #340), the TC fonts TS1's, the others OT1's (no text is put in a TS1 font by encoding: its symbols are characters) */
export function encodingOf(font: Font): string {
  return /^ec|8t$/.test(font.name) ? "T1" : /^tc/.test(font.name) ? "TS1" : "OT1"
}

/**
 * Text (Unicode, accents as marks: encodings.ts) into a horizontal list in the font's encoding (TeX's main loop,
 * hmode.ts): its characters, and each accent with \add@accent's \spacefactor after it, the base's (from 1000).
 */
export function appendText(list: Node[], text: string, font: Font, state: HState, paragraph = true) {
  if (text.includes("\\")) throw new Unsupported(`text "${text}"`) // (a command, not a character: \ref's label 1\emph {a})
  if (/^[\x00-\x7f]*$/.test(text)) { appendCodes(list, text, font, state, paragraph); return }
  for (const item of encodeText(text, encodingOf(font), font)) {
    if ("run" in item) { appendCodes(list, item.run, font, state, paragraph); continue }
    if ("allowhyphens" in item) { list.push(penalty(10000), glue(0)); continue }
    makeAccent(list, font, item.accent, item.base, state)
    if (!item.baseSpaceFactor) continue
    const s = state.sfcodes?.[item.base] ?? sfCode(item.base)
    if (s < 1000 && s > 0 || s > 1000) state.spaceFactor = s
  }
}
