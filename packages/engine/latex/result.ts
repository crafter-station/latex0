// What laying out a document produces: the shipped pages as a trace, plus the
// decisions behind them, which the conformance tooling compares with TeX's.

import type { PageTrace, ParagraphTrace } from "../trace/decisions"
import type { BoxNode, Trace } from "../trace/schema"
import type { PageView } from "../emit/svg"

export interface LayoutResult {
  trace: Trace
  /** line-breaking decisions, compared with TeX's \tracingparagraphs */
  decisions?: ParagraphTrace[]
  /** page-breaking decisions, compared with TeX's \tracingpages */
  pages?: PageTrace[]
  /** each page's main vertical list from \\topskip on, compared with TeX's page dumps (null for a page of floats) */
  columns?: (BoxNode[] | null)[]
  notes?: string[]
  /** what drawing the pages needs besides the trace (emit/svg) */
  view?: PageView
}
