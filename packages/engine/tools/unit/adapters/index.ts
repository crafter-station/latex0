// Engine adapters: how a fixture becomes an engine layout. Today the engine
// cannot lay out arbitrary LaTeX, so each adapter states what it covers. As the
// engine grows, adapters collapse into one: render(src) → layout → trace.

import { document } from "../../../latex/document"
import { paragraph } from "../../../latex/paragraph"
import type { LayoutResult } from "../../../latex/result"
import type { Trace } from "../../../trace/schema"
import "../../data"
import { ORACLE_EPOCH } from "../../tex"

export type AdapterResult = LayoutResult
export type Adapter = (src: string, oracle: Trace) => AdapterResult

export const ADAPTERS: Record<string, Adapter> = {
  paragraph,
  // \today on the oracle's fixed date
  document: (src) => document(src, { epoch: ORACLE_EPOCH }),
}
