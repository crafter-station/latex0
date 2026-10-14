# Engine fixtures

Every claim the engine makes is a fixture compared against real TeX.

## Layout

```
fixtures/micro/<area>/<construct>.tex   one construct per file
fixtures/macro/<name>.tex               whole documents (templates, papers)
```

## Header

Each fixture starts with `% key: value` comment lines:

| Key | Meaning |
|---|---|
| `fixture` | Stable id, `<area>/<construct>` |
| `tier` | Target tier: `T0` structural, `T1` typographic, `T2` layout, `T3` DVI-exact |
| `engine` | Adapter that renders it with the engine (`tools/unit/adapters`) |
| `covers` | What the fixture exercises |
| `issue` | Issue that owns it (optional) |
| `xfail` | Reason it is expected to fail; an unexpected pass fails the run so the marker gets removed |
| `source` | Where a fixture was taken from (macro fixtures), with its license if it is not ours |

A fixture whose `engine` has no adapter yet (whole documents use `document`)
is still compiled by TeX on every run, so it is known to be valid, and it shows
on the scorecard as not yet matching. That is the point of the macro corpus: it
measures how far the engine is from real documents.

The oracle compiles with a fixed date (`SOURCE_DATE_EPOCH`), so `\today` never
changes a reference.

## Running

```
bun engine unit                         all fixtures
bun engine unit lib/latex/fixtures/micro/text/space-factor.tex
bun engine unit <paths> --watch         rerun on every save under lib/latex
bun engine unit --json                  machine-readable results
bun engine fuzz:paragraphs --n 1000     random paragraphs, line-break decisions vs TeX
bun engine dimen:check --n 20000        numbers, dimensions and glue vs TeX's scanners
bun engine glyph:check --n 10000        words in every font and synthetic lig/kern fonts vs \showbox
bun engine expand:check --n 3000        random macro programs: \edef results and \meaning vs TeX
bun engine scorecard [--check]          write (or verify) scorecard.json and badge.json
```

TeX references are cached in `.cache/oracle/refs`, keyed by fixture content and
TeX version, so reruns skip TeX. A failure prints the first divergent glyph, the
difference in scaled points, and the TeX line with the glyph bracketed.

## Rules

- One construct per micro fixture. If TeX does something the fixture did not
  mean to test (a hyphenated line end, a float moving), split it out.
- Keep the preamble minimal: `\documentclass{article}` and `\pagestyle{empty}`
  unless the construct needs more.
- Never edit a fixture to make the engine pass. Fix the engine, or mark
  `xfail` with the issue that will fix it.
