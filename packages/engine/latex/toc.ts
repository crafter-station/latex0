// The table of contents' file: what \addcontentsline{toc} writes in one run
// (\thepage is the page each write is shipped out on), and what the next run
// reads back for \tableofcontents.

import type { Node } from "../layout/nodes"
import { printTokens } from "./encodings"

/** A line the run before wrote to the .toc file: \contentsline{name}{\numberline{number}title}{page}{anchor} */
export interface TocEntry { level: 0 | 1 | 2 | 3 | 4 | 5; number: string | null; title: string; /** \thepage */ page: string; /** with hyperref, the heading's anchor */ anchor: string; /** babel's language of the .toc's \babel@toc line before it (the last \babel@aux written) */ language?: string }

const NAMES = ["chapter", "section", "subsection", "subsubsection", "paragraph", "subparagraph"]

/** A line of the .lof or .lot file: \contentsline{figure}{\numberline{number}{\ignorespaces title}}{page}{anchor},
 *  or report's \addvspace{10\p@} at a chapter */
export type ListEntry = { number: string; title: string; page: string; anchor: string } | { vspace: true }
export type ListFile = "lof" | "lot"

export class TocWriter {
  private readonly writes: { node: Node; entry: Omit<TocEntry, "page"> }[] = []
  private readonly listWrites: { node: Node; file: ListFile; entry: { number: string; title: string; anchor: string } | { vspace: true } }[] = []

  /** \addcontentsline{lof}{figure}{\protect\numberline{n}{\ignorespaces text}} (or lot): its \write */
  listLine(file: ListFile, number: string, source: string, anchor: string): Node {
    const title = printTokens(source) // (as \protected@write prints it)
    const node: Node = { kind: "whatsit", text: `\\write1{\\@writefile{${file}}{\\protect \\contentsline {${file === "lof" ? "figure" : "table"}}{\\protect \\numberline {${number}}{\\ignorespaces ${title}}}{\\thepage }{${anchor}}\\protected@file@percent }}` }
    this.listWrites.push({ node, file, entry: { number, title, anchor } })
    return node
  }

  /** \addtocontents{lof}{\protect\addvspace{10\p@}} (or lot): its \write */
  listSpace(file: ListFile): Node {
    const node: Node = { kind: "whatsit", text: `\\write1{\\@writefile{${file}}{\\protect \\addvspace {10\\p@ }}}` }
    this.listWrites.push({ node, file, entry: { vspace: true } })
    return node
  }

  /** The .lof or .lot file: the lines in the order they were shipped out, each with its page */
  writtenList(file: ListFile, order: (n: Node) => number, page: (n: Node) => string): ListEntry[] {
    return this.listWrites.filter((w) => w.file === file).sort((x, y) => order(x.node) - order(y.node)).map(({ node, entry }) => ("vspace" in entry ? entry : { ...entry, page: page(node) }))
  }

  /** \addcontentsline{toc}'s \write */
  write(level: TocEntry["level"], number: string | null, source: string, anchor = "", language?: string): Node {
    const title = printTokens(source) // (as \protected@write prints it, and the next run reads it)
    const node: Node = { kind: "whatsit", text: `\\write1{\\@writefile{toc}{\\protect \\contentsline {${NAMES[level]}}{${number !== null ? `\\protect \\numberline {${number}}` : ""}${title}}{\\thepage }{${anchor}}\\protected@file@percent }}` }
    this.writes.push({ node, entry: { level, number, title, anchor, ...(language ? { language } : {}) } })
    return node
  }

  /** The .toc file: the lines in the order they were shipped out, each with its page. */
  written(order: (n: Node) => number, page: (n: Node) => string): TocEntry[] {
    return this.writes.slice().sort((x, y) => order(x.node) - order(y.node)).map(({ node, entry }) => ({ ...entry, page: page(node) }))
  }
}
