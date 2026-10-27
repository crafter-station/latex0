// beamer's colors and fonts (beamerbasecolor.sty, beamerbasefont.sty) from the theme's
// data (data/beamer/<theme>.json, generated from TeX). \usebeamercolor{x} makes x's fg
// and bg the current fg and bg, keeping the current ones where x leaves them empty;
// \usebeamerfont{x} sets the NFSS attributes x sets.

import type { BeamerColor, BeamerFont, BeamerThemeData } from "../../layout/beamerdata"
import type { ClassOptionData, SizeCommand } from "../../layout/classdata"
import type { GlueSpec } from "../../layout/dimen"
import type { Font } from "../../layout/font"
import { fontAt, selectFont } from "../paragraph"
import { Colors } from "../xcolor"
import { beamerThemeFile } from "../data"
import { Unsupported } from "../unsupported"

/** the colors in force (beamer's fg and bg), as the driver gets them */
export interface ColorState { fg: string; bg: string }

export interface Theme { name: string; data: BeamerThemeData
  /** the inner theme (\useinnertheme): its templates */
  inner: "default" | "rounded" | "circles" | "rectangles"
  /** the footline: the outer theme's (\useoutertheme; the miniframes theme's by its footline option), or the default
   *  (empty) one */
  footline: "default" | "infolines" | "split" | "authorinstitutetitle" | "institutetitle"
  /** the headline: the outer theme's, or the default (empty) one */
  headline: "default" | "infolines" | "split" | "miniframes" | "tree" | "sidebar"
  /** the frame title's alignment (\setbeamertemplate{frametitle}[default][…]) */
  frametitle: "left" | "right"
  /** the sidebar theme's sidebar (\useoutertheme{sidebar}: on the left by default; none where its width is 0pt) */
  sidebar?: "left" | "right"
  /** the sidebar canvas's vertical shading ([vertical shading][top=…,bottom=…]: xcolor expressions) */
  sidebarCanvas?: { top: string; bottom: string }
  /** the sidebar theme's head (its height not 0pt): its headline, the frame title in it */
  sidebarHead?: true
  /** Boadilla's itemize subitem and subsubitem templates (\tiny triangles and stars in structure's fg) */
  boadillaItems?: true }

/** the presentation themes (\usetheme) the data has: the inner and outer themes they load, the headline they leave */
const PRESENTATION: Record<string, Partial<Theme>> = {
  CambridgeUS: { inner: "rounded", footline: "infolines", headline: "infolines" },
  AnnArbor: { inner: "rounded", footline: "infolines", headline: "infolines" },
  Boadilla: { inner: "rounded", footline: "infolines", headline: "default", boadillaItems: true },
  Pittsburgh: { inner: "circles", frametitle: "right" },
  Malmoe: { footline: "split", headline: "split" },
  Copenhagen: { inner: "rounded", footline: "split", headline: "split" },
  Luebeck: { inner: "rectangles", footline: "split", headline: "split" },
  Berlin: { inner: "rectangles", footline: "authorinstitutetitle", headline: "miniframes" },
  Dresden: { footline: "authorinstitutetitle", headline: "miniframes" },
  Ilmenau: { inner: "rounded", footline: "authorinstitutetitle", headline: "miniframes" },
  Szeged: { footline: "institutetitle", headline: "miniframes" },
  Montpellier: { headline: "tree" },
  Hannover: { inner: "circles", sidebar: "left", frametitle: "right" },
  Berkeley: { inner: "rectangles", sidebar: "left", sidebarHead: true, headline: "sidebar" },
  PaloAlto: { inner: "rounded", sidebar: "left", sidebarHead: true, headline: "sidebar" },
  Rochester: { inner: "rectangles", sidebarHead: true, headline: "sidebar" },
  Goettingen: { sidebar: "right", sidebarCanvas: { top: "structure.fg!25", bottom: "structure.fg!10" } },
  Marburg: { sidebar: "right", sidebarCanvas: { top: "palette quaternary.bg", bottom: "palette primary.bg" } },
}

export function loadTheme(name: string): Theme {
  const data = beamerThemeFile(name)
  const t: Theme = { name, data, inner: "default", footline: "default", headline: "default", frametitle: "left" }
  for (const line of data.preamble) {
    const inner = line.match(/^\\useinnertheme\{(rounded|circles|rectangles)\}$/)
    if (inner) t.inner = inner[1] as Theme["inner"]
    else if (line === "\\useoutertheme{infolines}") t.footline = t.headline = "infolines"
    else if (line === "\\useoutertheme{split}") t.footline = t.headline = "split"
    else if (line === "\\useoutertheme{miniframes}") t.headline = "miniframes"
    else if (line === "\\useoutertheme{tree}") t.headline = "tree"
    else if (line === "\\useoutertheme{sidebar}") Object.assign(t, { sidebar: "left", sidebarHead: true, headline: "sidebar" })
    else if (line === "\\setbeamertemplate{headline}[default]") t.headline = "default"
    else {
      const p = line.match(/^\\usetheme(?:\[[^\]]*\])?\{([A-Za-z]+)\}$/)
      if (p && p[1] in PRESENTATION) Object.assign(t, PRESENTATION[p[1]])
      else if (!line.startsWith("\\usecolortheme{")) throw new Unsupported(`beamer theme line ${line}`)
    }
  }
  return t
}

function color(t: Theme, name: string): BeamerColor {
  const c = t.data.colors[name]
  if (!c) throw new Unsupported(`beamer color ${name}`)
  return c
}

/** the document's outer level: normal text's fg and bg (beamerbasecolor.sty's \AtBeginDocument) */
export function outerColors(t: Theme): ColorState {
  const c = color(t, "normal text")
  return { fg: c.fg!, bg: c.bg! }
}

/** \usebeamercolor{name} where `at` is in force: the fg and bg after it */
export function useColor(t: Theme, name: string, at: ColorState): ColorState {
  const c = color(t, name), outer = outerColors(t)
  // the data resolved an expression with fg or bg in it at the outer level: elsewhere it is evaluated with the colors
  // in force
  if (c.contextual && (at.fg !== outer.fg || at.bg !== outer.bg)) {
    if (!c.fgExpr && !c.bgExpr) throw new Unsupported(`beamer color ${name} inside another`)
    return { fg: c.fgExpr ? evaluate(t, c.fgExpr, at) : c.fg ?? at.fg, bg: c.bgExpr ? evaluate(t, c.bgExpr, at) : c.bg ?? at.bg }
  }
  return { fg: c.fg ?? at.fg, bg: c.bg ?? at.bg }
}

/** an xcolor expression of a beamer color's (fg!40!bg, section in sidebar.fg!40!bg) where `at` is in force: fg and bg
 *  its colors, name.fg and name.bg the beamer color name's there */
export function evaluate(t: Theme, expr: string, at: ColorState): string {
  const mix = new Colors()
  const def = (n: string, spec: string) => { const [model, ...x] = spec.split(" "); mix.define(n, model, x.join(",")) }
  def("fg", at.fg); def("bg", at.bg)
  let n = 0
  const e = expr.split("!").map((part) => {
    const m = part.trim().match(/^(.+)\.(fg|bg)$/)
    if (!m) return part.trim()
    const name = `beamer${n++}`
    def(name, useColor(t, m[1], at)[m[2] as "fg" | "bg"])
    return name
  })
  return mix.spec(e.join("!"))
}

/** whether the theme leaves name's bg empty (\ifbeamercolorempty[bg]) */
export const emptyBackground = (t: Theme, name: string): boolean => color(t, name).bg === undefined

/** the size \usebeamerfont{name} leaves where `current` is in force: only sizes for now (the size is \usebeamerfont*'s
 *  too, \normalfont keeping the size) */
export function fontSize(t: Theme, k: ClassOptionData, name: string, current: SizeCommand): SizeCommand {
  const f = beamerFont(t, name)
  if (f.family || f.series || f.shape || f.encoding) throw new Unsupported(`beamer font ${name} with a family, series or shape`)
  const size = f.size ?? current
  if (!(size in k.sizes)) throw new Unsupported(`beamer's \\${size}`)
  return size as SizeCommand
}

/** A size's sans font and \baselineskip, beamer's \Tiny (\@setfontsize\Tiny{4}{5}: cmss8 below 9pt, ot1cmss.fd) among them */
export interface SizedFont { size: SizeCommand | "Tiny"; font: Font; baselineskip: GlueSpec }
const BEAMER_SIZES: Record<string, [number, number]> = { Tiny: [4, 5] }

/** the font \usebeamerfont{name} selects where the size `current` is in force (a size alone, as fontSize) */
export function sizedFont(t: Theme, k: ClassOptionData, name: string, current: SizedFont["size"]): SizedFont {
  const f = beamerFont(t, name)
  if (f.family || f.series || f.shape || f.encoding) throw new Unsupported(`beamer font ${name} with a family, series or shape`)
  const size = (f.size ?? current) as SizedFont["size"]
  const b = BEAMER_SIZES[size]
  if (b) return { size, font: fontAt("cmss8", b[0] * 65536), baselineskip: { width: b[1] * 65536, stretch: 0, stretchOrder: 0, shrink: 0, shrinkOrder: 0 } }
  if (!(size in k.sizes)) throw new Unsupported(`beamer's \\${size}`)
  return { size, font: selectFont(k, size as SizeCommand, { enc: "OT1", fam: "cmss", ser: "m", shape: "n" }), baselineskip: k.sizes[size as SizeCommand].baselineskip }
}

/** what \usebeamerfont{name} sets */
export function beamerFont(t: Theme, name: string): BeamerFont {
  const f = t.data.fonts[name]
  if (!f) throw new Unsupported(`beamer font ${name}`)
  return f
}
