// pgf oracle (#292, #298, #304, #305): snippets of pgf's \pgfsys@ commands and whole pgfpictures, typeset by TeX as
// `\setbox0\hbox{\nullfont <snippet>}\showbox0` with tikz loaded (a picture's \nullfont: every stray space in
// pgf's macros is a \glue 0.0) by latex (pgf's dvips driver) and by pdflatex (its pdftex driver), and run
// through pgf/ for each. The box dumps must agree node by node: every box's size and shift, every \special's
// and \pdfliteral's text, every space. A tiny reader of the snippet's commands drives the TS side. Fixed
// snippets cover each primitive, then seeded random sequences of system commands and random pictures (paths
// under transformations, scopes, groups, graphic state, rounded corners, baselines and trims) and random pictures of nodes
// (shapes, anchors, text, keys, named nodes' anchors and border points, \pgftext); a node's text is typeset
// by the engine (latex/paragraph.ts). A TeX error (a dimension too large) must be the engine's Unsupported.
//   bun engine pgf:check [--n 2000] [--seed 1]

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { emitBoxes } from "../../emit/boxes"
import { UNITY } from "../../layout/arith"
import { loadFont, QUAD, X_HEIGHT } from "../../layout/font"
import type { PgfUnits } from "../../pgf/mathparser"
import { dataFont } from "../fonts"
import { Unsupported } from "../../latex/unsupported"
import { Colors, xcolor } from "../../latex/xcolor"
import { hpack } from "../../layout/pack"
import type { BoxNode as LayoutBox, RuleNode } from "../../layout/nodes"
import { TexArith } from "../../pgf/fixed"
import { DvipsDriver } from "../../pgf/drivers/dvips"
import { PdftexDriver } from "../../pgf/drivers/pdftex"
import type { ColorModel, PgfDriver } from "../../pgf/drivers"
import { isColorName, pgfSetColor, pgfSetDash, pgfSetFillColor, pgfSetLineWidth, pgfSetMiterLimit, pgfSetStrokeColor } from "../../pgf/graphicstate"
import { texArgs } from "../../pgf/mathfunctions"
import { pgfPathCircle, pgfPathClose, pgfPathCurveTo, pgfPathEllipse, pgfPathLineTo, pgfPathMoveTo, pgfPathRectangle, pgfPathRectangleCorners, pgfUsePath } from "../../pgf/paths"
import {
  pgfPoint, pgfPointAdd, pgfPointBorderEllipse, pgfPointBorderRectangle, pgfPointDiff, pgfPointNormalised, pgfPointOrigin, pgfPointPolar, pgfPointScale, pgfPointXY,
  setLength, type PgfPoint,
} from "../../pgf/points"
import { beginPgfPicture, beginPgfScope, endPgfPicture, endPgfScope, pgfSetBaseline, pgfSetTrimLeft, pgfSetTrimRight } from "../../pgf/scopes"
import { pgfSetCornersArced } from "../../pgf/round"
import { pgfDeclareShading, pgfShadePath, pgfUseShading } from "../../pgf/shade"
import { PgfState } from "../../pgf/state"
import { pgfCoordinate, pgfMultipartNode, pgfNode, pgfPointAnchor, pgfPointShapeBorder, pgfText, SHAPE_KEYS, type PgfShapeKeys, type PgfText, type PgfTextOption } from "../../pgf/shapes"
import { hlistInput } from "../../latex/paragraph"
import { pgfArrowsMeta, pgfSetArrows, pgfSetArrowsEnd, pgfSetArrowsStart, pgfSetShortenEnd, pgfSetShortenStart } from "../../pgf/arrows"
import { classData } from "../../latex/classes"
import {
  pgfLowLevelSyncCm, pgfPointTransformed, pgfTransformCm, pgfTransformReset, pgfTransformResetNonTranslations, pgfTransformRotate, pgfTransformScale,
  pgfTransformShift, pgfTransformXScale, pgfTransformXShift, pgfTransformXSlant, pgfTransformYScale, pgfTransformYShift, pgfTransformYSlant,
} from "../../pgf/transformations"
import { compareBoxLists, type BoxNode } from "../../trace/schema"
import { texEnv } from "../tex"
import { parseBoxDump } from "./boxes"

const DIR = ".cache/pgfcheck"
/** the colours both sides define first */
const COLORS: [string, string, string][] = [["mine", "HTML", "3A7FC0"], ["dark", "rgb", "0.1,0.2,0.3"], ["ink", "cmyk", "0.5,0,.25,1"], ["mid", "gray", "0.4"]]

interface Target { name: string; program: string; driver: (s: PgfState) => PgfDriver }
const TARGETS: Target[] = [
  { name: "dvips", program: "latex", driver: (s) => new DvipsDriver(s) },
  { name: "pdftex", program: "pdflatex", driver: (s) => new PdftexDriver(s) },
]

/** Each primitive, the colour paths, line widths, nested scopes and groups, boxes, spaces. */
const FIXED = [
  "",
  "\\pgfsys@moveto{1pt}{2.5pt}\\pgfsys@lineto{10cm}{-3pt}\\pgfsys@stroke",
  "\\pgfsys@moveto{0pt}{0pt}\\pgfsys@curveto{1pt}{2pt}{3pt}{4pt}{5pt}{6pt}\\pgfsys@closepath\\pgfsys@fill",
  "\\pgfsys@rect{1pt}{2pt}{3pt}{4pt}\\pgfsys@fillstroke",
  "\\pgfsys@rect{-1in}{.5cm}{72.27pt}{1sp}\\pgfsys@discardpath",
  "\\pgfsys@moveto{16383.99998pt}{-16383.99998pt}\\pgfsys@lineto{1em}{2ex}\\pgfsys@stroke",
  "\\pgfsys@clipnext\\pgfsys@discardpath\\pgfsys@clipnext\\pgfsys@stroke\\pgfsys@clipnext\\pgfsys@fill\\pgfsys@clipnext\\pgfsys@fillstroke",
  "\\pgfsys@eoruletrue\\pgfsys@fill\\pgfsys@clipnext\\pgfsys@discardpath\\pgfsys@clipnext\\pgfsys@stroke\\pgfsys@clipnext\\pgfsys@fill\\pgfsys@clipnext\\pgfsys@fillstroke\\pgfsys@fillstroke",
  "\\pgfsys@eoruletrue\\pgfsys@color@gray@fill{0.5}\\pgfsys@fill\\pgfsys@eorulefalse\\pgfsys@fill",
  "\\pgfsys@setlinewidth{0.4pt}\\pgfsys@setlinewidth{0.8pt}\\pgfsys@setlinewidth{1.2pt}\\pgfsys@setlinewidth{0pt}\\pgfsys@setlinewidth{3mm}",
  "\\pgfsys@setdash{}{0pt}\\pgfsys@setdash{3pt,3pt}{0pt}\\pgfsys@setdash{1pt, 2pt,3pt}{1.5pt}",
  "\\pgfsys@setmiterlimit{10}\\pgfsys@setmiterlimit{1.5}",
  "\\pgfsys@buttcap\\pgfsys@roundcap\\pgfsys@rectcap\\pgfsys@miterjoin\\pgfsys@roundjoin\\pgfsys@beveljoin",
  "\\pgfsys@color@rgb@stroke{1}{0}{0}\\pgfsys@stroke\\pgfsys@color@rgb@fill{0}{0.5}{1}\\pgfsys@fill\\pgfsys@fillstroke",
  "\\pgfsys@color@cmyk@stroke{1}{0}{0}{0}\\pgfsys@color@cmyk@fill{0}{1}{0}{0.5}\\pgfsys@color@cmy@stroke{1}{0}{0}\\pgfsys@color@cmy@fill{0}{1}{0}",
  "\\pgfsys@color@gray@stroke{0.2}\\pgfsys@color@rgb{1}{0}{0}\\pgfsys@color@gray{0.5}\\pgfsys@color@cmyk{0}{0}{0}{1}\\pgfsys@color@cmy{0}{0}{1}",
  "\\pgfsys@color@gray@fill{0.2}\\pgfsys@color@gray{0.5}\\pgfsys@color@reset@inorderfalse\\pgfsys@color@gray{0.5}\\pgfsys@color@reset",
  "\\pgfsetstrokecolor{red}\\pgfsetfillcolor{blue!30}\\pgfsys@fillstroke\\pgfsetcolor{red!30!green}\\pgfsys@stroke",
  "\\pgfsetstrokecolor{mine}\\pgfsetfillcolor{ink}\\pgfsetcolor{cyan}\\pgfsetcolor{mid}\\pgfsetstrokecolor{dark!50}\\pgfsetfillcolor{olive}\\pgfsetstrokecolor{-red}",
  "\\pgfsys@beginscope\\pgfsys@color@rgb@stroke{1}{0}{0}\\pgfsys@setlinewidth{0.8pt}\\pgfsys@rect{0pt}{0pt}{1pt}{2pt}\\pgfsys@stroke\\pgfsys@endscope\\pgfsys@stroke",
  "\\begingroup\\pgfsys@beginscope\\pgfsys@color@rgb@stroke{1}{0}{0}\\begingroup\\pgfsys@beginscope\\pgfsys@color@gray@fill{0}\\pgfsys@fillstroke\\pgfsys@endscope\\endgroup\\pgfsys@fillstroke\\pgfsys@endscope\\endgroup\\pgfsys@fillstroke",
  "{\\pgfsys@eoruletrue\\pgfsys@clipnext}\\pgfsys@fill{\\pgfsys@color@gray@stroke{0.2}}\\pgfsys@stroke",
  "\\pgfsys@transformcm{1}{0}{0}{1}{3pt}{4pt}\\pgfsys@transformcm{0.70711}{0.70711}{-0.70711}{0.70711}{-2cm}{0pt}",
  "\\pgfsys@transformshift{1pt}{-1pt}\\pgfsys@transformxyscale{2}{0.5}",
  "\\setbox1\\hbox{}\\pgfsys@hbox1\\pgfsys@hbox1",
  "\\setbox\\pgfcheckbox\\hbox{\\vrule width 2pt height 3pt}\\pgfsys@hbox\\pgfcheckbox\\pgfsys@hbox\\pgfcheckbox",
  "\\setbox1\\hbox{\\vrule height 1pt depth 2pt}\\pgfsys@hbox1\\pgfsys@begin@text\\pgfsys@stroke\\pgfsys@end@text\\pgfsys@fill",
  "\\pgfsys@begininvisible\\pgfsys@moveto{0pt}{0pt}\\pgfsys@stroke\\pgfsys@endinvisible",
  "\\pgfsys@stroke \\pgfsys@fill { }\\pgfsys@moveto{1pt}{1pt} \\pgfsys@stroke{}  {  }",
  "\\pgfsys@begin@text\\pgfsys@stroke\\pgfsys@beginpicture\\pgfsys@stroke\\pgfsys@endpicture\\pgfsys@stroke",
  "\\pgfsysprotocol@flushcurrentprotocol\\pgfsysprotocol@bufferedtrue\\pgfsys@moveto{1pt}{2pt}\\pgfsys@lineto{3pt}{4pt}\\pgfsys@stroke\\pgfsysprotocol@flushcurrentprotocol\\pgfsysprotocol@flushcurrentprotocol\\pgfsys@fill\\pgfsysprotocol@bufferedfalse\\pgfsys@fill",
  "{\\pgfsysprotocol@bufferedtrue\\pgfsys@setlinewidth{1pt}}\\pgfsys@setlinewidth{2pt}",
].map((body) => `\\pgfsys@beginpicture${body}\\pgfsys@endpicture`)

/** Whole pictures: the box, its size and baseline; scopes, transformations, every path construction and use. */
const PICTURES = [
  // the picture box: empty; a space after \begin{pgfpicture} skipped; baseline and trims; the old syntax's bounding box
  "",
  " \\pgfpathmoveto{\\pgfpoint{1pt}{2pt}} \\pgfpathmoveto{\\pgfpoint{10pt}{-5pt}}\\pgfusepath{discard} ",
  "\\pgfsetbaseline{3pt}\\pgfsettrimleft{2pt}\\pgfsettrimright{1cm}\\pgfpathmoveto{\\pgfpoint{-1pt}{-2pt}}\\pgfpathmoveto{\\pgfpoint{2cm}{1cm}}",
  "\\pgfsetbaseline{3pt}\\pgfsettrimleft{2pt}\\begin{pgfscope}\\pgfsetbaseline{1pt}\\pgfsettrimleft{default}\\end{pgfscope}\\pgfpathmoveto{\\pgfpoint{-1pt}{-2pt}}",
  "{-1pt}{-2em}{3pt}{4ex}\\pgfpathmoveto{\\pgfpoint{20pt}{20pt}}",
  "\\pgfpathmoveto{\\pgfpoint{1pt}{1pt}}\\pgfusepath{use as bounding box}\\pgfpathmoveto{\\pgfpoint{3cm}{1cm}}",
  // transformations
  "\\pgftransformshift{\\pgfpoint{1cm}{2cm}}\\pgftransformscale{2}\\pgftransformxscale{0.5}\\pgftransformyslant{0.3}\\pgfpathmoveto{\\pgfpointxy{1}{2}}\\pgfpathmoveto{\\pgfpointpolar{30}{1cm}}",
  "\\pgftransformcm{1}{0.5}{-0.5}{1}{\\pgfpoint{1pt}{1pt}}\\pgflowlevelsynccm\\pgfpathmoveto{\\pgfpointadd{\\pgfpoint{1pt}{2pt}}{\\pgfpointscale{2}{\\pgfpoint{3pt}{4pt}}}}",
  "\\pgftransformrotate{30}\\pgftransformxshift{1pt}\\pgftransformresetnontranslations\\pgflowlevelsynccm\\pgftransformrotate{-45.5}\\pgflowlevelsynccm",
  // a quick \pgfmathsetlength's \unskip (\pgftransformxshift's +0pt)
  "\\pgfsys@stroke{ }  \\pgftransformxshift{1pt}\\pgfsys@stroke \\pgfpathmoveto{\\pgfpoint{-336033sp}{+-.3bp}}",
  // the largest coordinates TeX reads, and one more: TeX's error
  "\\pgfpathmoveto{\\pgfpointadd{\\pgfqpoint{16383.99998pt}{0pt}}{\\pgfqpoint{1sp}{0pt}}}",
  "{0pt}{0pt}{1pt}{1pt}\\pgfpathmoveto{\\pgfpointadd{\\pgfqpoint{0pt}{16383.99998pt}}{\\pgfqpoint{0pt}{1sp}}}",
  "{0pt}{0pt}{1pt}{1pt}\\pgfpathmoveto{\\pgfpointadd{\\pgfqpoint{0pt}{-16383.99998pt}}{\\pgfqpoint{0pt}{0sp}}}",
  "\\pgfpathmoveto{\\pgfqpoint{-16383.99998pt}{0pt}}\\pgfpathmoveto{\\pgfqpoint{0pt}{0pt}}",
  "\\pgfpathmoveto{\\pgfqpoint{16383.99998pt}{0pt}}\\pgfpathmoveto{\\pgfqpoint{-1sp}{0pt}}",
  "\\pgfpathmoveto{\\pgfqpoint{0pt}{16383.99998pt}}\\pgfpathmoveto{\\pgfqpoint{0pt}{0sp}}",
  "\\pgfpathmoveto{\\pgfqpoint{0pt}{16383.99998pt}}\\pgfpathmoveto{\\pgfqpoint{0pt}{-1sp}}",
  // paths: each construction and use, line widths in scopes, clips and bounding boxes
  "\\pgfpathmoveto{\\pgfpoint{1pt}{2pt}} \\pgfpathlineto{\\pgfpoint{10pt}{-5pt}}\\pgfusepath{stroke} ",
  "\\pgftransformrotate{30}\\pgfpathrectangle{\\pgfpoint{1pt}{2pt}}{\\pgfpoint{3pt}{4pt}}\\pgfusepath{fill,draw}",
  "\\pgfpathrectangle{\\pgfpoint{1pt}{2pt}}{\\pgfpoint{3pt}{4pt}}\\pgfusepath{fill}\\pgfpathrectanglecorners{\\pgfpoint{-1pt}{2pt}}{\\pgfpoint{3pt}{-4pt}}\\pgfusepath{draw}",
  "\\pgfpathcircle{\\pgfpoint{1cm}{1cm}}{5mm}\\pgfusepath{stroke}\\pgfpathellipse{\\pgfpointorigin}{\\pgfpoint{2cm}{1pt}}{\\pgfpoint{-3pt}{1cm}}\\pgfusepath{fill}",
  "\\pgfpathmoveto{\\pgfpointorigin}\\pgfpathcurveto{\\pgfpoint{1cm}{0pt}}{\\pgfpoint{1cm}{1cm}}{\\pgfpoint{2cm}{1cm}}\\pgfpathclose\\pgfusepath{stroke}",
  "\\pgfsetlinewidth{2pt}\\begin{pgfscope}\\pgfsetlinewidth{5pt}\\pgfpathmoveto{\\pgfpoint{0pt}{0pt}}\\pgfpathlineto{\\pgfpoint{1cm}{0pt}}\\pgfusepath{stroke}\\end{pgfscope}\\pgfpathmoveto{\\pgfpoint{0pt}{1cm}}\\pgfpathlineto{\\pgfpoint{1cm}{1cm}}\\pgfusepath{draw}",
  "\\pgfsetbaseline{3pt}\\pgfsettrimleft{2pt}\\pgfsettrimright{1cm}\\pgfpathrectangle{\\pgfpoint{-1pt}{-2pt}}{\\pgfpoint{2cm}{1cm}}\\pgfusepath{stroke}",
  "\\pgfpathrectangle{\\pgfpoint{0pt}{0pt}}{\\pgfpoint{1cm}{1cm}}\\pgfusepath{clip}\\pgfpathcircle{\\pgfpoint{1cm}{1cm}}{1cm}\\pgfusepath{fill,stroke,clip}\\pgfpathmoveto{\\pgfpoint{5cm}{5cm}}\\pgfusepath{stroke}",
  "\\pgfpathrectangle{\\pgfpoint{0pt}{0pt}}{\\pgfpoint{1cm}{1cm}}\\pgfusepath{use as bounding box}\\pgfpathcircle{\\pgfpoint{3cm}{1cm}}{1cm}\\pgfusepath{fill,stroke}",
  "\\pgfsetdash{{3pt}{1pt}}{0pt}\\pgfsetroundcap\\pgfsetbeveljoin\\pgfsetmiterlimit{4}\\pgfseteorule\\pgfsetcolor{red}\\pgfpathmoveto{\\pgfpoint{0pt}{0pt}} \\pgfpathlineto{\\pgfpoint{1pt}{0pt}} \\pgfusepath{discard} \\pgfusepath{fill}",
  // ellipses: \pgf@yc still the centre's while the first \ifdim's of each quarter expand
  "\\pgfpathellipse{\\pgfpoint{0pt}{0pt}}{\\pgfpoint{10pt}{3pt}}{\\pgfpoint{4pt}{20pt}}",
  "\\pgfpathellipse{\\pgfpoint{0pt}{0pt}}{\\pgfpointpolar{49.4}{478389.751sp}}{\\pgfpointpolar{-17.3}{.95in}}\\pgfusepath{fill}",
  "\\pgfpathellipse{\\pgfpoint{0pt}{0pt}}{\\pgfpoint{7.29pt}{0pt}}{\\pgfpoint{-20pt}{-65pt}}",
  // \pgfpathrectanglecorners evaluates #1 twice: two \unskip's
  "\\pgfsys@stroke{ }  \\pgfpathrectanglecorners{\\pgfpoint{-336033sp}{+-.3bp}}{\\pgfpointxy{-1}{-1}}",
  "\\pgftransformyslant{2}\\pgfsys@stroke{ }  \\pgfpathrectanglecorners{\\pgfpoint{-336033sp}{+-.3bp}}{\\pgfpointxy{-1}{-1}}",
  // a miter limit below 1: pgf's error
  "\\pgfsetmiterlimit{0.99999}", "\\pgfsetmiterlimit{1.0}",
  // a path's coordinates, read again from \the's text
  "{0pt}{0pt}{1pt}{1pt}\\pgfpathmoveto{\\pgfpointadd{\\pgfqpoint{16383.99998pt}{0pt}}{\\pgfqpoint{0sp}{-16383.99998pt}}}\\pgfusepath{fill}",
  "{0pt}{0pt}{1pt}{1pt}\\pgfpathrectangle{\\pgfqpoint{-1pt}{0pt}}{\\pgfpointadd{\\pgfqpoint{16383.99998pt}{0pt}}{\\pgfqpoint{0sp}{0pt}}}\\pgfusepath{fill}",
  "{0pt}{0pt}{1pt}{1pt}\\pgfpathrectangle{\\pgfqpoint{-1pt}{0pt}}{\\pgfpointadd{\\pgfqpoint{16383.99998pt}{0pt}}{\\pgfqpoint{1sp}{0pt}}}\\pgfusepath{fill}",
  // nodes (#304): each shape, anchors, the text box, keys, names, anchors and border points of named nodes
  "\\pgfnode{rectangle}{center}{Hg}{a}{\\pgfusepath{stroke}}",
  "\\pgftransformshift{\\pgfpoint{1cm}{2pt}}\\pgfnode{circle}{north west}{x}{b}{\\pgfusepath{fill}}\\pgfpathmoveto{\\pgfpointanchor{b}{south}}",
  "\\pgfnode{coordinate}{center}{}{c}{}\\pgfmultipartnode{coordinate}{center}{c}{} \\pgfnode{rectangle}{base}{}{c}{}\\pgfusepath{stroke}",
  "\\pgftransformrotate{30}\\pgfnode{rectangle}{center}{Hg}{a}{\\pgfusepath{stroke}}\\pgftransformshift{\\pgfpoint{3pt}{1pt}}\\pgfpathmoveto{\\pgfpointanchor{a}{north east}}\\pgfpathlineto{\\pgfpointanchor{a}{30}}\\pgfusepath{draw}",
  "\\pgfset{inner sep=2pt,minimum width=1cm}\\pgfnode{rectangle}{south west}{$x^2$ y}{a}{\\pgfusepath{fill,stroke}}{\\pgfset{outer sep=3pt,minimum height=20pt}\\pgfnode{circle}{text}{A}{b}{\\pgfusepath{draw}}}\\pgfnode{circle}{mid east}{}{c}{}",
  "\\pgfnode{rectangle}{north}{a}{a}{} \\pgfnode{rectangle}{south}{b}{}{} \\pgfnode{rectangle}{west}{c}{}{} \\pgfnode{rectangle}{east}{d}{}{} \\pgfnode{rectangle}{mid}{e}{}{} \\pgfnode{rectangle}{mid west}{f}{}{} \\pgfnode{rectangle}{mid east}{g}{}{}",
  "\\pgfnode{rectangle}{base west}{a}{}{}\\pgfnode{rectangle}{base east}{b}{}{}\\pgfnode{rectangle}{north west}{c}{}{}\\pgfnode{rectangle}{south east}{d}{}{}\\pgfnode{rectangle}{north east}{e}{}{}\\pgfnode{rectangle}{-45}{f}{}{}\\pgfnode{rectangle}{100}{g}{}{}",
  "\\pgfnode{circle}{north}{a}{}{}\\pgfnode{circle}{south}{b}{}{}\\pgfnode{circle}{west}{c}{}{}\\pgfnode{circle}{east}{d}{}{}\\pgfnode{circle}{mid}{e}{}{}\\pgfnode{circle}{mid west}{f}{}{}\\pgfnode{circle}{base}{g}{}{}\\pgfnode{circle}{base west}{h}{}{}\\pgfnode{circle}{base east}{i}{}{}",
  "\\pgfnode{circle}{south west}{a}{}{}\\pgfnode{circle}{south east}{b}{}{}\\pgfnode{circle}{north east}{c}{}{}\\pgfnode{circle}{200}{d}{}{}\\pgfnode{circle}{center}{long text}{}{}",
  "\\pgfnode{rectangle}{center}{A}{a}{}\\pgfnode{circle}{center}{B}{b}{}\\pgfpathmoveto{\\pgfpointshapeborder{a}{\\pgfpoint{1cm}{2pt}}}\\pgfpathlineto{\\pgfpointshapeborder{b}{\\pgfpoint{-1cm}{-3cm}}}\\pgfpathlineto{\\pgfpointshapeborder{a}{\\pgfpoint{0pt}{0.01pt}}}\\pgfusepath{stroke}",
  "\\pgfcoordinate{p}{\\pgfpoint{1cm}{1pt}}\\pgftransformscale{2}\\pgfpathmoveto{\\pgfpointanchor{p}{north}}\\pgfpathlineto{\\pgfpointshapeborder{p}{\\pgfpointorigin}}",
  "\\pgfsetlinewidth{2pt}\\setbox\\pgfnodeparttextbox\\hbox{\\vrule width 2pt height 3pt}\\pgfmultipartnode{rectangle}{north}{m}{\\pgfusepath{stroke}}\\pgfpathmoveto{\\pgfpointanchor{m}{south}}",
  "\\pgftext{Hg}", "\\pgftext[left,top,at={\\pgfpoint{1cm}{2pt}}]{Hg} \\pgftext[right,bottom,x=3pt,y=-1pt,rotate=20]{a b}\\pgftext[base]{x}",
  "\\pgfpathmoveto{\\pgfpointorigin}\\pgfpathlineto{\\pgfpointborderrectangle{\\pgfqpoint{1pt}{2pt}}{\\pgfqpoint{3pt}{4pt}}}\\pgfpathlineto{\\pgfpointborderrectangle{\\pgfqpoint{-1pt}{0.1pt}}{\\pgfqpoint{3pt}{4pt}}}\\pgfpathlineto{\\pgfpointborderrectangle{\\pgfqpoint{0.002pt}{-0.001pt}}{\\pgfqpoint{3pt}{4pt}}}\\pgfpathlineto{\\pgfpointborderrectangle{\\pgfqpoint{1pt}{2040sp}}{\\pgfqpoint{3pt}{4pt}}}\\pgfpathlineto{\\pgfpointborderrectangle{\\pgfqpoint{1pt}{2032sp}}{\\pgfqpoint{3pt}{4pt}}}\\pgfusepath{stroke}",
  "\\pgfpathmoveto{\\pgfpointorigin}\\pgfpathlineto{\\pgfpointborderrectangle{\\pgfqpoint{2040sp}{1000sp}}{\\pgfqpoint{3pt}{4pt}}}\\pgfpathlineto{\\pgfpointborderrectangle{\\pgfqpoint{1000sp}{2040sp}}{\\pgfqpoint{3pt}{4pt}}}\\pgfpathlineto{\\pgfpointborderrectangle{\\pgfqpoint{2040sp}{1pt}}{\\pgfqpoint{3pt}{4pt}}}\\pgfpathlineto{\\pgfpointborderrectangle{\\pgfqpoint{2032sp}{-1pt}}{\\pgfqpoint{3pt}{4pt}}}\\pgfpathlineto{\\pgfpointborderrectangle{\\pgfqpoint{-2pt}{1pt}}{\\pgfqpoint{4pt}{2pt}}}\\pgfpathlineto{\\pgfpointborderrectangle{\\pgfqpoint{1pt}{-2pt}}{\\pgfqpoint{2pt}{4pt}}}\\pgfpathlineto{\\pgfpointborderrectangle{\\pgfqpoint{0pt}{0pt}}{\\pgfqpoint{3pt}{4pt}}}\\pgfusepath{stroke}",
  "\\pgfpathmoveto{\\pgfpointorigin}\\pgfpathlineto{\\pgfpointborderellipse{\\pgfqpoint{1pt}{2pt}}{\\pgfqpoint{3pt}{4pt}}}\\pgfpathlineto{\\pgfpointborderellipse{\\pgfqpoint{-1pt}{0.1pt}}{\\pgfqpoint{5pt}{4pt}}}\\pgfpathlineto{\\pgfpointborderellipse{\\pgfqpoint{1pt}{-1pt}}{\\pgfqpoint{2pt}{2pt}}}\\pgfpathlineto{\\pgfpointborderellipse{\\pgfqpoint{-1pt}{-3pt}}{\\pgfqpoint{2pt}{7pt}}}\\pgfpathlineto{\\pgfpointborderellipse{\\pgfqpoint{2pt}{-1pt}}{\\pgfqpoint{9pt}{1.5pt}}}\\pgfusepath{stroke}",
  // arrow tips (#304): each kind, instantiated once per line width, at both ends, shortened paths, curves, sequences
  "\\pgfsetarrowsend{to}\\pgfpathmoveto{\\pgfpointorigin}\\pgfpathlineto{\\pgfpoint{1cm}{0pt}}\\pgfusepath{stroke}",
  "\\pgfsetarrowsend{to}\\pgfpathmoveto{\\pgfpointorigin}\\pgfpathlineto{\\pgfpoint{1cm}{0pt}}\\pgfusepath{stroke}\\pgfpathmoveto{\\pgfpoint{0pt}{1cm}}\\pgfpathlineto{\\pgfpoint{1cm}{2cm}}\\pgfusepath{draw}",
  "\\pgfsetarrowsend{Stealth}\\pgfpathmoveto{\\pgfpointorigin}\\pgfpathlineto{\\pgfpoint{1cm}{0pt}}\\pgfusepath{stroke}",
  "\\pgfsetarrowsend{Latex}\\pgfpathmoveto{\\pgfpointorigin}\\pgfpathlineto{\\pgfpoint{1cm}{5pt}}\\pgfusepath{stroke}",
  "\\pgfsetarrowsend{To}\\pgfpathmoveto{\\pgfpointorigin}\\pgfpathlineto{\\pgfpoint{-1cm}{5pt}}\\pgfusepath{stroke}",
  "\\pgfsetarrows{<->}\\pgfpathmoveto{\\pgfpointorigin}\\pgfpathlineto{\\pgfpoint{1cm}{5pt}}\\pgfusepath{stroke}",
  "\\pgfsetarrows{stealth-latex}\\pgfsetlinewidth{1pt}\\pgfpathmoveto{\\pgfpointorigin}\\pgfpathcurveto{\\pgfpoint{1cm}{0pt}}{\\pgfpoint{1cm}{1cm}}{\\pgfpoint{2cm}{1cm}}\\pgfusepath{stroke}",
  "\\pgfsetarrows{to-to}\\pgfpathmoveto{\\pgfpointorigin}\\pgfpathlineto{\\pgfpoint{1cm}{0pt}}\\pgfpathmoveto{\\pgfpoint{0pt}{1cm}}\\pgfpathlineto{\\pgfpoint{1cm}{1cm}}\\pgfpathlineto{\\pgfpoint{2cm}{2cm}}\\pgfusepath{stroke}",
  "\\pgfsetarrowsend{>>}\\pgfsetstrokecolor{red}\\pgfpathmoveto{\\pgfpointorigin}\\pgfpathlineto{\\pgfpoint{1cm}{0pt}}\\pgfusepath{stroke} \\pgfsetarrowsend{Stealth[]Latex}\\pgfpathmoveto{\\pgfpointorigin}\\pgfpathlineto{\\pgfpoint{1cm}{1cm}}\\pgfusepath{stroke}",
  "\\pgfsetshortenstart{2pt}\\pgfsetshortenend{+1pt}\\pgfpathmoveto{\\pgfpointorigin}\\pgfpathlineto{\\pgfpoint{1cm}{0pt}}\\pgfusepath{stroke}",
  "\\pgfsetarrowsstart{LaTeX}\\pgfpathmoveto{\\pgfpointorigin}\\pgfpathcurveto{\\pgfpointorigin}{\\pgfpoint{1cm}{1cm}}{\\pgfpoint{2cm}{1cm}}\\pgfusepath{stroke}\\pgfpathmoveto{\\pgfpointorigin}\\pgfpathcurveto{\\pgfpointorigin}{\\pgfpointorigin}{\\pgfpoint{2cm}{1cm}}\\pgfusepath{stroke}",
  "\\pgfsetarrowsend{stealth}\\pgfpathmoveto{\\pgfpointorigin}\\pgfpathcurveto{\\pgfpoint{1cm}{0pt}}{\\pgfpoint{2cm}{1cm}}{\\pgfpoint{2cm}{1cm}}\\pgfusepath{stroke}\\pgfpathmoveto{\\pgfpointorigin}\\pgfpathcurveto{\\pgfpoint{1cm}{0pt}}{\\pgfpoint{2cm}{1cm}}{\\pgfpoint{2cm}{1cm}}\\pgfpathmoveto{\\pgfpoint{3cm}{0pt}}\\pgfusepath{stroke}",
  "\\pgfsetarrowsend{to}\\pgfpathrectangle{\\pgfpointorigin}{\\pgfpoint{1cm}{1cm}}\\pgfusepath{stroke} \\pgfpathmoveto{\\pgfpointorigin}\\pgfpathlineto{\\pgfpoint{1cm}{0pt}}\\pgfusepath{fill} \\pgfusepath{stroke}",
  // the fill colour of a tip: the globals \ifx-compared, by name under dvips, restored by \endpgfscope
  ...["\\pgfsetcolor{red}", "\\pgfsetstrokecolor{red}\\pgfsetfillcolor{red}", "\\pgfsetstrokecolor{red!50}\\pgfsetfillcolor{red!50}", "\\pgfsetstrokecolor{red!50}", "\\pgfsetfillcolor{blue}"]
    .map((c) => `${c}\\pgfsetarrowsend{>>}\\pgfpathmoveto{\\pgfpointorigin}\\pgfpathlineto{\\pgfpoint{1cm}{0pt}}\\pgfusepath{stroke}\\begin{pgfscope}\\pgfsetfillcolor{red}\\end{pgfscope}\\pgfpathmoveto{\\pgfpointorigin}\\pgfpathlineto{\\pgfpoint{1cm}{0pt}}\\pgfusepath{stroke}`),
  // the minimum width met to the sp
  "\\pgfset{inner sep=1pt,minimum size=131071sp}\\pgfnode{rectangle}{north east}{}{}{\\pgfusepath{stroke}}\\pgfnode{rectangle}{south west}{}{}{\\pgfusepath{stroke}}",
  // rounded corners: rectangles, polylines, curves, closepaths, consecutive marks, the arc switched off
  "\\pgfsetcornersarced{\\pgfpoint{4pt}{4pt}}\\pgfpathrectangle{\\pgfpointorigin}{\\pgfpoint{1cm}{1cm}}\\pgfusepath{stroke}",
  "\\pgfsetcornersarced{\\pgfpoint{3pt}{5pt}}\\pgfpathrectanglecorners{\\pgfpoint{2cm}{1cm}}{\\pgfpoint{-1pt}{-2pt}}\\pgfusepath{fill,stroke}",
  "\\pgfpathmoveto{\\pgfpointorigin}\\pgfsetcornersarced{\\pgfpoint{4pt}{4pt}}\\pgfpathlineto{\\pgfpoint{0pt}{1cm}}\\pgfpathlineto{\\pgfpoint{1cm}{1cm}}\\pgfpathlineto{\\pgfpoint{2cm}{3mm}}\\pgfusepath{stroke}",
  "\\pgfsetcornersarced{\\pgfpoint{2pt}{2pt}}\\pgfpathmoveto{\\pgfpointorigin}\\pgfpathlineto{\\pgfpoint{1cm}{0cm}}\\pgfpathlineto{\\pgfpoint{1cm}{1cm}}\\pgfpathclose\\pgfusepath{draw}",
  "\\pgfsetcornersarced{\\pgfpoint{2pt}{6pt}}\\pgfpathmoveto{\\pgfpointorigin}\\pgfpathcurveto{\\pgfpoint{1cm}{0pt}}{\\pgfpoint{1cm}{1cm}}{\\pgfpoint{2cm}{1cm}}\\pgfpathcurveto{\\pgfpoint{3cm}{1cm}}{\\pgfpoint{3cm}{0cm}}{\\pgfpoint{2cm}{-1cm}}\\pgfpathlineto{\\pgfpoint{0pt}{-1cm}}\\pgfpathclose\\pgfusepath{fill}",
  "\\pgftransformrotate{20}\\pgfsetcornersarced{\\pgfpoint{3pt}{3pt}}\\pgfpathrectangle{\\pgfpoint{1pt}{2pt}}{\\pgfpoint{2cm}{1cm}}\\pgfsetcornersarced{\\pgfpointorigin}\\pgfpathlineto{\\pgfpoint{3cm}{0pt}}\\pgfpathlineto{\\pgfpoint{3cm}{2cm}}\\pgfusepath{clip}",
  "\\pgfsetcornersarced{\\pgfpoint{0pt}{3pt}}\\pgfpathrectangle{\\pgfpointorigin}{\\pgfpoint{1cm}{5mm}}\\pgfpathrectangle{\\pgfpoint{2cm}{0pt}}{\\pgfpoint{-1cm}{-5mm}}\\pgfusepath{stroke}\\pgfpathrectangle{\\pgfpointorigin}{\\pgfpoint{1cm}{5mm}}\\pgfusepath{discard}",
  "\\pgfpathrectangle{\\pgfpointorigin}{\\pgfpoint{1cm}{5mm}}\\pgfsetcornersarced{\\pgfpoint{1pt}{1pt}}\\pgfpathlineto{\\pgfpoint{1cm}{1cm}}\\pgfpathlineto{\\pgfpoint{0pt}{1cm}}\\pgfpathclose\\pgfpathlineto{\\pgfpoint{1cm}{1cm}}\\pgfusepath{stroke}",
  "\\pgfsetcornersarced{\\pgfpoint{5pt}{5pt}}\\pgfpathlineto{\\pgfpoint{1cm}{1cm}}\\pgfpathlineto{\\pgfpoint{1cm}{1cm}}\\pgfpathlineto{\\pgfpoint{2cm}{0pt}}\\pgfpathclose\\pgfpathclose\\pgfusepath{stroke}",
  "\\pgfpathmoveto{\\pgfpointorigin}\\pgfsetcornersarced{\\pgfpoint{3pt}{3pt}}\\pgfpathlineto{\\pgfpoint{1cm}{0pt}}\\pgfsetcornersarced{\\pgfpointorigin}\\pgfpathcurveto{\\pgfpoint{2cm}{0pt}}{\\pgfpoint{2cm}{1cm}}{\\pgfpoint{1cm}{2cm}}\\pgfusepath{stroke}",
  "\\pgfsetcornersarced{\\pgfpoint{2pt}{3pt}}\\pgfpathmoveto{\\pgfpoint{1pt}{2pt}}\\pgfpathlineto{\\pgfpoint{1cm}{0pt}}\\pgfpathlineto{\\pgfpoint{1cm}{1cm}}\\pgfpathclose\\pgfpathlineto{\\pgfpoint{-1cm}{5mm}}\\pgfpathlineto{\\pgfpoint{-2cm}{-5mm}}\\pgfusepath{stroke}",
  "\\pgfsetcornersarced{\\pgfpoint{900pt}{700.3pt}}\\pgfpathrectangle{\\pgfpoint{-11pt}{3pt}}{\\pgfpoint{2000pt}{1999pt}}\\pgfusepath{fill}",
  // a rectangle's size past max_dimen; a corner past it from the point before, which only the rounding of a used path reads
  "{0pt}{0pt}{1pt}{1pt}\\pgfpathrectangle{\\pgfqpoint{-1pt}{0pt}}{\\pgfpointadd{\\pgfqpoint{16383.99998pt}{0pt}}{\\pgfqpoint{1sp}{0pt}}}\\pgfusepath{discard}",
  "{0pt}{0pt}{1pt}{1pt}\\pgfpathmoveto{\\pgfpoint{-16000pt}{0pt}}\\pgfsetcornersarced{\\pgfpoint{1pt}{1pt}}\\pgfpathlineto{\\pgfpoint{16000pt}{0pt}}\\pgfpathlineto{\\pgfpoint{16000pt}{1pt}}\\pgfusepath{discard}",
  "{0pt}{0pt}{1pt}{1pt}\\pgfpathmoveto{\\pgfpoint{-16000pt}{0pt}}\\pgfsetcornersarced{\\pgfpoint{1pt}{1pt}}\\pgfpathlineto{\\pgfpoint{16000pt}{0pt}}\\pgfpathlineto{\\pgfpoint{16000pt}{1pt}}\\pgfusepath{clip}",
]

/** Shadings (each on one line): each declaration, its colour stops and dependencies, used outside and inside pictures, \pgfshadepath. */
const BIGSPHERE = "\\pgfdeclareradialshading[bg,parent.bg]{bigsphere}{\\pgfpoint{-0.1849315ex}{.2260273ex}}{color(0cm)=(bg!15); color(0.1643835ex)=(bg!75); color(0.3287671ex)=(bg!70!black); color(0.4520547ex)=(bg!50!black); color(0.53ex)=(parent.bg)}"
const SHADINGS = [
  "\\pgfdeclarehorizontalshading{h}{1cm}{rgb(0pt)=(1,0,0); rgb(2cm)=(0,0,1)}\\pgfuseshading{h}",
  "\\pgfdeclareverticalshading{v}{2cm}{gray(0pt)=(0); gray(1cm)=(.5); gray(2cm)=(1)}\\pgfuseshading{v} \\pgfuseshading{v}",
  "\\pgfdeclareradialshading{r}{\\pgfpoint{-0.0333em}{0.0333em}}{color(0cm)=(white);color(0.1cm)=(red!55);color(0.2cm)=(mine);color(0.5cm)=(white)}\\pgfuseshading{r}",
  "\\colorlet{structure}{blue}\\pgfdeclareradialshading[structure]{s}{\\pgfpointorigin}{color(0cm)=(white);color(0.1cm)=(structure!55);color(0.2cm)=(structure);color(0.5cm)=(white)}\\pgfuseshading{s}\\colorlet{structure}{dark}\\pgfuseshading{s}\\pgfuseshading{s}",
  `\\colorlet{bg}{mine}\\colorlet{parent.bg}{white}${BIGSPHERE}\\pgfuseshading{bigsphere}\\colorlet{bg}{red}{\\pgfuseshading{bigsphere}}\\colorlet{bg}{mine}\\pgfuseshading{bigsphere}`,
  "\\pgfdeclarehorizontalshading[mine]{h}{3mm}{rgb(0pt)=(0.5,1.0,.25); color(5pt)=(mine); gray(1cm)=(0.3); color(1.5cm)=(-red); rgb(2cm)=(0,0,0)}\\pgfuseshading{h}",
  "\\pgfdeclareverticalshading{v}{+1cm}{rgb(1cm)=(1,0,0);rgb(-1cm)=(0,1,0)} \\pgfdeclarehorizontalshading{h}{+1cm}{rgb(+2pt)=(1,0,0);rgb(+3pt)=(0,1,0)}\\pgfuseshading{v}\\pgfuseshading{h}",
  // inside pictures: centred on the origin; a path shaded at an angle; no path
  "\\pgfdeclarehorizontalshading{h}{1cm}{rgb(0pt)=(1,0,0); rgb(2cm)=(0,0,1)}\\pgfdeclareradialshading{r}{\\pgfpoint{1pt}{-2pt}}{rgb(0pt)=(1,1,1); rgb(5mm)=(0,0,0)}\\begin{pgfpicture}\\pgfpathrectangle{\\pgfpointorigin}{\\pgfpoint{1cm}{2cm}}\\pgfshadepath{h}{30}\\pgfuseshading{r}\\end{pgfpicture}",
  "\\pgfdeclareverticalshading{v}{2cm}{gray(0pt)=(0); gray(1cm)=(1)}\\begin{pgfpicture}\\pgfshadepath{v}{0}\\pgfpathcircle{\\pgfpoint{1cm}{0pt}}{3mm}\\pgfshadepath{v}{-120.5}\\pgfusepath{stroke}\\pgfpathmoveto{\\pgfpointorigin}\\pgfpathlineto{\\pgfpoint{0pt}{1cm}}\\pgfshadepath{v}{90}\\end{pgfpicture}",
  `\\colorlet{bg}{dark}\\colorlet{parent.bg}{mid}${BIGSPHERE}\\begin{pgfpicture}\\pgftransformscale{1.75}\\pgfuseshading{bigsphere}\\pgfpathrectangle{\\pgfpoint{-1pt}{-1pt}}{\\pgfpoint{2pt}{2pt}}\\pgfshadepath{bigsphere}{45}\\end{pgfpicture}`,
  // a horizontal line has nothing to shade; a shading declared again with the same colours is made again
  "\\pgfdeclarehorizontalshading{h}{1cm}{rgb(0pt)=(1,0,0); rgb(2cm)=(0,0,1)}\\begin{pgfpicture}\\pgfpathmoveto{\\pgfpointorigin}\\pgfpathlineto{\\pgfpoint{1cm}{0pt}}\\pgfshadepath{h}{0}\\pgfshadepath{h}{10}\\pgfusepath{discard}\\pgfpathmoveto{\\pgfpointorigin}\\pgfpathlineto{\\pgfpoint{0pt}{1cm}}\\pgfshadepath{h}{0}\\end{pgfpicture}",
  "\\colorlet{ca}{red}\\pgfdeclarehorizontalshading[ca]{h}{1cm}{color(0pt)=(ca); rgb(2cm)=(0,0,1)}\\pgfuseshading{h}\\pgfdeclarehorizontalshading[ca]{h}{2cm}{color(0pt)=(ca); rgb(1cm)=(0,1,1)}\\pgfuseshading{h}",
  // errors: an undefined shading; one stop (an ill-formed specification is an endless loop of errors)
  "\\pgfuseshading{nothing}",
  "\\pgfdeclarehorizontalshading{h}{1cm}{rgb(0pt)=(1,0,0)}",
]

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function makeSnippets(n: number, seed: number): string[] {
  const r = rng(seed)
  const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)]
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))
  const digits = (k: number) => Array.from({ length: k }, () => String(int(0, 9))).join("")
  const dim = () => {
    const unit = pick(["pt", "pt", "pt", "bp", "cm", "mm", "in", "sp", "em", "pc", "dd"])
    const whole = unit === "sp" ? int(0, 999999) : unit === "pt" || unit === "bp" ? int(0, 9999) : int(0, 99)
    return `${pick(["", "", "-"])}${pick([String(whole), `${whole}.${digits(int(1, 6))}`, `.${digits(int(1, 3))}`, "0"])}${unit}`
  }
  const num = () => pick(["0", "1", "-1", "2", "0.5", ".25", `0.${digits(int(1, 5))}`, `-0.${digits(5)}`, `${int(0, 99)}.${digits(int(1, 3))}`])
  const unit = () => pick(["0", "1", "0.5", ".25", `0.${digits(int(1, 5))}`])
  const colorExpr = () => pick(["red", "blue", "green!50", "red!30!blue", "-red", "cyan", "magenta!20", "gray", "black", "white", "olive!40!ink", "mine", "dark", "ink", "mid", "dark!25!red"])
  const model = (): ColorModel => pick(["rgb", "cmyk", "cmy", "gray"])
  const args = (k: number, f: () => string) => Array.from({ length: k }, () => `{${f()}}`).join("")
  const box = () => pick(["\\hbox{}", `\\hbox{\\vrule width ${dim()}}`, `\\hbox{\\vrule height ${dim()} depth ${dim()}}`])
  const commands: (() => string)[] = [
    () => `\\pgfsys@moveto${args(2, dim)}`, () => `\\pgfsys@lineto${args(2, dim)}`, () => `\\pgfsys@curveto${args(6, dim)}`,
    () => `\\pgfsys@rect${args(4, dim)}`, () => "\\pgfsys@closepath",
    () => "\\pgfsys@stroke", () => "\\pgfsys@fill", () => "\\pgfsys@fillstroke", () => "\\pgfsys@clipnext", () => "\\pgfsys@discardpath",
    () => pick(["\\pgfsys@eoruletrue", "\\pgfsys@eorulefalse"]),
    () => `\\pgfsys@setlinewidth{${dim()}}`, () => `\\pgfsys@setdash{${Array.from({ length: int(0, 4) }, dim).join(",")}}{${dim()}}`,
    () => `\\pgfsys@setmiterlimit{${num()}}`,
    () => pick(["\\pgfsys@buttcap", "\\pgfsys@roundcap", "\\pgfsys@rectcap", "\\pgfsys@miterjoin", "\\pgfsys@roundjoin", "\\pgfsys@beveljoin"]),
    () => { const m = model(); return `\\pgfsys@color@${m}${pick(["@stroke", "@fill", ""])}${args(m === "gray" ? 1 : m === "cmyk" ? 4 : 3, unit)}` },
    () => `\\${pick(["pgfsetstrokecolor", "pgfsetfillcolor", "pgfsetcolor"])}{${colorExpr()}}`,
    () => pick(["\\pgfsys@color@reset", "\\pgfsys@color@reset@inorderfalse", "\\pgfsys@color@reset@inordertrue"]),
    () => pick(["\\pgfsys@beginscope", "\\pgfsys@endscope"]),
    () => `\\pgfsys@transformcm${args(4, num)}${args(2, dim)}`, () => `\\pgfsys@transformshift${args(2, dim)}`, () => `\\pgfsys@transformxyscale${args(2, num)}`,
    () => pick([`\\setbox1${box()}\\pgfsys@hbox1`, `\\setbox\\pgfcheckbox${box()}\\pgfsys@hbox\\pgfcheckbox`, "\\pgfsys@hbox1", "\\pgfsys@hbox\\pgfcheckbox"]),
    () => pick(["\\pgfsys@begininvisible", "\\pgfsys@endinvisible", "\\pgfsys@begin@text", "\\pgfsys@end@text"]),
    () => pick([" ", "{ }", "{}"]),
    () => pick(["\\pgfsysprotocol@bufferedtrue", "\\pgfsysprotocol@bufferedfalse", "\\pgfsysprotocol@flushcurrentprotocol", "\\pgfsys@beginpicture", "\\pgfsys@endpicture"]),
  ]
  const body = (depth: number): string => {
    let out = ""
    for (let k = int(1, 8); k > 0; k--) {
      out += depth < 2 && r() < 0.1 ? pick([`{${body(depth + 1)}}`, `\\begingroup${body(depth + 1)}\\endgroup`, `\\pgfsys@beginscope${body(depth + 1)}\\pgfsys@endscope`]) : pick(commands)()
      if (r() < 0.1) out += " "
    }
    return out
  }
  return Array.from({ length: n }, () => `\\pgfsys@beginpicture${body(0)}\\pgfsys@endpicture`)
}

/** Random pictures: path constructions and uses under random transformations, scopes, groups, graphic state and spaces. */
export function makePictures(n: number, seed: number): string[] {
  const r = rng(seed * 7919 + 17)
  const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)]
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))
  const digits = (k: number) => Array.from({ length: k }, () => String(int(0, 9))).join("")
  const len = () => {
    const unit = pick(["pt", "pt", "bp", "cm", "mm", "in", "sp", "em", "pc", "dd"])
    const whole = unit === "sp" ? int(0, 999999) : unit === "pt" || unit === "bp" || unit === "dd" ? int(0, 200) : unit === "in" ? int(0, 2) : int(0, 9)
    return `${pick(["", "", "-"])}${pick([String(whole), `${whole}.${digits(int(1, 5))}`, `.${digits(int(1, 3))}`])}${unit}`
  }
  const expr = () => pick([len, len, len, () => `+${len()}`, () => `${len()}+${len()}`, () => `${int(1, 3)}*${len()}`, () => `(${len()})/${int(1, 4)}`])()
  // (near 1, so that a picture's transformations seldom multiply past TeX's largest dimension)
  const factor = () => pick(["1", "2", "0.5", "-1", ".75", `${pick(["", "-"])}${pick(["0", "1"])}.${digits(int(1, 4))}`, `1+0.${digits(2)}`])
  const angle = () => pick([String(int(-360, 360)), `${int(-90, 90)}.${digits(int(1, 3))}`, "45", "90", "180", `${int(1, 9)}*10`])
  const point = (depth = 0): string => {
    const kinds: (() => string)[] = [
      () => `\\pgfpoint{${expr()}}{${expr()}}`, () => `\\pgfpoint{${len()}}{${len()}}`, () => `\\pgfqpoint{${len()}}{${len()}}`,
      () => "\\pgfpointorigin", () => `\\pgfpointxy{${factor()}}{${factor()}}`, () => `\\pgfpointpolar{${angle()}}{${expr()}}`,
      () => `\\pgfpointpolar{${angle()}}{${len()} and ${len()}}`,
    ]
    if (depth < 2) kinds.push(
      () => `\\pgfpointadd{${point(depth + 1)}}{${point(depth + 1)}}`, () => `\\pgfpointdiff{${point(depth + 1)}}{${point(depth + 1)}}`,
      () => `\\pgfpointscale{${factor()}}{${point(depth + 1)}}`, () => `\\pgfpointtransformed{${point(depth + 1)}}`,
    )
    return pick(kinds)()
  }
  const colorExpr = () => pick(["red", "blue", "green!50", "red!30!blue", "cyan", "black", "mine", "dark", "ink", "mid", "dark!25!red"])
  const uses = () => {
    const keys = ["stroke", "draw", "fill", "clip", "discard", "use as bounding box"].filter(() => r() < 0.3)
    return `\\pgfusepath{${keys.join(pick([",", ", "]))}}`
  }
  const commands: (() => string)[] = [
    () => `\\pgfpathmoveto{${point()}}`, () => `\\pgfpathlineto{${point()}}`, () => `\\pgfpathlineto{${point()}}`,
    () => `\\pgfpathcurveto{${point()}}{${point()}}{${point()}}`, () => "\\pgfpathclose",
    () => `\\pgfpathrectangle{${point()}}{${point()}}`, () => `\\pgfpathrectanglecorners{${point()}}{${point()}}`,
    () => `\\pgfpathcircle{${point()}}{${len()}}`, () => `\\pgfpathellipse{${point()}}{${point()}}{${point()}}`,
    uses, uses, uses,
    () => `\\pgftransformshift{${point()}}`, () => `\\pgftransformxshift{${expr()}}`, () => `\\pgftransformyshift{${expr()}}`,
    () => `\\pgftransformscale{${factor()}}`, () => `\\pgftransformxscale{${factor()}}`, () => `\\pgftransformyscale{${factor()}}`,
    () => `\\pgftransformxslant{${factor()}}`, () => `\\pgftransformyslant{${factor()}}`, () => `\\pgftransformrotate{${angle()}}`,
    () => `\\pgftransformcm{${factor()}}{${factor()}}{${factor()}}{${factor()}}{${point()}}`,
    () => pick(["\\pgftransformreset", "\\pgftransformresetnontranslations", "\\pgflowlevelsynccm"]),
    () => `\\pgfsetlinewidth{${pick([len, () => "0.4pt", () => "1pt"])()}}`,
    () => `\\pgfsetdash{${Array.from({ length: int(0, 3) }, () => `{${len()}}`).join("")}}{${len()}}`,
    () => `\\pgfsetmiterlimit{${pick(["1", "4", "10", `${int(1, 20)}.${digits(2)}`])}}`,
    () => pick(["\\pgfsetbuttcap", "\\pgfsetroundcap", "\\pgfsetrectcap", "\\pgfsetmiterjoin", "\\pgfsetroundjoin", "\\pgfsetbeveljoin", "\\pgfseteorule", "\\pgfsetnonzerorule"]),
    () => `\\${pick(["pgfsetstrokecolor", "pgfsetfillcolor", "pgfsetcolor"])}{${colorExpr()}}`,
    () => `\\${pick(["pgfsetbaseline", "pgfsettrimleft", "pgfsettrimright"])}{${pick([len, expr, () => "default"])()}}`,
    () => pick(["\\pgfsys@clipnext", "\\pgfsys@stroke", "\\pgfsys@beginscope\\pgfsys@endscope"]),
    () => `\\pgfsetcornersarced{${pick([point, () => "\\pgfpointorigin", () => `\\pgfpoint{${len()}}{${len()}}`])()}}`,
  ]
  const body = (depth: number): string => {
    let out = ""
    for (let k = int(1, 9); k > 0; k--) {
      out += depth < 2 && r() < 0.12 ? pick([`{${body(depth + 1)}}`, `\\begingroup${body(depth + 1)}\\endgroup`, `\\begin{pgfscope}${body(depth + 1)}\\end{pgfscope}`]) : pick(commands)()
      if (r() < 0.15) out += pick([" ", "  "])
    }
    return out
  }
  return Array.from({ length: n }, () => {
    const bbox = r() < 0.1 ? Array.from({ length: 4 }, () => `{${expr()}}`).join("") : ""
    // (a body beginning with a brace would be the old syntax's bounding box)
    return `\\begin{pgfpicture}${r() < 0.2 ? " " : ""}${bbox}${pick(commands)()}${body(0)}\\end{pgfpicture}`
  })
}

/** Random pictures of nodes (#304): shapes, anchors, texts and keys under transformations, the named nodes' anchors and border points, \pgftext. */
export function makeNodes(n: number, seed: number): string[] {
  const r = rng(seed * 104729 + 3)
  const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)]
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))
  const digits = (k: number) => Array.from({ length: k }, () => String(int(0, 9))).join("")
  const len = () => {
    const unit = pick(["pt", "pt", "bp", "cm", "mm", "em", "ex"])
    const whole = unit === "pt" || unit === "bp" ? int(0, 40) : int(0, 2)
    return `${pick(["", "", "", "-"])}${pick([String(whole), `${whole}.${digits(int(1, 4))}`, `.${digits(int(1, 3))}`])}${unit}`
  }
  const size = () => pick([len, () => "0pt", () => `+${len()}`, () => `${len()}+${len()}`])()
  const factor = () => pick(["1", "2", "0.5", "-1", ".75", `${pick(["", "-"])}${pick(["0", "1"])}.${digits(int(1, 3))}`])
  const angle = () => pick([String(int(-360, 360)), `${int(-90, 90)}.${digits(int(1, 2))}`, "45", "90", "180"])
  const shapes = ["rectangle", "rectangle", "circle", "circle", "coordinate"]
  const anchors = ["center", "north", "south", "east", "west", "mid", "mid west", "mid east", "base", "base west", "base east", "north west", "north east", "south west", "south east", "text"]
  const anchor = () => r() < 0.15 ? angle() : pick(anchors)
  const text = () => pick(["", "x", "Hg", "A", "long text", "$x^2$", "fly", "a b", "1", "Wq"])
  const names: string[] = []
  const point = (): string => pick([
    () => `\\pgfpoint{${len()}}{${len()}}`, () => "\\pgfpointorigin", () => `\\pgfpointpolar{${angle()}}{${len()}}`,
    ...(names.length ? [() => `\\pgfpointanchor{${pick(names)}}{${anchor()}}`, () => `\\pgfpointshapeborder{${pick(names)}}{\\pgfpoint{${len()}}{${len()}}}`] : []),
  ])()
  const keys = () => {
    const ks = ["inner sep", "inner xsep", "inner ysep", "outer sep", "outer xsep", "outer ysep", "minimum width", "minimum height", "minimum size"].filter(() => r() < 0.25)
    return `\\pgfset{${ks.map((k) => `${k}=${size()}`).join(",")}}`
  }
  const uses = () => pick(["", "\\pgfusepath{stroke}", "\\pgfusepath{fill}", "\\pgfusepath{fill,stroke}", "\\pgfusepath{discard}", "\\pgfusepath{clip}"])
  const node = () => {
    const name = r() < 0.7 ? pick(["a", "b", "c"]) : ""
    const out = r() < 0.15
      ? `\\pgfcoordinate{${name}}{${point()}}`
      : `\\pgfnode{${pick(shapes)}}{${anchor()}}{${text()}}{${name}}{${uses()}}`
    if (name && !names.includes(name)) names.push(name)
    return out
  }
  const textOptions = () => {
    const os = [pick(["", "left", "right"]), pick(["", "top", "bottom", "base"]), ...(r() < 0.3 ? [`at={${point()}}`] : []), ...(r() < 0.2 ? [`rotate=${angle()}`] : []), ...(r() < 0.2 ? [`x=${len()}`] : [])].filter((o) => o)
    return os.length ? `[${os.join(",")}]` : ""
  }
  const commands: (() => string)[] = [
    node, node, node, node, keys,
    () => `\\pgftext${textOptions()}{${text() || "x"}}`,
    () => `\\pgfpathmoveto{${point()}}`, () => `\\pgfpathlineto{${point()}}`, () => "\\pgfusepath{stroke}",
    () => `\\pgftransformshift{${point()}}`, () => `\\pgftransformrotate{${angle()}}`, () => `\\pgftransformscale{${factor()}}`,
    () => `\\pgftransformcm{${factor()}}{${factor()}}{${factor()}}{${factor()}}{${point()}}`, () => `\\pgftransformxslant{${factor()}}`,
    () => `\\pgfsetlinewidth{${pick(["0.4pt", "1pt", "2pt", len()])}}`,
  ]
  const body = (depth: number): string => {
    let out = ""
    for (let k = int(1, 7); k > 0; k--) {
      // (lazily: a body made and not picked would still name its nodes)
      out += depth < 2 && r() < 0.15 ? pick([() => `{${body(depth + 1)}}`, () => `\\begin{pgfscope}${body(depth + 1)}\\end{pgfscope}`])() : pick(commands)()
      if (r() < 0.15) out += " "
    }
    return out
  }
  return Array.from({ length: n }, () => {
    names.length = 0
    return `\\begin{pgfpicture}${node()}${body(0)}\\end{pgfpicture}`
  })
}

/** Random pictures with arrow tips (#304): tip sequences at both ends of random open paths, shortening, line widths, colours, transformations, stray spaces. */
export function makeArrows(n: number, seed: number): string[] {
  const r = rng(seed * 15485863 + 11)
  const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)]
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))
  const digits = (k: number) => Array.from({ length: k }, () => String(int(0, 9))).join("")
  const len = () => {
    const unit = pick(["pt", "pt", "bp", "cm", "mm", "em"])
    const whole = unit === "pt" || unit === "bp" ? int(0, 60) : int(0, 2)
    return `${pick(["", "", "-"])}${pick([String(whole), `${whole}.${digits(int(1, 4))}`, `.${digits(int(1, 3))}`])}${unit}`
  }
  // (> is To at an end, < at a start; the other way round they are reversed tips)
  const common = ["to", "To", "stealth", "latex", "Stealth", "Latex", "LaTeX", "Stealth[]Latex", "to[].to", "Latex[] . Stealth", "", ".", "Computer Modern Rightarrow"]
  const ends = [...common, ">", ">>"], starts = [...common, "<", "<<"]
  const pts: string[] = []
  const point = () => pick([
    () => `\\pgfpoint{${len()}}{${len()}}`, () => "\\pgfpointorigin", () => `\\pgfpointpolar{${int(-180, 180)}}{${len()}}`,
    ...(pts.length ? [() => pick(pts)] : []), // (a point again: degenerate segments)
  ])()
  const keep = (p: string) => { pts.push(p); return p }
  const path = () => {
    let out = `\\pgfpathmoveto{${keep(point())}}`
    for (let k = int(0, 4); k > 0; k--) {
      out += pick([
        () => `\\pgfpathlineto{${keep(point())}}`, () => `\\pgfpathlineto{${keep(point())}}`,
        () => `\\pgfpathcurveto{${keep(point())}}{${keep(point())}}{${keep(point())}}`,
        () => (r() < 0.2 ? "\\pgfpathclose" : `\\pgfpathmoveto{${keep(point())}}`),
      ])()
      if (r() < 0.1) out += " "
    }
    return out
  }
  const uses = () => `\\pgfusepath{${pick(["stroke", "stroke", "draw", "fill", "fill,stroke", "clip", "discard", "stroke,clip"])}}`
  const commands: (() => string)[] = [
    () => `${path()}${pick(["", " "])}${uses()}`, () => `${path()}${pick(["", " "])}${uses()}`, () => `${path()}${uses()}`,
    () => `\\pgfsetarrowsend{${pick(ends)}}`, () => `\\pgfsetarrowsstart{${pick(starts)}}`, () => `\\pgfsetarrows{${pick(starts)}-${pick(ends)}}`,
    () => `\\pgfsetshortenstart{${pick([len(), `+${len()}`, "0pt"])}}`, () => `\\pgfsetshortenend{${pick([len(), `+${len()}`, "0pt"])}}`,
    () => `\\pgfsetlinewidth{${pick(["0.4pt", "1pt", "2pt", ".1pt", len()])}}`,
    () => `\\${pick(["pgfsetstrokecolor", "pgfsetfillcolor", "pgfsetcolor"])}{${pick(["red", "blue", "red!50", "mine", "dark!25!red", "black"])}}`,
    () => `\\pgftransformshift{${point()}}`, () => `\\pgftransformrotate{${int(-180, 180)}}`, () => `\\pgftransformscale{${pick(["2", "0.5", "-1"])}}`,
    () => pick(["\\pgfsetdash{{3pt}{1pt}}{0pt}", "\\pgfsetroundcap", "\\pgfsetbuttcap", "\\pgfsetroundjoin"]),
  ]
  const body = (depth: number): string => {
    let out = ""
    for (let k = int(1, 7); k > 0; k--) {
      out += depth < 2 && r() < 0.15 ? pick([() => `{${body(depth + 1)}}`, () => `\\begin{pgfscope}${body(depth + 1)}\\end{pgfscope}`])() : pick(commands)()
      if (r() < 0.2) out += pick([" ", "  "])
    }
    return out
  }
  return Array.from({ length: n }, () => {
    pts.length = 0
    return `\\begin{pgfpicture}\\pgfsetarrows{${pick(starts)}-${pick(ends)}}${body(0)}\\end{pgfpicture}`
  })
}

/**
 * Random shadings: declarations of each kind with random stops, sizes and dependencies, used outside and inside
 * pictures and by \pgfshadepath, between changes of the colours they depend on (at the snippet's level: the
 * reader's colours are not local to groups).
 */
export function makeShadings(n: number, seed: number): string[] {
  const r = rng(seed * 104729 + 3)
  const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)]
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))
  const digits = (k: number) => Array.from({ length: k }, () => String(int(0, 9))).join("")
  const len = () => {
    const unit = pick(["pt", "pt", "bp", "cm", "mm", "sp", "em", "ex", "pc"])
    const whole = unit === "sp" ? int(0, 999999) : unit === "pt" || unit === "bp" ? int(0, 99) : int(0, 4)
    return `${pick(["", "", "", "-"])}${pick([String(whole), `${whole}.${digits(int(1, 5))}`, `.${digits(int(1, 3))}`])}${unit}`
  }
  // (a quick \pgfmathsetlength, +, takes a dimension only)
  const expr = () => pick([len, len, len, () => `+${len()}`, () => `${len()}+${len()}`, () => `2*${len()}`])()
  const value = () => pick(["0", "1", ".5", "0.25", `0.${digits(int(1, 4))}`, "1.0"])
  const named = () => pick(["red", "blue", "green!50", "red!30!blue", "black", "white", "gray", "mine", "dark", "mid", "dark!25!red", "-red", "ca", "cb", "ca!40", "cb!20!black"])
  const stop = () => {
    const pos = expr()
    return pick([() => `rgb(${pos})=(${value()},${value()},${value()})`, () => `gray(${pos})=(${value()})`, () => `color(${pos})=(${named()})`])()
  }
  const point = () => pick(["\\pgfpointorigin", `\\pgfpoint{${len()}}{${len()}}`, `\\pgfpoint{-0.1849315ex}{.2260273ex}`])
  const names = ["s0", "s1", "s2"]
  const declare = (name: string) => {
    const kind = pick(["horizontal", "vertical", "radial"])
    const deps = pick(["", "", "[ca]", "[ca,cb]", "[cb]"])
    const stops = Array.from({ length: int(2, 5) }, stop).join(pick([";", "; ", " ; "]))
    return `\\pgfdeclare${kind}shading${deps}{${name}}{${kind === "radial" ? point() : expr()}}{${stops}}`
  }
  const path = () => pick([
    () => `\\pgfpathrectangle{\\pgfpoint{${len()}}{${len()}}}{\\pgfpoint{${len()}}{${len()}}}`,
    () => `\\pgfpathcircle{\\pgfpoint{${len()}}{${len()}}}{${len()}}`,
    () => `\\pgfpathmoveto{\\pgfpoint{${len()}}{${len()}}}\\pgfpathlineto{\\pgfpoint{${len()}}{${len()}}}`,
  ])()
  const angle = () => pick(["0", "90", "45", "-30", `${int(-360, 360)}`, `${int(0, 90)}.${digits(2)}`])
  const inPicture = (depth: number): string => {
    let out = ""
    for (let k = int(1, 5); k > 0; k--) {
      out += pick([
        () => `\\pgfuseshading{${pick(names)}}`, () => path(), () => `\\pgfshadepath{${pick(names)}}{${angle()}}`,
        () => `\\pgftransformrotate{${angle()}}`, () => `\\pgfusepath{${pick(["stroke", "fill", "discard"])}}`, () => " ",
        () => (depth < 1 ? `{${inPicture(depth + 1)}}` : ""), () => (depth < 1 ? `\\begin{pgfscope}${inPicture(depth + 1)}\\end{pgfscope}` : ""),
      ])()
    }
    return out
  }
  return Array.from({ length: n }, () => {
    let out = `\\colorlet{ca}{${pick(["red", "mine", "dark", "mid"])}}\\colorlet{cb}{${pick(["blue", "white", "dark!50"])}}`
    out += names.map(declare).join(pick(["", " "]))
    for (let k = int(1, 5); k > 0; k--) {
      out += pick([
        () => `\\pgfuseshading{${pick(names)}}`, () => `{\\pgfuseshading{${pick(names)}}}`, () => " ",
        () => `\\colorlet{${pick(["ca", "cb"])}}{${pick(["red", "blue!50", "mine", "dark", "green"])}}`,
        // (a body beginning with a brace would be the old syntax's bounding box)
        () => `\\begin{pgfpicture}\\pgftransformrotate{${angle()}}${inPicture(0)}\\end{pgfpicture}`,
      ])()
    }
    return out
  })
}

/** The snippet's commands on a driver: TeX's tokens as the snippet has them (spaces after a control word skipped). */
export function runSnippet(source: string, driver: PgfDriver, colors: Colors, text: PgfText = TEXT): void {
  let src = source
  const s = driver.state
  const a = new TexArith({ em: 0, ex: 0 }) // \nullfont's quad and x-height
  const boxes = new Map<string, LayoutBox | null>()
  // \setbox is local: the first one in a group saves the register's value for the group's end (eq_save);
  // \box empties the register without saving
  const saved: Map<string, LayoutBox | null>[] = []
  const assign = (reg: string, b: LayoutBox) => {
    const level = saved[saved.length - 1]
    if (level && !level.has(reg)) level.set(reg, boxes.get(reg) ?? null)
    boxes.set(reg, b)
  }
  // the shape keys (\pgfset), local
  let keys = SHAPE_KEYS
  const keyStack: PgfShapeKeys[] = []
  const begingroup = () => { s.begingroup(); saved.push(new Map()); keyStack.push(keys) }
  const endgroup = () => { s.endgroup(); for (const [reg, b] of saved.pop() ?? []) boxes.set(reg, b); keys = keyStack.pop() ?? keys }
  let i = 0
  const skipSpaces = () => { while (/\s/.test(src[i] ?? "")) i++ }
  const controlWord = () => {
    const m = src.slice(i).match(/^\\([A-Za-z@]+)/)
    if (!m) throw new Error(`pgf:check: no control word at ${i} in ${src}`)
    i += m[0].length
    skipSpaces()
    return m[1]
  }
  /** an undelimited argument: a braced group without its braces, or one token */
  const arg = (): string => {
    skipSpaces()
    if (src[i] === "\\") return `\\${controlWord()}`
    if (src[i] !== "{") return src[i++]
    let depth = 0
    const start = i
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++
      else if (src[i] === "}" && --depth === 0) break
    }
    return src.slice(start + 1, i++)
  }
  const dims = (k: number) => Array.from({ length: k }, () => a.dimen(arg()))
  const strs = (k: number) => Array.from({ length: k }, arg)
  /** \setbox<register>\hbox{} or \hbox{\vrule <spec>} */
  const setbox = () => {
    const reg = arg()
    if (controlWord() !== "hbox") throw new Error(`pgf:check: \\setbox${reg} takes an \\hbox`)
    const body = arg().trim()
    if (body === "") { assign(reg, hpack([])); return }
    const m = body.match(/^\\vrule((?:\s*(?:width|height|depth)\s*\S+)*)$/)
    if (!m) throw new Error(`pgf:check: box ${body}`)
    const rule: RuleNode = { kind: "rule", width: 26214, height: null, depth: null } // \vrule's default width 0.4pt
    for (const [, k, v] of m[1].matchAll(/(width|height|depth)\s*(\S+)/g)) rule[k as "width" | "height" | "depth"] = a.dimen(v)
    assign(reg, hpack([rule]))
  }
  const sys: Record<string, () => void> = {
    beginpicture: () => driver.beginPicture(), endpicture: () => driver.endPicture(),
    moveto: () => driver.moveto(...(dims(2) as [number, number])), lineto: () => driver.lineto(...(dims(2) as [number, number])),
    curveto: () => driver.curveto(...(dims(6) as [number, number, number, number, number, number])),
    rect: () => driver.rect(...(dims(4) as [number, number, number, number])), closepath: () => driver.closepath(),
    stroke: () => driver.stroke(), fill: () => driver.fill(), fillstroke: () => driver.fillstroke(),
    clipnext: () => driver.clipnext(), discardpath: () => driver.discardpath(),
    eoruletrue: () => { s.sw.eoRule = true }, eorulefalse: () => { s.sw.eoRule = false },
    transformcm: () => { const [p, q, u, v] = strs(4); const [x, y] = dims(2); driver.transformcm(p, q, u, v, x, y) },
    transformshift: () => driver.transformshift(...(dims(2) as [number, number])),
    transformxyscale: () => driver.transformxyscale(...(strs(2) as [string, string])),
    beginscope: () => driver.beginscope(), endscope: () => driver.endscope(),
    setlinewidth: () => driver.setlinewidth(dims(1)[0]),
    setdash: () => { const p = arg(); driver.setdash(p === "" ? [] : p.split(",").map((x) => a.dimen(x)), dims(1)[0]) },
    setmiterlimit: () => driver.setmiterlimit(arg()),
    buttcap: () => driver.cap("butt"), roundcap: () => driver.cap("round"), rectcap: () => driver.cap("rect"),
    miterjoin: () => driver.join("miter"), roundjoin: () => driver.join("round"), beveljoin: () => driver.join("bevel"),
    "color@reset": () => driver.colorReset(),
    "color@reset@inordertrue": () => { s.sw.colorResetInOrder = true }, "color@reset@inorderfalse": () => { s.sw.colorResetInOrder = false },
    hbox: () => { const reg = arg(); driver.hbox(boxes.get(reg) ?? null, reg.startsWith("\\")); boxes.set(reg, null) },
    begininvisible: () => driver.beginInvisible(), endinvisible: () => driver.endInvisible(),
    "begin@text": () => driver.beginText(), "end@text": () => driver.endText(),
  }
  const units = s.units
  /** a point: one of pgf's point commands and its arguments, evaluated */
  const point = (src: string): PgfPoint => {
    const m = src.trim().match(/^\\([A-Za-z]+)\s*/)
    if (!m) throw new Error(`pgf:check: point ${src}`)
    const as = texArgs(src.trim().slice(m[0].length))
    switch (m[1]) {
      case "pgfpoint": return pgfPoint(s, as[0], as[1])
      case "pgfqpoint": return { x: a.dimen(as[0]), y: a.dimen(as[1]) }
      case "pgfpointorigin": return pgfPointOrigin()
      case "pgfpointadd": return pgfPointAdd(point(as[0]), point(as[1]))
      case "pgfpointdiff": return pgfPointDiff(point(as[0]), point(as[1]))
      case "pgfpointscale": return pgfPointScale(as[0], point(as[1]), units)
      case "pgfpointpolar": return pgfPointPolar(s, as[0], as[1])
      case "pgfpointxy": return pgfPointXY(as[0], as[1], units)
      case "pgfpointtransformed": return pgfPointTransformed(s, point(as[0]))
      case "pgfpointanchor": return pgfPointAnchor(s, as[0], as[1])
      case "pgfpointshapeborder": return pgfPointShapeBorder(s, as[0], pt(as[1]))
      case "pgfpointnormalised": return pgfPointNormalised(point(as[0]), units)
      case "pgfpointborderrectangle": { const c = point(as[1]); return pgfPointBorderRectangle(point(as[0]), c) }
      case "pgfpointborderellipse": { const c = point(as[1]); return pgfPointBorderEllipse(pt(as[0]), c, units) }
    }
    throw new Error(`pgf:check: unknown point \\${m[1]}`)
  }
  /** a point argument: the macro, evaluated by the command */
  const pt = (src: string) => () => point(src)
  const environments: Record<string, [() => void, () => void]> = {
    // \pgfutil@ifnextchar skips the spaces; a brace begins the old syntax's bounding box
    pgfpicture: [() => { skipSpaces(); beginPgfPicture(s, driver, xcolor.normal, src[i] === "{" ? strs(4) as [string, string, string, string] : undefined) }, () => endPgfPicture(s, driver)],
    pgfscope: [() => beginPgfScope(s, driver), () => endPgfScope(s, driver)],
  }
  const environment = (k: 0 | 1) => {
    const name = arg()
    const e = environments[name]
    if (!e) throw new Error(`pgf:check: environment ${name}`)
    if (k === 0) keyStack.push(keys)
    e[k]()
    if (k === 1) keys = keyStack.pop() ?? keys
  }
  /** \pgfdeclare…shading[deps]{name}{size}{spec} (\pgfutil@ifnextchar skips the spaces) */
  const declare = (kind: "horizontal" | "vertical" | "radial") => {
    skipSpaces()
    let deps = ""
    if (src[i] === "[") { const j = src.indexOf("]", i); deps = src.slice(i + 1, j); i = j + 1 }
    const name = arg()
    const size = kind === "radial" ? pt(arg()) : arg()
    pgfDeclareShading(s, driver, kind, deps, name, size, arg(), colors)
  }
  /** pgf's basic layer; the commands ending in \ignorespaces skip the spaces after them */
  const ignoring = (f: () => void) => () => { f(); skipSpaces() }
  const basic: Record<string, () => void> = {
    begin: () => environment(0), end: () => environment(1),
    pgfpathmoveto: () => pgfPathMoveTo(s, pt(arg())), pgfpathlineto: () => pgfPathLineTo(s, pt(arg())),
    pgfpathcurveto: () => pgfPathCurveTo(s, pt(arg()), pt(arg()), pt(arg())), pgfpathclose: () => pgfPathClose(s),
    pgfpathrectangle: () => pgfPathRectangle(s, pt(arg()), pt(arg())),
    pgfpathrectanglecorners: () => pgfPathRectangleCorners(s, pt(arg()), pt(arg())),
    pgfpathcircle: () => { const c = pt(arg()); pgfPathCircle(s, c, arg()) },
    pgfpathellipse: () => pgfPathEllipse(s, pt(arg()), pt(arg()), pt(arg())),
    pgfusepath: ignoring(() => pgfUsePath(s, driver, arg().split(",").map((k) => k.trim()).filter((k) => k !== ""))),
    pgftransformshift: () => pgfTransformShift(s, pt(arg())),
    pgftransformxshift: () => pgfTransformXShift(s, arg()), pgftransformyshift: () => pgfTransformYShift(s, arg()),
    pgftransformscale: () => pgfTransformScale(s, arg()),
    pgftransformxscale: () => pgfTransformXScale(s, arg()), pgftransformyscale: () => pgfTransformYScale(s, arg()),
    pgftransformxslant: () => pgfTransformXSlant(s, arg()), pgftransformyslant: () => pgfTransformYSlant(s, arg()),
    pgftransformrotate: () => pgfTransformRotate(s, arg()),
    pgftransformcm: () => { const [p, q, u, v] = strs(4); pgfTransformCm(s, p, q, u, v, pt(arg())) },
    pgftransformreset: () => pgfTransformReset(s), pgftransformresetnontranslations: () => pgfTransformResetNonTranslations(s),
    pgflowlevelsynccm: () => pgfLowLevelSyncCm(s, driver),
    pgfsetcornersarced: () => pgfSetCornersArced(s, pt(arg())),
    pgfdeclarehorizontalshading: () => declare("horizontal"), pgfdeclareverticalshading: () => declare("vertical"), pgfdeclareradialshading: () => declare("radial"),
    pgfuseshading: () => pgfUseShading(s, driver, arg(), colors),
    pgfshadepath: () => pgfShadePath(s, driver, arg(), arg(), colors),
    colorlet: () => { const name = arg(); const [model, ...v] = colors.spec(arg()).split(" "); colors.define(name, model, v.join(",")) },
    pgfsetbaseline: () => pgfSetBaseline(s, arg()), pgfsettrimleft: () => pgfSetTrimLeft(s, arg()), pgfsettrimright: () => pgfSetTrimRight(s, arg()),
    pgfsetlinewidth: ignoring(() => pgfSetLineWidth(s, driver, arg())),
    pgfsetdash: ignoring(() => { const pattern = texArgs(arg()); pgfSetDash(s, driver, pattern, arg()) }),
    pgfsetmiterlimit: ignoring(() => pgfSetMiterLimit(s, driver, arg())),
    pgfsetbuttcap: ignoring(() => driver.cap("butt")), pgfsetroundcap: ignoring(() => driver.cap("round")), pgfsetrectcap: ignoring(() => driver.cap("rect")),
    pgfsetmiterjoin: ignoring(() => driver.join("miter")), pgfsetroundjoin: ignoring(() => driver.join("round")), pgfsetbeveljoin: ignoring(() => driver.join("bevel")),
    pgfseteorule: ignoring(() => { s.sw.eoRule = true }), pgfsetnonzerorule: ignoring(() => { s.sw.eoRule = false }),
    pgfnode: () => { const [shape, anchor, t, name, use] = strs(5); pgfNode(s, driver, text, shape, anchor, t, name, () => exec(use), keys) },
    pgfmultipartnode: () => {
      const [shape, anchor, name, use] = strs(4)
      pgfMultipartNode(s, driver, shape, anchor, name, () => exec(use), keys, boxes.get("\\pgfnodeparttextbox") ?? null)
      boxes.set("\\pgfnodeparttextbox", null)
    },
    pgfcoordinate: () => { const name = arg(); pgfCoordinate(s, name, pt(arg())) },
    pgftext: () => {
      skipSpaces()
      const options: PgfTextOption[] = []
      if (src[i] === "[") {
        const end = src.indexOf("]", i)
        for (const o of splitKeys(src.slice(i + 1, end))) {
          const [k, v] = o
          if (k === "at") options.push(["at", pt(v)])
          else if (k === "x" || k === "y" || k === "rotate") options.push([k, v])
          else options.push([k as "left"])
        }
        i = end + 1
      }
      pgfText(s, driver, text, options, arg())
      skipSpaces() // (\pgf@collectresetcolor's \pgfutil@ifnextchar)
    },
    pgfset: () => { keys = setKeys(keys, arg()) },
    pgfsetarrowsstart: () => pgfSetArrowsStart(s, arg()), pgfsetarrowsend: () => pgfSetArrowsEnd(s, arg()), pgfsetarrows: () => pgfSetArrows(s, arg()),
    pgfsetshortenstart: ignoring(() => pgfSetShortenStart(s, arg())), pgfsetshortenend: ignoring(() => pgfSetShortenEnd(s, arg())),
  }
  const commands: Record<string, () => void> = {
    ...basic, begingroup, endgroup, setbox,
    "pgfsysprotocol@bufferedtrue": () => { s.sw.buffered = true }, "pgfsysprotocol@bufferedfalse": () => { s.sw.buffered = false },
    "pgfsysprotocol@flushcurrentprotocol": () => driver.flush(),
    pgfsetstrokecolor: () => { const e = arg(); pgfSetStrokeColor(driver, colors.spec(e), isColorName(e)) },
    pgfsetfillcolor: () => { const e = arg(); pgfSetFillColor(driver, colors.spec(e), isColorName(e)) },
    pgfsetcolor: () => { const e = arg(); pgfSetColor(driver, colors.spec(e), isColorName(e)) },
  }
  const exec = (code: string) => {
    const [outerSrc, outerI] = [src, i]
    src = code
    i = 0
    run()
    src = outerSrc
    i = outerI
  }
  const run = () => { while (i < src.length) {
    const c = src[i]
    if (c === "{") { begingroup(); i++; continue }
    if (c === "}") { endgroup(); i++; continue }
    if (/\s/.test(c)) { s.space(); skipSpaces(); continue }
    const name = controlWord()
    const m = name.match(/^pgfsys@color@(rgb|cmyk|cmy|gray)(?:@(stroke|fill))?$/)
    if (m) { const model = m[1] as ColorModel; driver.color(model, (m[2] ?? "both") as "stroke" | "fill" | "both", strs(model === "gray" ? 1 : model === "cmyk" ? 4 : 3)); continue }
    const f = name.startsWith("pgfsys@") ? sys[name.slice(7)] : commands[name]
    if (!f) throw new Error(`pgf:check: unknown command \\${name}`)
    f()
  } }
  run()
}

/** `key=value` pairs separated by commas outside braces, the values without their outer braces */
function splitKeys(list: string): [string, string][] {
  const out: [string, string][] = []
  let depth = 0, start = 0
  const push = (item: string) => {
    if (!item.trim()) return
    const eq = item.indexOf("=")
    const k = (eq < 0 ? item : item.slice(0, eq)).trim(), v = eq < 0 ? "" : item.slice(eq + 1).trim()
    out.push([k, v.startsWith("{") && v.endsWith("}") ? v.slice(1, -1) : v])
  }
  for (let j = 0; j < list.length; j++) {
    if (list[j] === "{") depth++
    else if (list[j] === "}") depth--
    else if (list[j] === "," && depth === 0) { push(list.slice(start, j)); start = j + 1 }
  }
  push(list.slice(start))
  return out
}

/** \pgfset{…} of the shape keys (pgfmoduleshapes.code.tex 898–906) */
function setKeys(keys: PgfShapeKeys, list: string): PgfShapeKeys {
  const k = { ...keys }
  for (const [name, v] of splitKeys(list)) {
    switch (name) {
      case "inner xsep": k.innerXSep = v; break
      case "inner ysep": k.innerYSep = v; break
      case "inner sep": k.innerXSep = v; k.innerYSep = v; break
      case "outer xsep": k.outerXSep = v; break
      case "outer ysep": k.outerYSep = v; break
      case "outer sep": k.outerXSep = v; k.outerYSep = v; break
      case "minimum width": k.minimumWidth = v; break
      case "minimum height": k.minimumHeight = v; break
      case "minimum size": k.minimumWidth = v; k.minimumHeight = v; break
      default: throw new Error(`pgf:check: key ${name}`)
    }
  }
  return k
}

/** a node's text as the engine typesets it: article's \normalfont at 10pt */
const TEXT: PgfText = { hlist: (src) => hlistInput(src, classData("article", "10pt"), "normalsize", { footnote: 0 }, { enc: "OT1", fam: "cmr", ser: "m", shape: "n" }) }

/** TeX's box for each snippet (or its error), from one run per target, cached while the snippets stay the same */
function texBoxes(t: Target, snippets: string[]): (BoxNode | string)[] {
  mkdirSync(DIR, { recursive: true })
  const tex = [
    "\\documentclass{article}", "\\usepackage{tikz}", "\\usetikzlibrary{arrows.meta}", "\\newbox\\pgfcheckbox", ...COLORS.map(([n, m, v]) => `\\definecolor{${n}}{${m}}{${v}}`),
    "\\showboxdepth=100 \\showboxbreadth=100000", "\\begin{document}", "\\makeatletter",
    // (each snippet instantiates its arrow tips afresh, as the engine does)
    "\\let\\pgfcheck@fullname\\pgf@arrow@fullname\\def\\pgf@arrow@fullname#1{\\pgfcheckn @\\pgfcheck@fullname{#1}}",
    // (the protocol and the last moveto are global: what one snippet leaves must not reach the next)
    ...snippets.map((x, i) => `\\immediate\\write16{C:${i}}\\global\\let\\pgfsysprotocol@currentprotocol\\pgfutil@empty\\gdef\\pgfsyssoftpath@lastmoveto{{0pt}{0pt}}\\def\\pgfcheckn{${i}}\\setbox0\\hbox{\\nullfont ${x}}\\showbox0`), "\\end{document}", "",
  ].join("\n")
  const file = join(DIR, `${t.name}.tex`), log = join(DIR, `${t.name}.log`)
  if (!existsSync(file) || readFileSync(file, "utf8") !== tex || !existsSync(log) || !/^(No pages of output|Output written)/m.test(readFileSync(log, "latin1"))) {
    writeFileSync(file, tex)
    const run = spawnSync(t.program, ["-interaction=nonstopmode", `${t.name}.tex`], { cwd: DIR, env: texEnv({ max_print_line: "100000" }), stdio: "ignore", timeout: 600_000 })
    if (run.error) throw run.error
  }
  const out: (BoxNode | string)[] = []
  const lines = readFileSync(log, "latin1").split("\n")
  let cur = -1
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^C:(\d+)$/)
    if (m) { cur = Number(m[1]); continue }
    if (cur < 0) continue
    if (lines[i] === "> \\box0=") { const { box, end } = parseBoxDump(lines, i + 1); if (out[cur] === undefined) out[cur] = box; i = end; continue }
    if (lines[i].startsWith("! ") && lines[i] !== "! OK.") out[cur] = `TeX error: ${lines[i].slice(2)}`
  }
  return out
}

export function pgfCheck(n: number, seed: number): number {
  const f = loadFont(dataFont("cmr10"), 10 * UNITY) // \pgfmath@selectfont: the document's \normalfont
  const units: PgfUnits = { em: f.params[QUAD], ex: f.params[X_HEIGHT] }
  const snippets = [...FIXED, ...PICTURES.map((body) => `\\begin{pgfpicture}${body}\\end{pgfpicture}`), ...SHADINGS, ...makeSnippets(n, seed), ...makePictures(n, seed), ...makeNodes(n, seed), ...makeArrows(n, seed), ...makeShadings(Math.ceil(n / 4), seed)]
  let failed = 0
  for (const t of TARGETS) {
    const tex = texBoxes(t, snippets)
    let same = 0, refused = 0
    snippets.forEach((src, i) => {
      const expected = tex[i]
      if (expected === undefined) throw new Error(`TeX showed no box for snippet ${i} (${DIR}/${t.name}.log)`)
      let problem: string
      try {
        const state = new PgfState(units)
        pgfArrowsMeta(state)
        const colors = new Colors()
        for (const [name, model, values] of COLORS) colors.define(name, model, values)
        runSnippet(src, t.driver(state), colors)
        if (typeof expected === "string") problem = `${expected}\n    engine: no error`
        else {
          const d = compareBoxLists([expected], [emitBoxes(hpack(state.out))])
          if (!d) { same++; return }
          problem = `${d.path} ${d.field}\n    TeX:    ${JSON.stringify(d.expected)}\n    engine: ${JSON.stringify(d.actual)}`
        }
      } catch (e) {
        // what TeX stops at with an error (a dimension too large), the engine refuses
        if (typeof expected === "string" && e instanceof Unsupported) { same++; refused++; return }
        problem = `${typeof expected === "string" ? `${expected}\n    ` : ""}engine: ${(e as Error).message}`
      }
      failed++
      if (failed <= 10) console.log(`✗ [${t.name}] ${src}\n    ${problem}`)
    })
    console.log(`${same}/${snippets.length} pgf snippets identical to TeX under ${t.name} (seed ${seed})${refused ? `, ${refused} of them TeX errors the engine refuses` : ""}`)
  }
  return failed ? 1 : 0
}
