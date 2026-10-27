// Text symbols and logos: the symbol commands of ot1enc.def, t1enc.def and ts1enc.def with latex.ltx's defaults
// (\DeclareTextSymbolDefault: TS1's companion font, OMS's cmsy, OML's cmmi; \DeclareTextCommandDefault), and
// ltlogos.dtx's \TeX, \LaTeX and \LaTeXe. In a paragraph's text a symbol stands as a private character;
// appendSymbols() typesets it in the encoding in force: the font's own character joins the run of characters
// around it (\DeclareTextSymbol is a \chardef: ligatures and kerns), another font's stands in a group of its own
// (\UseTextSymbol). A robust command's \protect is a \relax, which ends the run before it.

import type { ClassOptionData, SizeCommand } from "../layout/classdata"
import { parseDimen } from "../layout/dimen"
import { QUAD, SPACE_STRETCH, X_HEIGHT, type Font } from "../layout/font"
import { appendText, SYMBOLS as LETTERS } from "./encodings"
import { charNode, kern, penalty, ssGlue, type Node } from "../layout/nodes"
import { hpack, vpack } from "../layout/pack"
import { Unsupported } from "./unsupported"

/**
 * Each symbol: its character in OT1 and T1 (a code, or the characters of a command made of them), else the
 * default's: a code in TS1, OMS or OML
 */
interface Sym { OT1?: number | string; T1?: number; TS1?: number; OMS?: number; OML?: number }
// (the letters, dashes, quotes and guillemets are encodings.ts's TEXT_LETTERS; \textsection, \textdegree and the
// ordinals paragraph.ts's TEXT_SYMBOLS)
const SYMBOLS: Record<string, Sym> = {
  guilsinglleft: { T1: 14 }, guilsinglright: { T1: 15 }, quotedblbase: { T1: 18 }, quotesinglbase: { T1: 13 },
  textsterling: { T1: 191, TS1: 163 },
  textparagraph: { TS1: 182 }, textdagger: { TS1: 132 }, textdaggerdbl: { TS1: 133 }, textbullet: { TS1: 136 }, textperiodcentered: { TS1: 183 },
  textcopyright: { TS1: 169 }, textregistered: { TS1: 174 }, texttrademark: { TS1: 151 },
  textcent: { TS1: 162 }, textyen: { TS1: 165 }, texteuro: { TS1: 191 }, textmu: { TS1: 181 }, textpm: { TS1: 177 }, texttimes: { TS1: 214 }, textdiv: { TS1: 246 },
  textlnot: { TS1: 172 }, textonesuperior: { TS1: 185 }, texttwosuperior: { TS1: 178 }, textthreesuperior: { TS1: 179 },
  textonequarter: { TS1: 188 }, textonehalf: { TS1: 189 }, textthreequarters: { TS1: 190 }, textbrokenbar: { TS1: 166 }, textcurrency: { TS1: 164 },
  textcelsius: { TS1: 137 }, textnumero: { TS1: 155 }, textbardbl: { TS1: 134 }, textperthousand: { TS1: 135 }, textreferencemark: { TS1: 184 },
  textleftarrow: { TS1: 24 }, textrightarrow: { TS1: 25 }, textuparrow: { TS1: 94 }, textdownarrow: { TS1: 95 }, textmusicalnote: { TS1: 110 },
  textbar: { T1: 124, OMS: 106 }, textbackslash: { T1: 92, OMS: 110 }, textbraceleft: { T1: 123, OMS: 102 }, textbraceright: { T1: 125, OMS: 103 },
  textless: { T1: 60, OML: 60 }, textgreater: { T1: 62, OML: 62 },
  // OT1: \^{} and \~{}, \leavevmode\kern.06em\vbox{\hrule\@width.3em}; none for \textquotedbl
  textasciicircum: { T1: 94 }, textasciitilde: { T1: 126 }, textunderscore: { T1: 95 }, textquotedbl: { T1: 34 },
  // \textellipsis: .\kern\fontdimen3\font three times; \slash: /\penalty\exhyphenpenalty
  textellipsis: {}, slash: {},
}
/** commands for the same symbols; robust ones (\DeclareRobustCommand) start with \protect */
const ALIASES: Record<string, { sym: string; robust?: boolean }> = {
  S: { sym: "textsection", robust: true }, // (a TEXT_SYMBOLS symbol) P: { sym: "textparagraph", robust: true }, dag: { sym: "textdagger", robust: true },
  ddag: { sym: "textdaggerdbl", robust: true }, pounds: { sym: "textsterling", robust: true }, copyright: { sym: "textcopyright", robust: true },
  dots: { sym: "textellipsis", robust: true }, ldots: { sym: "textellipsis", robust: true },
}
/** the logos, which make nodes of their own (robust) */
export const LOGOS = ["TeX", "LaTeX", "LaTeXe"]

const NAMES = Object.keys(SYMBOLS)
/** a symbol's private character in the text */
const char = (name: string) => String.fromCharCode(0xe100 + NAMES.indexOf(name))
const PRIVATE = /[\ue100-\ue1ff]/
// the symbols an encoding has as its own characters: in its text, as encodings.ts's letters are
for (const name of NAMES) for (const enc of ["OT1", "T1"] as const) { const own = SYMBOLS[name][enc]; if (own !== undefined) LETTERS[enc][char(name)] = own }

/** The commands in text this module reads (for the check of unknown commands) */
export const SYMBOL_COMMANDS = [...NAMES, ...Object.keys(ALIASES), ...LOGOS]

/**
 * A text symbol or logo at `i` in a paragraph's source: the private character it stands for in the text (with
 * `flush`, a \relax first: the run of characters before ends), or a logo's name; null if there is none. The
 * spaces after a control word go.
 */
export function textSymbolAt(body: string, i: number): { end: number; text?: string; flush?: boolean; logo?: string; symbol?: string } | null {
  if (body[i] !== "\\") return null
  // \_ (robust), \{ and \} (\protected: no \relax)
  if (body.startsWith("\\_", i)) return { end: i + 2, text: char("textunderscore"), flush: true }
  if (body.startsWith("\\{", i)) return { end: i + 2, text: char("textbraceleft") }
  if (body.startsWith("\\}", i)) return { end: i + 2, text: char("textbraceright") }
  const sym = body.slice(i).match(/^\\([A-Za-z]+)(?![A-Za-z])\s*/)
  if (!sym) return null
  const name = sym[1], end = i + sym[0].length
  if (name in SYMBOLS) return { end, text: char(name) }
  if (name in ALIASES) {
    const a = ALIASES[name]
    return a.sym in SYMBOLS ? { end, text: char(a.sym), flush: !!a.robust } : { end, symbol: a.sym }
  }
  if (LOGOS.includes(name)) return { end, logo: name, flush: true }
  return null
}

/** What appendSymbols needs: the encoding in force, and the font of another encoding (TS1, OMS, OML) */
export interface SymbolEnv { enc: "OT1" | "T1" | "TS1"; select(enc: "TS1" | "OMS" | "OML"): Font
  /** the default commands used so far in each encoding (\@changed@cmd's first use is a \global\let: it ends the run) */
  used?: Set<string> }

/** Text in a font, its symbols' private characters typeset in the encoding in force */
export function appendSymbols(list: Node[], text: string, font: Font, env: SymbolEnv, state: HState, paragraph: boolean) {
  if (!PRIVATE.test(text)) return appendText(list, text, font, state, paragraph)
  const enc = env.enc
  if (enc !== "OT1" && enc !== "T1") throw new Unsupported(`text symbols in ${enc}`)
  let run = ""
  const flush = () => { if (run) appendText(list, run, font, state, paragraph); run = "" }
  const em = (d: string) => parseDimen(d, { em: font.params[QUAD], ex: font.params[X_HEIGHT] })
  for (const ch of text) {
    if (!PRIVATE.test(ch)) { run += ch; continue }
    const name = NAMES[ch.charCodeAt(0) - 0xe100], s = SYMBOLS[name]
    if (s[enc] !== undefined) { run += ch; continue } // (encodings.ts puts it in the encoding)
    if (name === "textellipsis") { // (the first period joins the run before, but at the first use; \dots and \ldots are robust)
      const k3 = () => list.push(kern(font.params[SPACE_STRETCH], true))
      if (env.used && !env.used.has(`${enc}${name}`)) { env.used.add(`${enc}${name}`); flush() }
      run += "."; flush(); k3(); appendText(list, ".", font, state, paragraph); k3(); appendText(list, ".", font, state, paragraph); k3()
      continue
    }
    if (name === "slash") { run += "/"; flush(); list.push(penalty(50)); continue }
    flush()
    if (s.TS1 !== undefined) { appendText(list, String.fromCharCode(s.TS1), env.select("TS1"), state, paragraph); continue }
    if (s.OMS !== undefined) { appendText(list, String.fromCharCode(s.OMS), env.select("OMS"), state, paragraph); continue }
    if (s.OML !== undefined) { appendText(list, String.fromCharCode(s.OML), env.select("OML"), state, paragraph); continue }
    // \add@accent{94 or 126}{}: \accent with no letter after it, the space factor 1000
    if (name === "textasciicircum" || name === "textasciitilde") { list.push(charNode(font, name === "textasciicircum" ? 94 : 126)); state.spaceFactor = 1000; continue }
    if (name === "textunderscore") { list.push(kern(em(".06em"), true), vpack([{ kind: "rule", width: em(".3em"), height: 26214, depth: 0 }])); state.spaceFactor = 1000; continue }
    throw new Unsupported(`\\${name} in ${enc}`)
  }
  flush()
}

/**
 * The logos: \TeX (T\kern-.1667em\lower.5ex\hbox{E}\kern-.125emX\@), \LaTeX (L\kern-.36em, an A at \sf@size in a
 * \vbox to the T's height, \kern-.15em, \TeX) and \LaTeXe (\mbox{\LaTeX\kern.15em2$_{\textstyle\varepsilon}$}:
 * `box` makes the \mbox, `epsilon` the formula)
 */
export function logoNodes(name: string, font: Font, sfFont: () => Font, state: { spaceFactor: number }, box: (l: Node[]) => Node, epsilon: () => Node[]): Node[] {
  const em = (d: string) => parseDimen(d, { em: font.params[QUAD], ex: font.params[X_HEIGHT] })
  const chars = (s: string, f = font) => { const l: Node[] = []; appendText(l, s, f, { spaceFactor: 1000 }, false); return l }
  const tex = (): Node[] => [...chars("T"), kern(em("-.1667em"), true), { ...hpack(chars("E")), shift: em(".5ex") }, kern(em("-.125em"), true), ...chars("X")]
  const latex = (): Node[] => [...chars("L"), kern(em("-.36em"), true), vpack([hpack(chars("A", sfFont())), ssGlue()], { exactly: hpack(chars("T")).height }), kern(em("-.15em"), true), ...tex()]
  state.spaceFactor = 1000 // \@, or after the \mbox
  if (name === "TeX") return tex()
  if (name === "LaTeX") return latex()
  return [box([...latex(), kern(em(".15em"), true), ...chars("2"), ...epsilon()])]
}
