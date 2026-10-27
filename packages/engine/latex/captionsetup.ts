// caption3.sty's options, as caption.sty's package options and \captionsetup set them: \captionsetup{keys} at
// once, \captionsetup[type]{keys} into the option list `type` (\caption@setup@options@), which \caption@setoptions
// runs where the type starts (\caption@settype: a float's \@xfloat, \setcaptiontype; subcaption's
// \caption@subtypehook runs `sub` and then `sub<type>`). Every key not modeled here is Unsupported.

import type { SizeCommand } from "../layout/classdata"
import { SIZE_COMMANDS } from "../layout/classdata"
import { Unsupported } from "./unsupported"

/** a \DeclareCaptionFont key: a size, a \…series, \…shape or \…family, or \caption@smaller and \caption@larger */
export type CaptionFont = SizeCommand | "smaller" | "larger" | "bf" | "md" | "it" | "sl" | "sc" | "up" | "rm" | "sf" | "tt"
const FONT_KEYS: readonly string[] = [...SIZE_COMMANDS, "smaller", "larger", "bf", "md", "it", "sl", "sc", "up", "rm", "sf", "tt"]

export interface CaptionKeys {
  /** \captionfont, \captionlabelfont, \captiontextfont: the font keys in order */
  font: CaptionFont[]; labelfont: CaptionFont[]; textfont: CaptionFont[]
  /** \caption@labelsep (\DeclareCaptionLabelSeparator; quad, newline and endash with the * not in the label font) */
  labelsep: "none" | "colon" | "period" | "space" | "quad" | "newline" | "endash"
  format: "plain" | "hang"
  justification: "justified" | "centering" | "centerlast" | "raggedright" | "raggedleft"
  /** singlelinecheck */
  slc: boolean
  /** \abovecaptionskip and \belowcaptionskip set by skip (aboveskip) and belowskip, null: the class's */
  above: number | null; below: number | null
  position: "top" | "bottom" | "auto"
  /** \caption@leftmargin, \caption@rightmargin, \caption@width (margin= sets the width to zero, width= the margins) */
  left: number; right: number; width: number
  /** \caption@indent (indention=) */
  indent: number
  labelformat: "original" | "simple" | "parens" | "empty" | "brace"
  /** \figurename and \tablename (figurename=, tablename= in the preamble, name= in a type's list or a float) */
  names: { figure?: string; table?: string }
  hypcap: boolean
  /** list=: a lof or lot line */
  list: boolean
  /** \caption@iftwoside (the class's \if@twoside; twoside=, oneside): unequal margins swap on even pages */
  twoside: boolean
}

/** caption3's state after \captionsetup{style=default,position=default,listformat=default} and caption.sty's
 *  own (hypcap=1) */
export function captionDefaults(twoside: boolean): CaptionKeys {
  return { twoside, font: [], labelfont: [], textfont: [], labelsep: "colon", format: "plain", justification: "justified", slc: true, above: null, below: null, position: "auto", left: 0, right: 0, width: 0, indent: 0, labelformat: "original", names: {}, hypcap: true, list: true }
}

export const copyKeys = (k: CaptionKeys): CaptionKeys => ({ ...k, font: [...k.font], labelfont: [...k.labelfont], textfont: [...k.textfont], names: { ...k.names } })

/** keyval's split of a key list at its outer commas: key and value (null: none), braces around a value taken off */
export function keyvals(src: string): [string, string | null][] {
  const out: [string, string | null][] = []
  let depth = 0, start = 0
  const items: string[] = []
  for (let i = 0; i <= src.length; i++) {
    const c = src[i]
    if (c === "{") depth++
    else if (c === "}") depth--
    else if ((c === "," && depth === 0) || i === src.length) { items.push(src.slice(start, i)); start = i + 1 }
  }
  for (const item of items) {
    const t = item.trim()
    if (!t) continue
    const eq = t.indexOf("=")
    if (eq < 0) { out.push([t, null]); continue }
    let v = t.slice(eq + 1).trim()
    if (/^\{[^]*\}$/.test(v) && balancedInside(v)) v = v.slice(1, -1)
    out.push([t.slice(0, eq).trim(), v])
  }
  return out
}
const balancedInside = (v: string) => { let d = 0; for (let i = 0; i < v.length - 1; i++) { if (v[i] === "{") d++; else if (v[i] === "}" && --d === 0) return false } return true }

/** where keys are set: in the preamble at once (`preamble`), or where a type's list runs, a float or a sub-float */
export type KeysAt = "preamble" | "list" | "float" | "sub"

/**
 * \caption@setkeys{caption}{keys} on `k`, `dim` evaluating a length as \setlength would where the keys run
 * (null: the lengths there are not modeled). `at` says where: figurename and tablename only in the preamble
 * (\@onlypreamble@key), name only where \@captype (`captype`) is a float's.
 */
export function setCaptionKeys(k: CaptionKeys, src: string, at: KeysAt, dim: ((v: string) => number) | null, captype?: "figure" | "table"): { position: boolean } {
  let position = false
  const length = (key: string, v: string | null) => {
    if (v === null || !dim) throw new Unsupported(`caption option ${key}${v === null ? "" : `=${v}`}`)
    try { return dim(v) } catch { throw new Unsupported(`caption option ${key}=${v}`) }
  }
  const bool = (key: string, v: string | null) => {
    const t = (v ?? "1").trim() // (keys declared with [1] as their default)
    if (["1", "true", "yes", "on"].includes(t)) return true
    if (["0", "false", "no", "off"].includes(t)) return false
    throw new Unsupported(`caption option ${key}=${v}`)
  }
  const fonts = (key: string, v: string | null): CaptionFont[] => {
    if (v === null) throw new Unsupported(`caption option ${key}`)
    return keyvals(v).map(([f, x]) => {
      if (x !== null || !FONT_KEYS.includes(f)) throw new Unsupported(`caption font ${f}${x === null ? "" : `=${x}`}`)
      return f as CaptionFont
    })
  }
  const one = <T extends string>(key: string, v: string | null, values: Record<string, T>): T => {
    if (v === null || !Object.hasOwn(values, v.trim())) throw new Unsupported(`caption option ${key}${v === null ? "" : `=${v}`}`)
    return values[v.trim()]
  }
  for (const [key, v] of keyvals(src)) {
    switch (key) {
      case "font": case "labelfont": case "textfont": k[key] = fonts(key, v); break // (\caption@setfont: empty, then added to)
      case "font+": case "labelfont+": case "textfont+": { const f = key.slice(0, -1) as "font"; k[f] = [...k[f], ...fonts(key, v)]; break }
      case "labelsep": case "labelseparator":
        k.labelsep = one(key, v, { none: "none", colon: "colon", period: "period", space: "space", quad: "quad", newline: "newline", endash: "endash" }); break
      case "format": k.format = one(key, v, { plain: "plain", hang: "hang" }); break
      // (RaggedRight and the other ragged2e ones load ragged2e at \begin{document})
      case "justification": k.justification = one(key, v, { justified: "justified", centering: "centering", centerlast: "centerlast", raggedright: "raggedright", raggedleft: "raggedleft" }); break
      case "singlelinecheck": case "slc": k.slc = bool(key, v); break
      case "skip": case "aboveskip": k.above = length(key, v); break
      case "belowskip": k.below = length(key, v); break
      case "position": position = true; k.position = one(key, v, { top: "top", t: "top", above: "top", bottom: "bottom", b: "bottom", below: "bottom", auto: "auto" }); break
      case "margin": { // \caption@setmargin: the width zero, then one margin for both sides or left,right
        if (v === null) throw new Unsupported("caption option margin")
        const parts = v.split(",")
        if (parts.length > 2 || !parts.every((p) => p.trim())) throw new Unsupported(`caption option margin=${v}`)
        k.width = 0; k.left = length(key, parts[0]); k.right = parts.length === 2 ? length(key, parts[1]) : k.left
        break
      }
      case "width": k.left = 0; k.right = 0; k.width = length(key, v); break
      case "indention": case "indent": k.indent = length(key, v); break // ([\leftmargini] with no value: not modeled)
      case "labelformat": k.labelformat = one(key, v, { original: "original", simple: "simple", parens: "parens", empty: "empty", brace: "brace" }); break
      case "name": // \caption@setname\@captype: in the preamble \@captype is undefined; in a sub-float it renames the
        // float, whose \figurename nothing there prints (a subcaption's label is \subfigurename's, empty)
        if (at === "preamble" || !captype || v === null || /[\\{}$%&#^_~]/.test(v)) throw new Unsupported(`caption option name${v === null ? "" : `=${v}`} here`)
        k.names = { ...k.names, [captype]: v }
        break
      case "figurename": case "tablename": // (\caption@SetName: newfloat's \newfloat@setname, preamble only)
        if (at !== "preamble" || v === null || /[\\{}$%&#^_~]/.test(v)) throw new Unsupported(`caption option ${key}${v === null ? "" : `=${v}`} here`)
        k.names = { ...k.names, [key === "figurename" ? "figure" : "table"]: v }
        break
      case "hypcap": k.hypcap = bool(key, v); break
      case "list": case "listof": k.list = bool(key, v); break
      case "twoside": k.twoside = bool(key, v); break
      case "oneside": if (v !== null) throw new Unsupported(`caption option oneside=${v}`); k.twoside = false; break
      default: throw new Unsupported(`caption option ${key}${v === null ? "" : `=${v}`}`)
    }
  }
  return { position } // (\caption@setposition's \caption@initposition: the position fixed is no more)
}

/** the preamble's caption options: the state \captionsetup{…} and the package options left, and the option lists
 *  (\caption@opt@<type>) for figure, table, sub, subfigure and subtable */
export interface CaptionSetup { keys: CaptionKeys; lists: Record<string, string[]> }

export const CAPTION_LISTS = ["figure", "table", "sub", "subfigure", "subtable"]

/** a type's option list run on `k` (\caption@setoptions{type}) */
export function runList(setup: CaptionSetup, type: string, k: CaptionKeys, at: KeysAt, dim: ((v: string) => number) | null, captype: "figure" | "table"): { position: boolean } {
  let position = false
  for (const src of setup.lists[type] ?? []) position = setCaptionKeys(k, src, at, dim, captype).position || position
  return { position }
}
