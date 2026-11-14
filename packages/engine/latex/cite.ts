// cite.sty (v5.5): numeric citations sorted and compressed. \cite[note]{keys} is \leavevmode\cite@adjust
// \citeleft{\@cite@n{keys}, the note after \citemid, \spacefactor\@m}\citeright; \citen, \citenum and \citeonline
// are \@cite@n alone.
//   \cite@adjust: \unskip, \penalty\citeprepenalty unless a penalty is last, then the space: \  (the font's
//     interword glue) after no glue or where the space factor is above 1000, else the glue taken off, again.
//   \@cite@n: \@make@cite@list for each key (an undefined one is set at once, {\bfseries ?}; a number goes in
//     \@cite@list, in order of its value), then \@compress@cite over the list: a number, \citepunct between two, and
//     for a run of three or more consecutive ones the first, \citedash and the last.
//   \citepunct ,\penalty\citepunctpenalty\hskip.13em plus.1em minus.1em; \citedash \hbox{--}\penalty\citepunctpenalty;
//     \citemid ,\penalty\citemidpenalty\ ; \citeleft [ and \citeright ]. A number is \citeform{\csname b@key\endcsname},
//     a group of its own (\citeform takes no argument): no kern between it and what is around it.
// The options: nospace and space (\citepunct's glue: none, or \ ), nobreak (the three penalties \@M), ref (\citeleft
// [Ref.\penalty\@M\ ), nosort, nocompress, noadjust (no \cite@adjust). Not modeled: superscript (and move, nomove
// with it) and biblabel; labels that are not positive numbers (\bibitem[label], which the engine has only with natbib).

import { Unsupported } from "./unsupported"

/** the package's options as they leave its commands */
export interface CiteOptions { punct: "small" | "none" | "space"; nobreak: boolean; ref: boolean; sort: boolean; compress: boolean; adjust: boolean }

/** \usepackage[options]{cite}: \ProcessOptions runs them in the order of their declarations (verbose, nospace, space, …) */
export function citeOptions(list: string): CiteOptions {
  const o: CiteOptions = { punct: "small", nobreak: false, ref: false, sort: true, compress: true, adjust: true }
  const given = list.split(",").map((x) => x.trim()).filter(Boolean)
  for (const name of given) if (!DECLARED.includes(name)) throw new Unsupported(`cite.sty's option ${name}`)
  for (const name of DECLARED) {
    if (!given.includes(name)) continue
    switch (name) {
      case "nospace": o.punct = "none"; break
      case "space": o.punct = "space"; break
      case "nobreak": o.nobreak = true; break
      case "ref": o.ref = true; break
      case "nosort": o.sort = false; break
      case "nocompress": o.compress = false; break
      case "noadjust": o.adjust = false; break
      // (verbose, sort, compress and adjust do nothing; move and nomove only set what superscript reads)
    }
  }
  return o
}
const DECLARED = ["verbose", "nospace", "space", "nobreak", "ref", "nosort", "sort", "nocompress", "compress", "nomove", "move", "noadjust", "adjust"]

/** what \@cite@n sets, in order: a citation's number, {\bfseries ?} for an undefined key, \citepunct, \citedash */
export type CiteItem = { kind: "number"; key: string; text: string } | { kind: "undefined" } | { kind: "punct" } | { kind: "dash" }

/** \@cite@n{keys}: `number` is a key's \bibcite the run before wrote */
export function citeList(o: CiteOptions, keys: string[], number: (key: string) => string | undefined): CiteItem[] {
  const out: CiteItem[] = []
  let citea = false // \@citea is \citepunct
  const emit = (items: CiteItem[]) => { out.push(...items) }
  const withPunct = (item: CiteItem): CiteItem[] => (citea ? [{ kind: "punct" }, item] : [item])
  // \@make@cite@list: the sorted list of \@celt{value}{text}{tag}
  const list: { value: number; item: CiteItem }[] = []
  let highest = -1 // \@tempcntb
  for (const key of keys) {
    const text = number(key)
    if (text === undefined) { emit(withPunct({ kind: "undefined" })); citea = true; continue }
    // (\@cite@posnumtest: a positive number; \@tempcnta is its 256-fold)
    if (!/^\d+$/.test(text) || Number(text) < 1 || Number(text) > 8388607) throw new Unsupported(`cite.sty: the citation label ${text}`)
    const item: CiteItem = { kind: "number", key, text }
    // (nosort with nocompress: \@addto@cite@list is \@cite@dump@now)
    if (!o.sort && !o.compress) { emit(withPunct(item)); citea = true; continue }
    const value = Number(text) * 256
    if (!o.sort || value > highest) { list.push({ value, item }); if (o.sort) highest = value } // (\@citeaddcnta)
    else { // \@sort@celt: before the first one that is not smaller
      const at = list.findIndex((x) => x.value >= value)
      list.splice(at < 0 ? list.length : at, 0, { value, item })
    }
  }
  // \@compress@cite for each: \@tempcnta the number before, \@cite@incr the step of a sequence that is running, \@h@ld
  // what is held back
  let prev = -1, incr = 0, held: CiteItem[] = []
  for (const { value, item } of list) {
    if (!o.compress) { emit(held); emit(withPunct(item)); held = [] } // (nocompress's \@compress@cite)
    else if (incr === 0) {
      if (value === prev + 256) { held = withPunct(item); incr = 256 } // a sequence of consecutive numbers starts
      else if (value === prev + 1) { held = withPunct(item); incr = 1 } // (of suffixes: not with plain numbers)
      else emit(withPunct(item))
    } else if (value === prev + incr) held = [{ kind: "dash" }, item]
    else { emit(held); emit(withPunct(item)); held = []; incr = 0 }
    prev = value; citea = true
  }
  emit(held)
  return out
}
