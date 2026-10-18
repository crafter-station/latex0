// Engine adapters: how a fixture becomes an engine layout. Today the engine
// cannot lay out arbitrary LaTeX, so each adapter states what it covers. As the
// engine grows, adapters collapse into one: render(src) → layout → trace.

import { document } from "../../../latex/document"
import { paragraph } from "../../../latex/paragraph"
import type { LayoutResult } from "../../../latex/result"
import type { Trace } from "../../../trace/schema"
import "../../data"
import { ORACLE_EPOCH } from "../../tex"
import { parseHeader } from "../header"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { bitmapInfo, type Bitmap } from "../../../latex/images"

export type AdapterResult = LayoutResult
export type Adapter = (src: string, oracle: Trace, path?: string) => AdapterResult

export const ADAPTERS: Record<string, Adapter> = {
  paragraph,
  // \today on the oracle's fixed date; the driver of the fixture's reference TeX
  // the images among the fixture's files, by their headers (as the app reads an upload's)
  document: (src, _, path) => {
    const h = parseHeader(src), images: Record<string, Bitmap> = {}
    for (const f of h.files) { const b = path && bitmapInfo(new Uint8Array(readFileSync(join(dirname(path), f)))); if (b) images[f] = b }
    return document(src, { epoch: ORACLE_EPOCH, driver: h.oracle === "pdflatex" ? "pdftex" : "dvips", images })
  },
}
