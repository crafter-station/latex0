// A beamer document's class options and preamble (beamer.cls 3.77). The class
// loads geometry (paper 128mm × 96mm, 1cm side margins), xcolor, hyperref,
// amsmath, amssymb, amsthm, graphicx, url and enumerate itself, so a \usepackage
// of one of them changes nothing. The themes are the default ones, color themes
// and the infolines outer theme (with the default headline), as data/beamer has
// them, with the navigation symbols switched off: any other theme or template
// setting throws Unsupported.

import type { ClassOptionData } from "../../layout/classdata"
import { classFile } from "../data"
import { pdfString } from "../hyperref"
import { Unsupported } from "../unsupported"
import { loadTheme, type Theme } from "./theme"

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
  /** between \begin{document} and \end{document} */
  body: string
}

export interface TitleInfo { title: string; subtitle: string; author: string; institute: string; date: string
  /** the short forms (\@dblarg's optional argument, the text itself without one), which the head and foot lines print */
  short: { title: string; subtitle: string; author: string; institute: string; date: string } }

/** \DeclareOptionBeamer for the sizes: 8pt … 20pt, bigger (12pt) and smaller (10pt) */
const SIZES: Record<string, string> = { "8pt": "8pt", "9pt": "9pt", "10pt": "10pt", "11pt": "11pt", "12pt": "12pt", "14pt": "14pt", "17pt": "17pt", "20pt": "20pt", bigger: "12pt", smaller: "10pt" }
/** the themes data/beamer has (tools/codegen/beamer.ts), by the parts of their preamble lines: color themes, then the
 *  infolines outer theme with the default headline */
const THEMES = ["default", "whale", "orchid", "seahorse", "beaver", "dolphin", "whale-orchid", "infolines", "whale-infolines", "orchid-infolines",
  "seahorse-infolines", "beaver-infolines", "dolphin-infolines", "whale-orchid-infolines"]
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
  const pre = src.slice(src.indexOf(m[0]) + m[0].length, begin).replace(/(^|[^\\])%.*$/gm, "$1")
  let navigationSymbols = true
  const info: TitleInfo = { title: "", subtitle: "", author: "", institute: "", date: "\\today", short: { title: "", subtitle: "", author: "", institute: "", date: "\\today" } }
  /** the theme lines (other than the default themes'), and the theme they name */
  const themeLines: string[] = [], themeParts: string[] = []
  for (const line of pre.split("\n").map((l) => l.trim()).filter(Boolean)) {
    if (/^\\use(?:color|font|inner|outer)?theme\{default\}$/.test(line)) {
      // (the class loads the default themes; after another theme, loading one again would set some things back)
      if (themeLines.length) throw new Unsupported(`beamer: ${line} after another theme`)
      continue
    }
    const color = line.match(/^\\usecolortheme\{([A-Za-z]+)\}$/)
    if (color) { themeLines.push(line); themeParts.push(color[1]); continue }
    if (line === "\\useoutertheme{infolines}") { themeLines.push(line); themeParts.push("infolines"); continue }
    // (infolines' headline set back to the default one, as Madrid does)
    if (line === "\\setbeamertemplate{headline}[default]" && themeLines.at(-1) === "\\useoutertheme{infolines}") { themeLines.push(line); continue }
    if (line === "\\setbeamertemplate{navigation symbols}{}") { navigationSymbols = false; continue }
    const pk = line.match(/^\\usepackage\{([a-z,\s]+)\}$/)
    if (pk && pk[1].split(",").every((n) => LOADED.includes(n.trim()))) continue
    // \title, \subtitle, \author, \institute and \date keep their text (\@dblarg: an optional short form);
    // only the title page and the head and foot lines print them
    const t = line.match(/^\\(title|subtitle|author|institute|date)(?:\[([^\]]*)\])?\{(.*)\}$/)
    if (t) { const key = t[1] as keyof TitleInfo["short"]; info[key] = t[3].trim(); info.short[key] = (t[2] ?? t[3]).trim(); continue }
    throw new Unsupported(`beamer preamble: ${line}`)
  }
  if (navigationSymbols) throw new Unsupported("beamer's navigation symbols")
  const name = themeParts.join("-") || "default"
  if (!THEMES.includes(name)) throw new Unsupported(`beamer theme ${themeLines.join(" ")}`)
  const theme = loadTheme(name)
  // (the data is for these lines in this order: infolines with its own headline, or another order, has none)
  if (theme.data.preamble.join("\n") !== themeLines.join("\n")) throw new Unsupported(`beamer theme ${themeLines.join(" ")}`)
  const cls = classFile("beamer").options[option]
  const k: ClassOptionData = { ...cls, dimens: { ...cls.dimens, ...theme.data.options[option].dimens } }
  // beamerbasetitle.sty's \beamer@firstminutepatches: pdftitle={\inserttitle\ - \insertsubtitle}; \beamer@author:
  // pdfauthor={\beamer@andstripped}
  const title = pdfInfo(info.title + (info.subtitle ? ` - ${info.subtitle}` : ""))
  // (\beamer@stripands, then \and as ", ")
  const author = pdfInfo(info.author.replace(/\s*\\and(?![A-Za-z])\s*/g, ", "))
  return { option, centered, k, theme, info, pdfTitle: title, pdfAuthor: author, body: src.slice(begin + 16, end) }
}

/** a document information string as hyperref's \pdfstringdef makes it ("" for none) */
function pdfInfo(text: string): string {
  if (!text) return ""
  const s = pdfString(text)
  if (s === null) throw new Unsupported(`a PDF title or author with commands: ${text}`)
  return s
}
