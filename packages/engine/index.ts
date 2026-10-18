// @latex0/latex — zero-dependency, single-pass LaTeX -> HTML engine.
//
//   render(source)  ->  HTML string
//
// Pipeline: expandDocument() -> tokenize() -> parse() -> renderAst(). The
// document's own macros are expanded at token level, exactly as TeX expands
// them (expand/); each stage is exported so callers can cache or inspect
// intermediate results.

import { expandDocument } from "./expand/document"
import { tokenize } from "./lexer"
import { isKnownCommand, parse } from "./parser"
import { renderAst, type RenderOptions } from "./render"
import { escapeHtml } from "./util"

export { expandDocument, type DocumentExpansion } from "./expand/document"
export { tokenize } from "./lexer"
export { parse } from "./parser"
export { renderAst, type RenderOptions } from "./render"
export { LATEX_CSS } from "./styles"
export type { Node, Token } from "./types"

// The exact engine: a document laid out as TeX lays it out, drawn as SVG pages (emit/svg). The host
// installs the engine's data (data/*.json) first; a construct the engine cannot lay out exactly yet
// throws Unsupported.
export { document, type DocumentOptions } from "./latex/document"
export { svgPages, type SvgOptions, type SvgPages } from "./emit/svg"
export { installData, type DataSource, type WebFonts } from "./latex/data"
export { Unsupported } from "./latex/unsupported"
export { bitmapInfo, type Bitmap } from "./latex/images"

/** The source with the document's macro definitions removed and their uses expanded. */
export function expandMacros(source: string): string {
  return expandDocument(source, { known: isKnownCommand }).text
}

/** Render LaTeX source to an HTML fragment string. */
export function render(source: string, opts: RenderOptions = {}): string {
  const { text, errors } = expandDocument(source, { known: isKnownCommand })
  const tokens = tokenize(text)
  const ast = parse(tokens, text)
  const warning = errors.length ? `<div class="l0-warning">Macro expansion stopped: ${escapeHtml(errors[0])}</div>` : ""
  return warning + renderAst(ast, opts)
}
