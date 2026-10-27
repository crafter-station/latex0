# Starter corpus

Documents of the kinds people write in the editor: papers (one and two
columns, natbib, biblatex, amsart), thesis and book chapters (report, book,
memoir), CVs, cover and formal letters, homework and exams, lab reports, math
and analysis notes, CS reports (listings, algorithms, TikZ), business reports,
tables (tabularx, longtable, multirow, colortbl), meeting notes, a newsletter,
recipes and beamer talks (default, Madrid, Warsaw, Boadilla). About a quarter
are in Spanish with `babel`. They are hand-written stand-ins until real usage
tells us what documents look like. They are not fixtures: there is no TeX
reference, only the question of whether the engine lays them out. Every one
compiles without errors under the pinned TeX Live 2025 (pdflatex), and uses
only packages installed there.

    bun engine gaps                     # fixtures + this corpus
    bun engine gaps path/to/documents   # any folder of .tex files

`gaps` ranks the constructs that stop documents, so the next feature is the one
that unblocks the most documents. It reports only each document's first
blocker.
