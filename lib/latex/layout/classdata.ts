// Class parameters as data (#44): what article/report/book set for each size
// option, read from TeX by `bun engine codegen` (tools/codegen/classes.ts).
// Dimensions in sp; glue as GlueSpec.

import type { GlueSpec } from "./dimen"

export const SIZE_COMMANDS = ["tiny", "scriptsize", "footnotesize", "small", "normalsize", "large", "Large", "LARGE", "huge", "Huge"] as const
export type SizeCommand = (typeof SIZE_COMMANDS)[number]

/** One size command: \@setfontsize plus what the .clo sets with it. */
export interface SizeData {
  /** \f@size, and the math sizes \sf@size, \ssf@size (fontdef \DeclareMathSizes) */
  size: number
  scriptSize: number
  scriptScriptSize: number
  /** the upright roman font at this size: TFM name and at-size */
  font: { name: string; at: number }
  baselineskip: GlueSpec
  /** display skips; set by \normalsize, \small and \footnotesize, inherited by the others */
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
}

/** A class: its data for each size option ("10pt", "11pt", "12pt"). */
export interface ClassData { class: string; tex: string; options: Record<string, ClassOptionData> }
