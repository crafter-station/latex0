// Layout tree: TeX's node types (§§ 133–160), dimensions in integer sp.
// Every renderer projection (trace, box tree, HTML, PDF) is computed from this.

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
export interface GlueNode { kind: "glue"; width: number; stretch: number; stretchOrder: GlueOrder; shrink: number; shrinkOrder: GlueOrder; /** skip parameter this glue came from, e.g. "rightskip" (§ 149 subtype) */ param?: string }
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
}
/**
 * Discretionary (§ 145): `pre` ends the line and `post` starts the next if TeX
 * breaks here; otherwise the `replaceCount` nodes that follow it stay.
 */
export interface DiscNode { kind: "disc"; pre: Node[]; post: Node[]; replaceCount: number }
export type Node = CharNode | GlueNode | KernNode | PenaltyNode | RuleNode | BoxNode | DiscNode

export const glue = (width: number, stretch = 0, stretchOrder: GlueOrder = NORMAL, shrink = 0, shrinkOrder: GlueOrder = NORMAL): GlueNode =>
  ({ kind: "glue", width, stretch, stretchOrder, shrink, shrinkOrder })
/** Glue taken from a skip parameter (TeX shows it as \glue(\name)). */
export const paramGlue = (param: string, g: GlueNode): GlueNode => ({ ...g, param })
export const kern = (width: number, explicit = false): KernNode => (explicit ? { kind: "kern", width, explicit } : { kind: "kern", width })
export const penalty = (p: number): PenaltyNode => ({ kind: "penalty", penalty: p })
export const emptyDisc = (): DiscNode => ({ kind: "disc", pre: [], post: [], replaceCount: 0 })
export const emptyBox = (kind: "hlist" | "vlist", width = 0): BoxNode =>
  ({ kind, width, height: 0, depth: 0, shift: 0, glueSet: 0, glueSign: SIGN_NORMAL, glueOrder: NORMAL, list: [] })
