// One run of the document's layout, as its parts see it: the preamble, the
// state the run changes (RunState), the main vertical list, and the services
// the parts share. layout() builds it; each part (headings, lists, floats,
// front matter …) is a module of functions taking it first.

import type { SizeCommand } from "../layout/classdata"
import type { GlueSpec } from "../layout/dimen"
import type { Font } from "../layout/font"
import type { BoxNode } from "../layout/nodes"
import type { ParagraphTrace } from "../trace/decisions"
import type { Block } from "./blocks"
import type { MarkWriter } from "./marks"
import type { DocState, FontAttrs, ParagraphOptions, TabularOuter } from "./paragraph"
import type { Preamble } from "./preamble"
import type { RunState } from "./run"
import type { TabCol, TabLine } from "./tabular"
import type { TocEntry } from "./toc"
import type { VerticalList } from "./vlist"

export type Heading = Extract<Block, { kind: "heading" }>

export interface Ctx {
  pre: Preamble
  run: RunState
  /** the main vertical list */
  v: VerticalList
  /** what paragraphs read and write: footnotes, references, colors, tabulars and minipages in text */
  doc: DocState
  /** the line-breaking decisions so far, compared with TeX's */
  decisions: ParagraphTrace[]
  /** the .toc file the run before wrote (null: none yet) */
  toc: TocEntry[] | null
  marks: MarkWriter
  /** \pagestyle{headings}: \@mkboth is \markboth */
  mkboth: boolean
  /** the class's \normalsize roman, the font of \parskip and of skips in em and ex */
  romanFont: Font
  roman: { name: string; at: number }
  bodyUnits: { em: number; ex: number }
  /** the date \today prints, in seconds since 1970 */
  epoch: number
  /** \parskip at the outer level */
  outerParskip: GlueSpec
  /** a paragraph of text on the main vertical list, after \parskip */
  typeset(text: string, opts: ParagraphOptions, parskip: GlueSpec, size?: SizeCommand): void
  tabular(lines: TabLine[], cols: TabCol[], size: SizeCommand, pos: "t" | "b" | "c", attrs?: FontAttrs, sfcodes?: Record<number, number>, outer?: TabularOuter): BoxNode
  heading(b: Heading): void
  chapter(b: Heading): void
}
