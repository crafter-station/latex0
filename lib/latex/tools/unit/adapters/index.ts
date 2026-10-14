// Engine adapters: how a fixture becomes an engine layout. Today the engine
// cannot lay out arbitrary LaTeX, so each adapter states what it covers. As the
// engine grows, adapters collapse into one: render(src) → layout → trace.

import type { ParagraphTrace } from "../../../trace/decisions"
import type { BoxNode, Trace } from "../../../trace/schema"
import { paragraph } from "./paragraph"

export interface AdapterResult { trace: Trace; /** line-breaking decisions, compared with TeX's \tracingparagraphs */ decisions?: ParagraphTrace[]; /** the main vertical list from \\topskip on, compared with TeX's page dump */ column?: BoxNode[]; notes?: string[] }
export type Adapter = (src: string, oracle: Trace) => AdapterResult

export const ADAPTERS: Record<string, Adapter> = { paragraph }
