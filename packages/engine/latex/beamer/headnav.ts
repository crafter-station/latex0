// What the head and foot lines' navigation reads of the last run's .nav (beamerbasemisc.sty's
// \beamer@lastminutepatches \@input's it at \begin{document}: each \headcommand stored, \dohead
// replaying them): the section entries, the slide entries and the subsection entries, in order, and
// \beamer@sectionmax and \beamer@subsectionmax as \beamer@initsectionentry and \beamer@initslideentry
// count them.

import type { Node } from "../../layout/nodes"

/** \sectionentry {section}{short title}{page}{title}{part} */
export interface SectionEntry { kind: "section"; section: number; short: string; page: number }
/** \slideentry {section}{subsection}{slide}{first/last page}{\lastsubsection}{part} */
export interface SlideEntry { kind: "slide"; section: number; subsection: number; slide: number; first: number; last: number; lastSubsection: string }
/** \beamer@subsectionentry {part}{section}{subsection}{page}{short title} */
export interface SubsectionEntry { kind: "subsection"; section: number; subsection: number; page: number; short: string }
export type NavHead = SectionEntry | SlideEntry | SubsectionEntry

const SECTION = /\\headcommand \{\\protect \\sectionentry \{(\d+)\}\{([^{}]*)\}\{(\d+)\}\{[^{}]*\}\{0\}\}/
const SLIDE = /\\headcommand \{\\protect \\slideentry \{(\d+)\}\{(\d+)\}\{(\d+)\}\{(\d+)\/(\d+)\}\{([^{}]*)\}\{0\}\}/
const SUBSECTION = /\\headcommand \{\\protect \\beamer@subsectionentry \{0\}\{(\d+)\}\{(\d+)\}\{(\d+)\}\{([^{}]*)\}\}/

/** the entries a run writes to the .nav: its \write's on the main vertical list `nodes`, in order */
export function navHeads(nodes: Node[]): NavHead[] {
  const out: NavHead[] = []
  for (const n of nodes) {
    if (n.kind !== "whatsit" || !n.text.startsWith("\\write1{\\@writefile{nav}")) continue
    let m = n.text.match(SECTION)
    if (m) { out.push({ kind: "section", section: +m[1], short: m[2], page: +m[3] }); continue }
    m = n.text.match(SLIDE)
    if (m) { out.push({ kind: "slide", section: +m[1], subsection: +m[2], slide: +m[3], first: +m[4], last: +m[5], lastSubsection: m[6] }); continue }
    m = n.text.match(SUBSECTION)
    if (m) out.push({ kind: "subsection", section: +m[1], subsection: +m[2], page: +m[3], short: m[4] })
  }
  return out
}

/** \beamer@sectionmax (the section entries, in the one part) and \beamer@subsectionmax (the largest subsection a slide
 *  entry names) */
export function navMax(heads: NavHead[]): { sections: number; subsections: number } {
  let sections = 0, subsections = 0
  for (const h of heads) {
    if (h.kind === "section") sections++
    else if (h.kind === "slide") subsections = Math.max(subsections, h.subsection)
  }
  return { sections, subsections }
}
