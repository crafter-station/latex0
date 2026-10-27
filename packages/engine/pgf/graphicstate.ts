// pgf's graphic state commands (pgfcoregraphicstate.code.tex) on a driver. Colours are xcolor's: a colour
// expression becomes the model and values xcolor keeps (latex/xcolor.ts gives them as the driver's
// `<model> <v1> …` text), and \pgf@setstrokecolor hands the values to \pgfsys@color@<model>@stroke one
// argument each (\pgf@uncomma).

import { Unsupported } from "../latex/unsupported"
import type { ColorModel, ColorTarget, PgfDriver } from "./drivers"
import { TexArith } from "./fixed"
import { setLength } from "./points"
import type { PgfState } from "./state"

function setColor(d: PgfDriver, spec: string, target: ColorTarget) {
  const [model, ...values] = spec.split(" ")
  if (model !== "rgb" && model !== "cmyk" && model !== "cmy" && model !== "gray") throw new Unsupported(`pgf: colour model ${model}`)
  d.color(model as ColorModel, target, values)
}

/**
 * What \pgf@strokecolor@global and \pgf@fillcolor@global hold, which arrow tips compare: xcolor's
 * definition of pgfstrokecolor or pgffillcolor. A colour given by its name is \colorlet[named]
 * (pgfutil-latex.def 31–39), whose definition under dvips names the colour it defines; an expression's
 * does not.
 */
const colorKey = (d: PgfDriver, spec: string, named: boolean, target: string) => `${named && d.namedColors ? `named ${target}` : ""}|${spec}`

/**
 * \pgfsetstrokecolor (126–142), with the colour as xcolor's driver text (`rgb 1 0 0`); `named`: it was
 * given as a colour's name, not an expression
 */
export function pgfSetStrokeColor(d: PgfDriver, spec: string, named: boolean) {
  d.state.strokeColor = colorKey(d, spec, named, "pgfstrokecolor")
  setColor(d, spec, "stroke")
}
/** \pgfsetfillcolor (161–177) */
export function pgfSetFillColor(d: PgfDriver, spec: string, named: boolean) {
  d.state.fillColor = colorKey(d, spec, named, "pgffillcolor")
  setColor(d, spec, "fill")
}
/** \pgfsetcolor (186–202): \pgfsys@color@<model>, both at once (and both globals pgfstrokecolor's) */
export function pgfSetColor(d: PgfDriver, spec: string, named: boolean) {
  d.state.strokeColor = d.state.fillColor = colorKey(d, spec, named, "pgfstrokecolor")
  setColor(d, spec, "both")
}

/** a colour expression that is a colour's name */
export const isColorName = (expr: string) => /^\s*[A-Za-z][A-Za-z0-9]*\s*$/.test(expr) || expr.trim() === "."

/** \pgfsetlinewidth{#1} (9–13): \pgflinewidth, global */
export function pgfSetLineWidth(s: PgfState, d: PgfDriver, w: string) {
  s.lineWidth = setLength(w, s)
  d.setlinewidth(s.lineWidth)
}

/** \pgfsetdash{#1}{#2} (37–56): each dash length of #1 (one token or group each) and the phase, \pgfmathsetlength'ed */
export function pgfSetDash(s: PgfState, d: PgfDriver, pattern: string[], phase: string) {
  const lengths = pattern.map((x) => setLength(x, s))
  d.setdash(lengths, setLength(phase, s))
}

/** \pgfsetmiterlimit{#1} (30–33): below 1 pgf complains (not modeled) */
export function pgfSetMiterLimit(s: PgfState, d: PgfDriver, m: string) {
  if (new TexArith(s.units).dimen(`${m}pt`) < 65536) throw new Unsupported("pgf: a miter limit below 1")
  d.setmiterlimit(m)
}
