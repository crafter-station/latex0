// natbib's citations. Its punctuation (\NAT@open, \NAT@close, \NAT@sep, \NAT@aysep, \NAT@yrsep and
// author-year or numbers) comes from the package options, then from the .aux's \bibstyle, which
// \bibliographystyle wrote the run before and the first style natbib knows sets (\bibpunct gobbles the rest).
// A key is defined by the \bibcite{key}{{num}{year}{{short}}{{long}}} that natbib's \bibitem wrote the run
// before (\NAT@wrout); with no .bbl and no thebibliography every key is undefined.

import { Unsupported } from "./unsupported"

export interface NatStyle { open: string; close: string; numbers: boolean; sep: string; aysep: string; yrsep: string }

/** \bibstyle@<name>'s \bibpunct{open}{close}{sep}{mode}{aysep}{yrsep} (cospar, esa and nature are not modeled) */
const BIBSTYLES: Record<string, NatStyle> = {}
const punct = (open: string, close: string, sep: string, mode: string, aysep: string, yrsep: string): NatStyle => ({ open, close, sep, numbers: mode === "n", aysep, yrsep })
for (const s of ["chicago", "copernicus", "egu", "egs", "pass", "anngeo", "nlinproc"]) BIBSTYLES[s] = punct("(", ")", ";", "a", ",", ",")
BIBSTYLES.named = punct("[", "]", ";", "a", ",", ",")
BIBSTYLES.agu = punct("[", "]", ";", "a", ",", ",~")
for (const s of ["agsm", "kluwer"]) BIBSTYLES[s] = punct("(", ")", ",", "a", "", ",")
BIBSTYLES.dcu = punct("(", ")", ";", "a", ";", ",")
BIBSTYLES.aa = punct("(", ")", ";", "a", "", ",")
for (const s of ["plain", "alpha", "abbrv", "unsrt"]) BIBSTYLES[s] = punct("[", "]", ",", "n", "", ",")
for (const s of ["plainnat", "abbrvnat", "unsrtnat"]) BIBSTYLES[s] = punct("[", "]", ",", "a", ",", ",")

/** natbib's options, in the order \ProcessOptions runs them (declaration order); whether \bibstyle still works after */
export function natbibOptions(options: string): { style: NatStyle; bibstyle: boolean } {
  const given = new Set(options.split(",").map((o) => o.trim()).filter(Boolean))
  for (const o of given) if (!["numbers", "authoryear", "round", "square", "comma", "semicolon"].includes(o)) throw new Unsupported(`natbib option ${o}`)
  // (\NAT@open, \NAT@close and \NAT@sep before \ProcessOptions; \NAT@aysep and \NAT@yrsep after)
  const style: NatStyle = { open: "(", close: ")", numbers: false, sep: ";", aysep: ",", yrsep: "," }
  let bibstyle = true
  if (given.has("numbers")) { style.numbers = true; style.open = "["; style.close = "]"; style.sep = ","; bibstyle = false } // square, comma, nobibstyle
  if (given.has("authoryear")) { style.numbers = false; style.open = "("; style.close = ")"; style.sep = ";"; bibstyle = true } // round, semicolon, bibstyle (in that order)
  if (given.has("round")) { style.open = "("; style.close = ")"; bibstyle = false }
  if (given.has("square")) { style.open = "["; style.close = "]"; bibstyle = false }
  if (given.has("comma")) { style.sep = ","; bibstyle = false }
  if (given.has("semicolon")) { style.sep = ";"; bibstyle = false }
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

/** What the run before's \bibcite{key}{{num}{date}{{name}}{{all names}}} gives \NAT@parse (names as typed, without their braces) */
export interface NatEntry { num: string; date: string; name: string; all: string }

/**
 * natbib's \bibitem[label]{key} (\NAT@ifcmd, \NAT@bare): `short(year)long` is the entry \NAT@wrout writes with
 * the counter (an empty label: the counter alone); \natexlab{x} expands to x (author-year) or nothing (numbers)
 */
export function natBibitem(label: string | null, num: number, numbers: boolean): NatEntry {
  if (label === null || label === "") return { num: String(num), date: "", name: "", all: "" }
  const text = label.replace(/\\natexlab\s*\{([^{}]*)\}/g, numbers ? "" : "$1")
  if (/^\s*\\relax(?![A-Za-z])/.test(text)) throw new Unsupported(`\\bibitem[${label}]`) // (\NAT@ifcmd: nothing written)
  // the parentheses at brace depth 0
  const at: number[] = []
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === "\\") { i++; continue }
    if (c === "{") depth++
    else if (c === "}") depth--
    else if (depth === 0 && (c === "(" || c === ")")) at.push(i)
  }
  if (at.length < 2 || text[at[0]] !== "(" || text[at[1]] !== ")" || at.length > 2) throw new Unsupported(`\\bibitem[${label}]`) // (no year: \NAT@apalk)
  // (a delimited argument that is one group loses its braces)
  const arg = (s: string) => (/^\{[^{}]*\}$/.test(s) ? s.slice(1, -1) : s)
  const name = arg(text.slice(0, at[0])), date = arg(text.slice(at[0] + 1, at[1])), all = arg(text.slice(at[1] + 1))
  if (date === "@") throw new Unsupported(`\\bibitem[${label}]`)
  return { num: String(num), date, name, all }
}

/** \NAT@parse@date: the year (the characters before the first letter, four at most) and the extra label after it ({?} without) */
function parseDate(date: string): { year: string; exlab: string } {
  const toks = date.match(/\{[^{}]*\}|\\[A-Za-z]+|./g) ?? []
  const pad = [...toks, "?", "?", "?", "?", "?", "?"]
  for (let i = 0; i < 4; i++) if (/^[A-Za-z]$/.test(pad[i])) return { year: pad.slice(0, i).join(""), exlab: pad[i] }
  const five = pad[4]
  return { year: pad.slice(0, 4).join(""), exlab: `{${five.startsWith("{") ? five.slice(1, -1) : five}}` }
}

/**
 * What a citation sets, as items for the caller to append: `src` LaTeX source in the current font, `q` an undefined
 * key's {\reset@font\bfseries ?}, `note` the pre- or post-note, `mbox` an \mbox, `link` a key's \hyper@natlinkstart
 * … \hyper@natlinkend (its text alone without hyperref), `break` \hyper@natlinkbreak's text between two links,
 * `penalty` \NAT@penalty, `unskip`.
 * \NAT@citex (author-year): an undefined key's ?, then the date empty (\@citea is set only after a defined key);
 * a defined one's name and date, or the date alone after the same names (\NAT@yrsep, the extra label for the same
 * year); \ifNAT@swa puts \NAT@@open, the pre-note and \NAT@spacechar, the keys, \NAT@cmt and the post-note, \NAT@@close
 * around them, and without it each name has \NAT@@open and the pre-note before its date and the post-note comes last.
 * \NAT@citexnum (numbers): each undefined key's ? and the space after it in natbib.sty; a defined one's number in an
 * \mbox (without \ifNAT@swa its names, then the bracket in an \mbox), separated by \NAT@sep\penalty\@m\NAT@space.
 */
export type NatItem = { kind: "src"; src: string } | { kind: "q" } | { kind: "note"; which: "pre" | "post" } | { kind: "mbox"; items: NatItem[] }
  | { kind: "link"; key: string; items: NatItem[] } | { kind: "break"; items: NatItem[] } | { kind: "penalty" } | { kind: "unskip" }

export function natCite(style: NatStyle, name: string, star: boolean, keys: string[], entries: (NatEntry | null)[], pre: boolean, post: boolean, optional: boolean): NatItem[] {
  const cmd = NAT_COMMANDS[name]
  const swa = name === "cite" ? optional || style.numbers : cmd.swa
  const open = cmd.par ? style.open : "", close = cmd.par ? style.close : ""
  const src = (s: string): NatItem[] => (s ? [{ kind: "src", src: s }] : [])
  const ctl: NatItem = { kind: "src", src: "\\ " } // \NAT@spacechar
  const preNote: NatItem = { kind: "note", which: "pre" }, postNote: NatItem = { kind: "note", which: "post" }
  // \NAT@up (\Citet …): the name's first letter through \MakeUppercase (in a group of its own: no kern after it)
  const up = (n: string) => {
    if (!/^[A-Z]/.test(name)) return n
    if (/^[A-Za-z]/.test(n)) return `{${n[0].toUpperCase()}}${n.slice(1)}`
    throw new Unsupported(`\\${name} of a name that starts with ${n.slice(0, 8)}`)
  }
  const named = (e: NatEntry) => (star ? e.all || e.name : e.name) // (\NAT@all@names is the name when empty)
  /** \NAT@test{\@ne}: the names, or (author?) for none */
  const test = (n: string) => { if (!n) throw new Unsupported("natbib: (author?)"); return src(`{${n}}`) }
  const out: NatItem[] = []
  let citea: NatItem[] = []
  let nm = "", year = "", date = ""
  if (!style.numbers) {
    entries.forEach((e, i) => {
      const link = (items: NatItem[]): NatItem => ({ kind: "link", key: keys[i], items })
      if (!e) { out.push(...citea, { kind: "q" }); date = ""; return }
      const lastNm = nm, lastYr = year
      nm = named(e); date = e.date
      const d = parseDate(date); year = d.year
      const fmt = src(`{${up(nm)}}`) // \NAT@nmfmt
      if (cmd.ctype === 1) out.push(...citea, link(fmt))
      else if (cmd.ctype === 2) { if (!date) throw new Unsupported("natbib: (year?)"); out.push(...citea, link(src(date))) }
      else if (!date) out.push(...citea, link(fmt))
      else if (lastNm === nm) {
        out.push(...src(style.yrsep))
        if (lastYr === year) out.push(link(src(d.exlab)))
        else out.push({ kind: "unskip" }, ctl, link(src(date)))
      } else out.push(...citea, link([...fmt, { kind: "break", items: swa ? [...src(style.aysep), ctl] : [ctl, ...src(open), ...(pre ? [preNote, ctl] : [])] }, ...src(date)]))
      citea = swa || !date ? [...src(style.sep), ctl] : [...src(close), ...src(style.sep), ctl]
    })
    if (!swa) {
      if (post) out.push(...src(", "), postNote)
      if (date) out.push(...src(close))
    }
  } else {
    entries.forEach((e, i) => {
      const link = (items: NatItem[]): NatItem => ({ kind: "link", key: keys[i], items })
      if (!e) { out.push({ kind: "q" }, ...src(" ")); return }
      const lastNm = nm
      nm = named(e); date = e.date
      const number: NatItem = { kind: "mbox", items: [link(src(e.num))] } // \NAT@mbox{\NAT@hyper@{{\citenumfont{\NAT@num}}}}
      if (swa) {
        if (cmd.ctype === 2) { if (!date) throw new Unsupported("natbib: (year?)"); out.push(...citea, link(src(date))) }
        else out.push(...citea, number)
        citea = [...src(style.sep), { kind: "penalty" }, ctl]
      } else if (cmd.ctype === 0) {
        if (lastNm === nm) out.push(...src(style.yrsep), { kind: "penalty" }, ctl)
        else out.push(...citea, ...test(nm), ctl, { kind: "mbox", items: src(open) }) // (\NAT@test{\@ne}: no \NAT@up)
        if (pre) out.push(preNote, ctl)
        out.push(number)
        citea = [{ kind: "mbox", items: src(close) }, ...src(style.sep), { kind: "penalty" }, ctl]
      } else {
        if (cmd.ctype === 2 && !date) throw new Unsupported("natbib: (year?)")
        out.push(...citea, link(cmd.ctype === 1 ? test(nm) : src(date)))
        citea = [...src(style.sep), { kind: "penalty" }, ctl]
      }
    })
    if (!swa) {
      if (post && cmd.ctype === 0) out.push(...src(", "), postNote)
      out.push({ kind: "mbox", items: src(close) })
    }
  }
  // \NAT@cite and \NAT@citenum
  if (!swa) return out
  return [...src(open), ...(pre ? [preNote, ctl] : []), ...out, ...(post ? [...src(", "), postNote] : []), ...src(close)]
}
