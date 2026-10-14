// TFM writer (dev tooling): the inverse of tfm.ts, for synthetic fonts that
// exercise lig/kern features no Computer Modern font uses (boundary characters,
// every ligature op). Layout per "TeX: The Program" §§ 539–545.

import type { FixWordFont } from "../../layout/font"

export function writeTfm(f: FixWordFont): Uint8Array {
  const codes = [...f.chars.keys()].sort((a, b) => a - b)
  if (!codes.length) throw new Error("font has no characters")
  const bc = codes[0], ec = codes[codes.length - 1]
  const table = (pick: (m: { width: number; height: number; depth: number; italic: number }) => number, max: number, what: string) => {
    const vals = [0, ...new Set([...f.chars.values()].map(pick).filter((v) => v !== 0))]
    if (vals.length > max) throw new Error(`too many distinct ${what} (${vals.length} > ${max})`)
    return vals
  }
  const w = table((m) => m.width, 256, "widths"), h = table((m) => m.height, 16, "heights")
  const d = table((m) => m.depth, 16, "depths"), it = table((m) => m.italic, 64, "italics")
  const lh = 2, np = f.params.length - 1
  const lf = 6 + lh + (ec - bc + 1) + w.length + h.length + d.length + it.length + f.ligKern.length + f.kerns.length + 0 + np
  const buf = new Uint8Array(lf * 4)
  const dv = new DataView(buf.buffer)
  ;[lf, lh, bc, ec, w.length, h.length, d.length, it.length, f.ligKern.length, f.kerns.length, 0, np].forEach((v, i) => dv.setUint16(2 * i, v))
  let p = 6
  dv.setUint32(4 * p++, f.checksum >>> 0)
  dv.setInt32(4 * p++, f.designSize)
  for (let c = bc; c <= ec; c++, p++) {
    const m = f.chars.get(c)
    if (!m) continue // all-zero char_info: absent
    const wi = w.indexOf(m.width)
    if (wi <= 0) throw new Error(`char ${c} needs a nonzero width`)
    buf.set([wi, (h.indexOf(m.height) << 4) | d.indexOf(m.depth), (it.indexOf(m.italic) << 2) | m.tag, m.remainder], 4 * p)
  }
  for (const v of [...w, ...h, ...d, ...it]) dv.setInt32(4 * p++, v)
  for (const v of f.ligKern) dv.setUint32(4 * p++, v >>> 0)
  for (const v of f.kerns) dv.setInt32(4 * p++, v)
  for (let i = 1; i <= np; i++) dv.setInt32(4 * p++, f.params[i])
  if (p !== lf) throw new Error(`TFM size mismatch ${p} != ${lf}`)
  return buf
}
