// TikZ oracle (#309): whole tikzpictures (and \tikz) typeset by TeX as `\setbox0\hbox{<picture>}\showbox0`
// with tikz loaded, by latex (pgf's dvips driver) and by pdflatex (its pdftex driver), and through
// tikz/path.ts on pgf/ for each. The box dumps must agree node by node: the picture's box and its size and
// shift, every \special's and \pdfliteral's text, every space TikZ's macros leave. Fixed pictures cover each
// path command, operation, coordinate kind and option, then seeded random pictures: paths of random
// operations and coordinates under random options, transformations, scopes and groups. What TeX stops at
// with an error must be the engine's Unsupported.
//   bun engine tikz:check [--n 1000] [--seed 1]

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { emitBoxes } from "../../emit/boxes"
import { UNITY } from "../../layout/arith"
import { loadFont, QUAD, X_HEIGHT } from "../../layout/font"
import { hpack } from "../../layout/pack"
import type { Node } from "../../layout/nodes"
import { classData } from "../../latex/classes"
import { pdftexColors } from "../../latex/pdftex"
import { Unsupported } from "../../latex/unsupported"
import { Colors, xcolor } from "../../latex/xcolor"
import { DvipsDriver } from "../../pgf/drivers/dvips"
import { PdftexDriver } from "../../pgf/drivers/pdftex"
import type { PgfDriver } from "../../pgf/drivers"
import type { PgfUnits } from "../../pgf/mathparser"
import { PgfState } from "../../pgf/state"
import { TikzDocument, type TikzText } from "../../tikz/path"
import { nodeBaselines, nodeHlist, nodeMinipage, nodeUnits } from "../../latex/tikz"
import { compareBoxLists, type BoxNode } from "../../trace/schema"
import { dataFont } from "../fonts"
import { texEnv } from "../tex"
import { parseBoxDump } from "./boxes"

const DIR = ".cache/tikzcheck"
/** the colours both sides define first */
const COLORS: [string, string, string][] = [["mine", "HTML", "3A7FC0"], ["dark", "rgb", "0.1,0.2,0.3"], ["ink", "cmyk", "0.5,0,.25,1"], ["mid", "gray", "0.4"]]

interface Target { name: string; program: string; driver: (s: PgfState) => PgfDriver }
const TARGETS: Target[] = [
  { name: "dvips", program: "latex", driver: (s) => new DvipsDriver(s) },
  { name: "pdftex", program: "pdflatex", driver: (s) => new PdftexDriver(s) },
]

const pic = (body: string, options = "") => `\\begin{tikzpicture}${options}${body}\\end{tikzpicture}`

/** Each command, operation, coordinate and option; scopes, groups, \tikz. */
const FIXED = [
  pic(""),
  pic("\n\\draw (0,0) -- (1,0);\n"),
  pic("\\draw (0,0) rectangle (1,1);"),
  pic("\\draw[red] (0,0) circle (1);"),
  pic("\\draw[draw=red,thick] (0,0) -- (1,0) to (2,1);"),
  pic("\\draw (0,0) -- ++(1,0) -- +(0,1) -- cycle (3,0) ellipse (1 and 2);"),
  pic("\\draw (0,0) -| (1,1) |- (2,2) -- (3pt,4pt) -- (1cm,2) -- (2,1cm);"),
  pic("\\draw (30:1cm) -- (0:1) -- (up:2) -- (north west:1cm and 2cm) -- (45:1 and 2);"),
  pic("\\fill (0,0) rectangle (2,1); \\filldraw[fill=blue!20] (0,0) circle (5pt); \\path (5,5);"),
  pic("\\fill[green] (0,0) -- (1,1) -- (1,0) -- cycle;"),
  pic("\\draw[thick,dashed] (0,0) -- (1,0); \\draw[dotted,line width=2pt] (0,1) -- (1,1); \\draw[dash dot] (0,2) -- (2,2);"),
  pic("\\begin{scope}[xshift=1cm,red] \\draw (0,0) -- (1,0); \\end{scope}\n\\draw (0,0) -- (0,1);"),
  pic("\\begin{scope}\\draw[rotate=30] (0,0) rectangle (1,1);\\end{scope}"),
  pic("\\draw[scale=2] (0,0) -- (1,1); \\draw[shift={(1,2)}] (0,0) -- (1,0); \\draw[xscale=-1,yshift=3pt] (0,0) -- (1,0);"),
  pic("\\clip (0,0) rectangle (2,2); \\draw (-1,-1) -- (3,3);"),
  pic("\\clip[red] (0,0) rectangle (2,2);"),
  pic("\\useasboundingbox (0,0) rectangle (1,1); \\draw (-1,-1) -- (3,3);"),
  pic("\\draw (0,0) -- (1,0) [red] -- (1,1) [line width=1pt] -- (0,1);"),
  pic("\\draw (0,0) -- (1pt, +2pt) -- ( +1pt,0pt) -- (+1, 1);"),
  pic("\\draw[draw=red,color=blue,green] (0,0) -- (1,0); \\fill[fill=red,color=blue] (0,0) circle (1pt);"),
  pic("\\draw (0,0) {coordinate (a) -- (1,0)} -- (2,0); \\draw (a) -- (0,1);"),
  pic("\\begin{scope}[scale=0.5,rotate=10] \\coordinate[yshift=1cm] (a) at (1,2); \\coordinate[xshift=2pt,rotate=5] (b) at (1,2); \\end{scope} \\draw (a) -- (b);"),
  pic("\\coordinate (a) at (1,2); \\draw[shift={(1,1)},rotate=30] (a) -- (0,0); \\draw[shift={(1,1)},xscale=2] (a) -- (0,0); \\draw[shift={(1,1)},xslant=1] (a) -- (0,0);"),
  pic("\\draw (0,0) to (1,1) to[red] (2,0);"),
  pic("\\draw (0,0) to (1,1) to +(1,0) to ++(0,1);"),
  pic("\\draw (0,0) circle[radius=2pt] (1,1) circle[x radius=1, y radius=5mm] (2,2) ellipse[radius=1cm];"),
  pic("\\draw (0,0) {-- (1,0) [red] -- (1,1)} -- (0,1);"),
  pic("\\draw[color=red] (0,0) -- (1,0); \\draw[blue,fill=red] (0,0) rectangle (1,1); \\draw[color=red,draw=blue] (0,0) -- (1,0);"),
  pic("\\draw[help lines] (0,0) -- (2,0); \\draw[very thick,gray] (0,0) -- (0,2);"),
  pic("\\draw (0,0) -- (1,0);", "[baseline=3pt]"),
  pic("\\draw (0,0) -- (1,0);", "[scale=0.5,thick]"),
  pic("\\coordinate (a) at (0,0); \\draw (a.text) -- (1,0);"),
  pic("\\tikzset{every path/.style={red}} \\draw (0,0) -- (1,0);"),
  pic("\\draw (1,2 |- 3,4) -- (1,2 -| 3,4) -- (1,2|-3,4);"),
  pic("\\draw (0,0) -- (1,0);\n\n\\draw (0,1) -- (1,1); % comment\n\\draw (0,2) -- (1,2);"),
  pic("{\\draw[red] (0,0) -- (1,0);} {\\tikzset{thick} \\draw (0,0) -- (0,1);}"),
  pic("\\coordinate (a) at (1,2);"),
  pic("\\coordinate (a) at (1,2);\\draw (a) -- (0,0) -| (1,1) |- (2,2);"),
  pic("\\coordinate (a) at (1,2); \\coordinate (b) at (30:1cm); \\draw[rotate=30] (a) -- (b.north) -- (a |- b) -- (b -| a.center);"),
  pic("\\draw (1,2) coordinate (a) -- (3,1) coordinate (b) (0,0) coordinate[red] (c); \\draw[xshift=1cm,scale=2] (a) rectangle (b) (c) circle (1pt);"),
  pic("\\begin{scope}[rotate=20,xshift=3pt] \\coordinate (a) at (1,1); \\end{scope} \\draw[scale=0.5,yslant=0.2] (a) -- (0,0); \\draw[xscale=3] (0,0) -- (a);"),
  pic("\\path (0,0) coordinate (p) -- (2,1) coordinate (q); \\draw (p) to (q) -- +(1,0) coordinate (r) (r) -- (p);"),
  pic("\\draw[->] (0,0) -- (1,0); \\draw[<->,thick,red] (0,1) -- (2,1) -- (2,2); \\draw[-latex] (0,2) to (1,3); \\draw[-{Stealth}] (0,3) -- (1,3);"),
  pic("\\draw[-Latex,blue] (0,0) -- (1,0) -- cycle; \\draw[-To,line width=2pt] (0,2) -- (1,2); \\draw[stealth-] (0,3) -- (1,3);"),
  pic("\\draw[draw=blue,fill=green,red,->] (0,0) -- (1,0); \\draw[draw=blue,red!50,->] (0,1) -- (1,1); \\draw[draw=blue,fill=green,->] (0,2) -- (1,2);"),
  pic("\\draw[draw=red,fill=red,->] (0,0) -- (1,0); \\draw[red,fill=red,->] (0,1) -- (1,1); \\draw[draw=red!50,fill=red!50,->] (0,2) -- (1,2); \\draw[draw=red,fill=red!100,->] (0,3) -- (1,3);"),
  pic("\\draw[rounded corners] (0,0) -- (1,0) -- (1,1); \\draw[rounded corners=2mm] (2,0) rectangle (4,1) (5,0) -- (6,1) -| (7,0) -- cycle;"),
  pic("\\draw[rounded corners=3pt,->] (0,0) -| (1,1) [sharp corners] -- (2,0) [rounded corners] |- (3,3); \\begin{scope}[rounded corners=4pt] \\fill (0,2) -- (1,3) -- (2,2) -- cycle; \\end{scope}"),
  pic("\\draw[->] (1,1);"),
  pic("\\draw[->] (0,0) circle (1);"),
  pic("\\draw[->] (0,0) -- (1,0) -- cycle;"),
  pic("\\draw[->] (0,0) -| (1,1);"),
  pic("\\begin{scope}[->] \\clip (0,0) circle (1); \\end{scope}"),
  pic("\\draw[->] (0,0) -- (0,0);"),
  "\\tikz \\draw (0,0) -- (1,0);",
  "\\tikz[baseline=-0.5ex] \\draw (0,0) circle (2pt);",
  "\\tikz{\\draw (0,0) -- (1,0); \\fill (0,0) circle (1pt);}",
  "\\tikz[red]{\\draw (0,0) -- (1,0)}",
  // nodes
  pic("\\node {x};"),
  pic("\\node at (1,2) {Start}; \\node {};"),
  pic("\\node[draw] (a) {A}; \\node[draw,circle] (b) at (2,0) {B}; \\draw[->] (a) -- (b);"),
  pic("\\node (A) {Start};\n\\node (B) [right of=A] {Process};\n\\node (C) [right of=B] {End};\n\\draw[->] (A) -- (B);\n\\draw[->] (B) -- (C);", "[node distance=2cm, auto]"),
  pic("\\node (a) {Ingest};\n\\node (b) [right=of a] {Clean};\n\\node (c) [right=of b] {Model};\n\\draw[-Stealth] (a) -- (b);\n\\draw[-Stealth] (b) -- (c);", "[node distance=2cm, every node/.style={draw, rounded corners}]"),
  pic("\\draw (0,0) node {x} -- (1,0) node[above] {y}; \\draw (0,1) node[left] {L} -- (1,2) node[right] {R};"),
  pic("\\draw (0,0) -- node {m} (2,1); \\draw (0,0) -- node[midway,above] {a} node[pos=0.2,below] {b} (2,0);"),
  pic("\\draw[->] (0,0) -| node[near start] {c} (2,1); \\draw (0,0) |- node[auto] {d} (2,1) -| node[auto,swap,pos=0.7] {e} (3,-1);"),
  pic("\\draw (0,0) to node[auto,swap] {t} (2,1) to node[sloped,above] {s} (3,3); \\draw (0,0) -- node[sloped,below] {u} (-2,1);"),
  pic("\\node[draw,inner sep=2pt,minimum size=1cm] {x}; \\node[fill=red,text=blue] at (2,0) {y}; \\node[draw,anchor=north west,outer sep=3pt] at (0,0) {z};"),
  pic("\\node[draw] (a) {A}; \\node[draw, right of=a] (b) {B}; \\node[draw, below of=b, node distance=2cm] (c) {C}; \\draw (a) |- (c); \\draw (a) -| (c); \\draw (c) to (a.north);"),
  pic("\\node[circle,draw] (a) at (0,0) {A}; \\node[draw] (b) at (3,1) {Bb}; \\draw (a) -- (b) -- (2,-1) -- (a);"),
  pic("\\path (0,0) node[draw] (p) {P} (2,2) node[draw] (q) {Q}; \\draw[->] (p) -- (q); \\draw (p.east) -- (q.west) (p.north east) -- (q.south);"),
  pic("\\draw (0,0) rectangle node {r} (2,1); \\draw (0,0) -- (1,0) -- node {c} cycle; \\draw (0,0) -- coordinate (m) (2,0); \\fill (m) circle (1pt);"),
  pic("\\node (e) at (1,1) {}; \\draw (e) -- (0,0); \\node[red] at (0,1) {x}; \\node[draw=blue,thick,fill=green] at (1,2) {a b};"),
  pic("\\node[draw,below right=2pt and 1cm of e] {f}; \\node[draw,above=of e,on grid] {g}; \\node[draw] (e) at (1,1) {Ee};"),
  pic("\\node[draw] (a) {A}; \\node[draw,above=5mm of a] (b) {B}; \\node[draw,below left=of a] (c) {C}; \\draw[<->] (b) -- (a) -- (c);"),
  pic("\\node[draw,rotate=30] (a) {A}; \\node[draw,xshift=1cm,scale=2] at (1,1) (b) {B}; \\draw (a) -- (b);"),
  pic("\\begin{scope}[shift={(1,1)},rotate=20] \\node[draw] (a) {A}; \\node[draw,transform shape] (b) at (2,0) {B}; \\draw (a) -- (b); \\end{scope}"),
  pic("\\node[draw,rounded corners=2pt,dashed] (a) {fine}; \\node[circle,fill=blue!20,draw=red] (b) at (0,-1) {$x^2$}; \\draw[->,thick] (a) -- (b);"),
  pic("\\draw (0,0) node[coordinate] (z) {} -- (1,1); \\draw (z) -- (2,0) node[at end,above] {end} node[at start,below] {start};"),
  pic("\\node[draw] (a) at (0,0) {A}; \\draw (a) -- ++(2,1) -- (a); \\draw (a) to[red] +(0,2);"),
  pic("\\node[draw,font=\\small] (a) {Small text}; \\node[font=\\bfseries\\itshape] at (2,0) {Bold}; \\node[font=\\footnotesize,circle,draw] at (0,1) {f};"),
  pic("\\begin{scope}[draw=red] \\node[text=blue] {x}; \\node at (1,0) {y }; \\end{scope} \\node[draw,rotate=30] (r) at (1.3,-1.7) {R}; \\draw (r) |- (0,2) (r) -| (2,2);"),
  pic("\\node[draw] (a) {A}; \\node[draw,circle] (b) at (3,2) {B}; \\draw (a) -- (b) -- cycle (b) ellipse (6mm and 4mm) (a) circle (2mm) (a) rectangle (1,1); \\draw[red] (a) {-- (b)} -- (2,0);"),
  "\\tikz \\node[draw] {x};",
  "\\tikz \\draw (0,0) node {a} -- (1,0) node {b};",
  // aligned lines, text widths, node fonts
  pic("\\node[align=center] {a\\\\b}; \\node[align=right,draw] at (2,0) {ab \\\\ c\\\\[2pt] d e\\\\[-1ex] f \\\\ $x^2$ yy};"),
  pic("\\node[align=flush center,font=\\small] {one\\\\two lines\\\\}; \\node[align=flush right,font=\\footnotesize\\bfseries,circle,draw] at (2,0) {\\\\ x \\\\[1mm]};"),
  pic("\\node[align=justify,text=red,draw=blue] {a b \\\\c}; \\node[align=none] at (1,0) {a b c}; \\node[align=left] at (2,0) {a };"),
  pic("\\node[align=center,font=\\Large] {Ag\\\\ \\\\ y}; \\node[node font=\\Large\\bfseries,font=\\itshape,draw,align=center] at (4,0) {x\\\\[1ex]y};"),
  pic("\\node[draw] (a) {Long\\\\line}; \\draw (a) -- (2,1) node[right] {p\\\\q};", "[every node/.style={align=center}]"),
  pic("\\node[text width=2cm] {some longer text that breaks over lines}; \\node[draw,text width=3cm,align=center] at (3,0) {A centered node. With sentences, commas and more words here};"),
  pic("\\node[draw,text width=25mm,align=right,font=\\small] {Right aligned text in a small font here, yes.}; \\node[draw,text width=2cm,align=justify] at (3,0) {Justified text that goes on for a while to break};"),
  pic("\\node[draw,text width=2cm,align=flush center] {Flush center text that goes on}; \\node[draw,text width=2cm,align=flush left] at (3,0) {Flush left text that goes on and on}; \\node[draw,text width=2cm,align=flush right] at (6,0) {Flush right text that goes on and on};"),
  pic("\\node[draw,text width=4em,node font=\\footnotesize] {Text in a footnote size font}; \\node[draw,text width=1cm] at (2,0) {x}; \\node[draw,text width=1cm] at (3,0) {};"),
  pic("\\node[draw,text width=15mm,circle,align=center] {In a circle~here \\ and there}; \\node[draw,text width=2cm,font=\\bfseries] at (3,0) {Bold. Words: yes; extraordinarily long};"),
  pic("\\node[fill=blue,text=white,text width=2cm,align=center] {White text on blue that breaks }; \\node[text=red,text width=2cm] at (3,0) {Red text }; \\node[text=red,align=center] at (5,0) {Red\\\\text };"),
  pic("\\node[draw,text width=2cm,align=center] {Line one\\\\ line two and more words}; \\node[draw,text width=2cm,align=justify] at (3,0) {Line one\\\\ line two and more words}; \\node[draw,text width=2cm] at (6,0) {Line one \\\\ line two\\\\three};"),
  pic("\\node[node font=\\small,draw,minimum size=2em] {x}; \\node[node font=\\small,font=\\large,draw] at (1,0) {Ag};"),
  pic("\\node (a) {A}; \\node[right=1em of a,xshift=1em] (b) {B}; \\draw (a) -- node[above,node font=\\tiny] {e} (b);", "[every node/.style={node font=\\footnotesize,draw}]"),
  // \foreach
  pic("\\foreach \\x in {1,2,3} \\draw (\\x,0) -- (\\x,1); \\foreach \\x in {0,...,4} {\\draw (\\x,0) circle (2pt); \\node at (\\x,1) {\\x};}"),
  pic("\\foreach \\x in {0,0.25,...,1} \\fill (\\x,0) circle (1pt); \\foreach \\x/\\y in {1/a, 2/b,3} \\node at (\\x,0) {\\y};"),
  pic("\\foreach \\x [count=\\i] in {a,...,e} \\node at (\\i,0) {\\x}; \\foreach \\x in {1,2} \\foreach \\y in {1,...,3} \\draw[red!\\y0] (\\x,\\y) -- +(1,0);"),
  pic("\\foreach \\a [evaluate=\\a as \\b using \\a*2] in {10,20} \\draw (0,0) -- (\\a:\\b pt); \\foreach \\x in {5,3,...,-1} \\draw (\\x,0) -- (\\x,1); \\foreach \\x [count=\\n from 0] in {1, 2 ,3} {\\node at (\\n,1) {\\x};}"),
  pic("\\foreach \\p in {(0,0),(1,2)} \\draw \\p -- (3,3); \\foreach \\x in {0.1,0.2,...,0.5} \\draw (\\x,0) -- (\\x,1); \\foreach \\c in {red,blue} {\\begin{scope}[\\c] \\draw (0,0) -- (1,1); \\end{scope}}"),
  // curves, curved to paths, edges, pins, arcs, grids, coordinate options
  pic("\\draw (0,0) .. controls (1,1) and (2,1) .. (3,0); \\draw (0,0) .. controls (1,1) .. (3,0); \\draw[->] (0,0) .. controls +(1,1) and +(-1,1) .. (3,0) .. controls ++(0,-1) and (1,-1) .. cycle;"),
  pic("\\draw (0,0) .. controls (1,1) and (2,1) .. node[sloped,above] {m} (3,0) .. controls (4,-1) .. node[pos=0.2,auto] {n} (5,0); \\draw[rotate=20,fill=red,rounded corners] (1,0) -- (2,1) .. controls (3,3) .. cycle;"),
  pic("\\node[draw] (a) {A}; \\node[draw,circle] (b) at (3,1) {B}; \\draw[->] (a) .. controls (1,2) and (2,2) .. (b); \\draw (b) .. controls +(0,-1) .. (a) node[midway,below] {x};"),
  pic("\\draw (0,0) to[out=90,in=180] (2,2) to[bend left] (4,0) to[bend right=45] node[above] {x} (5,1) to[out=-30,in=200,looseness=2] (7,0);"),
  pic("\\node[draw] (a) {A}; \\node[draw,circle] (b) at (3,1) {B}; \\draw[->] (a) to[bend left] (b); \\draw[->] (b) to[out=-90,in=0] (a); \\draw (a) to[bend right=10] +(1,-2) to[out=0,in=90,min distance=2cm] (5,-2) to[in looseness=0.5,out=45] (6,0);"),
  pic("\\draw ([shift={(1,1)}]0,0) -- ([xshift=1cm,rotate=30]1,0) -- ({30}:1); \\node[draw] (a) {A}; \\draw ([yshift=2pt]a.east) -- (2,2);", "[scale=0.5]"),
  pic("\\node[draw] (a) {A}; \\node[draw] (b) at (2,1) {B}; \\draw (a) edge[->] (b) edge[bend left,red] node[above] {e} (2,-1); \\draw (0,0) edge (1,1) edge node {f} (1,-1);"),
  pic("\\node (a) {A} edge[->] (2,0); \\node[circle,draw] {C} edge[<-] +(0,1) edge (-1,-1); \\path (0,0) edge (1,0) -- (2,0); \\path[->] (a) edge (2,0) (1,1) edge[out=0,in=90] (a);", "[every edge/.style={draw,dashed}]"),
  pic("\\node[draw,pin=x] {A}; \\node[draw,circle,pin=right:r,pin={[red,pin edge={blue,thick}]30:q},pin distance=1cm] at (2,0) {A}; \\coordinate[pin=left:c] (c) at (1,1);"),
  pic("\\node[draw,pin=below:p] (a) {A}; \\draw (a) -- (2,0) node[pin=60:end] {}; \\node[draw,pin=above left:a,label=b] at (3,1) {A};", "[every pin edge/.style={->,red}]"),
  pic("\\draw (0,0) arc (0:90:1) arc (0:200:1cm) arc (90:-180:1cm and 5mm) -- (0,0); \\draw[->] (1,0) arc[start angle=0,end angle=100,radius=1];"),
  pic("\\draw (1,0) arc[start angle=30,delta angle=-75,x radius=2,y radius=1] arc[end angle=0,delta angle=45,radius=5mm] -- +(1,0); \\draw[rotate=30,rounded corners] (0,0) -- (1,0) arc (0:120:1) -- cycle; \\fill[red] (0,0) -- (1,0) arc (0:45:1) -- cycle;"),
  pic("\\draw (0,0) arc (0:90:1) node[midway] {x} node[pos=0.2,sloped] {s}; \\draw (1,0) arc (0:200:1cm and 5mm) node[near end,auto] {y} node[pos=0,above,sloped] {z} coordinate (c) arc (0:30:1);"),
  pic("\\draw[rotate=20] (1,0) arc[start angle=30,delta angle=-75,x radius=2,y radius=1] node[at end,sloped,below] {e} arc (0:-90:1pt) node[midway,right] {f};"),
  pic("\\draw (0,0) grid (2,2); \\draw[step=0.5] (-1,-1) grid (1.2,1.3); \\draw[help lines,step=5mm] (0,0) grid (3,2) (4,1) grid[xstep=1cm,ystep=2mm] (3,0); \\draw[rotate=30,step=0.7] (0.3,0.3) grid (2,2);"),
  // calc, vectors, caps, joins, opacity
  pic("\\draw ($(0,0)+(1,0)$) -- ($(1,1)!0.5!(3,2)$) -- ($2*(1,0)-(0,1)$) -- ($(0,0)!.3!-20:(2,2)$) -- ([xshift=2pt]$(1,1)+(0,1)$);"),
  pic("\\node[draw] (a) {A}; \\node[draw] (b) at (3,1) {B}; \\draw ($(a)!.25!(b)$) circle (2pt) ($(a.east)!1cm!(b.west)$) circle (1pt) ($(a)!(1,2)!(b)$) -- (1,2) ($(a)!0.5!30:(b)$) -- (a); \\draw[->] ($(a.north)+(0,0.5)$) -- ($(b)+.5*(1,1)$);"),
  pic("\\draw (0,0) -- (1,1) -- (2,0) circle (1) (0,0) grid (2,2); \\draw (30:1) -- (0,0) arc (0:90:1); \\node[right=of {(1,1)}] {x};", "[x=2cm,y=0.5cm]"),
  pic("\\draw (0,0) -- (1,1) -- (2,0); \\node[right=1 of {(1,1)}] {x};", "[x={(1cm,0.5cm)},y={(0cm,1cm)}]"),
  pic("\\draw (0,0) rectangle (1,1); \\draw[x=5mm] (0,0) -- (3,0); \\begin{scope}[y=2] \\draw (0,0) -- (0,1); \\end{scope}", "[scale=2,x=1.5cm]"),
  pic("\\draw[line cap=round,line join=bevel,line width=3pt] (0,0) -- (1,1) -- (2,0); \\draw[line cap=rect,line join=miter,miter limit=4] (0,1) -- (1,2) -- (2,1);"),
  pic("\\fill[red,opacity=0.5] (0,0) circle (1); \\filldraw[fill=blue,fill opacity=0.3,draw opacity=0.7] (0,0) rectangle (1,1); \\fill[semitransparent,green] (2,0) circle (1); \\node[draw,fill=red,fill opacity=0.2] at (3,0) {x};"),
  pic("\\draw (0,0) -- (1,1);", "[nearly transparent]"),
  // plots, marks, ellipses
  pic("\\draw plot coordinates {(0,0) (1,1) (2,0.5) (3,1.5)}; \\draw (0,0) -- plot coordinates {(1,1) (2,0.5)} -- (3,0); \\draw[domain=0:2,samples=10] plot (\\x,{\\x*\\x/2});"),
  pic("\\draw[red,thick,domain=-1:1] plot (\\x,{sin(\\x r)}); \\draw plot[domain=0:360,samples=37] ({cos(\\x)},{sin(\\x)}) -- cycle; \\draw[variable=\\t,domain=0:1,samples=5] plot (\\t,{exp(\\t)}) node[right] {e};"),
  pic("\\draw plot[samples at={0,0.5,...,2}] (\\x,\\x/2); \\draw plot[mark=*] coordinates {(0,0) (1,1) (2,0.5)}; \\draw[blue] plot[mark=x,mark size=3pt] coordinates {(0,0) (1,1)} -- (2,0) plot[mark=+,only marks] coordinates {(3,0) (3,1)};"),
  pic("\\draw[domain=0:2,samples=5,mark=o,mark options={red,scale=1.5}] plot (\\x,{\\x*\\x/2}); \\draw[mark=*] plot coordinates {(0,0) (1,1)} node[above] {n};"),
  pic("\\node[ellipse,draw] {Ellipse text}; \\node[ellipse,draw,fill=red!20,minimum height=1cm] (a) at (0,-1) {A}; \\node[ellipse,draw] (b) at (3,1) {Bb}; \\draw[->] (a) -- (b);"),
  pic("\\node[ellipse,draw] (a) {A}; \\node[ellipse,draw] (b) at (3,1) {Bb}; \\draw (a.north) -- (b.south west) (a.east) -- (b.mid west) (a.base east) -- (b.30) (a.north east) |- (b.south) (a.west) -- (a.south east) (b.mid east) -- (b.base west) (b.north west) -- (b.east);"),
  pic("\\node[ellipse,draw,inner sep=1pt,outer sep=2pt,label=above:l] (e) {$x^2$} edge[bend left,->] +(2,0);"),
  // labels
  pic("\\node[draw,label=x] {A}; \\node[draw,label=right:x,label=below left:{$y$}] at (2,0) {A};"),
  pic("\\node[circle,draw,label={[red,font=\\small]30:lab},label=center:c] at (1,2) {Abc}; \\node[draw,label distance=3pt,label=left:x,label={[label distance=1mm]-45:q}] {A};"),
  pic("\\node[draw,label=north:N,label=:X] (a) {A}; \\draw (a) -- (2,0) node[label=above:e] {}; \\coordinate[label=below:c] (c) at (1,1); \\draw (c) -- (a);", "[every label/.style={draw,blue}]"),
  pic("\\draw (0,0) -- node[label=above:mid] {m} (2,0) -- (2,2) node[draw,label=right:end] {E}; \\draw (0,0) node[label=x] {} -- (1,1) node[draw,label={[anchor=west]east:w}] {} |- (3,3);"),
  pic("\\node[draw,label=above:x] {A}; \\node[draw,label=right:r,transform shape] at (2,0) {B}; \\node[draw,label={above:a:b},label position=below,label=d] at (4,0) {C};", "[rotate=30]"),
]

/** What TeX typesets but the engine does not model yet: it must refuse each. */
const REFUSED = [
  pic("\\draw let \\p1=(1,0) in (\\p1) -- (0,0);"), pic("\\draw plot[smooth] coordinates {(0,0) (1,1) (2,0)};"), pic("\\draw plot[mark=square] coordinates {(0,0)};"), pic("\\node[diamond] {x};"), pic("\\node[text opacity=0.5] {x};"), pic("\\node[draw,label={[absolute]x}] {A};"),
  pic("\\foreach \\x in \\list \\draw (\\x,0) -- (0,0);"), pic("\\draw (0,0) foreach \\x in {1,2} {-- (\\x,1)};"),
  pic("\\draw (0,0) .. (2,0);"), pic("\\draw (0,0) -- (1,0,1);"), pic("\\draw[line cap=square] (0,0) -- (1,0);"),
  pic("\\draw (0,0) -- (1,0);", "[baseline=(current bounding box.center)]"), pic("\\draw[red] (0,0) -- (1,0) [.] -- (0,1);"),
  pic("\\draw (0,0) -- (b);"), pic("\\draw[|->] (0,1) -- (1,1);"), pic("\\draw (0,0) parabola (1,1);"), pic("\\draw (0,0) sin (1,1);"), pic("\\draw[step=(1,1)] (0,0) grid (1,1);"),
  pic("\\node[text depth=1ex] {x};"),
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

/** Random pictures: paths of random operations and coordinates under random options, scopes and groups. */
export function makePictures(n: number, seed: number): string[] {
  const r = rng(seed * 7919 + 29)
  const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)]
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))
  const digits = (k: number) => Array.from({ length: k }, () => String(int(0, 9))).join("")
  const num = () => `${pick(["", "", "-"])}${pick([String(int(0, 3)), `${int(0, 2)}.${digits(int(1, 3))}`, `.${digits(int(1, 2))}`])}`
  const len = () => `${num()}${pick(["pt", "cm", "mm", "em", "ex", "bp", "in"])}`
  const sp = () => pick(["", "", "", " "])
  return Array.from({ length: n }, (_, k) => {
    // the coordinates named by the paths so far, and by the current path (their names the picture's own:
    // TeX's are global and outlive a picture)
    const names: string[] = [], pending: string[] = []
    const coord = (): string => pick([
      () => `(${sp()}${num()},${sp()}${num()}${sp()})`, () => `(${num()},${num()})`, () => `(${len()},${len()})`, () => `(${len()},${num()})`, () => `(${num()},${len()})`,
      () => `(${int(-180, 360)}:${pick([num, len])()})`, () => `(${int(0, 90)}:${num()} and ${num()})`, () => `(${pick(["up", "down", "left", "right", "north east", "south west"])}:${len()})`,
      () => `(${num()},${num()} |- ${num()},${num()})`, () => `(${num()},${num()}-|${num()},${num()})`,
      () => (names.length ? `(${pick(names)}${pick(["", "", ".center", ".north", " |- 1,1", " -| 0,2"])})` : `(${num()},${num()})`),
    ])()
    const target = () => pick([coord, coord, coord, () => `+${coord()}`, () => `++${coord()}`])()
    const color = () => pick(["red", "blue!30", "green!50!black", "mine", "dark", "ink", "mid", "gray", "cyan", "."])
    const transform = () => pick([`xshift=${len()}`, `yshift=${len()}`, `scale=${pick(["2", "0.5", "1.5", "-1"])}`, `rotate=${int(-90, 90)}`, `xscale=${pick(["2", "0.5"])}`,
      `shift={(${num()},${num()})}`, `xslant=${pick(["0.5", "-1", "0.2"])}`, `yslant=${pick(["0.3", "1"])}`])
    const option = () => pick([
      () => pick(["thick", "thin", "very thick", "ultra thin", "semithick", `line width=${int(0, 3)}.${digits(1)}pt`, "help lines"]),
      () => pick(["dashed", "dotted", "densely dotted", "loosely dashed", "dash dot", "solid", "dash pattern=on 2pt off 1pt", "dash phase=1pt"]),
      () => pick([`draw=${color()}`, `fill=${color()}`, `color=${color()}`, color().replace(".", "red"), "draw", "fill", "draw=none", "fill=none"]),
      transform,
      () => pick(["rounded corners", "rounded corners=2pt", "rounded corners=1mm", "sharp corners"]),
      () => pick(["->", "<-", "<->", "-latex", "-stealth", "-{Stealth}", "-Latex", "-To", "->>", "arrows=-to"]),
      () => pick(["line cap=round", "line join=bevel", "line cap=rect,line join=round", "opacity=0.5", "fill opacity=0.3", "draw opacity=.8", "semitransparent", "miter limit=2"]),
      () => pick(["x=2cm", "y=5mm", "x={(1cm,0.2cm)}", "y=0.5"]),
    ])()
    const options = () => (r() < 0.5 ? "" : `[${Array.from({ length: int(1, 3) }, option).join(",")}]`)
    const name = () => { const x = `${pick(["a", "b", "c", "p", "q"])}${k}`; pending.push(x); return x }
    // nodes: their text, options (shape, sizes, colors, placement, a label's position, positioning) and names
    const nodeText = () => pick(["x", "Ab", "$y$", "a b", "", "fi", "Some words, in a line."])
    const nodeOption = () => pick([
      () => pick(["draw", "fill=red!20", "circle", "rectangle", "ellipse", "inner sep=2pt", "minimum size=5mm", "minimum width=1cm", "outer sep=1pt", "rounded corners", "thick", "red", "text=blue", "draw=mine", "font=\\small", "font=\\bfseries"]),
      () => pick(["anchor=north", "anchor=south west", "anchor=30", "above", "below left", "right=2pt", "left=1mm", "above right=3pt and 1pt"]),
      () => pick(["pos=0.3", "near end", "near start", "midway", "at end", "sloped", "auto", "auto,swap", "transform shape"]),
      () => pick(["align=center", "align=left", "align=flush right", "text width=1cm", "text width=15mm,align=center", "node font=\\small", "node font=\\large\\itshape",
        "label=l", "label=below:{$z$}", "label={[red]30:q}", "label=center:c", "label distance=2pt,label=left:m", "label={[draw]south east:se}", "pin=above:p", "pin={[pin edge={red}]-30:q}"]),
      transform,
      () => (names.length ? pick([`right=of ${pick(names)}`, `below=2mm of ${pick(names)}`, `right of=${pick(names)}`, `above left=of ${pick(names)}`]) : "draw"),
    ])()
    const nodeOptions = () => (r() < 0.3 ? "" : `[${Array.from({ length: int(1, 3) }, nodeOption).join(",")}]`)
    // (\\ only where lines are set: align= or a text width; elsewhere it is LaTeX's error in a paragraph)
    const node = () => { const o = nodeOptions(); return `node${o}${r() < 0.3 ? ` (${name()})` : ""} {${/align|text width/.test(o) && r() < 0.5 ? "a\\\\b" : nodeText()}}` }
    const operation = (): string => pick([
      () => ` -- ${target()}`, () => ` -- ${target()}`, () => ` -| ${coord()}`, () => ` |- ${coord()}`, () => ` rectangle ${target()}`,
      () => ` circle (${pick([len, num])()})`, () => ` ellipse (${num()} and ${num()})`, () => ` circle[radius=${pick([len, num])()}${r() < 0.3 ? `,${transform()}` : ""}]`,
      () => " -- cycle", () => ` to${r() < 0.2 ? `[${option()}]` : ""} ${target()}`, () => ` ${coord()}`, () => ` [${option()}]`,
      () => ` coordinate${r() < 0.2 ? `[${transform()}]` : ""} (${name()})`, () => ` {[${option()}] -- ${target()}}`,
      () => ` ${node()}`, () => ` -- ${node()} ${target()}`, () => ` ${pick(["-|", "|-"])} ${node()} ${coord()}`, () => ` to ${node()} ${target()}`,
      () => ` -- coordinate (${name()}) ${target()}`, () => ` rectangle ${node()} ${target()}`,
      () => ` .. controls ${coord()}${r() < 0.5 ? ` and ${target()}` : ""} .. ${r() < 0.3 ? `${node()} ` : ""}${coord()}`,
      () => ` to[${pick(["out=90,in=180", "bend left", "bend right=20", "out=-30,in=200,looseness=1.5", "bend left,looseness=0.7"])}] ${r() < 0.3 ? `${node()} ` : ""}${target()}`,
      () => ` edge${r() < 0.5 ? `[${pick(["->", "bend left", "red,dashed", "out=0,in=90"])}]` : ""} ${r() < 0.3 ? `${node()} ` : ""}${coord()}`,
      () => ` arc (${int(-180, 180)}:${int(-180, 360)}:${pick([num, len])()})`, () => ` arc[start angle=${int(0, 90)},delta angle=${int(-200, 200)},radius=${pick([num, len])()}]`,
      () => ` grid${r() < 0.3 ? `[step=${pick(["0.5", "3mm", "1"])}]` : ""} (${int(-2, 3)}${pick(["", ".5"])},${int(-2, 3)})`,
      () => ` -- ($${coord()}${pick(["+", "-", "+.5*"])}${coord()}$)`, () => ` -- ($${coord()}!${pick(["0.3", ".5", "1cm", "-0.2"])}!${pick(["", "30:"])}${coord()}$)`,
      () => ` -- ($${coord()}!${coord()}!${coord()}$)`, () => ` -- ([${transform()}]${coord().slice(1)}`,
      () => ` ${pick(["", "-- "])}plot${pick(["", "[mark=*]", "[mark=x,mark size=1pt]", "[only marks,mark=o]"])} coordinates {${coord()} ${coord()}${r() < 0.5 ? ` ${coord()}` : ""}}`,
      () => ` ${pick(["", "-- "])}plot[domain=${int(-2, 0)}:${int(1, 3)},samples=${int(2, 9)}${pick(["", ",mark=+"])}] (\\x,{${pick(["\\x*\\x/3", "sin(\\x r)", "0.5*\\x", "exp(\\x/4)"])}})`,
    ])()
    const path = () => {
      names.push(...pending.splice(0))
      if (r() < 0.12) return `\\coordinate${r() < 0.2 ? `[${transform()}]` : ""} (${name()}) at ${target()};`
      if (r() < 0.12) return `\\node${nodeOptions()} (${name()}) at ${target()} {${nodeText()}};`
      // (a clipping path takes no options: TeX's error, kept to the fixed pictures)
      const cmd = pick(["\\draw", "\\draw", "\\fill", "\\filldraw", "\\path", "\\clip", "\\useasboundingbox"])
      const ops = Array.from({ length: int(1, 5) }, operation).join("")
      return `${cmd}${cmd === "\\clip" ? "" : options()} ${coord()}${cmd === "\\clip" ? ops.replace(/ \[[^\]]*\]/g, "") : ops};`
    }
    const body = (depth: number): string => {
      let out = ""
      for (let k = int(1, 4); k > 0; k--) {
        out += depth < 2 && r() < 0.15 ? pick([() => `\\begin{scope}${options()}${body(depth + 1)}\\end{scope}`, () => `{${body(depth + 1)}}`,
          () => `\\foreach \\i${pick(["", " [count=\\n]"])} in {${pick(["1,2", "0,...,2", "1,3,...,7", "0.5,1", "2,1.5,...,1"])}} {\\begin{scope}[xshift=\\i mm]${body(depth + 1)}\\end{scope}}`])() : path()
        out += pick(["", "", "\n", " "])
      }
      return out
    }
    const pictureOptions = () => (r() < 0.2 ? `[baseline=${len()}]` : options())
    return pick([
      () => `\\tikz${pictureOptions()} ${path()}`,
      () => `\\tikz${pictureOptions()}{${body(1)}}`,
      () => pic(body(0), pictureOptions()), () => pic(body(0), pictureOptions()), () => pic(body(0), pictureOptions()),
    ])()
  })
}

/** TeX's box for each picture (or its error), from one run per target, cached while the pictures stay the same */
function texBoxes(t: Target, pictures: string[]): (BoxNode | string)[] {
  mkdirSync(DIR, { recursive: true })
  const tex = [
    "\\documentclass{article}", "\\usepackage{tikz}", "\\usetikzlibrary{arrows.meta,positioning,calc,shapes.geometric,plotmarks}", ...COLORS.map(([n, m, v]) => `\\definecolor{${n}}{${m}}{${v}}`),
    "\\showboxdepth=100 \\showboxbreadth=100000", "\\begin{document}",
    // (pgf's globals one picture leaves must not reach the next)
    ...pictures.map((x, i) => `\\immediate\\write16{C:${i}}\\makeatletter\\gdef\\pgfsyssoftpath@lastmoveto{{0pt}{0pt}}\\makeatother\\setbox0\\hbox{${x}}\\showbox0`), "\\end{document}", "",
  ].join("\n")
  const file = join(DIR, `${t.name}.tex`), log = join(DIR, `${t.name}.log`)
  if (!existsSync(file) || readFileSync(file, "utf8") !== tex || !existsSync(log) || !/^(No pages of output|Output written)/m.test(readFileSync(log, "latin1"))) {
    writeFileSync(file, tex)
    const run = spawnSync(t.program, ["-interaction=nonstopmode", `${t.name}.tex`], { cwd: DIR, env: texEnv({ max_print_line: "100000" }), stdio: "ignore", timeout: 900_000 })
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

/** a node's text as the engine typesets it: article's \normalfont at 10pt */
const TEXT: TikzText = {
  hlist: (text, font) => nodeHlist(text, font, classData("article", "10pt"), "normalsize", { footnote: 0 }, { enc: "OT1", fam: "cmr", ser: "m", shape: "n" }, false),
  baselines: (font) => nodeBaselines(font, classData("article", "10pt"), "normalsize"),
  units: (font) => nodeUnits(font, classData("article", "10pt"), "normalsize", { footnote: 0 }, { enc: "OT1", fam: "cmr", ser: "m", shape: "n" }),
  minipage: (text, nodeFont, textFont, width, action, before, after) => nodeMinipage(text, nodeFont, textFont, width, action, before, after, classData("article", "10pt"), "normalsize", { footnote: 0 }, { enc: "OT1", fam: "cmr", ser: "m", shape: "n" }, false, { notes: [], club: 150, widow: 150, finalHyph: 5000 }),
}

/** TikZ in the check's document (its arrow tips instantiated once, as TeX's are) */
function tikzDocument(units: PgfUnits): TikzDocument {
  const colors = new Colors()
  for (const [name, model, values] of COLORS) colors.define(name, model, values)
  return new TikzDocument({ units, colors, arrowsMeta: true, positioning: true, calc: true, geometric: true, plotmarks: true, text: TEXT })
}

/** the engine's box for a picture under a target */
export function enginePicture(src: string, t: Target, doc: TikzDocument, units: PgfUnits): Node[] {
  const s = new PgfState(units)
  doc.picture(src, s, t.driver(s), xcolor.normal)
  const box = hpack(s.out)
  if (t.name === "pdftex") pdftexColors(box)
  return [box]
}

export function tikzCheck(n: number, seed: number): number {
  const f = loadFont(dataFont("cmr10"), 10 * UNITY) // \pgfmath@selectfont: the document's \normalfont
  const units: PgfUnits = { em: f.params[QUAD], ex: f.params[X_HEIGHT] }
  const pictures = [...FIXED, ...makePictures(n, seed)]
  let failed = 0
  for (const src of REFUSED) {
    try {
      enginePicture(src, TARGETS[0], tikzDocument(units), units)
      failed++
      console.log(`✗ the engine typesets what it does not model: ${src}`)
    } catch (e) {
      if (!(e instanceof Unsupported)) throw e
    }
  }
  for (const t of TARGETS) {
    const tex = texBoxes(t, pictures)
    let same = 0, refused = 0, unsupported = 0
    const doc = tikzDocument(units)
    pictures.forEach((src, i) => {
      const expected = tex[i]
      if (expected === undefined) throw new Error(`TeX showed no box for picture ${i} (${DIR}/${t.name}.log)`)
      let problem: string
      try {
        const box = enginePicture(src, t, doc, units)
        if (typeof expected === "string") problem = `${expected}\n    engine: no error`
        else {
          const d = compareBoxLists([expected], box.map(emitBoxes))
          if (!d) { same++; return }
          problem = `${d.path} ${d.field}\n    TeX:    ${JSON.stringify(d.expected)}\n    engine: ${JSON.stringify(d.actual)}`
        }
      } catch (e) {
        if (!(e instanceof Unsupported)) throw e
        // what TeX stops at with an error, the engine refuses; what the engine does not model yet, it refuses too
        if (typeof expected === "string") { same++; refused++; return }
        unsupported++
        problem = `engine: ${e.message}`
      }
      failed++
      if (failed <= 10) console.log(`✗ [${t.name}] #${i} ${src}\n    ${problem}`)
    })
    console.log(`${same}/${pictures.length} TikZ pictures identical to TeX under ${t.name} (seed ${seed})${refused ? `, ${refused} of them TeX errors the engine refuses` : ""}${unsupported ? `; ${unsupported} outside the subset` : ""}`)
  }
  return failed ? 1 : 0
}
