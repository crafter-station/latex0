// CSS for the rendered output. Exported as a string so the engine stays
// self-contained and dependency-free — inject it once via a <style> tag.
// All classes are namespaced `l0-` and scoped under `.l0-root`.

export const LATEX_CSS = `
.l0-root {
  font-family: "Latin Modern Roman", "Computer Modern", Georgia, "Times New Roman", serif;
  font-size: 16px;
  line-height: 1.5;
  color: #1a1a1a;
  text-align: justify;
  hyphens: auto;
  counter-reset: l0-eq;
  /* Force lining figures: Georgia/some serifs default to oldstyle digits where
     "0" is short and reads like "o" (e.g. "latex0" -> "latexo"). */
  font-variant-numeric: lining-nums;
  font-feature-settings: "lnum" 1, "onum" 0;
}
.l0-root p { margin: 0 0 0.8em; }
.l0-root p:first-child { margin-top: 0; }

.l0-h { font-weight: 700; line-height: 1.2; text-align: left; margin: 1.4em 0 0.6em; }
.l0-h1 { font-size: 1.6em; }
.l0-h2 { font-size: 1.3em; }
.l0-h3 { font-size: 1.1em; }
.l0-chapter { font-size: 2em; margin-top: 0.4em; }
.l0-secnum { margin-right: 0.5em; }

.l0-titleblock { text-align: center; margin: 0 0 2em; }
.l0-doctitle { font-size: 1.9em; font-weight: 700; margin: 0 0 0.4em; }
.l0-author { font-size: 1.1em; margin-bottom: 0.2em; }
.l0-date { font-size: 1em; color: #444; }

.l0-list { margin: 0 0 0.8em; padding-left: 1.6em; }
.l0-item { margin: 0.2em 0; }
.l0-desc { margin: 0 0 0.8em; }
.l0-dt { font-weight: 700; }
.l0-dd { margin: 0 0 0.4em 1.6em; }

.l0-minipage { display: inline-block; vertical-align: top; }
.l0-center { text-align: center; }
.l0-left { text-align: left; }
.l0-right { text-align: right; }
.l0-quote { margin: 0 2em 0.8em; font-style: italic; color: #333; }
.l0-verbatim { font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 0.9em;
  background: #f6f6f6; padding: 0.8em 1em; border-radius: 4px; overflow-x: auto; text-align: left; }

.l0-abstract { margin: 1.5em 2em; font-size: 0.95em; }
.l0-abstract-title { text-align: center; font-weight: 700; margin-bottom: 0.4em; }

.l0-figure { text-align: center; margin: 1.2em 0; }
.l0-img { max-width: 100%; height: auto; }
.l0-img-missing { display: inline-flex; align-items: center; gap: 0.4em;
  min-width: 3em; min-height: 2.4em; padding: 0.5em 0.8em; vertical-align: middle;
  border: 1px dashed #bbb; border-radius: 6px; color: #999;
  font: 0.8em system-ui; font-style: normal; }
.l0-img-missing-icon { font-size: 1.1em; opacity: 0.7; }
.l0-img-missing-name { font-family: "SF Mono", Menlo, Consolas, monospace; }
.l0-caption { font-size: 0.9em; color: #444; margin-top: 0.4em; text-align: center; }
.l0-caption-label { font-weight: 700; }

.l0-bibliography { margin-top: 2em; }
.l0-biblist { padding-left: 2.2em; font-size: 0.95em; }
.l0-bibitem { margin: 0.3em 0; }

.l0-table { border-collapse: collapse; margin: 1em auto; text-align: left; }
.l0-td { padding: 0.3em 0.7em; vertical-align: top; }
.l0-hrule { border: 0; border-top: 1px solid #999; margin: 1em 0; }
.l0-pagebreak { height: 1px; margin: 2em 0; border-top: 1px dashed #ccc; }

.l0-link { color: #2563eb; text-decoration: underline; }
.l0-ref, .l0-cite { color: #16a34a; }
.l0-footnote { font-size: 0.85em; color: #555; vertical-align: super; }
.l0-latex { white-space: nowrap; }
.l0-latex sup { font-size: 0.7em; vertical-align: 0.28em; margin-left: -0.36em; margin-right: -0.15em; }
.l0-latex sub { font-size: 1em; vertical-align: -0.21em; margin-left: -0.1em; margin-right: -0.05em; }

/* ---- math ---- */
.l0-math, .l0-display { font-family: "Latin Modern Math", "Cambria Math", "STIX Two Math", serif; }
.l0-display { display: block; text-align: center; margin: 1em 0; position: relative; font-size: 1.05em; }
.l0-eq .l0-eqno { position: absolute; right: 0.5em; top: 50%; transform: translateY(-50%); color: #333; }
.l0-var { font-style: italic; }
.l0-op, .l0-text, .l0-rm { font-style: normal; }
.l0-bf { font-weight: 700; }
.l0-it { font-style: italic; }
.l0-sf { font-family: "Helvetica Neue", Arial, sans-serif; }
.l0-tt { font-family: "SF Mono", Menlo, Consolas, monospace; }
.l0-space { display: inline-block; width: 0.5em; }
.l0-space2 { width: 1em; }
.l0-op { margin-right: 0.15em; }

.l0-sup, .l0-sub { font-size: 0.75em; line-height: 0; position: relative; }
.l0-sup { vertical-align: 0.5em; }
.l0-sub { vertical-align: -0.3em; }

.l0-frac { display: inline-flex; flex-direction: column; text-align: center;
  vertical-align: middle; margin: 0 0.15em; font-size: 0.95em; }
.l0-num { display: block; padding: 0 0.3em; border-bottom: 1px solid currentColor; line-height: 1.2; }
.l0-den { display: block; padding: 0 0.3em; line-height: 1.2; }

.l0-binom { display: inline-flex; flex-direction: column; text-align: center; vertical-align: middle; }
.l0-binom > span { display: block; line-height: 1.1; }
.l0-paren { font-size: 1.4em; vertical-align: middle; }

.l0-sqrt { display: inline-flex; align-items: stretch; }
.l0-sqrt-sign { display: inline-block; transform: scaleY(1.1); }
.l0-sqrt-body { border-top: 1px solid currentColor; padding: 0.1em 0.2em 0 0.1em; }
.l0-root-idx { font-size: 0.7em; vertical-align: 0.7em; margin-right: -0.4em; }

.l0-accent { display: inline-flex; flex-direction: column; align-items: center; vertical-align: bottom; }
.l0-accent-mark { line-height: 0.6; font-size: 0.9em; }

.l0-matrix-wrap { display: inline-flex; align-items: center; vertical-align: middle; }
.l0-matrix { display: inline-flex; flex-direction: column; padding: 0 0.2em; }
.l0-mrow { display: flex; justify-content: center; }
.l0-mcell { padding: 0.1em 0.5em; text-align: center; }
.l0-delim { font-size: 1.6em; display: inline-flex; align-items: center; }

.l0-cases { display: inline-flex; align-items: center; vertical-align: middle; }
.l0-cases .l0-brace { font-size: 2em; }
.l0-cases-body { display: inline-flex; flex-direction: column; }
.l0-row { display: flex; gap: 1.5em; }

/* commutative diagrams (tikzcd -> svg) */
.l0-cd { display: block; margin: 1em auto; color: inherit; overflow: visible; max-width: 100%; }
.l0-cd-node { display: flex; align-items: center; justify-content: center; height: 100%;
  white-space: nowrap; font-size: 15px; line-height: 1; }
.l0-cd-label { display: flex; align-items: center; justify-content: center; height: 100%;
  white-space: nowrap; font-size: 12px; line-height: 1; }

.l0-graphics { display: flex; align-items: center; justify-content: center; gap: 0.5em;
  margin: 1em auto; padding: 1.2em; max-width: 60%; border: 1px dashed #bbb; border-radius: 8px;
  color: #888; font: 0.9em system-ui; font-style: normal; }
.l0-graphics-icon { font-size: 1.4em; }

.l0-unknown { color: #dc2626; font-family: monospace; font-size: 0.85em; }
`
