// Shared helpers. Kept dependency-free and side-effect-free.

const ESCAPE_RE = /[&<>"]/g
const ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
}

/** Escape text for safe interpolation into HTML. */
export function escapeHtml(s: string): string {
  return s.replace(ESCAPE_RE, (c) => ESCAPE_MAP[c])
}

// Picture/diagram environments we don't attempt to render (TikZ et al.). We
// emit a labelled placeholder rather than dumping raw drawing commands. Shared
// by the text and math renderers (diagrams often live inside \[...\]).
export const GRAPHICS_ENVS = new Set([
  "tikzpicture",
  "tikzcd",
  "circuitikz",
  "pgfpicture",
  "axis",
  "forest",
  "automata",
  "asy",
  "asypicture",
])

export function graphicsPlaceholder(name: string): string {
  return `<div class="l0-graphics"><span class="l0-graphics-icon">◫</span> <span class="l0-graphics-label">${escapeHtml(name)} diagram</span></div>`
}
