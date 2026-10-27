// A beamer document's class options and preamble (beamer.cls 3.77). The class
// loads geometry (paper 128mm × 96mm, 1cm side margins), xcolor, hyperref,
// amsmath, amssymb, amsthm, graphicx, url and enumerate itself, so a \usepackage
// of one of them changes nothing. The themes are the default ones, color themes,
// the rounded, circles and rectangles inner themes, the infolines, split,
// miniframes, tree and sidebar outer themes, the presentation themes Pittsburgh,
// Malmoe, Copenhagen, Luebeck, Berlin, Dresden, Ilmenau, Szeged, Montpellier,
// Hannover, Berkeley, Rochester, Goettingen and Marburg, and Madrid, CambridgeUS,
// AnnArbor, Boadilla and PaloAlto with their shadows or without, as data/beamer has them,
// with the default navigation symbols or none: any other theme or template setting
// throws Unsupported.

import type { ClassOptionData } from "../../layout/classdata"
import { classFile } from "../data"
import { pdfString } from "../hyperref"
import { Unsupported } from "../unsupported"
import { bracedArg } from "./frame"
import { loadTheme, type Theme } from "./theme"

/** an optional argument at text[i] (a [): its text, braces kept, and where it ends */
function bracketArg(text: string, i: number): { arg: string; end: number } {
  let depth = 0
  for (let j = i + 1; j < text.length; j++) {
    if (text[j] === "\\") { j++; continue }
    if (text[j] === "{") depth++
    else if (text[j] === "}") depth--
    else if (text[j] === "]" && depth === 0) return { arg: text.slice(i + 1, j), end: j + 1 }
  }
  throw new Unsupported("an optional argument not closed")
}

export interface BeamerPreamble {
  /** the size option (beamer's \beamer@size: the .clo it inputs) */
  option: string
  /** \ifbeamer@centered: frames centered vertically by default (the c option, beamer's default) or at the top (t) */
  centered: boolean
  /** the class's parameters at that size, with the theme's sizes */
  k: ClassOptionData
  /** the theme (data/beamer): its colors, fonts and sizes */
  theme: Theme
  /** \title, \subtitle, \author, \institute and \date as written ("" when not given; \date's default is \today) */
  info: TitleInfo
  /** hyperref's /Title and /Author (\pdfstringdef'd), from \title (with \subtitle) and \author */
  pdfTitle: string
  pdfAuthor: string
  /** the default navigation symbols in the right sidebar (false: \setbeamertemplate{navigation symbols}{}) */
  navigationSymbols: boolean
  /** between \begin{document} and \end{document} */
  body: string
  /** \AtBeginSection[starred]{text} and \AtBeginSubsection[…]{…}: what each \section and \section* (\subsection,
   *  \subsection*) is followed by */
  hooks: Hooks
}

export interface Hooks { section: string; sectionStar: string; subsection: string; subsectionStar: string }

export interface TitleInfo { title: string; subtitle: string; author: string; institute: string; date: string
  /** the short forms (\@dblarg's optional argument, the text itself without one), which the head and foot lines print */
  short: { title: string; subtitle: string; author: string; institute: string; date: string } }

/** \DeclareOptionBeamer for the sizes: 8pt … 20pt, bigger (12pt) and smaller (10pt) */
const SIZES: Record<string, string> = { "8pt": "8pt", "9pt": "9pt", "10pt": "10pt", "11pt": "11pt", "12pt": "12pt", "14pt": "14pt", "17pt": "17pt", "20pt": "20pt", bigger: "12pt", smaller: "10pt" }
/** the themes data/beamer has (tools/codegen/beamer.ts), by the parts of their preamble lines: color themes, then an
 *  inner theme, then the infolines outer theme with the default headline */
const THEMES = ["default", "whale", "orchid", "seahorse", "beaver", "dolphin", "whale-orchid", "infolines", "whale-infolines", "orchid-infolines",
  "seahorse-infolines", "beaver-infolines", "dolphin-infolines", "whale-orchid-infolines",
  "rounded", "whale-rounded", "orchid-rounded", "whale-orchid-rounded", "whale-orchid-rounded-infolines", "circles",
  "infolines-headline", "CambridgeUS", "AnnArbor", "Boadilla", "Pittsburgh", "rectangles", "whale-orchid-circles", "whale-orchid-rectangles", "split", "whale-orchid-split", "Malmoe", "Copenhagen", "Luebeck", "miniframes", "Berlin", "Dresden", "Ilmenau", "Szeged", "tree", "Montpellier", "Hannover", "sidebar", "Berkeley", "PaloAlto", "Rochester", "Goettingen", "Marburg",
  "albatross", "beetle", "crane", "dove", "fly", "lily", "monarca", "rose", "seagull", "spruce", "wolverine"]
/** the presentation themes with the rounded inner theme's shadows on by default */
const SHADOWS = ["CambridgeUS", "AnnArbor", "Boadilla", "PaloAlto"]
/** a presentation theme's option (\DeclareOptionBeamer{shadow}[true], the theme's \PassOptionsToPackage{shadow=true}
 *  first): whether its rounded boxes have shadows */
function shadowOption(theme: string, option: string | undefined): boolean {
  const o = option?.trim()
  if (o !== undefined && !/^shadow(?:\s*=\s*(?:true|false))?$/.test(o)) throw new Unsupported(`beamer: ${theme}'s option ${o}`)
  return !o?.endsWith("false")
}

/** the packages beamer.cls loads (with these, \usepackage does nothing) */
const LOADED = ["amsmath", "amssymb", "amsfonts", "amsthm", "graphicx", "hyperref", "xcolor", "geometry", "url", "enumerate"]

export function readBeamerPreamble(src: string): BeamerPreamble {
  const m = src.match(/\\documentclass\s*(?:\[([^\]]*)\])?\s*\{beamer\}/)
  if (!m) throw new Error("no \\documentclass{beamer}")
  // \ExecuteOptionsBeamer{c}\ProcessOptionsBeamer: each option in turn, the last size and the last of t and c win
  let option = "11pt", centered = true
  for (const o of (m[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    if (o in SIZES) option = SIZES[o]
    else if (o === "t" || o === "c") centered = o === "c"
    else throw new Unsupported(`beamer option ${o}`)
  }
  // \begin{document} and \end{document} outside comments
  const at = (re: RegExp) => { for (const x of src.matchAll(re)) if (!/(^|[^\\])%/.test(src.slice(src.lastIndexOf("\n", x.index!) + 1, x.index))) return x.index!; return -1 }
  const begin = at(/\\begin\{document\}/g), end = at(/\\end\{document\}/g)
  if (begin < 0 || end < begin) throw new Unsupported("a beamer document without its document environment")
  let pre = src.slice(src.indexOf(m[0]) + m[0].length, begin).replace(/(^|[^\\])%.*$/gm, "$1")
  // \AtBeginSection[starred]{text} (the text for both without [starred]), \AtBeginSubsection: their arguments may
  // span lines
  const hooks: Hooks = { section: "", sectionStar: "", subsection: "", subsectionStar: "" }
  for (let at; (at = pre.search(/\\AtBegin(?:Sub)?[Ss]ection(?![A-Za-z])/)) >= 0;) {
    const sub = pre.startsWith("\\AtBeginSubsection", at)
    let i = at + (sub ? 18 : 15)
    const o = pre.slice(i).match(/^\s*\[/)
    let star: string | undefined
    if (o) { const a = bracketArg(pre, i + o[0].length - 1); star = a.arg; i = a.end }
    const a = bracedArg(pre, i)
    if (!a) throw new Unsupported("beamer: \\AtBeginSection without its argument")
    hooks[sub ? "subsection" : "section"] = a.arg
    hooks[sub ? "subsectionStar" : "sectionStar"] = star ?? a.arg
    pre = pre.slice(0, at) + pre.slice(a.end)
  }
  let navigationSymbols = true
  /** \beamer@themerounded@shadow */
  let shadow = false
  const info: TitleInfo = { title: "", subtitle: "", author: "", institute: "", date: "\\today", short: { title: "", subtitle: "", author: "", institute: "", date: "\\today" } }
  /** the theme lines (other than the default themes'), and the theme they name */
  const themeLines: string[] = [], themeParts: string[] = []
  for (const line of pre.split("\n").map((l) => l.trim()).filter(Boolean)) {
    // (the class loaded the default themes: beamerbasethemes.sty's \beamer@calltheme is a \usepackage, which does
    // nothing again, before or after another theme)
    if (/^\\use(?:color|font|inner|outer)?theme\{default\}$/.test(line)) continue
    const color = line.match(/^\\usecolortheme\{([A-Za-z]+)\}$/)
    if (color) { themeLines.push(line); themeParts.push(color[1]); continue }
    // (with its own headline until the next line sets the default one back)
    if (line === "\\useoutertheme{infolines}") { themeLines.push(line); themeParts.push("infolines-headline"); continue }
    const outer = line.match(/^\\useoutertheme\{(split|miniframes|tree|sidebar)\}$/)
    if (outer) { themeLines.push(line); themeParts.push(outer[1]); continue }
    const inner = line.match(/^\\useinnertheme\{(rounded|circles|rectangles)\}$/)
    if (inner) { themeLines.push(line); themeParts.push(inner[1]); continue }
    // (infolines' headline set back to the default one, as Madrid does)
    if (line === "\\setbeamertemplate{headline}[default]" && themeLines.at(-1) === "\\useoutertheme{infolines}") { themeLines.push(line); themeParts[themeParts.length - 1] = "infolines"; continue }
    // Madrid (beamerthemeMadrid.sty): the whale and orchid color themes, the rounded inner theme (shadow=true unless its
    // shadow option says false), the infolines outer theme with the default headline
    const madrid = line.match(/^\\usetheme(?:\[([^\]]*)\])?\{Madrid\}$/)
    if (madrid) {
      shadow = shadowOption("Madrid", madrid[1])
      if (themeLines.length) throw new Unsupported(`beamer: ${line} after another theme`)
      themeLines.push("\\usecolortheme{whale}", "\\usecolortheme{orchid}", "\\useinnertheme{rounded}", "\\useoutertheme{infolines}", "\\setbeamertemplate{headline}[default]")
      themeParts.push("whale", "orchid", "rounded", "infolines")
      continue
    }
    // the presentation themes data/beamer has whole (the data of those with shadows made with shadow=false: the
    // shadows change no color, font or size)
    const p = line.match(/^\\usetheme(?:\[([^\]]*)\])?\{(CambridgeUS|AnnArbor|Boadilla|Pittsburgh|Malmoe|Copenhagen|Luebeck|Berlin|Dresden|Ilmenau|Szeged|Montpellier|Hannover|Berkeley|PaloAlto|Rochester|Goettingen|Marburg)\}$/)
    if (p) {
      if (!SHADOWS.includes(p[2]) && p[1] !== undefined) throw new Unsupported(`beamer: ${p[2]}'s options`)
      if (SHADOWS.includes(p[2])) shadow = shadowOption(p[2], p[1])
      if (themeLines.length) throw new Unsupported(`beamer: ${line} after another theme`)
      themeLines.push(SHADOWS.includes(p[2]) ? `\\usetheme[shadow=false]{${p[2]}}` : line); themeParts.push(p[2])
      continue
    }
    if (line === "\\setbeamertemplate{navigation symbols}{}") { navigationSymbols = false; continue }
    const pk = line.match(/^\\usepackage\{([a-z,\s]+)\}$/)
    if (pk && pk[1].split(",").every((n) => LOADED.includes(n.trim()))) continue
    // \title, \subtitle, \author, \institute and \date keep their text (\@dblarg: an optional short form);
    // only the title page and the head and foot lines print them
    const t = line.match(/^\\(title|subtitle|author|institute|date)(?:\[([^\]]*)\])?\{(.*)\}$/)
    if (t) { const key = t[1] as keyof TitleInfo["short"]; info[key] = t[3].trim(); info.short[key] = (t[2] ?? t[3]).trim(); continue }
    throw new Unsupported(`beamer preamble: ${line}`)
  }
  const name = themeParts.join("-") || "default"
  if (!THEMES.includes(name)) throw new Unsupported(`beamer theme ${themeLines.join(" ")}`)
  const theme = { ...loadTheme(name), shadow }
  // (the data is for these lines in this order: infolines with its own headline, or another order, has none)
  if (theme.data.preamble.join("\n") !== themeLines.join("\n")) throw new Unsupported(`beamer theme ${themeLines.join(" ")}`)
  const cls = classFile("beamer").options[option]
  const k: ClassOptionData = { ...cls, dimens: { ...cls.dimens, ...theme.data.options[option].dimens } }
  // beamerbasetitle.sty's \beamer@firstminutepatches: pdftitle={\inserttitle\ - \insertsubtitle}; \beamer@author:
  // pdfauthor={\beamer@andstripped}
  const title = pdfInfo(info.title + (info.subtitle ? ` - ${info.subtitle}` : ""))
  // (\beamer@stripands, then \and as ", ")
  const author = pdfInfo(info.author.replace(/\s*\\and(?![A-Za-z])\s*/g, ", "))
  return { option, centered, k, theme, navigationSymbols, info, pdfTitle: title, pdfAuthor: author, body: src.slice(begin + 16, end), hooks }
}

/** a document information string as hyperref's \pdfstringdef makes it ("" for none) */
function pdfInfo(text: string): string {
  if (!text) return ""
  const s = pdfString(text)
  if (s === null) throw new Unsupported(`a PDF title or author with commands: ${text}`)
  return s
}
