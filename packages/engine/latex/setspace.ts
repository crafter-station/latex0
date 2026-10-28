// setspace: \baselinestretch, which \set@fontsize applies to every size it selects (\baselineskip
// \f@linespread\baselineskip, a dimension, and the \strutbox .7 and .3 of it); floats and footnotes
// single-spaced (setspace's \@xfloat and \@footnotetext); and its \everydisplay, which multiplies the four
// display skips by \displayskipstretch (a glue times a factor: a dimension).

import type { ClassOptionData, SizeCommand, SizeData } from "../layout/classdata"
import { parseDimen, type GlueSpec } from "../layout/dimen"
import { Unsupported } from "./unsupported"

/** `factor` times a dimension, as TeX scans <decimal><internal dimen> (§ 455) */
export const times = (factor: string, sp: number) => parseDimen(`${factor}\\x`, { em: 0, ex: 0, internal: () => ({ level: "dimen", value: sp }) })

const dimenGlue = (width: number): GlueSpec => ({ width, stretch: 0, stretchOrder: 0, shrink: 0, shrinkOrder: 0 })

/** \onehalfspacing and \doublespacing: setspace's stretch for \@ptsize (10pt, 11pt, 12pt) */
const STRETCH = { onehalfspacing: ["1.25", "1.213", "1.241"], doublespacing: ["1.667", "1.618", "1.655"] } as const

/** \baselinestretch (empty, the kernel's, until a spacing command) and \displayskipstretch when set apart from it */
export interface SetSpace { stretch: string; display: string }

/** \usepackage[options]{setspace}: \ProcessOptions in declaration order, each spacing \AtEndOfPackage */
export function setspaceOptions(options: string, option: string): SetSpace {
  const given = new Set(options.split(",").map((o) => o.trim()).filter(Boolean))
  for (const o of given) if (!["nodisplayskipstretch", "singlespacing", "onehalfspacing", "doublespacing"].includes(o)) throw new Unsupported(`setspace option ${o}`)
  const s: SetSpace = { stretch: "", display: given.has("nodisplayskipstretch") ? "1.0" : "" }
  // \singlespacing's \vskip\baselineskip in the preamble is glue the empty page discards
  for (const o of ["singlespacing", "onehalfspacing", "doublespacing"] as const) if (given.has(o)) spacing(s, o, option)
  return s
}

/** \singlespacing, \onehalfspacing, \doublespacing or \setstretch{factor} in the preamble; false if the line is not one */
export function setspaceCommand(s: SetSpace, line: string, option: string): boolean {
  const m = line.match(/^\\(singlespacing|onehalfspacing|doublespacing)$/) ?? line.match(/^\\setstretch\{\s*([0-9]*\.?[0-9]+)\s*\}$/)
  if (!m) return false
  if (line.startsWith("\\setstretch")) s.stretch = m[1]
  else spacing(s, m[1] as "singlespacing", option)
  return true
}

function spacing(s: SetSpace, cmd: "singlespacing" | "onehalfspacing" | "doublespacing", option: string) {
  s.stretch = cmd === "singlespacing" ? "1" : STRETCH[cmd][["10pt", "11pt", "12pt"].indexOf(option)] ?? STRETCH[cmd][0]
}

/**
 * Every size as \set@fontsize selects it with \baselinestretch `stretch`, and its display skips as \everydisplay
 * leaves them (an empty factor, the kernel's \baselinestretch, changes neither: \baselineskip\baselineskip; `display`
 * null: no setspace, no \everydisplay)
 */
export function stretchedSizes(sizes: Record<SizeCommand, SizeData>, stretch: string, display: string | null): Record<SizeCommand, SizeData> {
  const factor = display === null ? "" : display || stretch
  return Object.fromEntries(Object.entries(sizes).map(([name, d]) => {
    const bs = stretch ? times(stretch, d.baselineskip.width) : 0
    return [name, {
      ...d, ...(stretch ? { baselineskip: dimenGlue(bs), strut: { height: times(".7", bs), depth: times(".3", bs) } } : {}),
      ...(factor ? Object.fromEntries((["abovedisplayskip", "belowdisplayskip", "abovedisplayshortskip", "belowdisplayshortskip"] as const).map((g) => [g, dimenGlue(times(factor, d[g].width))])) : {}),
    }]
  })) as Record<SizeCommand, SizeData>
}

/** The class data with setspace: the stretched sizes, and the single-spaced ones floats and footnotes select */
export function withSetspace(k: ClassOptionData, s: SetSpace): ClassOptionData {
  return { ...k, sizes: stretchedSizes(k.sizes, s.stretch, s.display), singleSizes: stretchedSizes(k.sizes, "1", s.display || "1") }
}

/** The class data as a float or a footnote sees it: single-spaced */
export const singleSpaced = (k: ClassOptionData): ClassOptionData => (k.singleSizes ? { ...k, sizes: k.singleSizes } : k)
