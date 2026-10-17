// What one LaTeX run of the document changes as it goes, shared by the layout's
// parts: the class parameters (letter changes \interlinepenalty), counters and
// flags the kernel keeps globally.

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
  /** floats so far */
  floats: number
  /** \c@lstlisting, \lst@neglisting, \lst@lineno */
  listingCount: number
  negListing: number
  lstLineno: number
  /** in a minipage: its width (\textwidth, \columnwidth and \linewidth there) */
  minipageWidth: number | null
  /** the float being read (\@captype), for a \caption in a minipage */
  captype: "figure" | "table" | null
  /** a run-in heading (\paragraph, \subparagraph) waiting for its paragraph: what replaces the indent box
   *  (`em`: of the font where its \everypar runs, which reads \hskip -\@tempskipa's -1em) */
  runIn: ((em?: number, parindent?: number) => Node[]) | null
  /** \@noskipsec left true by a run-in heading whose \everypar never ran (a listing's replaced it, then
   *  \lst@doendpe's): the heading is lost, and the next \@startsection or \@trivlist (\if@noskipsec\leavevmode)
   *  starts an empty paragraph, as \newpage does before it sets \@noskipsecfalse */
  noskipsec: boolean
}

export function runState(k: ClassOptionData): RunState {
  return { k, mainmatter: true, linkcounter: 0, items: 0, floats: 0, listingCount: 0, negListing: 0, lstLineno: 0, minipageWidth: null, captype: null, runIn: null, noskipsec: false }
}
