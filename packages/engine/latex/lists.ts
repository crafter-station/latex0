// LaTeX's list kernel (latex.ltx \list, \@trivlist, \@item, \endtrivlist, \@endparenv) and the environments
// built on it: itemize, enumerate, description (with enumitem's options), quote, quotation, verse, center,
// flushleft, flushright, thebibliography, abstract, and amsthm's theorems and proofs.

import { dataFont } from "./data"
import { type SizeCommand } from "../layout/classdata"
import type { GlueSpec } from "../layout/dimen"
import { loadFont, QUAD, X_HEIGHT, type Font } from "../layout/font"
import { parseGlue, Scanner } from "../layout/dimen"
import { spaceGlue } from "../layout/hmode"
import { appendText, sourceText } from "./encodings"
import { emptyBox, glue, kern, paramGlue, penalty, type GlueNode, type Node, charNode, filGlue, fillGlue, ssGlue } from "../layout/nodes"
import { hpack, vpack } from "../layout/pack"
import { xnOverD } from "../layout/arith"
import { displaySegments, type ListBlock, type Part } from "./blocks"
import type { Ctx } from "./context"
import { flushglue, sloppy, zeroskip } from "./kernel"
import { groupStart, tabularStart } from "./source"
import { Unsupported } from "./unsupported"
import { addGlue, dimen, LOW_PENALTY, negate } from "./vlist"
import { anchor, hyperDriver, labelName, linkTarget } from "./hyperref"
import { setgroup } from "./xcolor"
import { crefWrites, hsizeOf, labelWrite, selectFont, type FontAttrs } from "./paragraph"
import { leadingColor } from "./colors"
import { ALIGNMENTS, declare, topDeclarations, type DeclState } from "./vmode"
import { isSpanish, languageGroups } from "./babel"
import { spanishEnumLabel, spanishEnumRef, spanishItemLabel } from "./spanish"
import { hlistInput } from "./paragraph"
import { labelText, preset, type ListSetup, type ResumeScope } from "./enumitem"
import { representation } from "./counters"
import { frenchItemLabel, frenchListDimens, frenchTextGuard } from "./french"

/** the environments whose text may hold declarations here: no labels, one item */
const DECLARING: string[] = ["center", "flushleft", "flushright", "quote", "quotation", "verse"]
const TEXTBULLET = 136 // \textbullet in TS1

/** What an environment inherits: \@listdepth, the itemize and enumerate depths, \@totalleftmargin and
 *  \linewidth, \parskip, \topsep and \partopsep in force, the size, \@rightskip and \finalhyphendemerits */
export interface EnvCtx { depth: number; itemDepth: number; enumDepth: number; totalLeft: number; lineWidth: number; parskip: GlueSpec; parsep: GlueSpec; itemsep: GlueSpec; topsep: GlueSpec; partopsep: GlueSpec; labelwidth: number; size: SizeCommand; atRightskip: GlueNode | null; finalHyph: number | undefined; /** the enclosing enumerate counters (\p@enumii …) */ enums: number[]
  /** in an enclosing list: the \clubpenalty in force where this one begins */ club?: number
  /** \@beginparpenalty and \@endparpenalty, when not -\@lowpenalty (report's abstract) */ beginparpenalty?: number; endparpenalty?: number
  /** \labelsep (a list's keys may set it, and the lists inside keep it); description's depth; enumitem's
   *  \enit@outerparindent, the enclosing lists' labels (\labelenumi …, \labelitemi …), \theenumi … as text, and
   *  resume's saved lists in the enclosing group; in a list that took french.ldf's \\FB@listHsettings */
  labelsep?: number; frenchMargins?: boolean; /** \parindent in force (center and its kind zero it) */ parindent?: number; descDepth?: number; outerParindent?: number; labels?: Record<string, string | null>; thes?: string[]; scope?: ResumeScope }

/** the document's group: resume's saved lists at the outer level, for each run */
const outerScopes = new WeakMap<object, ResumeScope>()
/** \labelenumi … \labelenumiv as \enit@normlabel leaves them */
const ENUM_LABELS = ["\\arabic{enumi}.", "(\\alph{enumii})", "\\roman{enumiii}.", "\\Alph{enumiv}."]

/** The outer level: no list yet. */
export function topCtx(cx: Ctx): EnvCtx {
  let scope = outerScopes.get(cx.run)
  if (!scope) outerScopes.set(cx.run, scope = new Map())
  return { scope, depth: 0, itemDepth: 0, enumDepth: 0, totalLeft: 0, lineWidth: hsizeOf(cx.run.k), parskip: cx.outerParskip, parsep: cx.run.k.glue.parsep, itemsep: cx.run.k.glue.itemsep, topsep: cx.run.k.glue.topsep, partopsep: cx.run.k.glue.partopsep, labelwidth: cx.run.k.dimens.labelwidth, size: "normalsize", atRightskip: null, finalHyph: undefined, enums: [] }
}

/** a paragraph from a ready horizontal list (the display's opening line) */
/**
 * A list-like environment. \list at a depth (\@listi … \@listvi, the first at the size in force):
 * \@trivlist (\@topsep from \topsep, \partopsep when it starts in vertical mode, and the enclosing
 * \parskip), \parskip\parsep, \parindent\listparindent, \parshape 1 \@totalleftmargin \linewidth, with
 * each environment's settings (description, quote, quotation, verse); \trivlist (center, flushleft,
 * flushright) keeps the enclosing \topsep and margins, with \parsep\parskip and no label. Each \item
 * (\@item) puts \box\@labels — \hskip\itemindent \hskip-\labelwidth \hskip-\labelsep, \makelabel in
 * \labelwidth, \hskip\labelsep — in place of the first paragraph's indentation; later paragraphs are
 * indented by \parindent; a nested environment starts in the item's paragraph (\unskip\par) and the
 * text after it is not indented (\@doendpe); \\ in center, flushleft, flushright and verse is
 * \@centercr (\par\addvspace{-\parskip}). Then \endtrivlist and \@endparenv.
 */
export function list(cx: Ctx, b: ListBlock, ctx: EnvCtx) {
  const { cls, enumitem, hyper, nameref, thmDefs } = cx.pre
  // natbib's thebibliography (\bibitem[label]{key} only there)
  const natbib = b.env === "thebibliography" && cx.pre.natbib ? cx.doc.natbib! : null
  if (b.env === "thebibliography" && !natbib && b.labels?.some((l) => l !== null)) throw new Unsupported("\\bibitem[label]")
  const { counters, esphackNobreaks, lastNode, refs, romanFont, run, typeset, v } = cx
  if (b.env === "abstract") return abstract(cx, b, ctx)
  const outerLabel = refs.label, outerCref = refs.cleveref?.current ?? null // \@currentlabel is local to the environment (and cleveref's \cref@currentlabel)
  const amsthm = b.env === "LXtheorem" || b.env === "proof"
  const trivial = b.env === "center" || b.env === "flushleft" || b.env === "flushright" || amsthm
  const sizeFont = loadFont(dataFont(run.k.sizes[ctx.size].font.name), run.k.sizes[ctx.size].font.at)
  const ems = (x: string) => new Scanner(x, { em: sizeFont.params[QUAD], ex: sizeFont.params[X_HEIGHT] }).scanDimen().value
  let ls = ctx.labelsep ?? run.k.dimens.labelsep // \labelsep (an enclosing list's keys may have set it)
  let depth = ctx.depth, leftmargin = 0, labelwidth = 0, itemindent = 0, listparindent = 0, rightmargin = 0
  const french = cx.pre.babel?.main === "french" // (french.ldf's \update@legacylists)
  // \trivlist: \parsep\parskip; \list: \@listi … \@listvi set some parameters, the others stay as they are
  let topsep = ctx.topsep, partopsep = ctx.partopsep, parsep = trivial ? ctx.parskip : ctx.parsep, itemsep = ctx.itemsep
  labelwidth = trivial ? 0 : ctx.labelwidth
  // enumitem's \trivlist: \parsep\parskip, then \@list<depth> again (inside a list), then \@trivlist; its
  // paragraphs keep the enclosing \parskip, and a list inside it inherits the new \parsep
  let childParsep = parsep
  // parskip.sty's \@listI (\normalsize's \@listi), \@listii and \@listiii: \parsep\parskip, the \parskip in force
  const parskipParsep = (d: number, p: string) => (cx.pre.parskip && p === "parsep" && (d === 2 || d === 3 || d === 1 && ctx.size !== "small" && ctx.size !== "footnotesize") ? ctx.parskip : undefined)
  // what \@list<depth> sets: article, report and book \@listi–iii \topsep \parsep \itemsep, \@listiii also
  // \partopsep; letter \@listI \parsep \topsep \itemsep, \@listii none of them, \@listiii \topsep \itemsep
  const listSets = (d: number): string[] => cls === "letter" ? (d === 1 ? ["topsep", "parsep", "itemsep"] : d === 3 ? ["topsep", "itemsep"] : [])
    : d <= 2 ? ["topsep", "parsep", "itemsep"] : d === 3 ? ["topsep", "parsep", "itemsep", "partopsep"] : []
  if (trivial && enumitem && ctx.depth >= 1) {
    const d = ctx.depth, L = (p: string) => parskipParsep(d, p) ?? run.k.glue[d === 1 ? `list1${p}@${ctx.size}` : `list${d}${p}`]
    for (const p of listSets(d)) { if (p === "topsep") topsep = L(p); else if (p === "parsep") childParsep = L(p); else if (p === "itemsep") itemsep = L(p); else partopsep = L(p) }
  }
  if (!trivial) {
    depth++
    if (depth > 6) throw new Unsupported("lists nested more than six deep") // LaTeX: Too deeply nested
    const L = (p: string) => parskipParsep(depth, p) ?? run.k.glue[depth === 1 ? `list1${p}@${ctx.size}` : `list${depth}${p}`]
    const D = (p: string) => run.k.dimens[depth === 1 ? `list1${p}@${ctx.size}` : `list${depth}${p}`]
    leftmargin = D("leftmargin")
    for (const p of listSets(depth)) { if (p === "topsep") topsep = L(p); else if (p === "parsep") parsep = L(p); else if (p === "itemsep") itemsep = L(p); else partopsep = L(p) }
    if (depth >= 2) labelwidth = D("labelwidth") + run.k.dimens.labelsep - ls // \labelwidth\leftmargin<depth> \advance\labelwidth-\labelsep
    // (in a list that took \FB@listHsettings, \leftmarginii … vi are \leftmarginFB: \@listii … vi's \leftmargin, and their
    // \labelwidth less \labelsep)
    if (ctx.frenchMargins && depth >= 2) { const fb = frenchListDimens(cx); leftmargin = fb.labelwidth + ls; labelwidth = fb.labelwidth }
    if (french) {
      // french.ldf's lists (its main language): \list is \listFB, whose \FB@listVsettings come before the environment's
      // own (itemize's \itemizeFB calls \listORI: \FB@itemizesettings, all four zero); itemize, enumerate and
      // description take \FB@listHsettings: \leftmargin\labelwidthFB+\labelsep, and \listindentFB more at depth 1
      if (enumitem) throw new Unsupported("french.ldf's lists with enumitem")
      // (\FB@pardim, \parskip's width: in a list, the enclosing one's \parsep)
      const pd = Math.max(ctx.parskip.width, 0), plus = (g: GlueSpec, d: number): GlueSpec => ({ ...g, width: g.width + d })
      if (b.env === "itemize") { topsep = dimen(-pd); partopsep = dimen(pd); parsep = dimen(pd); itemsep = dimen(-pd) }
      else {
        const ex = (x: number) => ems(`${x}ex`), half = { width: ex(0.4), stretch: ex(0.2), stretchOrder: 0 as const, shrink: ex(0.2), shrinkOrder: 0 as const }
        topsep = plus({ width: ex(0.8), stretch: ex(0.4), stretchOrder: 0, shrink: ex(0.4), shrinkOrder: 0 }, -pd)
        partopsep = plus(half, pd); itemsep = plus(half, -pd); parsep = pd > 0 ? dimen(pd) : half
      }
      if (b.env === "itemize" || b.env === "enumerate" || b.env === "description") {
        const fb = frenchListDimens(cx)
        leftmargin = fb.labelwidth + ls + (depth === 1 ? fb.listindent : 0)
        listparindent = ctx.parindent ?? run.k.dimens.parindent // (\listparindent\parindent: the enclosing list's)
        if (b.env === "itemize") labelwidth = frenchItemLabel(cx, sizeFont).width
        else if (b.env === "description") { labelwidth = 0; itemindent = -leftmargin + (depth === 1 ? fb.listindent : 0) }
      }
    }
    // \labelwidth\z@ \itemindent-\leftmargin (enumitem: \enit@calcleft's)
    if (b.env === "description" && !french) { labelwidth = 0; itemindent = enumitem ? 0 : -leftmargin }
    else if (b.env === "quote") rightmargin = leftmargin
    // (letter.cls: quotation keeps \parsep, verse indents 15pt)
    else if (b.env === "quotation") { listparindent = ems("1.5em"); itemindent = listparindent; rightmargin = leftmargin; if (cls !== "letter") parsep = { width: 0, stretch: 65536, stretchOrder: 0, shrink: 0, shrinkOrder: 0 } }
    else if (b.env === "verse") { const ind = cls === "letter" ? 15 * 65536 : ems("1.5em"); itemsep = dimen(0); itemindent = -ind; listparindent = itemindent; rightmargin = leftmargin; leftmargin += ind }
    else if (b.env === "thebibliography" && natbib && !natbib.numbers) { // natbib's \NAT@bibsetup: \leftmargin\bibhang (1em at its load) \itemindent-\leftmargin
      leftmargin = romanFont.params[QUAD]; itemindent = -leftmargin
    } else if (b.env === "thebibliography") { // \settowidth\labelwidth{\@biblabel{widest}} \leftmargin\labelwidth \advance\leftmargin\labelsep
      const w: Node[] = []
      appendText(w, `[${b.widest}]`, sizeFont, { spaceFactor: 1000 }, false)
      labelwidth = hpack(w).width; leftmargin = labelwidth + run.k.dimens.labelsep
    }
    // natbib's \@bibsetup: \itemsep\bibsep (\@listi's \itemsep and \parsep when it loaded) \parsep\z@
    if (b.env === "thebibliography" && natbib) { itemsep = addGlue(run.k.glue["list1itemsep@normalsize"], run.k.glue["list1parsep@normalsize"]); parsep = dimen(0) }
  }
  const itemDepth = ctx.itemDepth + (b.env === "itemize" ? 1 : 0), enumDepth = ctx.enumDepth + (b.env === "enumerate" ? 1 : 0)
  const descDepth = (ctx.descDepth ?? 0) + (b.env === "description" ? 1 : 0)
  const level = b.env === "itemize" ? itemDepth : enumDepth
  if (level > 4) throw new Unsupported(`${b.env} nested more than four deep`)
  // enumitem's keys (\enit@preset, \enit@calcleft)
  let eit: ListSetup | null = null
  const units = { em: sizeFont.params[QUAD], ex: sizeFont.params[X_HEIGHT] }
  const labelFont = (attrs: FontAttrs, src: string) => hlistInput(src, run.k, ctx.size, cx.doc, attrs, { spaceFactor: 1000 }, cx.pre.amsmath, undefined, true)
  const parindentAt = depth === 1 ? ctx.parindent ?? run.k.dimens.parindent : ctx.outerParindent ?? 0 // \enit@outerparindent
  if (enumitem && (b.env === "itemize" || b.env === "enumerate" || b.env === "description")) {
    const dims = { leftmargin, labelwidth, labelsep: ls, labelindent: 0, itemindent, listparindent, rightmargin, topsep, partopsep, parsep, itemsep }
    const widest = (src: string | null): number => {
      if (src !== null) return hpack(labelFont(cx.normalAttrs, labelText(src, "widest"))).width
      if (b.env === "description") return 0 // (\@itemlabel empty)
      if (b.env === "enumerate") { if (isSpanish(cx.pre.babel)) throw new Unsupported("enumitem's widest label with spanish"); return hpack(labelFont(cx.normalAttrs, labelText(ENUM_LABELS[level - 1], "widest"))).width }
      // \labelitemi … iv: \textbullet, \bfseries\textendash, \textasteriskcentered, \textperiodcentered (spanish.ldf's labels)
      if (isSpanish(cx.pre.babel)) return hpack(spanishItemLabel(level, run.k, ctx.size, sizeFont, loadFont(dataFont(run.k.sizes[ctx.size].companion.name), run.k.sizes[ctx.size].companion.at), cx.pre.amsmath)).width
      const f = level === 2 ? loadFont(dataFont(run.k.sizes[ctx.size].bold.name), run.k.sizes[ctx.size].bold.at) : loadFont(dataFont(run.k.sizes[ctx.size].companion.name), run.k.sizes[ctx.size].companion.at)
      return f.chars.get(level === 2 ? (run.k.ints.T1 ? 21 : 123) : [TEXTBULLET, 0, 42, 183][level - 1])!.width
    }
    const type = b.env === "enumerate" ? "enum" : "item"
    eit = preset({ env: b.env, e: enumitem, depth, level: b.env === "description" ? descDepth : level, dims, units, parindent: parindentAt, linewidth: ctx.lineWidth, textwidth: run.k.dimens.textwidth, prevLabel: ctx.labels?.[`${type}${level - 1}`] ?? null, widest, scope: ctx.scope ?? new Map(), own: b.options ?? "" })
    ;({ leftmargin, labelwidth, labelsep: ls, itemindent, listparindent, rightmargin, topsep, partopsep, parsep, itemsep } = dims)
    // (spanish.ldf's \theenum… after an enclosing list's label= or ref=; its \@roman, small capitals, throws in representation)
    if (ctx.thes && b.env === "enumerate" && isSpanish(cx.pre.babel)) throw new Unsupported("spanish.ldf's references in a list inside one with enumitem's label or ref")
  } else if (b.options !== undefined) throw new Unsupported(`\\begin{${b.env}}[${b.options}] without enumitem`)
  // amsthm's proof: \topsep6\p@\@plus6\p@ before \trivlist
  if (b.env === "proof") topsep = { width: 6 * 65536, stretch: 6 * 65536, stretchOrder: 0, shrink: 0, shrinkOrder: 0 }
  let topsepadd = b.inPar ? topsep : addGlue(topsep, partopsep) // \partopsep only from vertical mode
  let topsepAll = addGlue(topsepadd, ctx.parskip) // \advance\@topsep\parskip, the enclosing \parskip
  // amsthm's theorem: \@topsep \thm@preskip and \@topsepadd \thm@postskip, \topsep (half of it for remark)
  const thmDef = b.thm ? thmDefs.get(b.thm.name)! : null
  if (thmDef) {
    const half = (g: GlueSpec): GlueSpec => ({ ...g, width: Math.trunc(g.width / 2), stretch: Math.trunc(g.stretch / 2), shrink: Math.trunc(g.shrink / 2) }) // \divide…\tw@
    topsepAll = topsepadd = thmDef.style === "remark" ? half(ctx.topsep) : ctx.topsep
    if (b.items.some((it) => it.parts.some((p) => p.kind === "list"))) throw new Unsupported("a list in a theorem")
    if (hyper && !thmDef.counter) throw new Unsupported("an unnumbered theorem with hyperref")
  }
  // nameref's patched \@begintheorem: \@currentlabelname is the note (empty without one), in the environment's group
  const outerName = refs.name
  if (thmDef && nameref) refs.name = labelName(b.thm!.note ?? "")
  // \refstepcounter{counter}: \the<counter> (the section's number first, when within it)
  let thmNumber: string | null = null
  if (thmDef?.counter) {
    thmNumber = counters.stepNumbered(thmDef.counter)
    refs.label = thmNumber; refs.href = counters.currentHref(thmDef.counter)
    // (cleveref's \@ynthm gives a theorem sharing a counter \refstepcounter[name]{counter}; LaTeX's first aid rebuilds
    // the label from \@currentcounter unless \iftag@)
    const crefType = run.tagFlag && thmDef.counter !== b.thm!.name && thmDef.crefNamed ? b.thm!.name : thmDef.counter
    if (refs.cleveref) refs.cleveref.current = { type: crefType, arabic: counters.value(thmDef.counter), prefix: counters.crefPrefix(thmDef.counter), label: thmNumber }
    // (with cleveref hyperref leaves \@thm unpatched: \refstepcounter's own anchor, in vertical mode after \trivlist)
    if (hyper && refs.cleveref) v.nodes.push(...anchor(refs.href, run.k.sizes[ctx.size].baselineskip.width, "v", lastNode()))
  }
  // the body's font: \itshape for plain theorems
  const bodyAttrs: FontAttrs | undefined = thmDef?.style === "plain" ? { enc: run.k.ints.T1 ? "T1" : "OT1", fam: "cmr", ser: "m", shape: "it" } : undefined
  /** \@begintheorem's head, \sbox'ed into \@labels and \unhbox'ed by \dth@everypar: \normalfont, the head font
   *  (\bfseries, remark \itshape), the name, \@upn{number} (\textup's italic corrections before and after it),
   *  ( note) in \fontseries\mddefault\upshape, the punctuation, \hskip\thm@headsep (5pt plus1pt minus1pt) */
  const thmHead = (): Node[] => {
    const T1 = run.k.ints.T1 ? "T1" : "OT1"
    const hf = selectFont(run.k, ctx.size, thmDef!.style === "remark" ? { enc: T1, fam: "cmr", ser: "m", shape: "it" } : { enc: T1, fam: "cmr", ser: "bx", shape: "n" })
    const up = selectFont(run.k, ctx.size, thmDef!.style === "remark" ? { enc: T1, fam: "cmr", ser: "m", shape: "n" } : { enc: T1, fam: "cmr", ser: "bx", shape: "n" })
    const note = selectFont(run.k, ctx.size, { enc: T1, fam: "cmr", ser: "m", shape: "n" })
    const l: Node[] = [], st = { spaceFactor: 1000 }
    const italic = (f: Font) => { const last = l.at(-1); return last?.kind === "char" ? (f.chars.get(last.char)?.italic ?? 0) : 0 }
    appendText(l, thmDef!.title, hf, st, false)
    if (thmNumber !== null) {
      const sp = spaceGlue(hf, st.spaceFactor); st.spaceFactor = 1000
      l.push(kern(italic(hf), true), sp) // \sw@slant: the skip off, \/, the skip back
      appendText(l, thmNumber, up, st, false)
      if (thmDef!.style !== "remark") l.push(kern(italic(up), true)) // \check@icr: only when the head's font is upright
    }
    if (b.thm!.note !== null) {
      if (/[\\{}$%&#^_~]/.test(b.thm!.note)) throw new Unsupported(`theorem note "${b.thm!.note}"`)
      l.push(spaceGlue(hf, st.spaceFactor)); st.spaceFactor = 1000
      appendText(l, `(${b.thm!.note})`, note, st, false)
    }
    appendText(l, ".", hf, st, false)
    l.push(glue(5 * 65536, 65536, 0, 65536, 0))
    return setgroup(l)
  }
  const totalLeft = ctx.totalLeft + leftmargin, lineWidth = ctx.lineWidth - leftmargin - rightmargin
  const parShape: [number, number][] | undefined = depth > 0 ? [[totalLeft, lineWidth]] : undefined
  // paragraph settings: \@trivlist's \leftskip\z@skip \rightskip\@rightskip \parfillskip\@flushglue, then
  // \centering, \raggedright or \raggedleft (\parindent\z@)
  let atRightskip = ctx.atRightskip, finalHyph = ctx.finalHyph
  let align: { leftSkip?: GlueNode; rightSkip?: GlueNode; parFillSkip?: GlueNode } = atRightskip ? { rightSkip: paramGlue("rightskip", atRightskip) } : {}
  let parindent = amsthm ? run.k.dimens.parindent : listparindent
  if (b.env === "center") { align = { leftSkip: flushglue("leftskip"), rightSkip: flushglue("rightskip"), parFillSkip: zeroskip("parfillskip") }; finalHyph = 0; parindent = 0 }
  else if (b.env === "flushleft") { atRightskip = filGlue(); align = { rightSkip: flushglue("rightskip") }; finalHyph = 0; parindent = 0 }
  else if (b.env === "flushright") { align = { leftSkip: flushglue("leftskip"), parFillSkip: zeroskip("parfillskip") }; finalHyph = 0; parindent = 0 }
  // thebibliography: \sloppy \clubpenalty4000 \@clubpenalty\clubpenalty \widowpenalty4000 \sfcode`\.\@m (natbib's leaves
  // \@clubpenalty, which \@item's \everypar sets)
  const atClub = b.env === "thebibliography" && !natbib ? 4000 : run.k.ints.clubpenalty
  const bib = b.env === "thebibliography" ? { ...sloppy(romanFont.params[QUAD]), clubPenalty: atClub, widowPenalty: 4000, noteWidowPenalty: 4000, sfcodes: { 46: 1000 } } : {}
  const shape = { ...align, ...(parShape ? { parShape } : {}), ...(finalHyph !== undefined ? { finalHyphenDemerits: finalHyph } : {}), ...bib }
  const font = sizeFont
  const bold = loadFont(dataFont(run.k.sizes[ctx.size].bold.name), run.k.sizes[ctx.size].bold.at)
  const companion = loadFont(dataFont(run.k.sizes[ctx.size].companion.name), run.k.sizes[ctx.size].companion.at)
  let counter = eit?.counter ?? 0 // \c@enum…: an item with its own label does not step it (\usecounter, then start= or resume)
  const outerHyperItem = run.hyperItem
  if (b.env === "enumerate") run.enums[level - 1] = counter
  // \theenum… as text: label= or ref= (\enit@reflabel), else \arabic \alph \roman \Alph; the enclosing ones
  const thes = () => ctx.thes ?? ctx.enums.map((n, j) => representation(["arabic", "alph", "roman", "Alph"][j], n))
  const the = (n: number) => eit?.ref != null ? labelText(eit.ref, [...ctx.enums, n]) : representation(["arabic", "alph", "roman", "Alph"][level - 1], n)
  /** \enit@format around a label, in the label's font */
  const formatted = (attrs: FontAttrs, src: string) => labelFont(attrs, eit?.format ? `{${eit.format}{${src}}}` : src)
  if (b.env === "thebibliography") run.enums[3] = 0
  const alph = (n: number) => (n > 0 && n <= 26 ? String.fromCharCode(96 + n) : "") // \@alph: \ifcase (\@ctrerr past z)
  const spanish = isSpanish(cx.pre.babel) // (spanish.ldf's layout: its labels)
  const roman = (n: number) => { // \@roman (TeX's \romannumeral)
    let out = ""
    for (const [v, r] of [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]] as const) while (n >= v) { out += r; n -= v }
    return out
  }
  /** the proof's \qed at its end: \leavevmode\unskip\penalty9999 \hbox{}\nobreak\hfill\quad\hbox{\qedsymbol}, \openbox
   *  (\hbox to.77778em{\hfil\vrule\vbox to.675em{\hrule width.6em\vfil\hrule}\vrule\hfil}) in the body's font */
  const lastPart = b.items.at(-1)?.parts.at(-1)
  if (b.env === "proof" && (!lastPart || lastPart.kind !== "text" || !lastPart.text)) throw new Unsupported("a proof that does not end with text")
  const qedAt = (p: Part) => b.env === "proof" && p === lastPart
  const qed = (): Node[] => {
    const frac = (d: string) => new Scanner(d, { em: sizeFont.params[QUAD], ex: sizeFont.params[X_HEIGHT] }).scanDimen().value
    const vrule = (): Node => ({ kind: "rule", width: 26214, height: null, depth: null })
    const vb = vpack([{ kind: "rule", width: frac(".6em"), height: 26214, depth: 0 }, filGlue(), { kind: "rule", width: null, height: 26214, depth: 0 }], { exactly: frac(".675em") })
    const box = hpack([filGlue(), vrule(), vb, vrule(), filGlue()], { exactly: frac(".77778em") })
    return [penalty(9999), hpack([]), penalty(10000), fillGlue(), glue(sizeFont.params[QUAD]), hpack([box])]
  }
  // the \clubpenalty in force when an item's paragraph starts in a group (where \@item's \everypar sets its own):
  // thebibliography's, the outer one before the first item, then what the last item's \everypar set
  const innerScope: ResumeScope = new Map(ctx.scope ?? []) // (the environment's group)
  let groupClub = b.env === "thebibliography" ? 4000 : ctx.club ?? (depth <= 1 ? v.club : run.k.ints.clubpenalty)
  // what declarations in the environment's text set (center, flushleft, flushright, quote, quotation, verse)
  let envState: DeclState = { size: ctx.size, attrs: bodyAttrs ?? cx.normalAttrs, align: null }, declared = false
  let bibItemStart = 0 // (where the item's material starts)
  b.items.forEach(({ label: given, parts }, i) => {
    if (given) frenchTextGuard(given)
    // (babel's otherlanguage over an item's paragraphs: what its end restores is not modeled in a list)
    if (parts.some((p) => p.kind === "text" && languageGroups(p.text).closed)) throw new Unsupported("otherlanguage over an item's paragraphs")
    run.hyperItem = hyper && (b.env === "enumerate" || b.env === "thebibliography" && !natbib) // hyperref's \item: \if@nmbrlist (natbib's has no \usecounter)
    // \@item: before the first item \@beginparpenalty, \@topsep and -\parskip (right after a heading,
    // \@nbitem: \@outerparskip-\parskip); then \@itempenalty and \itemsep
    let club: number | undefined
    const penaltyAt = v.nodes.length
    if (i === 0 && v.nobreak) { v.addvspace(addGlue(ctx.parskip, negate(parsep))); v.nobreak = false; club = 10000 }
    else if (i === 0) { v.addpenalty(ctx.beginparpenalty ?? -LOW_PENALTY); v.addvspace(topsepAll); v.addvspace(negate(parsep)) }
    else { v.addpenalty(-LOW_PENALTY); v.addvspace(itemsep) }
    // babel's \@bibitem: \@safe@activestrue\org@@bibitem…, whose \item ends the item before (\par) and adds the penalty
    if (b.env === "thebibliography") {
      const prev = b.items[i - 1]?.parts
      run.bibSafe.push({ from: i ? bibItemStart : penaltyAt, to: penaltyAt + 1, exact: !prev || (prev.length === 1 && prev[0].kind !== "list" && displaySegments(prev[0].text).length === 1) })
      bibItemStart = v.nodes.length
    }
    // \sbox\@tempboxa{\makelabel{label}}
    let content: Node[]
    let post: Node[] | null = null // description's label for \enit@postlabel
    if (b.env === "itemize" || b.env === "enumerate") {
      const l: Node[] = []
      if (given !== null) { if (eit?.format) l.push(...formatted(cx.normalAttrs, given)); else appendText(l, sourceText(given.replace(/\s+/g, " ")), font, { spaceFactor: 1000 }, false) }
      else if (b.env === "itemize" && eit?.label != null) l.push(...formatted(cx.normalAttrs, eit.label))
      else if (b.env === "itemize") { // \labelitemi … iv: \textbullet, \bfseries\textendash, \textasteriskcentered, \textperiodcentered
        if (eit?.format) throw new Unsupported(`enumitem font=${eit.format} for itemize's own labels`)
        if (spanish) l.push(...spanishItemLabel(level, run.k, ctx.size, font, companion, cx.pre.amsmath))
        else if (french) l.push(frenchItemLabel(cx, font).node) // (\Frlabelitemi … iv: \FrenchLabelItem, \textemdash)
        else if (level === 2) l.push(charNode(bold, run.k.ints.T1 ? 21 : 123)) // \textendash in OT1 and T1
        else l.push(charNode(companion, [TEXTBULLET, 0, 42, 183][level - 1]))
      } else { // \labelenumi … iv: 1. (a) i. A.
        const n = ++counter
        // \refstepcounter{enum…}: \p@enum… \theenum… (1, 1a, 1(a)i, 1(a)iA; with label= or ref= no \p@), and \@currentHref enum….n
        refs.label = eit?.ref != null ? the(n) : spanish ? spanishEnumRef(level, [...ctx.enums, n]) : ((t) => [the(n), `${t[0]}${the(n)}`, `${t[0]}(${t[1]})${the(n)}`, `${t[0]}(${t[1]})${t[2]}${the(n)}`][level - 1])(thes())
        refs.href = `enum${["i", "ii", "iii", "iv"][level - 1]}.${n}`
        run.enums[level - 1] = n // (no counter resets another: \@definecounter; cleveref's prefix only names the chain)
        if (refs.cleveref) refs.cleveref.current = { type: `enum${["i", "ii", "iii", "iv"][level - 1]}`, arabic: n, prefix: run.enums.slice(0, level - 1).join(","), label: refs.label }
        // hyperref: \refstepcounter's anchor (Item.n, a counter of its own) on the vertical list before the item
        if (hyper) { refs.href = `Item.${++run.items}`; run.hyperItem = false; v.nodes.push(...anchor(refs.href, run.k.sizes[ctx.size].baselineskip.width, "v", lastNode())) }
        if ((level === 2 || level === 4) && n > 26) throw new Unsupported("\\alph counter past z") // LaTeX: Counter too large
        // (a \label whose text has more than characters, groups and text font commands: not modeled)
        if ((eit?.ref != null || /[{}]/.test(ctx.thes?.join("") ?? "")) && /\$|\\(?!(?:textbf|textmd|textit|textsl|textsc|textup|textrm|textsf|texttt|textnormal|emph)\s*\{)/.test(refs.label) && hasLabel(parts)) throw new Unsupported(`a \\label to "${refs.label}"`)
        if (eit?.label != null || eit?.format) l.push(...formatted(cx.normalAttrs, labelText(eit.label ?? `{${ENUM_LABELS[level - 1]}}`, [...ctx.enums, n])))
        else if (spanish) l.push(...spanishEnumLabel(level, n, run.k, ctx.size, font, selectFont(run.k, ctx.size, { enc: run.k.ints.T1 ? "T1" : "OT1", fam: "cmr", ser: "m", shape: "it" }), cx.pre.amsmath))
        else appendText(l, level === 1 ? `${n}.` : level === 2 ? `(${alph(n)})` : level === 3 ? `${roman(n)}.` : `${alph(n).toUpperCase()}.`, font, { spaceFactor: 1000 }, false)
      }
      // \hss\llap{#1}, enumitem's \nobreak first; or \nobreak #1\hfil (align=left)
      content = french && b.env === "itemize" ? [filGlue(), ...l] // (\itemizeFB keeps \list's \@mklab, \hfil #1)
        : eit?.align === "left" ? [penalty(10000), ...l, filGlue()] : [...(enumitem ? [penalty(10000)] : []), ssGlue(), hpack([ssGlue(), ...l], { exactly: 0 })]
    } else if (b.env === "description") { // \descriptionlabel: \hspace\labelsep\normalfont\bfseries #1 (enumitem: \labelsep\z@ and \nobreak, the label, \hfil)
      const l: Node[] = []
      if (given && eit?.format) l.push(...formatted({ ...cx.normalAttrs, ser: "bx" }, given))
      else if (given) appendText(l, sourceText(given.replace(/\s+/g, " ")), bold, { spaceFactor: 1000 }, false)
      if (!eit) content = [glue(ls), ...l]
      else if (!eit.boxdesc) { // \nobreak\descriptionlabel{label}, \enit@postlabel after the box
        if (eit.align !== "left") throw new Unsupported(`enumitem align=${eit.align} in a description of style other than standard`)
        content = []; post = [penalty(10000), glue(0), ...l]
      } else content = [glue(0), penalty(10000), ...(eit.align === "left" ? [...l, filGlue()] : [ssGlue(), hpack([ssGlue(), ...l], { exactly: 0 })])]
    } else if (b.env === "proof") { // \item[\hskip\labelsep\itshape title\@addpunct{.}]
      const title = (b.proofTitle ?? sourceText(cx.pre.names.proofname)).replace(/\s+/g, " ").trim()
      if (/[{}$%&#^_]/.test(title.replace(/\\ref\{[A-Za-z0-9:._-]+\}/g, "")) || /\\(?!ref\{)/.test(title)) throw new Unsupported(`proof title "${title}"`)
      if (hyper && /\\ref/.test(title)) throw new Unsupported("a \\ref in a proof title with hyperref")
      const it = selectFont(run.k, ctx.size, { enc: run.k.ints.T1 ? "T1" : "OT1", fam: "cmr", ser: "m", shape: "it" })
      content = [glue(ls)]
      const st = { spaceFactor: 1000 }
      // text, ~ (\nobreak\ ) and \ref{key} (the label's text and \null; ?? in bold when not known)
      for (const piece of title.split(/(~|\\ref\{[^}]*\})/)) {
        if (piece === "~") { content.push(penalty(10000), spaceGlue(it, st.spaceFactor)); continue }
        const ref = piece.match(/^\\ref\{([^}]*)\}$/)
        if (!ref) { appendText(content, piece, it, st, false); continue }
        const known = refs.prev?.get(ref[1])
        if (known) { appendText(content, known.label, it, st, false); content.push(hpack([])) }
        else { const q: Node[] = []; appendText(q, "??", selectFont(run.k, ctx.size, { enc: run.k.ints.T1 ? "T1" : "OT1", fam: "cmr", ser: "bx", shape: "n" }), { spaceFactor: 1000 }, false); content.push(hpack(q)) }
        st.spaceFactor = 1000
      }
      if (st.spaceFactor <= 1000) appendText(content, ".", it, st, false) // \@addpunct: a period unless the title ends in punctuation
    } else if (trivial) content = given ? (() => { const l: Node[] = []; appendText(l, sourceText(given), font, { spaceFactor: 1000 }, false); return l })() : [] // \makelabel##1{##1}
    else if (natbib) {
      // natbib's \@lbibitem: \item[\hfil\NAT@anchor{key}{\NAT@num}], \NAT@num the run before's number for a [label]
      // (none the first run), else \c@NAT@ctr; \NAT@anchor puts \@biblabel (\hfill, or numbers' [n]) when it has one
      const key = b.keys![i], label = b.labels![i]
      const num = label === null || label === "" ? String(i + 1) : refs.natCites?.get(key)?.num ?? ""
      content = [filGlue(), filGlue()] // (\@mklab's \hfil)
      // hyperref: \hyper@natanchorstart{key} (\Hy@raisedlink{\hyper@anchorstart{cite.key}}) before, \hyper@anchorend after
      const a = hyper ? anchor(`cite.${key}`, run.k.sizes[ctx.size].baselineskip.width, "h", undefined) : []
      const [begin, end] = hyperDriver.pdftex ? [a, []] : [a.slice(0, 3), a.slice(3)]
      content.push(...begin)
      if (num !== "" && natbib.numbers) appendText(content, `[${num}]`, font, { spaceFactor: 1000 }, false)
      else if (num !== "") content.push(fillGlue())
      content.push(...end)
    } else { // \@mklab: \hfil #1 (thebibliography's label: \@biblabel{n}, [n])
      content = [filGlue()]
      const l = b.env === "thebibliography" ? `[${i + 1}]` : given
      if (l) appendText(content, sourceText(l), font, { spaceFactor: 1000 }, false)
      // \refstepcounter{enumiv}; with hyperref (\@skiphyperreftrue) \@currentHref stays what it was
      if (b.env === "thebibliography") {
        refs.label = String(i + 1); if (!hyper) refs.href = `enumiv.${i + 1}`
        run.enums[3] = i + 1
        if (refs.cleveref) refs.cleveref.current = { type: "enumiv", arabic: i + 1, prefix: run.enums.slice(0, 3).join(","), label: refs.label }
      }
      // hyperref's \@bibitem: \H@item with no anchor of its own (\@skiphyperreftrue), then \Hy@raisedlink{\hyper@anchorstart{cite.<key>}…}, still in vertical mode
      if (b.env === "thebibliography" && hyper) v.nodes.push(...anchor(`cite.${b.keys![i]}`, run.k.sizes[ctx.size].baselineskip.width, "v", lastNode()))
    }
    const temp = hpack(setgroup(content.slice()))
    const boxed = temp.width > labelwidth ? temp : hpack(setgroup(content.slice()), { exactly: labelwidth })
    let labelStart: Node[] = [hpack([glue(itemindent), glue(-labelwidth), glue(-ls), boxed, glue(ls)]), penalty(0)]
    if (post) {
      // \enit@postlabel: \@labels with \enit@align{\unhbox\@tempboxa} (\unskip'ped when wider than \labelwidth, else in
      // \hbox to\labelwidth), unboxed by \everypar, its \labelsep taken off and put back after \penalty\z@; with
      // nextline a label wider than \labelwidth ends the line (\newline: \nobreak\hfil\break, then \@nobreaktrue)
      const tb = setgroup(post), wide = hpack(tb.slice()).width > labelwidth
      const newline = eit!.nextline && wide
      labelStart = [glue(itemindent), glue(-labelwidth), glue(-ls), ...(wide ? [penalty(10000), ...tb] : [hpack([penalty(10000), ...tb, filGlue()], { exactly: labelwidth })]), ...(newline ? [penalty(10000), filGlue(), penalty(-10000)] : [penalty(0), glue(ls)])]
      if (newline) club = 10000
      // (after an amsmath display in that paragraph TeX's \clubpenalty is back to \@clubpenalty: not modeled)
      const first = parts[0]
      if (newline && first?.kind === "text" && displaySegments(first.text).length > 1) throw new Unsupported("a display in the paragraph of a nextline label on a line of its own")
    }
    // \clubpenalty in the item: \@M from its first paragraph right after a heading, until a later paragraph's
    // \everypar (still \@item's) or \@doendpe's \par sets \@clubpenalty
    let itemClub = club
    let started = false // a paragraph has started in the item (its \everypar has run)
    parts.forEach((p) => {
      if (p.kind === "list" && declared) throw new Unsupported(`an environment after a declaration in ${b.env}`)
      if (p.kind === "list") {
        if (p.blank) v.par()
        if (run.noskipsec && !p.inPar) throw new Unsupported("a nested list after a run-in heading lost to a listing")
        // (the \clubpenalty in force: what the item's \everypar left, or before its first paragraph what was there)
        const inForce = started ? itemClub ?? atClub : groupClub
        // (enumitem: \labelsep, \enit@outerparindent, \labelenum… and \labelitem…, \theenum…, and the list's group for resume)
        const labels = eit && b.env !== "description" ? { ...ctx.labels, [`${b.env === "enumerate" ? "enum" : "item"}${level}`]: eit.label ?? (b.env === "enumerate" ? `{${ENUM_LABELS[level - 1]}}` : null) } : ctx.labels
        return list(cx, p, { depth, itemDepth, enumDepth, totalLeft, lineWidth, parskip: parsep, parsep: trivial ? childParsep : parsep, itemsep, topsep, partopsep, labelwidth, size: ctx.size, atRightskip, finalHyph, enums: b.env === "enumerate" ? [...ctx.enums, counter] : ctx.enums, club: inForce,
          labelsep: ls, parindent, descDepth, outerParindent: eit && depth === 1 ? parindentAt : ctx.outerParindent, labels, frenchMargins: ctx.frenchMargins || french && (b.env === "itemize" || b.env === "enumerate" || b.env === "description"), thes: b.env === "enumerate" ? (eit?.ref != null || ctx.thes ? [...thes(), the(counter)] : undefined) : ctx.thes, scope: innerScope })
      }
      if (p.text.trim()) started = true
      // \everypar: the indent box gives way to \box\@labels \penalty\z@; after a nested environment, \@doendpe
      // drops it; later paragraphs are indented by \parindent
      const un = p.unskip ? { unskip: p.unskip } : {}
      // a \label before a theorem's text: its write on the vertical list, before a color group's push (\nobreak's while \if@nobreak holds)
      if (thmDef && p.start === "label") {
        const lead = p.text.match(/^(?:\s*\\label\{[A-Za-z0-9:._-]+\})+\s*/)
        if (lead) {
          // (\if@nobreak still holds right after a heading: \@nbitem leaves it, the paragraph's \everypar ends it)
          for (const m of lead[0].matchAll(/\\label\{([^}]*)\}/g)) for (const w of [labelWrite(refs, m[1]), ...crefWrites(refs, m[1], false)]) v.nodes.push(w, ...esphackNobreaks(club !== undefined))
          p.text = p.text.slice(lead[0].length)
        }
      }
      // a group that starts the paragraph (the paragraph starts in it; a {\color …} group's push goes on the vertical list)
      const colorStart = /^\s*\{\\color(?![A-Za-z])/.test(p.text), inGroup = groupStart(p.text)
      // (declarations first, then a {\color …} group: its push goes on the vertical list after them, not laid out)
      if (/^\s*(?:\\[A-Za-z]+(?![A-Za-z])\s*)+\{\\color(?![A-Za-z])/.test(p.text)) throw new Unsupported("a color group after declarations starting a paragraph")
      if (inGroup && club && p.start !== "label" && p.start !== "doendpe") throw new Unsupported("a group starting an item's paragraph here")
      // (later, where \@item's \everypar may still run in the group: the \clubpenalty from before must be \@clubpenalty)
      if (inGroup && (p.start === "par" || p.start === "cr") && itemClub !== undefined && itemClub !== atClub) throw new Unsupported("a group starting an item's later paragraph here")
      // (after a nested list, \@doendpe's \everypar runs in the group, and its \par clears all it set; after \\ the
      // push comes after \@centercr's skip, below)
      if (colorStart && (p.start === "label" || p.start === "doendpe")) p.text = leadingColor(cx, p.text)
      // (so does a tabular: \begin{tabular}'s group, then \leavevmode)
      const grouped = inGroup || tabularStart(p.text)
      if (grouped && !inGroup && (p.start !== "label" || (club && depth > 1))) throw new Unsupported("a tabular starting an item's paragraph here")
      // (in a {\color …} group the \everypar's \clubpenalty\@clubpenalty ends with the group: the one in force stays,
      // the outer one for a first item, else what the item before set)
      // a theorem: \dth@everypar takes the indent box off and \unhbox'es the head (no \penalty\z@)
      // (with hyperref, \Hy@theorem@refstepcounter's anchor first: \MakeLinkTarget* at the paragraph's para/begin, raised
      // by \normalbaselineskip; then \dth@everypar's \lastbox finds no indent box: \kern-\itemindent)
      const thmAnchor = thmDef && hyper && !refs.cleveref
        ? [...linkTarget(refs.href, run.k.sizes[ctx.size].baselineskip.width, run.k.sizes.normalsize.baselineskip.width), kern(0, true)] : []
      const start = thmDef ? [...thmAnchor, ...thmHead(), ...(p.nodes ?? [])] : [...labelStart, ...(p.nodes ?? [])]
      // declarations at the top level of the text (\begin{center}\large …): to the environment's end, its paragraphs
      // started in the font in force and ended (\par, \@centercr's or \endtrivlist's) at the size in force
      const decls = topDeclarations(p.text)
      if (decls.length && !DECLARING.includes(b.env)) throw new Unsupported(`a declaration in ${b.env}`)
      if (decls.some((d) => (ALIGNMENTS as readonly string[]).includes(d))) throw new Unsupported(`\\${decls.find((d) => (ALIGNMENTS as readonly string[]).includes(d))} in ${b.env}`)
      if (decls.length && !p.text.replace(/\\([A-Za-z]+)(?![A-Za-z])\s*/g, (m, d) => (decls.includes(d) ? "" : m)).trim()) throw new Unsupported(`declarations alone in a paragraph of ${b.env}`)
      const from = envState
      envState = decls.reduce((s, d) => declare(cx, s, d), envState)
      declared ||= decls.length > 0
      const size = from.size
      const groups = { groups: true, ...(declared ? { attrs: from.attrs, topDecls: true, ...(envState.size !== size ? { parSize: envState.size } : {}) } : {}) }
      const body = { ...(bodyAttrs ? { attrs: bodyAttrs } : {}), ...(qedAt(p) && !p.parEnd ? { end: qed() } : {}) }
      if (p.start === "label") {
        // (footnotes read in a color group, and a leading tabular's p{width} entries, see what \@item's \everypar set
        // there; after it, the one from before)
        const everyparClub = club ?? atClub
        typeset(p.text, { start, ...shape, ...un, ...body, ...groups, ...(club && !grouped ? { clubPenalty: club } : grouped ? { clubPenalty: groupClub, noteClubPenalty: groupClub, ...{ leadGroupNoteClubPenalty: everyparClub } } : {}) }, parsep, size)
        if (!grouped) groupClub = club ?? atClub
        // (\@item's \everypar ran in the group: after it, \clubpenalty is the one from before, and \everypar still \@item's)
        else itemClub = groupClub
      }
      // the nested list's group is over: its footnotes see the item's \clubpenalty (\@M right after a
      // heading); \@doendpe's \par sets \@clubpenalty for the lines
      else if (p.start === "doendpe") { typeset(p.text, { ...shape, ...un, ...body, ...groups, noteClubPenalty: itemClub ?? run.k.ints.clubpenalty, everyparNoindent: true }, parsep, size); itemClub = undefined }
      else {
        // a paragraph's \everypar resets \clubpenalty; after \\ with no text (a list next) none starts
        if (p.text) itemClub = undefined
        if (p.start === "cr") { // \@centercr: \par, (\nobreak), \addvspace{-\parskip}, (\vskip)
          if (p.crStar) v.nodes.push(penalty(10000))
          v.addvspace(negate(parsep))
          const f = selectFont(run.k, from.size, from.attrs) // (in the font in force there)
          if (p.crSkip !== undefined) { try { v.vskip(parseGlue(p.crSkip, { em: f.params[QUAD], ex: f.params[X_HEIGHT] })) } catch { throw new Unsupported(`\\\\[${p.crSkip}]`) } }
        }
        if (colorStart) p.text = leadingColor(cx, p.text) // (after the \@centercr skip)
        if (p.text) typeset(p.text, { start: [emptyBox("hlist", parindent)], ...shape, ...un, ...body, ...groups }, parsep, size)
      }
      // a proof whose last paragraph a blank line ended: \qed's \leavevmode starts one of its own
      if (qedAt(p) && p.parEnd) typeset("", { start: [emptyBox("hlist", parindent)], ...shape, ...(bodyAttrs ? { attrs: bodyAttrs } : {}), end: qed() }, parsep, ctx.size)
    })
  })
  // \endtrivlist: the last item's \par, then \@endparenv
  v.endtrivlist(parsep, ctx.parskip, topsepadd, ctx.endparpenalty)
  if (natbib) v.vskip(negate(v.lastSkip)) // \bibcleanup: \vskip-\lastskip
  // enumitem's \enit@endlist: resume's counter (enumerate) and keys after the group
  if (eit) ctx.scope?.set(b.env, { level: b.env === "description" ? descDepth : level, counter: b.env === "enumerate" ? counter : null, keys: eit.keys })
  refs.label = outerLabel
  refs.name = outerName
  run.hyperItem = outerHyperItem
  if (refs.cleveref) refs.cleveref.current = outerCref
}

/**
 * article's abstract (one column, no title page): \small, \begin{center}{\bfseries \abstractname
 * \vspace{-.5em}\vspace{\z@}}\end{center}, then the text in a quotation
 */
export function abstract(cx: Ctx, b: ListBlock, ctx: EnvCtx) {
  const { cls } = cx.pre
  const { run, v } = cx
  if (cls !== "article") throw new Unsupported(`abstract in ${cls}`)
  const small = { ...ctx, size: "small" as SizeCommand }
  const bf = loadFont(dataFont(run.k.sizes.small.bold.name), run.k.sizes.small.bold.at)
  const head: Node[] = []
  appendText(head, sourceText(cx.pre.names.abstractname), bf, { spaceFactor: 1000 }, false)
  const em = bf.params[QUAD]
  // \vspace in a paragraph: \vadjust{\vskip#1\vskip\z@skip}
  head.push({ kind: "adjust", list: [glue(-xnOverD(em, 32768, 65536)), glue(0)] }, { kind: "adjust", list: [glue(0), glue(0)] })
  list(cx, { kind: "list", env: "center", items: [{ label: null, parts: [{ kind: "text", text: "", start: "label", nodes: head }] }], inPar: b.inPar, blank: false }, small)
  v.afterheadingEverypar = false
  list(cx, { kind: "list", env: "quotation", items: b.items, inPar: false, blank: false }, small)
}

/** a \label in the parts, or in an environment inside them (conservatively: it may see this \@currentlabel) */
function hasLabel(parts: Part[]): boolean {
  return parts.some((p) => p.kind === "text" ? /\\label\b/.test(p.text) : p.items.some((it) => hasLabel(it.parts)))
}
