// Engine adapters: how a fixture becomes an engine layout. Today the engine
// cannot lay out arbitrary LaTeX, so each adapter states what it covers. As the
// engine grows, adapters collapse into one: render(src) → layout → trace.

import type { PageTrace, ParagraphTrace } from "../../../trace/decisions"
import type { BoxNode, Trace } from "../../../trace/schema"
import { document } from "./document"
import { paragraph } from "./paragraph"

export interface AdapterResult {
  trace: Trace
  /** line-breaking decisions, compared with TeX's \tracingparagraphs */
  decisions?: ParagraphTrace[]
  /** page-breaking decisions, compared with TeX's \tracingpages */
  pages?: PageTrace[]
  /** each page's main vertical list from \\topskip on, compared with TeX's page dumps */
  columns?: BoxNode[][]
  notes?: string[]
}
export type Adapter = (src: string, oracle: Trace) => AdapterResult

export const ADAPTERS: Record<string, Adapter> = { paragraph, document }
