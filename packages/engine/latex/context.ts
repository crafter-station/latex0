// One run of the document's layout, as its parts see it: the preamble, the
// state the run changes (RunState), the main vertical list, and the services
// the parts share. layout() builds it; each part (headings, lists, floats,
// front matter …) is a module of functions taking it first.

import type { SizeCommand } from "../layout/classdata"
import type { GlueSpec } from "../layout/dimen"
import type { Font } from "../layout/font"
import type { BoxNode, Node } from "../layout/nodes"
import type { ParagraphTrace } from "../trace/decisions"
import type { Counters } from "./counters"
import type { MarkWriter } from "./marks"
import type { DocState, FontAttrs, ParagraphOptions, Refs, TabularOuter } from "./paragraph"
import type { Preamble } from "./preamble"
import type { RunState } from "./run"
import type { TabCol, TabLine } from "./tabular"
import type { TocEntry } from "./toc"
import type { VerticalList } from "./vlist"

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
  counters: Counters
  /** \label, \ref and the .aux values the run before wrote */
  refs: Refs
  /** the class defines \chaptermark and \sectionmark (\ps@headings ran) */
  headings: boolean
  /** the main vertical list's last node, as \lastskip and \lastnodetype see it (a hook is no node) */
  lastNode(): Node | undefined
  /** counter commands in text (Counters.counted); a \refstepcounter outside text sets \@currentlabel and \@currentHref */
  counted(text: string, inText?: boolean): string
  /** hyperref's \addcontentsline: the bookmark line (to the depth of \c@tocdepth), then the toc line; each
   *  \protected@write adds \nobreak while \if@nobreak holds */
  contentsWrites(level: TocEntry["level"], number: string | null, title: string, anchorName: string, nobreak: boolean): Node[]
  /** a color (xcolor's \color[model]{spec}) as the driver's \special gets it */
  colorSpec(spec: string, model?: string): string
  /** a \label in vertical mode: \protected@write's \nobreak while \if@nobreak, \@esphack's then or while \if@noskipsec */
  esphackNobreaks(nobreak: boolean): Node[]
  /** \if@noskipsec \leavevmode: an empty paragraph (the indent box) in the \everypar in force */
  noskipsecPar(what: string): void
}
