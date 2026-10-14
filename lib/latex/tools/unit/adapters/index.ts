// Engine adapters: how a fixture becomes an engine layout. Today the engine
// cannot lay out arbitrary LaTeX, so each adapter states what it covers. As the
// engine grows, adapters collapse into one: render(src) → layout → trace.

import type { Trace } from "../../../trace/schema"
import { paragraph } from "./paragraph"

export interface AdapterResult { trace: Trace; notes?: string[] }
export type Adapter = (src: string, oracle: Trace) => AdapterResult

export const ADAPTERS: Record<string, Adapter> = { paragraph }
