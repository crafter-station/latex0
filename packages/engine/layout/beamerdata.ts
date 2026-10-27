// beamer themes as data: what a theme (\usetheme, \usecolortheme…) sets, read from
// TeX by `bun engine codegen` (tools/codegen/beamer.ts) into data/beamer/<theme>.json.
// Colors as the driver gets them (xcolor's \current@color), fonts as the NFSS
// attributes \usebeamerfont changes, sizes in sp per class size option.

/** A beamer color (\setbeamercolor's fg and bg), each as \usebeamercolor resolves it at the document's outer level,
 *  where fg and bg are normal text's: the driver's color ("rgb 0.2 0.2 0.7"), absent when the theme leaves it empty
 *  (the color in force then stays). `contextual`: an expression with the current fg or bg in it (fg!50!bg), so only
 *  right at the outer level. */
export interface BeamerColor { fg?: string; bg?: string; contextual?: true }

/** A beamer font: the NFSS attributes \usebeamerfont sets (absent: the current one stays). `size` is a size command
 *  (tiny … Huge, or beamer's Tiny and TINY). */
export interface BeamerFont { size?: string; family?: string; series?: string; shape?: string; encoding?: string }

/** One class size option under the theme: beamer's sizes (\beamer@calculateheadfoot's at \begin{document}, the text
 *  margins, the sidebars, geometry's margins), each in sp */
export interface BeamerThemeOption { dimens: Record<string, number> }

/** A theme: the preamble lines that load it, its colors and fonts by name, its sizes per class size option */
export interface BeamerThemeData {
  theme: string
  tex: string
  preamble: string[]
  colors: Record<string, BeamerColor>
  fonts: Record<string, BeamerFont>
  options: Record<string, BeamerThemeOption>
}
