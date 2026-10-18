// url.sty's \url (\Url@FormatString), and hyperref's \url, \nolinkurl and
// \href. The address is set in math mode, in \UrlFont (\ttfamily) as family 0,
// with \Url@MathSetup's mathcodes: \UrlBreaks are binary (a break after them at
// \UrlBreakPenalty, \binoppenalty when url.sty loads), \UrlBigBreaks relations
// (at \relpenalty), \UrlNoBreaks openings, everything else ordinary;
// \medmuskip, \thickmuskip and \thinmuskip are zero, so only the penalties
// remain; \m@th. With hyperref, \url and \href are links: the text in an
// \hbox (so the address does not break) between the link's specials.

import type { SizeCommand } from "../layout/classdata"
import type { GlueSpec } from "../layout/dimen"
import { kern, type Node } from "../layout/nodes"
import { BIN, mlistToHlist, OPEN, ORD, REL, TEXT, type MItem, type NoadType } from "../mathlayout/mlist"
import type { Ctx } from "./context"
import { fileLink, hyperDriver, uriLink } from "./hyperref"
import { mathEnv, selectFont, type FontAttrs } from "./paragraph"
import { Unsupported } from "./unsupported"

const BREAKS = ".@\\/!_|;>]),?&'+=#"
const BIG_BREAKS = ":"
const NO_BREAKS = "([{<"
/** \verbatim@nolig@list (latex.ltx), less the ` url.sty does not read: \set@mathnolig gives each an empty
 *  subscript (\sb{\/}), so no ligature joins it to the next character */
const NOLIG = "<>,'-"
/** \UrlOrds, and the characters whose mathcode is ordinary in family 0 already */
const ORDS = `*-"$`

/** The noad class \Url@MathSetup gives a character; null for one url.sty makes active or that ligatures could join. */
function urlClass(c: string): NoadType | null {
  if (BREAKS.includes(c)) return BIN
  if (BIG_BREAKS.includes(c)) return REL
  if (NO_BREAKS.includes(c)) return OPEN
  if (/[A-Za-z0-9]/.test(c) || ORDS.includes(c)) return ORD // letters and digits: class 7, in \fam0
  return null // a space, %, ~ (\UrlSpecials), ` (\verbatim@nolig@list), or a character not modeled
}

const ZERO: GlueSpec = { width: 0, stretch: 0, stretchOrder: 0, shrink: 0, shrinkOrder: 0 }

/** \url or \nolinkurl number n where it stands, at a size in a font; `penalties`: not in restricted horizontal
 *  mode; `color`: the current color, with a color package (a link's box pushes it) */
export function urlAt(cx: Ctx, n: number, size: SizeCommand, attrs: FontAttrs, penalties: boolean, color: string | undefined): Node[] {
  const { hyper, usesUrl } = cx.pre
  const { address, link } = cx.urls[n]
  if (!usesUrl && !hyper) throw new Unsupported("\\url without url or hyperref")
  if (!link && !hyper) throw new Unsupported("\\nolinkurl without hyperref")
  // hyperref's \url: \hyper@linkurl{\Hurl{…}}{…}, the address in the link's \hbox (no breaks there); with pdfTeX
  // the link nodes around it where it stands, its breaks kept
  if (link && hyper) return uriLink(urlFormula(cx, address, size, attrs, hyperDriver.pdftex && penalties), pdfURI(address), color)
  return urlFormula(cx, address, size, attrs, penalties)
}

/** \href number n (hyperref) around its typeset text */
export function hrefAt(cx: Ctx, n: number, text: Node[], color: string | undefined): Node[] {
  if (!cx.pre.hyper) throw new Unsupported("\\href without hyperref")
  const address = pdfURI(cx.urls[n].address)
  const file = hrefFile(address)
  return file === null ? uriLink(text, address, color) : fileLink(text, file, color)
}

/**
 * \hyper@readexternallink: an address with no scheme before a colon (or file:) names a file. \filename@parse
 * splits it (the area up to the last /, the extension after the last .), \XR@ext (pdf) is the extension it
 * lacks, and a PDF file gets \hyper@linkfile; anything else is a URI as typed (null).
 */
function hrefFile(address: string): string | null {
  const colon = address.indexOf(":")
  const scheme = colon < 0 ? "" : address.slice(0, colon)
  if (scheme === "run") throw new Unsupported(`\\href to ${address}`)
  if (scheme !== "" && scheme !== "file") return null
  const path = scheme === "file" ? address.slice(5) : address
  const slash = path.lastIndexOf("/"), name = path.slice(slash + 1), dot = name.lastIndexOf(".")
  const file = dot < 0 ? `${path}.pdf` : path
  return dot < 0 || name.slice(dot + 1) === "pdf" ? file : null
}

/** The address as the pdfmark's string: characters a PostScript string or hyperref would escape are not modeled. */
function pdfURI(address: string): string {
  if (/[\\()%#~ ]/.test(address)) throw new Unsupported(`a link to ${address}`)
  return address
}

/** \Url@FormatString: \UrlFont, \Url@MathSetup, $\fam\z@\textfont\z@\font <address> \m@th$ */
function urlFormula(cx: Ctx, address: string, size: SizeCommand, attrs: FontAttrs, penalties: boolean): Node[] {
  const list: MItem[] = [...address].map((c) => {
    const noad = urlClass(c)
    if (noad === null) throw new Unsupported(`\\url with ${c === " " ? "a space" : c}`)
    return { noad, nucleus: { kind: "char", fam: 0, char: c.charCodeAt(0) }, sup: null, sub: NOLIG.includes(c) ? { kind: "mlist", list: [kern(0)] } : null } // (\/ in math: a zero kern, § 1111)
  })
  // \UrlFont: \ttfamily, in the series and shape around (\wrong@fontshape for one not declared)
  const tt: FontAttrs = { ...attrs, fam: "cmtt" }, key = `${tt.enc}/cmtt/${tt.ser}/${tt.shape}`
  if (!cx.run.k.sizes[size].fonts[key].declared) (cx.doc.substituted ??= new Set()).add(key)
  const font = selectFont(cx.run.k, size, tt)
  const env = mathEnv(cx.run.k, size, cx.pre.amsmath)
  env.fonts = env.fonts.map((fams, s) => (s === 0 ? fams.map((f, fam) => (fam === 0 ? font : f)) : fams)) // \textfont\z@\font
  env.muskips = { thinmuskip: ZERO, medmuskip: ZERO, thickmuskip: ZERO }
  return [{ kind: "math", on: true, width: 0 }, ...mlistToHlist(list, env, TEXT, penalties), { kind: "math", on: false, width: 0 }]
}
