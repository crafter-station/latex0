// beamer's colors and fonts (beamerbasecolor.sty, beamerbasefont.sty) from the theme's
// data (data/beamer/<theme>.json, generated from TeX). \usebeamercolor{x} makes x's fg
// and bg the current fg and bg, keeping the current ones where x leaves them empty;
// \usebeamerfont{x} sets the NFSS attributes x sets.

import type { BeamerColor, BeamerFont, BeamerThemeData } from "../../layout/beamerdata"
import type { ClassOptionData, SizeCommand } from "../../layout/classdata"
import { beamerThemeFile } from "../data"
import { Unsupported } from "../unsupported"

/** the colors in force (beamer's fg and bg), as the driver gets them */
export interface ColorState { fg: string; bg: string }

export interface Theme { name: string; data: BeamerThemeData }

export const loadTheme = (name: string): Theme => ({ name, data: beamerThemeFile(name) })

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
  // the data resolved an expression with fg or bg in it at the outer level only
  if (c.contextual && (at.fg !== outer.fg || at.bg !== outer.bg)) throw new Unsupported(`beamer color ${name} inside another`)
  return { fg: c.fg ?? at.fg, bg: c.bg ?? at.bg }
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

/** what \usebeamerfont{name} sets */
export function beamerFont(t: Theme, name: string): BeamerFont {
  const f = t.data.fonts[name]
  if (!f) throw new Unsupported(`beamer font ${name}`)
  return f
}
