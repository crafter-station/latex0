// enumitem (enumitem.sty v3.11) for itemize, enumerate and description: the package options, \setlist, and
// what \enit@preset does with the keys of a list (\setlist's for list, list<depth>, the type and type<level>,
// then the list's own, with resume* and the delayed ref=), then \enit@calcleft; the labels (\enit@normlabel)
// and references (\enit@reflabel) with their counters, and resume's saved counters and keys.

import { parseDimen, parseGlue, type GlueSpec, type ScanEnv } from "../layout/dimen"
import { representation } from "./counters"
import { Unsupported } from "./unsupported"

/** The package's options and \setlist's keys by \enit@@<name><level> (name list, enum, item or description; level
 *  in roman numerals, none for all levels) */
export interface Enumitem { shortlabels: boolean; sets: Map<string, string> }

const ROMAN = ["", "i", "ii", "iii", "iv", "v", "vi"]
/** \enit@short<type>: \setlist's names for the types */
const SHORT: Record<string, string> = { enumerate: "enum", itemize: "item", description: "description" }

/** \usepackage[options]{enumitem}: shortlabels, and inline (which only defines enumerate*, itemize* and description*) */
export function enumitemOptions(options: string): Enumitem {
  const e: Enumitem = { shortlabels: false, sets: new Map() }
  for (const o of options.split(",").map((x) => x.trim()).filter(Boolean)) {
    if (o === "shortlabels") e.shortlabels = true
    else if (o !== "inline") throw new Unsupported(`enumitem option ${o}`)
  }
  return e
}

/** \setlist[names and levels]{keys} and \setlist* (which adds to the keys) in the preamble; false if the line is not one */
export function setlist(e: Enumitem, line: string): boolean {
  const m = line.match(/^\\setlist(\*?)\s*(?:\[([^\]]*)\])?\s*\{(.*)\}$/)
  if (!m) return false
  if (!balanced(m[3])) throw new Unsupported(`preamble: ${line}`)
  const names: string[] = [], levels: number[] = []
  for (const x of (m[2] ?? "").split(",").map((y) => y.trim()).filter(Boolean)) {
    if (x in SHORT) names.push(SHORT[x])
    else if (/^\d+$/.test(x) && Number(x) < ROMAN.length) levels.push(Number(x))
    else throw new Unsupported(`\\setlist[${m[2]}]`) // (trivlist, custom lists)
  }
  for (const name of names.length ? names : ["list"]) for (const level of levels.length ? levels : [0]) {
    const key = name + ROMAN[level], was = e.sets.get(key)
    e.sets.set(key, m[1] && was !== undefined ? `${was},${m[3]}` : m[3])
  }
  return true
}

/** The list parameters the keys set (\topsep … glue, the others dimensions) */
export interface ListDims {
  leftmargin: number; labelwidth: number; labelsep: number; labelindent: number; itemindent: number; listparindent: number; rightmargin: number
  topsep: GlueSpec; partopsep: GlueSpec; parsep: GlueSpec; itemsep: GlueSpec
}

/** What one list's keys leave besides its parameters */
export interface ListSetup {
  /** \@itemlabel as \enit@normlabel leaves it: the source, its counters \arabic{enumi} and so on (null: the type's own) */
  label: string | null
  /** \the<counter> as label= or ref= set it, without the \p@ prefix (null: LaTeX's) */
  ref: string | null
  /** the counter before the first item (start=, resume); null: zero (\usecounter) */
  counter: number | null
  /** \enit@align: right (\nobreak\hss\llap{label}) or left (\nobreak label\hfil) */
  align: "right" | "left"
  /** \enit@format (font=, format=): a declaration before the label, in its group */
  format: string | null
  /** description: \makelabel boxed (style=standard) or \enit@postlabel's; with nextline a label wider than
   *  \labelwidth ends its line */
  boxdesc: boolean; nextline: boolean
  /** the list's own keys, which a later resume* applies again */
  keys: string
}

/** resume's saved state in a group: the last list of each type, its counter (enumerate) and own keys */
export type ResumeScope = Map<string, { level: number; counter: number | null; keys: string }>

export interface Preset {
  env: "itemize" | "enumerate" | "description"
  e: Enumitem
  /** \@listdepth, and the list's depth among lists of its type */
  depth: number; level: number
  dims: ListDims
  /** the font's em and ex where the keys are read */
  units: { em: number; ex: number }
  /** \parindent there (the outer list's, inside a list), and \linewidth and \textwidth */
  parindent: number; linewidth: number; textwidth: number
  /** the enclosing list's \@itemlabel of the same type (label*) */
  prevLabel: string | null
  /** \settowidth\labelwidth{\@itemlabel}: the width of a label with the widest values (null: the type's own) */
  widest(label: string | null): number
  scope: ResumeScope
  /** the list's own keys */
  own: string
}

/** enumitem's keys known to \enit@first (a short label is anything else) */
const KEYS = new Set(["topsep", "itemsep", "parsep", "partopsep", "widest", "widest*", "labelindent*", "labelindent", "labelwidth", "leftmargin", "itemindent", "listparindent", "rightmargin", "labelsep*", "labelsep", "left", "series", "resume", "resume*", "start", "beginpenalty", "midpenalty", "endpenalty", "format", "font", "style", "align", "label", "label*", "ref", "itemjoin", "itemjoin*", "afterlabel", "mode", "before", "before*", "after", "after*", "first", "first*", "nolistsep", "nosep", "noitemsep", "wide", "fullwidth"])

/** \enit@preset and \enit@calcleft: the keys in order, then the parameter computed (\enit@calc) */
export function preset(p: Preset): ListSetup {
  const { env, dims: d, level } = p
  const ctr = `enum${ROMAN[level]}`
  const s: ListSetup = { label: null, ref: null, counter: null, align: env === "description" ? "left" : "right", format: null, boxdesc: env === "description", nextline: false, keys: p.own }
  // \enit@calc: the parameter \enit@calcleft computes (0 labelindent, 1 labelwidth, 2 labelsep, 3 leftmargin,
  // 4 itemindent); with * from the label's width (\enit@calcwidest)
  let calc = 0, calcwidest = false
  if (env === "description") calc = 4 // \enit@style@standard: itemindent=!
  const calcset = (param: "labelindent" | "labelwidth" | "labelsep" | "leftmargin" | "itemindent", n: number, v: string) => {
    if (v === "*" || v === "!") { calcwidest = v === "*"; calc = n; return }
    if (calc === n) { calcwidest = false; calc = 0 }
    d[param] = dimen(v)
  }
  const internal = (name: string) => {
    const x: Record<string, number> = { parindent: p.parindent, linewidth: p.linewidth, textwidth: p.textwidth, labelsep: d.labelsep, labelwidth: d.labelwidth, leftmargin: d.leftmargin, itemindent: d.itemindent, labelindent: d.labelindent, listparindent: d.listparindent, rightmargin: d.rightmargin }
    return name in x ? { level: "dimen" as const, value: x[name] } : undefined
  }
  const env_ = (): ScanEnv => ({ ...p.units, internal })
  const dimen = (v: string) => { try { return parseDimen(v, env_()) } catch { throw new Unsupported(`enumitem length ${v}`) } }
  const skip = (v: string) => { try { return parseGlue(v, env_()) } catch { throw new Unsupported(`enumitem length ${v}`) } }
  const zero = (): GlueSpec => ({ width: 0, stretch: 0, stretchOrder: 0, shrink: 0, shrinkOrder: 0 })
  /** \enit@normlabel: the label's \arabic* and the like as the counter of this level */
  const norm = (src: string) => src.replace(/\\(arabic|alph|Alph|roman|Roman)\*/g, (_, style: string) => {
    if (env !== "enumerate") throw new Unsupported(`\\${style}* in ${env}`)
    return `\\${style}{${ctr}}`
  })
  let label: string | null = null, labelRef = false
  const short = p.e.shortlabels && env !== "description" ? env : null // (\enit@shl: not description's)
  const apply = (group: string, own: boolean) => {
    let ref: string | null = null
    for (const [k, v] of keyvals(group, short)) {
      const val = () => { if (v === null) throw new Unsupported(`enumitem key ${k} without a value`); return v }
      switch (k) {
        case "topsep": d.topsep = skip(val()); break
        case "itemsep": d.itemsep = skip(val()); break
        case "parsep": d.parsep = skip(val()); break
        case "partopsep": d.partopsep = skip(val()); break
        case "nosep": d.partopsep = zero(); d.topsep = zero(); d.itemsep = zero(); d.parsep = zero(); break
        case "noitemsep": d.itemsep = zero(); d.parsep = zero(); break
        case "nolistsep": d.partopsep = zero(); d.topsep = { ...zero(), stretch: 6554 }; d.itemsep = zero(); d.parsep = zero(); break
        case "labelindent": calcset("labelindent", 0, val()); break
        case "labelwidth": calcset("labelwidth", 1, val()); break
        case "labelsep": calcset("labelsep", 2, val()); break
        case "leftmargin": calcset("leftmargin", 3, val()); break
        case "itemindent": calcset("itemindent", 4, val()); break
        case "listparindent": d.listparindent = dimen(val()); break
        case "rightmargin": d.rightmargin = dimen(val()); break
        case "align":
          if (v !== "left" && v !== "right") throw new Unsupported(`enumitem align=${v}`)
          s.align = v; break
        case "style": { // \enit@style@<style>, after \enit@nextlinefalse \enit@boxdescfalse
          const st = v ?? "normal"
          s.nextline = false; s.boxdesc = false
          if (st === "standard" || st === "normal") { s.boxdesc = true; calcwidest = false; calc = 4 }
          else if (st === "unboxed") { calcwidest = false; calc = 4 }
          else if (st === "sameline") { calcwidest = false; calc = 1 }
          else if (st === "nextline") { s.nextline = true; calcwidest = false; calc = 1 }
          else throw new Unsupported(`enumitem style=${st}`) // (multiline: align=parleft)
          break
        }
        case "wide": // \enit@align@left, no margin, the label indented by the value (\parindent) as later paragraphs
          s.align = "left"; d.leftmargin = 0; d.labelwidth = 0
          d.labelindent = v === null ? p.parindent : dimen(v); d.listparindent = d.labelindent
          calcwidest = false; calc = 4; break
        case "font": case "format": s.format = val(); break
        case "label": label = norm(val()); labelRef = true; break
        case "label*": // the enclosing level's label, then this one's
          if (level > 1 && p.prevLabel === null) throw new Unsupported("enumitem label* after a list's own itemize label")
          label = level === 1 ? norm(val()) : `${p.prevLabel}${norm(val())}`; labelRef = true; break
        case "ref": ref = val(); break // (delayed: after the group's other keys)
        case "start": {
          if (env !== "enumerate") throw new Unsupported(`enumitem start in ${env}`)
          const n = v === null ? 1 : Number(v.trim())
          if (!/^\s*-?\d+\s*$/.test(v ?? "1")) throw new Unsupported(`enumitem start=${v}`)
          s.counter = n - 1; break
        }
        case "resume": { // \enit@resume@<env>: the last list's \c@<counter> N, if there was one
          if (v !== null) throw new Unsupported(`enumitem resume=${v}`) // (series)
          const r = p.scope.get(env)
          if (r && r.counter !== null) { if (r.level !== level) throw new Unsupported("enumitem resume at another level"); s.counter = r.counter }
          break
        }
        case "resume*": if (!own || v !== null) throw new Unsupported(`enumitem resume*${v === null ? "" : `=${v}`}`); break // (applied first)
        case "before": case "after": if (v?.trim()) throw new Unsupported(`enumitem ${k}=${v}`); break
        default: throw new Unsupported(`enumitem ${k}${v === null ? "" : `=${v}`}`)
      }
    }
    if (ref !== null) { s.ref = `{${norm(ref)}}`; labelRef = false }
  }
  for (const name of ["list", `list${ROMAN[p.depth]}`, SHORT[env], SHORT[env] + ROMAN[level]]) {
    const keys = p.e.sets.get(name)
    if (keys !== undefined) apply(keys, false)
  }
  // \enit@setresume: resume* first (the last list's own keys, then resume), then the list's own
  const own = keyvals(p.own, short)
  if (own.some(([k]) => k === "resume*")) {
    const r = p.scope.get(env)
    if (r) { apply(r.keys, false); apply("resume", false) }
    s.keys = r?.keys ?? ""
  }
  apply(p.own, true)
  if (label !== null) s.label = env === "enumerate" ? `{${label}}` : label // (\enit@normlabel: enumerate's only)
  if (labelRef && label !== null) s.ref = `{${s.label}}` // (\enit@reflabel\@itemlabel\z@: \the<counter> {{label}})
  // \enit@calcleft
  let x = d.leftmargin + d.itemindent - d.labelsep - d.labelindent
  const width = () => {
    if (calcwidest) d.labelwidth = env === "description" ? p.widest(s.label) - d.labelsep : p.widest(s.label)
    x -= d.labelwidth
  }
  if (calc === 0) { width(); d.labelindent += x }
  else if (calc === 1) d.labelwidth = x
  else if (calc === 2) { width(); d.labelsep += x }
  else if (calc === 3) { width(); d.leftmargin -= x }
  else { width(); d.itemindent -= x }
  return s
}

/** A label's or reference's source with its counters' values (or with the widest ones, \enit@getwidth's defaults) */
export function labelText(src: string, values: number[] | "widest"): string {
  return src.replace(/\\(arabic|alph|Alph|roman|Roman)\{enum(i|ii|iii|iv)\}/g, (_, style: string, r: string) => {
    if (values === "widest") return { arabic: "0", alph: "m", Alph: "M", roman: "viii", Roman: "VIII" }[style]!
    return representation(style, values[ROMAN.indexOf(r) - 1] ?? 0)
  })
}

/** A reference's text as the .aux file has it, without the braces around all of it (which TeX reads as groups) */
export function unbraced(t: string): string {
  while (/^\{[^]*\}$/.test(t) && balanced(t.slice(1, -1))) t = t.slice(1, -1)
  return t
}

/** keyval's list: key=value pairs at the outer level, spaces around each and one pair of braces around a value
 *  taken off; with shortlabels (`short`, the list's type) a first entry that is no key is its label */
function keyvals(src: string, short: string | null): [string, string | null][] {
  const out: [string, string | null][] = []
  const parts = split(src, ",")
  parts.forEach((part, i) => {
    const at = top(part, "=")
    const k = (at < 0 ? part : part.slice(0, at)).trim()
    if (!k) return
    if (i === 0 && at < 0 && short && !KEYS.has(k)) { out.push(["label", shortLabel(strip(part), short)]); return }
    out.push([k, at < 0 ? null : strip(part.slice(at + 1))])
  })
  return out
}

/** \enit@first: an enumerate's short label, its one a, A, i, I or 1 as \alph* … \arabic* (itemize's as it is) */
function shortLabel(src: string, env: string): string {
  if (env !== "enumerate") return src
  if (/\\[A-Za-z]/.test(src)) throw new Unsupported(`enumitem short label ${src}`)
  let out = src, marks = 0
  for (const [c, cmd] of [["a", "\\alph*"], ["A", "\\Alph*"], ["i", "\\roman*"], ["I", "\\Roman*"], ["1", "\\arabic*"]]) {
    const n = out.split(c).length - 1
    if (n > 1 || n && marks) throw new Unsupported(`enumitem short label ${src}`) // (Extra short label ignored)
    if (n) { out = out.replace(c, cmd); marks++ }
  }
  return out
}

/** the value with the spaces around it and one pair of braces around all of it taken off */
function strip(v: string): string {
  const t = v.trim()
  if (t.startsWith("{") && t.endsWith("}") && balanced(t.slice(1, -1))) return t.slice(1, -1)
  return t
}
/** the string split at a character outside braces */
function split(s: string, c: string): string[] {
  const out: string[] = []
  for (let at = top(s, c); at >= 0; at = top(s, c)) { out.push(s.slice(0, at)); s = s.slice(at + 1) }
  out.push(s)
  return out
}
/** where a character first stands outside braces (-1: nowhere) */
function top(s: string, c: string): number {
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\") { i++; continue }
    if (s[i] === "{") depth++
    else if (s[i] === "}") depth--
    else if (s[i] === c && depth === 0) return i
  }
  return -1
}
function balanced(s: string): boolean {
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\") { i++; continue }
    if (s[i] === "{") depth++
    else if (s[i] === "}" && --depth < 0) return false
  }
  return depth === 0
}
