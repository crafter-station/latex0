// @latex0/latex — zero-dependency, single-pass LaTeX -> HTML engine.
//
//   render(source)  ->  HTML string
//
// Pipeline: tokenize() -> parse() -> renderAst(). Each stage is exported so
// callers can cache or inspect intermediate results.

import { tokenize } from "./lexer"
import { expandMacros } from "./macros"
import { parse } from "./parser"
import { renderAst, type RenderOptions } from "./render"

export { tokenize } from "./lexer"
export { expandMacros } from "./macros"
export { parse } from "./parser"
export { renderAst, type RenderOptions } from "./render"
export { LATEX_CSS } from "./styles"
export type { Node, Token } from "./types"

/** Render LaTeX source to an HTML fragment string. */
export function render(source: string, opts: RenderOptions = {}): string {
  const expanded = expandMacros(source)
  const tokens = tokenize(expanded)
  const ast = parse(tokens, expanded)
  return renderAst(ast, opts)
}
