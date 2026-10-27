// What one LaTeX run of the document changes as it goes, shared by the layout's
// parts: the class parameters (letter changes \interlinepenalty), counters and
// flags the kernel keeps globally.

import type { CaptionKeys } from "./captionsetup"
import type { ClassOptionData } from "../layout/classdata"
import type { Node } from "../layout/nodes"

export interface RunState {
  k: ClassOptionData
  /** book's \if@mainmatter */
  mainmatter: boolean
  /** \Hy@linkcounter: anchors of unnumbered headings */
  linkcounter: number
  /** \item's so far (each an anchor with hyperref) */
  items: number
  /** \c@enumi … \c@enumiv: an item steps one, a list's \usecounter zeroes its own, none resets another; they keep
   *  their values after the list (cleveref's prefix reads them) */
  enums: number[]
  /** hyperref's \if@hyper@item: an \item of a numbered list sets it (local to the list), and the next \refstepcounter
   *  takes it: its anchor is Item.n then, a step of hyperref's own Item counter (`items`) */
  hyperItem: boolean
  /** amsmath's \iftag@ (global): a numbered multline leaves it true, equation, align and gather false. With cleveref,
   *  LaTeX's first aid then lets a \label keep cleveref's own \cref@currentlabel instead of rebuilding it from
   *  \@currentcounter (which tells a theorem sharing a counter apart) */
  tagFlag: boolean
  /** floats so far */
  floats: number
  /** \c@lstlisting, \lst@neglisting, \lst@lineno */
  listingCount: number
  negListing: number
  lstLineno: number
  /** cleveref with hyperref: the ALG@line anchors made so far (ALG@line.1 … ALG@line.n) */
  algAnchors: number
  /** in a minipage: its width (\textwidth, \columnwidth and \linewidth there) */
  minipageWidth: number | null
  /** the float being read (\@captype), for a \caption in a minipage */
  captype: "figure" | "table" | null
  /** caption.sty's first \label in a float wrote \providecommand*\caption@xref (\caption@@@xlabel, once) */
  captionXref: boolean
  /** caption.sty in the float being read: the number a subcaption stepped its counter to (\caption then takes it,
   *  `pending`, instead of stepping it again), the subcaption counter, and the position the group's first
   *  \caption fixed (\caption@fixposition: on top or not, null before), and whether a subcaption came before
   *  the float's \caption (\caption@ifsubcaption@above: position=auto is then bottom); with hyperref, hypcap's anchor name */
  floatCaption: { number: number | null; pending: boolean; sub: number; top: boolean | null; subAbove: boolean; hypcap?: string; /** caption.sty's keys in force */ keys?: CaptionKeys }
  /** a run-in heading (\paragraph, \subparagraph) waiting for its paragraph: what replaces the indent box
   *  (`em`: of the font where its \everypar runs, which reads \hskip -\@tempskipa's -1em) */
  runIn: ((em?: number, parindent?: number) => Node[]) | null
  /** \@noskipsec left true by a run-in heading whose \everypar never ran (a listing's replaced it, then
   *  \lst@doendpe's): the heading is lost, and the next \@startsection or \@trivlist (\if@noskipsec\leavevmode)
   *  starts an empty paragraph, as \newpage does before it sets \@noskipsecfalse */
  noskipsec: boolean
  /** what listings carries from one listing to the next: gobbled whitespace, \lst@breakcurrindent and the break shape */
  lstCarry: { gobbledws: boolean; breakcurrindent: number; breakshape: [number, number] | null }
  /** where caption.sty's listing captions are on the main vertical list, listings' \vskip (\nobreak\vskip…\nobreak)
   *  in force: an output routine run there would see it */
  lstCaptions: [number, number][]
}

export function runState(k: ClassOptionData): RunState {
  return { k, mainmatter: true, linkcounter: 0, items: 0, enums: [0, 0, 0, 0], hyperItem: false, tagFlag: false, floats: 0, listingCount: 0, negListing: 0, lstLineno: 0, algAnchors: 0, minipageWidth: null, captype: null, captionXref: false, floatCaption: { number: null, pending: false, sub: 0, top: null, subAbove: false }, runIn: null, noskipsec: false, lstCarry: { gobbledws: false, breakcurrindent: 0, breakshape: null }, lstCaptions: [] }
}
