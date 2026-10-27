# latex0 engine — coverage map & roadmap

**Target: the exact same result as real LaTeX.** The zero-dependency engine in
`packages/engine/` must typeset every document pdflatex typesets, with the same glyphs
at the same positions, the same line breaks and the same page breaks. No TeX
binary, no WASM TeX, no remote compile. If it takes two years, it takes two
years. Progress is measured, never felt.

Status date: 2026-10-14. Engine today: ~2,600 lines, 80-entry arity table,
~270 known identifiers, text + math + tikz-cd, two-pass label resolution.
Public ledger: GitHub issues, one tracking issue per area, one milestone per
phase (`scripts/issues/`).

---

## 0. Principles

1. **Exactness is the target, not a tier.** T0–T2 below are milestones on the
   way to T3 "Exact". Nothing is marked done at a lower tier than its phase
   requires.
2. **Spec-driven, not observation-driven.** Every layout rule is implemented
   from its source: *The TeXbook* (Appendix G for math, ch. 14–15 for lines and
   pages), `tex.web` section numbers, `source2e.pdf` for the LaTeX kernel,
   `latexref.xyz` for user-level semantics, each package's own manual. Every
   module cites the section it implements in a header comment.
3. **TeX is the oracle, never the runtime.** pdflatex/latex run only offline,
   in the conformance harness, to produce references. We compare against TeX's
   *own* serialized state (DVI, `\showbox`, `\tracingparagraphs`), not against
   rasters.
4. **We own every position.** The browser never decides layout. The engine
   produces a layout tree with positions in scaled points; the HTML preview and
   the PDF export are both projections of that tree. Fonts and metrics are
   vendored data (TFM + woff2), not dependencies.
5. **Bindings, not interpretation.** Packages and classes are TypeScript
   binding tables, never interpreted `.sty`/`.cls`. User-level macro
   facilities get a fuel-bounded token-level expander. This keeps the problem
   finite.
6. **Small pieces, both scales.** Micro fixtures (one construct per file) and
   macro fixtures (whole documents). One PR = one rule or one binding + its
   fixtures + a scorecard that does not regress. Vercel-Labs style: tiny focused
   modules, a public playground, a public scorecard, exhaustive tests.
7. **Every gap is a public issue.** If a construct is unsupported it has an
   issue, a fixture and a tracking entry. Telemetry of unknown commands decides
   the order.
8. **Build the machine that builds the engine.** Tooling comes before
   features: scaffolders that create a rule or binding with its fixture, test
   and issue link in one command; a one-command unit workflow (fixture →
   oracle → compare → report); codegen for every table (TFM metrics, symbols,
   signatures); a CLI; a release pipeline. The engine is a self-contained
   package from day one so it ships to npm as `@latex0/engine` by moving a
   folder, not by refactoring.

---

## 1. The architectural decision that makes "everything" finite

| Layer | What it covers | Finite source of truth |
|---|---|---|
| **Expansion** (user-level macro facilities) | `\newcommand` family, `\def` incl. delimited params, `\newenvironment`, counters, `\newif`/`\if…\fi`, `\ifthenelse`, `\makeatletter` blocks | TeXbook ch. 20 + latexref "Definitions"; fuel-bounded |
| **Semantics** (what commands mean) | LaTeX2e kernel, standard classes, top ~60 packages, then the long tail | latexref.xyz, `source2e.pdf`, per-package manuals; `@unified-latex/unified-latex-ctan` signatures as *generated data*; KaTeX `supported.md` for math |
| **Layout** (where every glyph goes) | TFM metrics, lig/kern programs, Appendix G math, Knuth–Plass lines, page builder, inserts (footnotes, floats), output routine | `tex.web` §§ 813–890 (lines), 967–1028 (pages), 699–767 (math); `latex.ltx` output routine; class files' dimensions |
| **Output** | HTML preview, PDF export | Our layout tree → HTML projection; our zero-dep PDF writer with subsetted fonts |

---

## 2. Fidelity tiers

| Tier | Definition | Oracle |
|---|---|---|
| **T0 Structural** | Same text, same numbering (sections, equations, floats, theorems, footnotes, citations), all refs resolved, zero unknown commands | normalized `pdftotext` vs our text projection |
| **T1 Typographic** | Same fonts, sizes, font switches, spacing semantics; math visually equivalent | per-block image diff as a smoke test only |
| **T2 Layout** | Same line breaks, page breaks, float placement, page numbers, TOC | `\tracingparagraphs` + `\tracingpages` traces equal; page count and break points equal |
| **T3 Exact** (**the target**) | Every glyph, rule and image at the same position in scaled points, same fonts, same ligatures and kerns | **DVI equality**: `latex` → `dvitype` trace vs our layout tree, tolerance 0 sp for positions we compute in integer sp; `\showbox` box-tree equality for every page |

Rasters are not an oracle (anti-aliasing differs by rasterizer); they stay as a
human-readable smoke test.

---

## 3. Measurement: the conformance harness (phase 0, before anything else)

Local toolchain present: `pdflatex`/`latex` (/Library/TeX/texbin), `dvitype`,
`pdftotext`, `pdftoppm`, Docker, Playwright.

```
fixtures/{micro,macro}/**/*.tex
   ├─ latex ─▶ .dvi ─▶ dvitype ─▶ ref.trace.json   (glyph/rule/font positions in sp)   ← T3 oracle
   ├─ latex with \tracingoutput\showboxdepth=\maxdimen ─▶ ref.boxes.json              ← box-tree oracle
   ├─ latex with \tracingparagraphs\tracingpages ─▶ ref.breaks.json                   ← decision oracle
   ├─ pdflatex ─▶ ref.pdf ─▶ pdftotext (T0) / pdftoppm (smoke)
   └─ render() ─▶ layout tree ─▶ ours.trace.json / ours.boxes.json / ours.breaks.json / text / html
compare ─▶ scorecard.json ─▶ public scorecard page + README badge
```

Deliverables:

- `scripts/conformance/` — runs the pipeline, writes `scorecard.md` and
  `scorecard.json` (per fixture: tier reached, first divergence with source
  position, unknown commands).
- **Oracles**: DVI trace parser (`dvitype` text), `\showbox` log parser,
  `\tracingparagraphs`/`\tracingpages` parser. All dev-only.
- **Micro fixtures**: one construct each, hundreds, named by rule
  (`fixtures/micro/math/rule18a-sup-shift.tex`). **Macro fixtures**: our 18
  templates, the playground demo, LaTeX.js fixtures, KaTeX screenshotter
  inputs, LaTeXML's 332-case suite, 50+ arXiv sources across fields, latexref
  examples. The LaTeX2e kernel's own `.lvt` regression tests where applicable.
- **Differential fuzzer**: composes random valid combinations of supported
  constructs, compiles with `latex`, compares traces. This is how edge cases
  are *found* rather than guessed.
- `scripts/census.ts` — every `\command`/`\begin{env}` in a corpus vs the
  engine's exported `knownCommands()`/`knownEnvironments()`, by frequency.
- **Runtime telemetry** — unknown command/env names → PostHog
  (`latex_unknown_command`). Real users set the priority order.
- **Diagnostics channel** — `render()` returns warnings with source positions;
  surfaced in Monaco gutters like TeX's log.
- **Determinism guard** — Node and headless Chromium produce byte-identical
  output for the whole corpus.
- **CI** — TeX Live, final and frozen, of the year in `tools/TEXLIVE` (2025;
  `packages/engine/tools/install-tex.sh`, the same TeX locally and in CI);
  scorecard must not regress; scorecard page deployed with the app.
- **New LaTeX releases** — LaTeX changes twice a year; the engine follows a
  frozen TeX Live, one year at a time:
  1. put the new year in `tools/TEXLIVE` and run `install-tex.sh`;
  2. `bun engine codegen` regenerates the font, class, hyphenation and math
     data from it (`codegen --check` holds again);
  3. `bun engine ci`: the oracle cache is keyed by the TeX version and package
     database, so every reference is recomputed, and each fixture or fuzz check
     that moves points at a kernel change;
  4. port each change in the module that cites that macro (`latex/kernel.ts`,
     `latex/sectioning.ts`, …), one PR per change with its fixture.

---

## 4. Coverage map

Legend: ✅ have · 🟡 partial · ❌ missing. Priority from (a) census of our own
templates, (b) Scienceography arXiv package frequencies (amsmath 52%, amssymb
51%, graphicx 50%, then amsfonts, epsfig, latexsym, url, color, amsthm,
subfigure, times, inputenc, cite, algorithm/algorithmic, hyperref), (c) what
LaTeXML needed to reach 75% error-free on arXiv, (d) telemetry once live.

### 4.1 Census gaps in our own templates (fix first)

```
\centering \noindent \par \hfill \setlength \parindent \parskip \baselineskip
\linewidth \textwidth \LARGE \hrule \pagestyle \newcounter \stepcounter \the<ctr>
\frontmatter \mainmatter \backmatter \columnbreak  env: multicols
beamer: \usetheme \usecolortheme \institute \titlepage  env: frame
letter: \signature \address \opening \closing  env: letter
tikz:   \node \draw (tikzpicture is a placeholder today)
```

### 4.2 Expansion layer

| Feature | Status | Notes |
|---|---|---|
| `\newcommand` / `\renewcommand` / `\providecommand` with `[n][default]` | ✅ | source-level today; move to token level with `pos` preserved |
| `\def` with delimited parameters | ❌ | TeXbook ch. 20 |
| `\newenvironment` / `\renewenvironment` | ❌ | |
| Counters: `\newcounter[within]`, `\setcounter`, `\stepcounter`, `\addtocounter`, `\refstepcounter`, `\the<ctr>`, `\arabic \alph \Alph \roman \Roman \fnsymbol`, `\value`, reset lists, `\numberwithin` | ❌ | `source2e` ltcounts |
| Conditionals: `\newif`, `\if<x>…\else…\fi`, `\ifx`, `\ifnum`, `\ifdim`, `\ifthenelse`, `\@ifundefined`, `\@ifnextchar`, `\@ifstar`, `\IfFileExists`, `\@ifpackageloaded` | ❌ | fuel-bounded evaluator |
| `\makeatletter … \makeatother` kernel internals | ❌ | whitelist: `\@addtoreset`, `\@startsection`, `\@seccntformat`, … |
| Lengths: `Dimen` in sp with TeX rounding, units pt/bp/mm/cm/in/em/ex/sp, rubber lengths, `\newlength \setlength \addtolength \settowidth \settoheight`, `\fill`, `\stretch` | ❌ | `tex.web` §§ 448–463 |
| `\let`, `\csname…\endcsname`, `\expandafter`, `\noexpand`, `\global`, `\relax`, `\protect`, `\DeclareRobustCommand` | ❌ | |
| `\input`, `\include`, `\includeonly`, `\graphicspath`, `\bibliography` resolved by the engine | 🟡 | regex bundler today |

### 4.3 Kernel text & structure

| Area | Status | Missing |
|---|---|---|
| Classes | 🟡 article | report/book (`\chapter`, `\part`, `\the…` formats, `\appendix`, front/main/backmatter), letter, beamer; options `10pt/11pt/12pt`, `twocolumn`, `a4paper/letterpaper`, `landscape`, `oneside/twoside`, `draft`, `fleqn`, `leqno`, `titlepage` |
| Front matter | 🟡 | `\maketitle` per class, `\thanks`, `\and`, `titlepage` env, `\listoffigures` `\listoftables`, `\addcontentsline`, `tocdepth`, `secnumdepth` |
| Paragraphs | 🟡 | `\par` `\noindent` `\indent`, first-paragraph-after-heading rule, `\\[len]` `\\*`, `\newline`, `\linebreak[n]` `\nolinebreak`, `\-`, `\hspace*` `\vspace*`, `\hfill \vfill \hrulefill \dotfill`, `\smallskip \medskip \bigskip`, `\centering \raggedright \raggedleft`, `\mbox \fbox \framebox \parbox \makebox \raisebox` exact dims |
| Fonts | 🟡 | `\tiny…\Huge` per class size table, `\bfseries \itshape \slshape \scshape \upshape \mdseries \rmfamily \sffamily \ttfamily \normalfont \em`, old-style `\bf \it \tt \sc \sl \rm \sf`, `\textsuperscript \textsubscript`, `\fontsize{}{}\selectfont`, NFSS font selection rules |
| Colors | ❌ | xcolor: named colors, `rgb/RGB/HTML/gray/cmyk`, `!` mixing, `\definecolor`, `\textcolor \color \colorbox \fcolorbox \pagecolor` |
| Characters | 🟡 | ligatures `--` `---` `` `` '' `` `fi fl ffi` from TFM, `\ldots \dots`, `~`, `\S \P \dag \ddag \copyright \pounds \textregistered \texttrademark \textbackslash \textasciitilde \textbar`, textcomp, babel (`spanish`, `english`, `german`, `french`, `portuguese`: captions, quotes, shorthands, hyphenation) |
| Lists | 🟡 | depth label formats, `\item[label]`, `\labelenumi` overrides, list dimensions (`\leftmargin`, `\labelsep`, `\itemsep`, `\parsep`, `\topsep`), enumitem binding |
| Footnotes | ❌ | `\footnote \footnotemark \footnotetext \thanks`, per-chapter counters, inserts at page bottom (§4.7), `footmisc` |
| Cross-refs | 🟡 | `\eqref`, `\pageref`, `\autoref`, `\nameref`, cleveref `\cref \Cref \crefrange`, hyperref `\url \href \nolinkurl \hypersetup` colors/links in PDF |
| Verbatim/code | 🟡 | `\verb \verb*`, `verbatim*`, `alltt`, listings (`\lstset` options, `\lstinline`, language highlighting), minted basic |
| Theorems | ❌ | amsthm `\newtheorem` variants, shared counters, `\theoremstyle`, `proof` + `\qedhere`, `\newtheorem*`, ntheorem basics |
| Algorithms | ❌ | `algorithm` float, `algorithmic`, `algpseudocode`, `algorithm2e` |
| Misc packages | ❌ | multicol, setspace, parskip, fancyhdr, titlesec, lipsum, xspace, csquotes, soul/ulem, todonotes, `\usepackage` no-op bindings (inputenc fontenc lmodern microtype textcomp latexsym) |

### 4.4 Math (TeXbook Appendix G, implemented rule by rule)

Fonts: vendored `public/fonts/KaTeX_*.woff2` (Computer Modern-derived) for
display; metrics from the real TFM files (`cmr10 cmmi10 cmsy10 cmex10 cmbx10
cmti10 cmtt10 cmss10`, 5/6/7/8/9/12/17pt variants, `msam10 msbm10`, `eufm10`,
`rsfs10`) parsed offline into `metrics.json` with font params σ1–σ22, ξ8–ξ13.

| Feature | Status | Rule |
|---|---|---|
| Box model: hbox/vbox/glue/kern/penalty with sp dims from TFM | ❌ | §§ 133–160 |
| Atom classes Ord/Op/Bin/Rel/Open/Close/Punct/Inner, 8×8 spacing table, binary→ordinary conversion | ❌ | rules 5–7, 20 |
| Styles D/T/S/SS + cramped, automatic changes in fractions/scripts/radicals | 🟡 | rule 17 and friends |
| Scripts: shifts σ13–σ19, sup+sub alignment, italic correction, primes | 🟡 | rules 18a–f |
| Fractions: `\frac \dfrac \tfrac \genfrac \over \atop \choose \binom \cfrac`, rule thickness ξ8, shifts σ8–σ12 | 🟡 | rule 15 |
| Radicals: `\sqrt[n]`, extensible radicals from cmex | 🟡 | rule 11 |
| Delimiters: `\left \right \middle` sizing, `\big…\Bigg`, extensible glyphs, `\left.` | 🟡 | rule 19, §§ 706–718 |
| Large operators & limits: `\sum \prod \int …`, `\limits \nolimits`, default limits by style, `\operatorname[*]`, `\DeclareMathOperator`, log-like | 🟡 | rule 13 |
| Accents: skew from TFM, `\widehat \widetilde`, stretchy `\overrightarrow \overleftarrow \overbrace \underbrace` with labels, `\xrightarrow[b]{a}` | 🟡 | rule 12 |
| Math alphabets: `\mathcal \mathbb \mathfrak \mathscr \mathsf \mathtt \mathit \mathbf \boldsymbol`, `bm`; `\text`/`\textrm` in math | 🟡 | |
| Environments exact: `equation align alignat flalign gather multline split aligned gathered cases dcases subequations`, `\intertext`, `\tag \tag* \notag`, number placement (`leqno`, `fleqn`), `eqnarray` | 🟡 | amsmath `amsmath.pdf`, `amsldoc` |
| Spacing & phantoms: `\, \: \; \! \quad \qquad \mspace`, `\phantom \hphantom \vphantom \smash \mathstrut`, `\not`, `cancel` | 🟡 | |
| siunitx in text: `\num \si \unit \SI \qty`, ranges, lists, `\ang` at the default options (#267); options, `\sisetup`, the `S` column and math mode not yet | 🟡 | `siunitx.pdf` |
| Packages: mathtools, physics, amscd, mhchem | ❌ | |
| Symbols: amssymb, latexsym, stmaryrd/wasysym subsets → ~1000 | 🟡 | |
| Hidden MathML for accessibility | ❌ | later |

### 4.5 Tables

Column spec grammar (`l c r p{} m{} b{} | || @{} >{} <{} *{n}{}` + tabularx
`X`, `\newcolumntype`), `\hline \cline`, `\multicolumn`, `\multirow`,
`\arraystretch \tabcolsep \extrarowheight`, booktabs, longtable (with
`\endhead` `\endfoot`), `array` in math, exact `tabularx` width algorithm,
`table*`, caption placement.

### 4.6 Floats & graphics

Placement `[htbp!H]` via the real float algorithm (§4.7), `\includegraphics`
full option set (`angle trim clip keepaspectratio`), `\graphicspath`,
extensionless lookup, PDF/EPS rasterized at upload (server side), `\caption`
variants + caption package, subcaption/subfigure/subfig, wrapfig, a TikZ subset
exact to TeX (pgf's \special/\pdfliteral strings: paths, nodes, styles, `\foreach`, arrow tips,
positioning), pgfplots basic axis, xy/amscd.

🟡 caption.sty and subcaption (#269, #279, #282): `\caption` with position=auto, the
single-line check and struts; `subfigure`/`subtable` with (a) subcaptions, `\subref`; hyperref
(hypcap's anchor); package options and `\captionsetup` (global, `[figure]`/`[table]`/`[sub]`/`[subfigure]`,
in floats and minipages) for font/labelfont/textfont, labelsep, format, justification,
singlelinecheck, skip/belowskip, position, margin/width, indention, labelformat, name,
figurename/tablename, hypcap, list; `\caption*`, `\caption[short]{long}`, `\captionof` in minipages.
Not yet: other keys (ragged2e's justifications, textformat, size, box, style, …), `\captionof` in
text outside a minipage or under setspace, capt-of (not installed), `\subcaptionbox`, subcaption
lof entries, captions with commands or math.

🟡 hyperref's `\autoref`, `\autoref*` and nameref's `\nameref`, `\nameref*`, `\Nameref` (#280), with hyperref
or nameref alone: the anchor's type names the reference (`\<type>autorefname`, `\lstlistingname`, a starred type's
base), the `\newlabel`'s name field (headings, captions with and without caption.sty, listings, amsthm notes), links
under dvips and pdfTeX; amsthm theorems with hyperref (`\MakeLinkTarget*`'s raised anchor). Not yet: babel's names,
`\appendix`, footnote and `\tag` anchors, names with macros (`\contentsname`, `\thethm`), unnumbered theorems
with hyperref.

🟡 TikZ's keys and options (#302, `tikz/`): pgfkeys (paths, `.cd`, `.style`, `.append style`, `.prefix style`,
`.code` made of `\pgfkeysalso`/`\pgfkeys`/`\tikzset`, `.initial`, `.default`, `.is choice`, `.is family`, `.try`,
`.unknown`, TeX's groups), `\tikzset`, `\tikzstyle`, and TikZ's options as the state TikZ keeps in TeX: `\tikz@options`,
`\tikz@mode`, `\tikz@transform`, `\pgflinewidth`, colors (names and xcolor expressions as options, draw/fill/color/text),
line widths, dash patterns, corners, anchors, placement (above=…, right of=…, positioning's right=of …, on grid),
node distance, auto/swap, inner/outer sep, minimum sizes, text width, align, font, shapes, arrow specifications
(the core's and arrows.meta's tips, `>=`), scale/shift/rotate; checked by `bun engine tikzkeys:check` against
TeX's macros. Not yet: pictures, paths and nodes themselves (T2–T4), other keys, arrow options, `.store in`/`.is if`
and other handlers, transformations applied at once (pgf's matrix, P4).

🟡 TikZ's pictures and paths (#309, `tikz/path.ts`): tikzpicture and `\tikz` (braces or one path), the scope
environment, `\path`, `\draw`, `\fill`, `\filldraw`, `\clip`, `\useasboundingbox`, `\coordinate`, `\tikzset`, options
anywhere (every picture/scope/path, clip, use as bounding box, baseline, radius, xslant/yslant), coordinates (x,y)
with and without units, (a:r) and its direction names, +(…), ++(…), (a |- b), (a -| b) and named coordinates, the
operations --, -|, |-, rectangle, circle, ellipse, cycle and to, path groups `{…}`, arrow tips (pgf/arrows.ts, one
cache a document), rounded corners (pgf/round.ts), pgf driven as tikz.code.tex does with every space its macros leave on the picture's list; checked
by `bun engine tikz:check` (whole pictures under latex/dvips and pdflatex, box for box). In documents
(`latex/tikz.ts`): `\usepackage{tikz}` (xcolor, graphicx, pgf's \newwrite before hyperref's), `\usetikzlibrary`
positioning, arrows.meta and calc, preamble style definitions, pictures in paragraphs, center and figures.
Not yet: nodes (but coordinates), `|` and other tip kinds pgf/arrows.ts lacks, arcs, curves,
grids, plots, `\foreach`, calc's coordinates, coordinate options, x/y vectors, custom to paths, pgf's dvips
header specials on the first page (`! /pgfHrgb…`, outside the column).

### 4.7 Pages: the exact layout engine

| Component | Source |
|---|---|
| Glyph runs from TFM lig/kern programs (ligatures, kerns, italic correction) | `tex.web` §§ 1030–1040 |
| Paragraph builder: Knuth–Plass with `\pretolerance` pass, `\tolerance` pass, `\emergencystretch` pass, demerits (`\adjdemerits \doublehyphendemerits \finalhyphendemerits`), `\looseness`, `\parshape`, `\hangindent` | §§ 813–890 |
| Hyphenation: Liang's algorithm with `hyph-en-us` patterns + exceptions (data), `\hyphenation`, `\-`, `\lefthyphenmin \righthyphenmin` | §§ 891–965 |
| Page builder: `\pagegoal \pagetotal`, penalties, `\widowpenalty \clubpenalty`, `\vsize`, inserts | §§ 967–1028 |
| LaTeX output routine: floats (`\topfraction \bottomfraction \textfraction \floatpagefraction`, `\topnumber`…), footnotes as inserts, marks for headers | `latex.ltx` ltoutput |
| Page box: paper sizes, class margins, `geometry` binding, `twoside` offsets, `\pagestyle`, fancyhdr, `\pagenumbering` | class files |
| Two-column mode, `multicols` balancing, `figure*` | ltoutput, multicol |
| `\newpage \clearpage \cleardoublepage \pagebreak[n] \nopagebreak \enlargethispage`, `\pageref`, TOC page numbers | |
| **Preview projection**: absolutely positioned line boxes and glyph runs; browser decides nothing but glyph rasterization | ours |
| **PDF emitter**: zero-dep writer from the layout tree (subsetted fonts, rules, images, links, outlines) replaces `window.print` | PDF 1.7 spec |
| Incremental re-layout cache by block hash | ours |

### 4.8 Bibliography

`.bib` parser; BibTeX styles `plain abbrv alpha unsrt ieeetr apalike acm`
(emulated exactly, incl. sorting and name formatting); natbib and cite
bindings; biblatex `numeric authoryear apa` basics.

### 4.9 Classes beyond the standard four

beamer (frames as pages, overlays, blocks, themes), IEEEtran, acmart, llncs,
elsarticle, revtex4, neurips/icml/iclr, exam, moderncv. Each is a binding + a
conformance fixture set.

🟡 beamer (#283), its own pipeline (`latex/beamer/`) with class data from TeX for every size option
(8pt–20pt) and theme data from TeX (data/beamer: the default theme, the whale, orchid, seahorse,
beaver and dolphin color themes, the infolines outer theme with the default headline), the
navigation symbols switched off, frames as pages (the frame environment and `\frame`, `[c]` and
`[t]`) with beamer's head (background canvas, sidebars) and foot (infolines' three boxes with the
frame number), frame titles, rectangular beamercolorboxes, the default title page, first-level
itemize and enumerate, the frames' paragraphs ragged right in the sans serif fonts, `\textbf` and
friends and beamer's `\emph`; `\section` and `\subsection` between frames (toc, nav and bookmark
writes) and `\tableofcontents` (also `[currentsection]`); overlays (one page per slide, `\pause`, `\item<…>` and `[<+->]`,
`\only`, `\alt`, `\temporal`, `\uncover`, `\visible`, `\invisible`, `\onslide`, covered material
between pgf's invisible specials); the .nav writes and page anchors, with dvips (#289, #299, #300).
The rounded inner theme without shadows, drawn by pgf/ on the run's one pgf state (#315): ball
itemize and enumerate items, ball numbers in the table of contents, rounded beamercolorboxes
(`rounded=true`), rounded blocks and the rounded title page; `\usetheme[shadow=false]{Madrid}`.
Not yet: the shadows (`shadow=true`, Madrid's default: pgf's fadings), the circles inner theme's
templates, the shaded table of contents with balls.

---

## 5. Engine changes required

1. **Token-level expander with fuel** (`tokenize → expand → parse`), `pos` kept.
2. **Signature registry** `{ name, signature: "o m m", mode, impl }` per
   package; `\usepackage` activates bindings; last loaded wins. Generated
   initial tables from unified-latex-ctan (offline script → JSON in repo).
3. **Dimen & counter state** in integer sp with TeX's rounding.
4. **TFM metrics + lig/kern programs** as generated JSON; `metrics.json` for
   math font parameters.
5. **Layout tree** (`render.ts` → layout tree → `emit-html.ts` / `emit-pdf.ts`).
   Boxes carry sp positions; the paragraph and page builders consume and
   produce the same tree.
6. **Math as `mathlayout/`**: `atoms.ts`, `spacing.ts`, `styles.ts`, `boxes.ts`,
   `rules/rule11.ts … rule20.ts`, each citing Appendix G.
7. **Diagnostics channel** and **determinism guard** (§3).

---

## 6. Phases with exit criteria

| Phase | Scope | Exit criterion |
|---|---|---|
| **0. Instrument & oracle** | Harness, DVI/box/trace oracles, fixtures convention, census, telemetry, diagnostics, CI, scorecard page, TFM metrics JSON, vendored fonts wired, §4.1 census gaps | Scorecard public; all 18 templates T0; first 50 micro fixtures with DVI traces |
| **1. Kernel** | §4.2 + §4.3 for article/report/book/letter, registry, bindings batch 1 | latexref user-level chapters green at T0; LaTeX.js fixtures T0 |
| **2. Math** | §4.4 rule by rule with micro fixtures per rule | KaTeX screenshotter inputs + amsmath guide examples **T3** (DVI-equal) in display and inline math boxes |
| **3. Tables, floats, bib, graphics** | §4.5, §4.6, §4.8 | 50 arXiv docs T0, 30 T1 |
| **4. Pages & PDF** | §4.7 paragraph/page builders, hyphenation, output routine, geometry, PDF emitter, preview projection | Standard-class macro fixtures **T3**: DVI-equal page by page; PDF export byte-stable |
| **5. Classes & long tail** | §4.9, fuzzer in CI, telemetry-driven bindings | Top-50 telemetry unknowns at zero for 30 days; fuzzer finds no divergence in 10k runs |

Each phase is a stack of small PRs; every PR adds fixtures and cannot lower
the scorecard. Order within a phase is `census × telemetry` frequency.

---

## 7. Prior art (ideas and data, never runtime deps)

- **LaTeX.js**: same thesis, PEG parser with no AST, bindings in JS, pages
  ignored, math via KaTeX. We start past its ceiling. Its CSS is vendored in
  `public/css`.
- **LaTeXML / ar5iv**: 75% of arXiv error-free (2026) via TeX emulation + bindings;
  its binding list ranks what matters; its 332-case suite is corpus material.
- **KaTeX / Temml**: Appendix G in JS with font metrics; `supported.md` is the
  §4.4 checklist; Temml's expander is a reference for macro handling.
- **Typst**: proof that a non-TeX engine reaches TeX quality with Knuth–Plass
  lines, OpenType-MATH-style math and its own page builder; architecture
  reference for §4.7.
- **Vercel's Satori**: a pure-JS layout engine that owns every position and
  emits deterministic output without the browser; the model for our
  "layout tree → projections" design and for shipping small, test-heavy modules.
- **tex-linebreak / typeset.js**: readable Knuth–Plass implementations.
- **Scienceography (arXiv 1202.2638)**: package frequencies on arXiv.

---

## 8. Scope boundaries

- Interpreting arbitrary `.sty`/`.cls` source. Unknown packages are a warning
  plus a public issue; they get a binding when telemetry says so.
- Full TikZ/pgf. The subset real papers use first, exact to TeX (pgf's literals, no SVG
  approximation); exotic libraries later, tracked as issues like everything else.
- Proprietary fonts: `times`/`mathptmx`/`newtx`/`helvet`/`courier` map to the
  free TeX Gyre families, vendored as assets, with their own TFM metrics.
- PDF/EPS figures are rasterized once at upload, server side.

---

## 9. The machine: package layout and developer tooling

The engine is the workspace package `@latex0/engine` in `packages/engine/`,
extracted to npm later. It imports nothing from the app (`bun engine ci` checks
this); the app imports only its public exports.

```
packages/engine/                (@latex0/engine)
  package.json                  name, exports, "sideEffects": false, zero deps
  src/
    lexer.ts  expand/  parser.ts  registry/  bindings/<pkg>.ts  classes/<cls>.ts
    layout/   (dimen.ts, boxes.ts, paragraph.ts, page.ts, output-routine.ts)
    mathlayout/ (atoms.ts, spacing.ts, styles.ts, rules/rule11.ts … rule20.ts)
    emit/     (html.ts, pdf.ts, trace.ts)
    data/     (metrics.json, symbols.json, signatures.json, hyph-en-us.json) ← generated
  fixtures/{micro,macro}/**/*.tex (+ .trace.json .boxes.json .breaks.json refs)
  tools/
    conformance/  oracles (dvitype, showbox, tracing parsers), compare, scorecard
    codegen/      tfm→metrics, unified-latex-ctan→signatures, hyph patterns, symbols
    scaffold/     new-rule, new-binding, new-fixture (module + fixture + test + issue link)
    fuzz/         construct composer + differential runner
    cli.ts        latex0 render|trace|diff|census|scorecard
```

Developer workflow for one unit of work (one rule or one binding):

```
bun engine new binding booktabs        # scaffolds src/bindings/booktabs.ts, fixtures, test, links issue
bun engine unit fixtures/micro/tables/booktabs-*.tex   # latex → oracle refs, render → compare, report
bun engine scorecard                   # full corpus; must not regress; CI runs the same command
bun engine gaps                        # what stops documents (fixtures + corpus/), ranked: pick the next feature
```

Rules:

- Generated data is committed and reproducible (`bun engine codegen` is a CI
  check that the output is unchanged).
- One PR = one unit + fixtures + scorecard delta in the PR description
  (auto-posted by CI).
- Versioning with changesets; every merged PR adds a changeset; releases are
  tagged and published from CI with provenance.
- The app consumes the engine only through its public `render()` /
  `layout()` / `emitPdf()` API, never through internal modules, so the
  extraction is a path change.
