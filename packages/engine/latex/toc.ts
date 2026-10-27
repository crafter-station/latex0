// The table of contents' file: what \addcontentsline{toc} writes in one run
// (\thepage is the page each write is shipped out on), and what the next run
// reads back for \tableofcontents.

import type { Node } from "../layout/nodes"
import { printTokens } from "./encodings"

/** A line the run before wrote to the .toc file: \contentsline{name}{\numberline{number}title}{page}{anchor} */
export interface TocEntry { level: 0 | 1 | 2 | 3 | 4 | 5; number: string | null; title: string; /** \thepage */ page: string; /** with hyperref, the heading's anchor */ anchor: string }

const NAMES = ["chapter", "section", "subsection", "subsubsection", "paragraph", "subparagraph"]

export class TocWriter {
  private readonly writes: { node: Node; entry: Omit<TocEntry, "page"> }[] = []

  /** \addcontentsline{toc}'s \write */
  write(level: TocEntry["level"], number: string | null, source: string, anchor = ""): Node {
    const title = printTokens(source) // (as \protected@write prints it, and the next run reads it)
    const node: Node = { kind: "whatsit", text: `\\write1{\\@writefile{toc}{\\protect \\contentsline {${NAMES[level]}}{${number !== null ? `\\protect \\numberline {${number}}` : ""}${title}}{\\thepage }{${anchor}}\\protected@file@percent }}` }
    this.writes.push({ node, entry: { level, number, title, anchor } })
    return node
  }

  /** The .toc file: the lines in the order they were shipped out, each with its page. */
  written(order: (n: Node) => number, page: (n: Node) => string): TocEntry[] {
    return this.writes.slice().sort((x, y) => order(x.node) - order(y.node)).map(({ node, entry }) => ({ ...entry, page: page(node) }))
  }
}
