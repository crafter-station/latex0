// Class data for dev tooling: committed data only (lib/latex/data/classes).

import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { ClassData, ClassOptionData } from "../layout/classdata"

const DIR = join(process.cwd(), "lib/latex/data/classes")
const memo = new Map<string, ClassData>()

export function classData(cls: string, option = "10pt"): ClassOptionData {
  let d = memo.get(cls)
  if (!d) { d = JSON.parse(readFileSync(join(DIR, `${cls}.json`), "utf8")) as ClassData; memo.set(cls, d) }
  const o = d.options[option]
  if (!o) throw new Error(`no data for ${cls} [${option}]`)
  return o
}

/** \documentclass[…]{cls} → class and size option (default 10pt). */
export function documentClass(src: string): { cls: string; option: string } {
  const m = src.match(/\\documentclass\s*(?:\[([^\]]*)\])?\s*\{(\w+)\}/)
  if (!m) throw new Error("no \\documentclass")
  const option = (m[1] ?? "").split(",").map((s) => s.trim()).find((o) => /^1[012]pt$/.test(o)) ?? "10pt"
  return { cls: m[2], option }
}
