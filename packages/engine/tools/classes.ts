// Class data for dev tooling: committed data only (packages/engine/data/classes).

import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { ClassData, ClassOptionData } from "../layout/classdata"

const DIR = join(process.cwd(), "packages/engine/data/classes")
const memo = new Map<string, ClassData>()

export function classData(cls: string, option = "10pt", extras: string[] = []): ClassOptionData {
  let d = memo.get(cls)
  if (!d) { d = JSON.parse(readFileSync(join(DIR, `${cls}.json`), "utf8")) as ClassData; memo.set(cls, d) }
  const o = d.options[option]
  if (!o) throw new Error(`no data for ${cls} [${option}]`)
  // the paper and side options: the last of each kind wins, as in the class's option processing
  const paper = [...extras].reverse().find((x) => PAPERS.includes(x)) ?? "letterpaper"
  const side = [...extras].reverse().find((x) => x === "oneside" || x === "twoside") ?? (cls === "book" ? "twoside" : "oneside")
  const v = o.variants?.[`${paper},${side}`]
  if (!v) return o
  return withTextHeight({ ...o, dimens: { ...o.dimens, ...v.dimens }, ints: { ...o.ints, ...v.ints } })
}

/** The float rooms \@floatplacement and \@flsettextmin take from \textheight: <fraction>\@colht, x_n_over_d (§ 455). */
export function withTextHeight(k: ClassOptionData): ClassOptionData {
  const h = k.dimens.textheight, f = (n: string) => Math.trunc((h * k.ints[n]) / 65536) // the fractions are below 1
  return { ...k, dimens: { ...k.dimens, toproom: f("topfraction"), botroom: f("bottomfraction"), textmin: f("textfraction"), fpmin: f("floatpagefraction") } }
}

const PAPERS = ["letterpaper", "a4paper", "a5paper", "b5paper", "legalpaper", "executivepaper"]
/** Class options that change nothing on the page for the classes laid out */
const NEUTRAL = ["final", "onecolumn", "notitlepage", "openany", "10pt", "11pt", "12pt"]

/** \documentclass[…]{cls} → class, size option (default 10pt), the paper and side options, and the options not modeled. */
export function documentClass(src: string): { cls: string; option: string; extras: string[]; unknown: string[] } {
  const m = src.match(/\\documentclass\s*(?:\[([^\]]*)\])?\s*\{(\w+)\}/)
  if (!m) throw new Error("no \\documentclass")
  const opts = (m[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean)
  const option = [...opts].reverse().find((o) => /^1[012]pt$/.test(o)) ?? "10pt"
  const extras = opts.filter((o) => PAPERS.includes(o) || o === "oneside" || o === "twoside")
  const unknown = opts.filter((o) => !extras.includes(o) && !NEUTRAL.includes(o) && !(o === "openany" && m[2] !== "book"))
  return { cls: m[2], option, extras, unknown }
}
