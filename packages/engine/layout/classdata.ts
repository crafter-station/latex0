// Class parameters as data (#44): what article/report/book set for each size
// option, read from TeX by `bun engine codegen` (tools/codegen/classes.ts).
// Dimensions in sp; glue as GlueSpec.

import type { GlueSpec } from "./dimen"

export const SIZE_COMMANDS = ["tiny", "scriptsize", "footnotesize", "small", "normalsize", "large", "Large", "LARGE", "huge", "Huge"] as const
export type SizeCommand = (typeof SIZE_COMMANDS)[number]

export interface FontRef { name: string; at: number }

/** One size command: \@setfontsize plus what the .clo sets with it. */
export interface SizeData {
  /** \f@size, and the math sizes \sf@size, \ssf@size (fontdef \DeclareMathSizes) */
  size: number
  scriptSize: number
  scriptScriptSize: number
  /** the upright roman font at this size: TFM name and at-size */
  font: FontRef
  baselineskip: GlueSpec
  /** display skips; set by \normalsize, \small and \footnotesize, inherited by the others */
  /** math families 0–3 (roman, math italic, symbols, extension) at text, script and scriptscript size */
  math: { text: FontRef[]; script: FontRef[]; scriptscript: FontRef[] }
  /** the same with amsmath loaded, which declares the extension font (family 3) at every size */
  mathAms: { text: FontRef[]; script: FontRef[]; scriptscript: FontRef[] }
  /** the math alphabets' families (\mathbf, \mathit, \mathsf, \mathtt): text, script and scriptscript fonts */
  alphabets: Record<"mathbf" | "mathit" | "mathsf" | "mathtt", FontRef[]>
  /** the bold extended roman (\bfseries) at this size */
  bold: FontRef
  /** the text companion font (TS1: \textbullet…) at this size */
  companion: FontRef
  /** the roman and bold fonts with \usepackage[T1]{fontenc}: the EC fonts */
  t1: { font: FontRef; bold: FontRef }
  /** the font LaTeX selects for "encoding/family/series/shape" (OT1 or T1; cmr, cmss, cmtt; m, bx; n, it, sl, sc) */
  fonts: Record<string, FontRef & { hyphenchar: number; declared: boolean }>
  /** \strutbox as \@setfontsize makes it: 0.7 and 0.3 \baselineskip */
  strut: { height: number; depth: number }
  abovedisplayskip: GlueSpec
  belowdisplayskip: GlueSpec
  abovedisplayshortskip: GlueSpec
  belowdisplayshortskip: GlueSpec
}

export interface ClassOptionData {
  dimens: Record<string, number>
  glue: Record<string, GlueSpec>
  ints: Record<string, number>
  sizes: Record<SizeCommand, SizeData>
  /** setspace: the sizes single-spaced, as floats and footnotes select them */
  singleSizes?: Record<SizeCommand, SizeData>
  /** array.sty loaded: its tabular and array, and \extrarowheight (added to \@arstrutbox's height) */
  array?: { extrarowheight: number }
  /** the hyphenation patterns of \language (data/hyphenation/<id>.json): babel's main language's; en-us when not set */
  patterns?: string
  /** what the paper and side options change ("a4paper,twoside"), against the class defaults */
  variants?: Record<string, { dimens: Record<string, number>; ints: Record<string, number> }>
  /** font packages (#340): the families \rmdefault, \sfdefault and \ttdefault name, whose fonts the FontAttrs families
   *  cmr, cmss and cmtt then select (absent: Computer Modern's) */
  families?: { rm: string; sf: string; tt: string }
}

/** A class: its data for each size option ("10pt", "11pt", "12pt"). */
export interface ClassData { class: string; tex: string; options: Record<string, ClassOptionData> }

/** A font family past Computer Modern (data/nfss/<family>.json, #340): at each font size (sp), the font NFSS selects
 *  for each "encoding/series/shape", its \hyphenchar, and whether the .fd file declares that shape */
export interface FamilyData { family: string; tex: string; sizes: Record<string, Record<string, FontRef & { hyphenchar: number; declared: boolean }>> }

/** A package's math fonts (data/nfss/math-<package>.json): by "\f@size:\sf@size:\ssf@size" in sp, the math families
 *  0–3 (also after amsmath) and the math alphabets' fonts */
export interface MathFontData { package: string; tex: string; sizes: Record<string, Pick<SizeData, "math" | "mathAms" | "alphabets">> }
