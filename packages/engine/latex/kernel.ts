// Paragraph settings from the LaTeX kernel (latex.ltx) that several parts use,
// each named for the macro it is.

import { filGlue, glue, paramGlue, type GlueNode } from "../layout/nodes"

/** \@flushglue (0pt plus 1fil) in a skip parameter */
export const flushglue = (param: "leftskip" | "rightskip" | "parfillskip"): GlueNode => paramGlue(param, filGlue())
/** \z@skip in a skip parameter */
export const zeroskip = (param: "leftskip" | "rightskip" | "parfillskip"): GlueNode => paramGlue(param, glue(0))

/** \centering: \leftskip and \rightskip \@flushglue, \parfillskip\z@skip, \finalhyphendemerits\z@ */
export const centering = () => ({ leftSkip: flushglue("leftskip"), rightSkip: flushglue("rightskip"), parFillSkip: zeroskip("parfillskip"), finalHyphenDemerits: 0 })
/** \raggedright: \rightskip \@flushglue, \finalhyphendemerits\z@ */
export const raggedright = () => ({ rightSkip: flushglue("rightskip"), finalHyphenDemerits: 0 })
/** \raggedleft: \leftskip \@flushglue, \rightskip and \parfillskip \z@skip, \finalhyphendemerits\z@ */
export const raggedleft = () => ({ leftSkip: flushglue("leftskip"), rightSkip: zeroskip("rightskip"), parFillSkip: zeroskip("parfillskip"), finalHyphenDemerits: 0 })

/** \sloppy: \tolerance 9999, \emergencystretch 3em (`em`: the font's quad where it is set) */
export const sloppy = (em: number) => ({ tolerance: 9999, emergencyStretch: 3 * em })
