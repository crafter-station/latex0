// Layout tree: TeX's node types (§§ 133–160), dimensions in integer sp.
// Every renderer projection (trace, box tree, HTML, PDF) is computed from this.

import type { Font } from "./font"

export const NORMAL = 0, FIL = 1, FILL = 2, FILLL = 3
export type GlueOrder = 0 | 1 | 2 | 3
export const SIGN_NORMAL = 0, STRETCHING = 1, SHRINKING = 2
export type GlueSign = 0 | 1 | 2

export interface CharNode {
  kind: "char"; font: string; size: number; char: number; width: number; height: number; depth: number
  /** source characters for ligatures */
  text: string
  /** a ligature node (§ 143), even when it stands for itself or for nothing */
  ligature?: boolean
  /** ligature subtype: 2 if it began at the left boundary, +1 if it ended at the right boundary */
  ligHits?: number
}
export interface GlueNode {
  kind: "glue"; width: number; stretch: number; stretchOrder: GlueOrder; shrink: number; shrinkOrder: GlueOrder
  /** skip parameter this glue came from, e.g. "rightskip" (§ 149 subtype) */ param?: string
  /** \leaders, \cleaders, \xleaders: the box repeated in the glue's space (§ 149 a_leaders…x_leaders) */
  leaders?: { kind: "leaders" | "cleaders" | "xleaders"; box: BoxNode | RuleNode }
}
export interface KernNode { kind: "kern"; width: number; /** \kern from the source (vs. a font kern); explicit kerns are breakpoints (§ 155, 866) */ explicit?: boolean }
export interface PenaltyNode { kind: "penalty"; penalty: number }
/** null dimensions are "running" and take the enclosing box's size (§ 138). */
export interface RuleNode { kind: "rule"; width: number | null; height: number | null; depth: number | null }
export interface BoxNode {
  kind: "hlist" | "vlist"
  width: number; height: number; depth: number
  /** hlist inside a vlist: moved right; box inside an hlist: moved down (§ 135). */
  shift: number
  glueSet: number; glueSign: GlueSign; glueOrder: GlueOrder
  list: Node[]
  /** e-TeX's dlist subtype: a displayed formula or its equation number (shown ", display") */
  display?: boolean
  /** pdfTeX's \pdfrefximage: an image of the box's size (its list empty), the file's name */
  image?: string
}
/**
 * Discretionary (§ 145): `pre` ends the line and `post` starts the next if TeX
 * breaks here; otherwise the `replaceCount` nodes that follow it stay.
 */
export interface DiscNode { kind: "disc"; pre: Node[]; post: Node[]; replaceCount: number }
/** \\mathon / \\mathoff (§ 147), with \\mathsurround as width. */
export interface MathNode { kind: "math"; on: boolean; width: number }
/** A whatsit (§ 146) such as \\write: no size, but it can precede a break (§ 148). */
export interface WhatsitNode {
  kind: "whatsit"; text: string
  /** a float leaving vertical mode (LaTeX's \penalty-\@Miv \vbox{} \penalty-\@Miii): the output routine places it */
  float?: unknown
  /** not a node: an assignment the output routine sees when the page builder gets here (LaTeX's \global\@topnum\z@) */
  hook?: unknown
  /** a \marks node (§ 141): its class and value, which the output routine reads */
  mark?: { cls: number; value: unknown }
}
/**
 * An insertion (§ 140): \\insert n with its vertical list. `height` is the list's
 * natural height plus depth; `depth` is \\splitmaxdepth; `splitTopSkip` and
 * `floatCost` (\\floatingpenalty) are the values in force when it ended.
 */
export interface InsNode { kind: "ins"; n: number; height: number; depth: number; splitTopSkip: GlueNode; floatCost: number; list: Node[] }
/** \vadjust material (§ 158): it leaves its line and follows it on the vertical list (§ 655). */
export interface AdjustNode { kind: "adjust"; list: Node[] }
export type Node = CharNode | GlueNode | KernNode | PenaltyNode | RuleNode | BoxNode | DiscNode | WhatsitNode | MathNode | InsNode | AdjustNode

export const glue = (width: number, stretch = 0, stretchOrder: GlueOrder = NORMAL, shrink = 0, shrinkOrder: GlueOrder = NORMAL): GlueNode =>
  ({ kind: "glue", width, stretch, stretchOrder, shrink, shrinkOrder })
/** fil_glue, fill_glue and ss_glue (§ 162): \hfil and \vfil, \hfill and \vfill, \hss and \vss */
export const filGlue = (): GlueNode => glue(0, 65536, FIL)
export const fillGlue = (): GlueNode => glue(0, 65536, FILL)
export const ssGlue = (): GlueNode => glue(0, 65536, FIL, 65536, FIL)
/** Glue taken from a skip parameter (TeX shows it as \glue(\name)). */
export const paramGlue = (param: string, g: GlueNode): GlueNode => ({ ...g, param })
export const kern = (width: number, explicit = false): KernNode => (explicit ? { kind: "kern", width, explicit } : { kind: "kern", width })
export const penalty = (p: number): PenaltyNode => ({ kind: "penalty", penalty: p })
/** A character of a font as a char node (new_character, § 582, for a character the font has). */
export function charNode(f: Font, c: number, text = String.fromCharCode(c)): CharNode {
  const m = f.chars.get(c)
  if (!m) throw new Error(`${f.name} has no character ${c}`)
  return { kind: "char", font: f.name, size: f.size, char: c, width: m.width, height: m.height, depth: m.depth, text }
}
export const emptyDisc = (): DiscNode => ({ kind: "disc", pre: [], post: [], replaceCount: 0 })
export const emptyBox = (kind: "hlist" | "vlist", width = 0): BoxNode =>
  ({ kind, width, height: 0, depth: 0, shift: 0, glueSet: 0, glueSign: SIGN_NORMAL, glueOrder: NORMAL, list: [] })
