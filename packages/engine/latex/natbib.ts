// natbib's citations with no .bbl: every key is undefined. Its punctuation (\NAT@open, \NAT@close and
// author-year or numbers) comes from the package options, then from the .aux's \bibstyle, which
// \bibliographystyle wrote the run before and the first style natbib knows sets (\bibpunct gobbles the rest).

import { Unsupported } from "./unsupported"

export interface NatStyle { open: string; close: string; numbers: boolean }

/** \bibstyle@<name>'s \bibpunct: its open, close and mode (cospar, esa and nature are not modeled) */
const BIBSTYLES: Record<string, NatStyle> = {}
for (const s of ["chicago", "copernicus", "egu", "egs", "agsm", "kluwer", "dcu", "aa", "pass", "anngeo", "nlinproc"]) BIBSTYLES[s] = { open: "(", close: ")", numbers: false }
for (const s of ["named", "agu", "plainnat", "abbrvnat", "unsrtnat"]) BIBSTYLES[s] = { open: "[", close: "]", numbers: false }
for (const s of ["plain", "alpha", "abbrv", "unsrt"]) BIBSTYLES[s] = { open: "[", close: "]", numbers: true }

/** natbib's options, in the order \ProcessOptions runs them (declaration order); whether \bibstyle still works after */
export function natbibOptions(options: string): { style: NatStyle; bibstyle: boolean } {
  const given = new Set(options.split(",").map((o) => o.trim()).filter(Boolean))
  for (const o of given) if (!["numbers", "authoryear", "round", "square"].includes(o)) throw new Unsupported(`natbib option ${o}`)
  const style: NatStyle = { open: "(", close: ")", numbers: false }
  let bibstyle = true
  if (given.has("numbers")) { style.numbers = true; style.open = "["; style.close = "]"; bibstyle = false } // square, comma, nobibstyle
  if (given.has("authoryear")) { style.numbers = false; style.open = "("; style.close = ")"; bibstyle = true } // round, semicolon, bibstyle (in that order)
  if (given.has("round")) { style.open = "("; style.close = ")"; bibstyle = false }
  if (given.has("square")) { style.open = "["; style.close = "]"; bibstyle = false }
  return { style, bibstyle }
}

/** The .aux's \bibstyle lines, one per \bibliographystyle in the document: the first style natbib knows sets the punctuation */
export function natbibStyle(base: { style: NatStyle; bibstyle: boolean }, styles: string[]): NatStyle {
  if (!base.bibstyle) return base.style
  for (const s of styles) {
    if (BIBSTYLES[s]) return BIBSTYLES[s]
    if (["cospar", "esa", "nature"].includes(s)) throw new Unsupported(`natbib's ${s} style`)
  }
  return base.style
}

/** A natbib citation command: \ifNAT@swa (the parenthetical form), \ifNAT@par (the brackets) and \NAT@ctype */
export interface NatCommand { swa: boolean; par: boolean; ctype: 0 | 1 | 2 }

export const NAT_COMMANDS: Record<string, NatCommand> = {
  citet: { swa: false, par: true, ctype: 0 }, Citet: { swa: false, par: true, ctype: 0 },
  citep: { swa: true, par: true, ctype: 0 }, Citep: { swa: true, par: true, ctype: 0 },
  citealt: { swa: false, par: false, ctype: 0 }, Citealt: { swa: false, par: false, ctype: 0 },
  citealp: { swa: true, par: false, ctype: 0 }, Citealp: { swa: true, par: false, ctype: 0 },
  citeauthor: { swa: false, par: false, ctype: 1 }, Citeauthor: { swa: false, par: false, ctype: 1 },
  citeyear: { swa: false, par: false, ctype: 2 }, citeyearpar: { swa: true, par: true, ctype: 2 },
  // \cite: \citep with an optional argument (or numbers), \citet without
  cite: { swa: true, par: true, ctype: 0 },
}

/**
 * What a citation sets with every key undefined, as items for the caller to append:
 * `text` in the current font (a space in it is a space token), `ctl` a control space (\NAT@spacechar),
 * `q` the undefined key's {\reset@font\bfseries ?}, `note` the pre- or post-note, `mbox` an \mbox of text.
 * \NAT@citex (author-year): each key's ?, never a separator (\@citea is set only after a defined key); with
 * \ifNAT@swa, \NAT@cite puts \NAT@@open, the pre-note and \NAT@spacechar, the keys, \NAT@cmt and the post-note,
 * \NAT@@close around them; without, the keys, then \NAT@cmt and the post-note (no close: \NAT@date is empty).
 * \NAT@citexnum (numbers): each key's ? and the space after it in natbib.sty; without \ifNAT@swa, the post-note
 * for \NAT@ctype 0 and \NAT@mbox{\NAT@@close}.
 */
export type NatItem = { kind: "text"; text: string } | { kind: "ctl" } | { kind: "q" } | { kind: "note"; which: "pre" | "post" } | { kind: "mbox"; text: string }

export function natCite(style: NatStyle, name: string, keys: number, pre: string, post: string, optional: boolean): NatItem[] {
  const cmd = NAT_COMMANDS[name]
  const swa = name === "cite" ? optional || style.numbers : cmd.swa
  const open = cmd.par ? style.open : "", close = cmd.par ? style.close : ""
  const body: NatItem[] = []
  for (let i = 0; i < keys; i++) body.push({ kind: "q" }, ...(style.numbers ? [{ kind: "text" as const, text: " " }] : []))
  const out: NatItem[] = []
  const text = (t: string) => { if (t) out.push({ kind: "text", text: t }) }
  if (swa) {
    text(open)
    if (pre) out.push({ kind: "note", which: "pre" }, { kind: "ctl" })
    out.push(...body)
    if (post) { text(", "); out.push({ kind: "note", which: "post" }) }
    text(close)
    return out
  }
  out.push(...body)
  if (post && (!style.numbers || cmd.ctype === 0)) { text(", "); out.push({ kind: "note", which: "post" }) }
  if (style.numbers) out.push({ kind: "mbox", text: close })
  return out
}
