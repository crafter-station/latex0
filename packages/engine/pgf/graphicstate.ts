// pgf's graphic state commands (pgfcoregraphicstate.code.tex) on a driver. Colours are xcolor's: a colour
// expression becomes the model and values xcolor keeps (latex/xcolor.ts gives them as the driver's
// `<model> <v1> …` text), and \pgf@setstrokecolor hands the values to \pgfsys@color@<model>@stroke one
// argument each (\pgf@uncomma).

import { Unsupported } from "../latex/unsupported"
import type { ColorModel, ColorTarget, PgfDriver } from "./drivers"
import { setLength } from "./points"
import type { PgfState } from "./state"

function setColor(d: PgfDriver, spec: string, target: ColorTarget) {
  const [model, ...values] = spec.split(" ")
  if (model !== "rgb" && model !== "cmyk" && model !== "cmy" && model !== "gray") throw new Unsupported(`pgf: colour model ${model}`)
  d.color(model as ColorModel, target, values)
}

/** \pgfsetstrokecolor (126–142), with the colour as xcolor's driver text (`rgb 1 0 0`) */
export const pgfSetStrokeColor = (d: PgfDriver, spec: string) => setColor(d, spec, "stroke")
/** \pgfsetfillcolor (161–177) */
export const pgfSetFillColor = (d: PgfDriver, spec: string) => setColor(d, spec, "fill")
/** \pgfsetcolor (186–202): \pgfsys@color@<model>, both at once */
export const pgfSetColor = (d: PgfDriver, spec: string) => setColor(d, spec, "both")

/** \pgfsetlinewidth{#1} (9–13): \pgflinewidth, global */
export function pgfSetLineWidth(s: PgfState, d: PgfDriver, w: string) {
  s.lineWidth = setLength(w, s)
  d.setlinewidth(s.lineWidth)
}

