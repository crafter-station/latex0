// @latex0/latex — zero-dependency, single-pass LaTeX -> HTML engine.
//
//   render(source)  ->  HTML string
//
// Pipeline: tokenize() -> parse() -> renderAst(). Each stage is exported so
// callers can cache or inspect intermediate results.

import { tokenize } from "./lexer"
import { parse } from "./parser"
import { renderAst, type RenderOptions } from "./render"

export { tokenize } from "./lexer"
export { parse } from "./parser"
export { renderAst, type RenderOptions } from "./render"
export { LATEX_CSS } from "./styles"
export type { Node, Token } from "./types"

/** Render LaTeX source to an HTML fragment string. */
export function render(source: string, opts: RenderOptions = {}): string {
  const tokens = tokenize(source)
  const ast = parse(tokens, source)
  return renderAst(ast, opts)
}
