# Starter corpus

Documents of the kinds people write in the editor: a paper, a thesis chapter,
a CV, homework, a lab report, math notes, slides, a TikZ figure, a cover
letter, an algorithm, a biblatex paper and a recipe. They are hand-written
stand-ins until real usage tells us what documents look like. They are not
fixtures: there is no TeX reference, only the question of whether the engine
lays them out.

    bun engine gaps                     # fixtures + this corpus
    bun engine gaps path/to/documents   # any folder of .tex files

`gaps` ranks the constructs that stop documents, so the next feature is the one
that unblocks the most documents.
