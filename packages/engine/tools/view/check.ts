// The exact page view's drawing, checked without a browser: small pages given as glyphs, rules and marks (what
// emit/trace records of a shipped page), and the SVG emit/svg must make of each, written out by hand from pdfTeX's
// rules (where its origin is, what a literal's operators do to the graphics state) and the PDF's (paths, clipping,
// shadings, soft masks). Positions are in bp on a 200bp × 100bp paper whose DVI origin is its top left corner, so a
// position (h, v) is the SVG's (h, v) and a literal's user space there is matrix(1 0 0 -1 h v).
//
//   bun engine view:check [--print]     (--print shows what is drawn instead of checking it)

import { svgPages, type PageView } from "../../emit/svg"
import type { PageForm, PageMark } from "../../emit/trace"
import type { Trace, TraceGlyph, TraceRule } from "../../trace/schema"
import "../data"

/** bp as sp */
const sp = (bp: number) => Math.round((bp * 65536 * 72.27) / 72)
const A = 65 // cmr10's A

interface Item { at: [h: number, v: number] }
type Step =
  | (Item & { glyph: number })
  | (Item & { rule: [width: number, height: number] })
  | (Item & { image: string; size: [width: number, height: number] })
  | (Item & { form: number; size: [width: number, height: number] })
  /** a whatsit as a box dump prints it */
  | (Item & { mark: string })

interface Case {
  name: string
  /** the pages' content, in the order ship_out meets it */
  pages: Step[][]
  forms?: Record<number, { size: [width: number, height: number]; steps: Step[]; resources?: string }>
  /** each page's SVG inside <svg>, after the paper's white rectangle */
  svg: string[]
  warnings?: string[]
}

function content(steps: Step[]): { glyphs: TraceGlyph[]; rules: TraceRule[]; marks: PageMark[] } {
  const glyphs: TraceGlyph[] = [], rules: TraceRule[] = [], marks: PageMark[] = []
  for (const s of steps) {
    const h = sp(s.at[0]), v = sp(s.at[1]), counts = { glyphs: glyphs.length, rules: rules.length }
    if ("glyph" in s) glyphs.push({ font: "cmr10", size: sp(10), char: s.glyph, h, v, width: sp(7.5) })
    else if ("rule" in s) rules.push({ h, v, width: sp(s.rule[0]), height: sp(s.rule[1]) })
    else if ("image" in s) marks.push({ kind: "image", name: s.image, h, v, width: sp(s.size[0]), height: sp(s.size[1]), depth: 0, ...counts })
    else if ("form" in s) marks.push({ kind: "form", number: s.form, h, v, width: sp(s.size[0]), height: sp(s.size[1]), depth: 0, ...counts })
    else marks.push({ kind: "whatsit", text: s.mark, h, v, ...counts })
  }
  return { glyphs, rules, marks }
}

function draw(c: Case): { svg: string[]; warnings: string[] } {
  const pages = c.pages.map(content)
  const trace: Trace = { unit: "sp", mag: 1000, pages: pages.map((p, i) => ({ counts: [i + 1, 0, 0, 0, 0, 0, 0, 0, 0, 0], glyphs: p.glyphs, rules: p.rules, specials: [] })) }
  const forms: Record<number, PageForm> = {}
  for (const [k, f] of Object.entries(c.forms ?? {})) forms[Number(k)] = { width: sp(f.size[0]), height: sp(f.size[1]), depth: 0, ...content(f.steps), resources: f.resources ?? "" }
  const view: PageView = { paper: { width: sp(200), height: sp(100) }, origin: { h: 0, v: 0 }, marks: pages.map((p) => p.marks), forms }
  const out = svgPages(trace, view, { image: (name) => (name === "missing.png" ? undefined : `/files/${name}`) })
  const open = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200pt" height="100pt" stroke-miterlimit="10"><rect width="200" height="100" fill="#fff"/>`
  return { svg: out.pages.map((p) => (p.startsWith(open) && p.endsWith("</svg>") ? p.slice(open.length, -6) : p)), warnings: out.warnings }
}

const text = (x: number, y: number, attrs = "") => `<text x="${x}" y="${y}" font-family="l0-cmr10" font-size="10"${attrs}>A</text>`
const lit = (h: number, v: number, ops: string): Step => ({ at: [h, v], mark: `\\pdfliteral{${ops}}` })
const SHADE = "/Shading << /Sh << /ShadingType 2 /ColorSpace /DeviceRGB /Domain [0 1] /Coords [0 0 0 10] /Function << /FunctionType 2 /Domain [0 1] /C0 [1 0 0] /C1 [0 0 1] /N 1 >> /Extend [false false] >> >>"

const CASES: Case[] = [
  {
    name: "\\pdfsave \\pdfsetmatrix \\pdfrestore scale about the current position (\\includegraphics[height=…] of a bitmap)",
    pages: [[
      { at: [10, 20], mark: "\\pdfsave" }, { at: [10, 20], mark: "\\pdfsetmatrix{.5 0 0 .5}" },
      { at: [10, 20], image: "logo.png", size: [100, 40] },
      { at: [10, 20], mark: "\\pdfrestore" },
      { at: [60, 20], glyph: A },
    ]],
    // the image box's baseline starts at (10, 20): its top left corner (10, -20) goes to (10, 0), its size halves
    svg: [`<g transform="matrix(0.5 0 0 0.5 5 10)"><image href="/files/logo.png" x="10" y="-20" width="100" height="40" preserveAspectRatio="none"/></g>${text(60, 20)}`],
  },
  {
    name: "glyphs and rules inside a transformation (\\resizebox, \\scalebox, \\rotatebox), nested",
    pages: [[
      { at: [10, 20], glyph: A },
      { at: [20, 20], mark: "\\pdfsave" }, { at: [20, 20], mark: "\\pdfsetmatrix{2 0 0 2}" },
      { at: [20, 20], glyph: A }, { at: [20, 22], rule: [10, 2] },
      // 90° counterclockwise (in the PDF's axes) about (40, 20), inside the scaling
      { at: [40, 20], mark: "\\pdfsave" }, { at: [40, 20], mark: "\\pdfsetmatrix{0 1 -1 0}" },
      { at: [40, 20], glyph: A },
      { at: [40, 20], mark: "\\pdfrestore" },
      { at: [50, 20], glyph: A },
      { at: [20, 20], mark: "\\pdfrestore" },
      { at: [70, 20], glyph: A },
    ]],
    svg: [`${text(10, 20)}<g transform="matrix(2 0 0 2 -20 -20)"><rect x="20" y="20" width="10" height="2"/>${text(20, 20)}</g>` +
      // (the rotation takes (X, Y) to (Y + 20, 60 - X); the scaling doubles that and moves it by (-20, -20))
      `<g transform="matrix(0 -2 2 0 20 100)">${text(40, 20)}</g><g transform="matrix(2 0 0 2 -20 -20)">${text(50, 20)}</g>${text(70, 20)}`],
  },
  {
    name: "a negative scale (\\reflectbox) and a scale that cancels",
    pages: [[
      { at: [50, 20], mark: "\\pdfsave" }, { at: [50, 20], mark: "\\pdfsetmatrix{-1 0 0 1}" },
      { at: [40, 20], glyph: A },
      { at: [50, 20], mark: "\\pdfsave" }, { at: [50, 20], mark: "\\pdfsetmatrix{-1 0 0 1}" },
      { at: [40, 20], glyph: A },
      { at: [50, 20], mark: "\\pdfrestore" }, { at: [50, 20], mark: "\\pdfrestore" },
    ]],
    svg: [`<g transform="matrix(-1 0 0 1 100 0)">${text(40, 20)}</g>${text(40, 20)}`],
  },
  {
    name: "path construction and painting: m l c v y h re, S s f f* B B* b b* n",
    pages: [[
      lit(10, 50, "q"),
      lit(10, 50, "0 0 m 10 0 l 10 10 20 10 20 0 c S"),
      lit(10, 50, "0 0 m 5 5 10 0 v 15 -5 20 0 y s"),
      lit(10, 50, "0 0 10 5 re f 0 0 10 5 re f*"),
      lit(10, 50, "0 0 m 10 0 l 5 5 l h B 0 0 m 10 0 l 5 5 l B*"),
      lit(10, 50, "0 0 m 10 0 l 5 5 l b 0 0 m 10 0 l 5 5 l b*"),
      lit(10, 50, "0 0 m 10 0 l n 20 0 m 30 0 l S"),
      lit(10, 50, "Q"),
    ]],
    svg: [[
      `M0 0L10 0C10 10 20 10 20 0" transform="matrix(1 0 0 -1 10 50)" fill="none" stroke="#000"`,
      `M0 0C0 0 5 5 10 0C15 -5 20 0 20 0Z" transform="matrix(1 0 0 -1 10 50)" fill="none" stroke="#000"`,
      `M0 0L10 0L10 5L0 5Z" transform="matrix(1 0 0 -1 10 50)"`,
      `M0 0L10 0L10 5L0 5Z" transform="matrix(1 0 0 -1 10 50)" fill-rule="evenodd"`,
      `M0 0L10 0L5 5Z" transform="matrix(1 0 0 -1 10 50)" stroke="#000"`,
      `M0 0L10 0L5 5" transform="matrix(1 0 0 -1 10 50)" fill-rule="evenodd" stroke="#000"`,
      `M0 0L10 0L5 5Z" transform="matrix(1 0 0 -1 10 50)" stroke="#000"`,
      `M0 0L10 0L5 5Z" transform="matrix(1 0 0 -1 10 50)" fill-rule="evenodd" stroke="#000"`,
      `M20 0L30 0" transform="matrix(1 0 0 -1 10 50)" fill="none" stroke="#000"`,
    ].map((p) => `<path d="${p}/>`).join("")],
  },
  {
    name: "the graphics state: q Q cm w J j M d, colors g G rg RG k K",
    pages: [[
      lit(10, 50, "q 2 0 0 2 5 5 cm 0.4 w 1 J 1 j [3 2] 1 d 1 0 0 RG 0 0 m 10 0 l S"),
      lit(10, 50, "q 2 J 2 j 4 M [ ] 0 d 0 w 0.5 G 0 0 1 rg 0 0 5 5 re B Q"),
      lit(10, 50, "0 1 0 0 k 0 0 0 1 K 0.25 g 0 0 5 5 re f 0 0 m 5 5 l S Q"),
      lit(10, 50, "0 0 m 10 0 l S"),
    ]],
    svg: [`<path d="M0 0L10 0" transform="matrix(2 0 0 -2 15 45)" fill="none" stroke="#ff0000" stroke-width="0.4" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="3 2" stroke-dashoffset="1"/>` +
      `<path d="M0 0L5 0L5 5L0 5Z" transform="matrix(2 0 0 -2 15 45)" fill="#0000ff" stroke="#808080" stroke-width="1" vector-effect="non-scaling-stroke" stroke-linecap="square" stroke-linejoin="bevel" stroke-miterlimit="4"/>` +
      `<path d="M0 0L5 0L5 5L0 5Z" transform="matrix(2 0 0 -2 15 45)" fill="#404040"/>` +
      `<path d="M0 0L5 5" transform="matrix(2 0 0 -2 15 45)" fill="none" stroke="#000" stroke-width="0.4" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="3 2" stroke-dashoffset="1"/>` +
      `<path d="M0 0L10 0" transform="matrix(1 0 0 -1 10 50)" fill="none" stroke="#000"/>`],
  },
  {
    name: "clipping: W n and W* n, nested, undone by Q; glyphs in a clipped picture",
    pages: [[
      lit(10, 50, "q 0 0 20 20 re W n"),
      lit(10, 50, "0 0 30 5 re f"),
      { at: [12, 48], glyph: A },
      lit(10, 50, "q 5 0 m 30 0 l 30 30 l W* n 0 0 30 5 re f Q"),
      lit(10, 50, "0 10 30 5 re f"),
      lit(10, 50, "Q"),
      lit(10, 50, "0 0 30 5 re f"),
    ]],
    svg: [`<clipPath id="l0p1c1"><path d="M0 0L20 0L20 20L0 20Z" transform="matrix(1 0 0 -1 10 50)"/></clipPath>` +
      `<g clip-path="url(#l0p1c1)"><path d="M0 0L30 0L30 5L0 5Z" transform="matrix(1 0 0 -1 10 50)"/>${text(12, 48)}</g>` +
      `<clipPath id="l0p1c2" clip-path="url(#l0p1c1)"><path d="M5 0L30 0L30 30" transform="matrix(1 0 0 -1 10 50)" clip-rule="evenodd"/></clipPath>` +
      `<g clip-path="url(#l0p1c2)"><path d="M0 0L30 0L30 5L0 5Z" transform="matrix(1 0 0 -1 10 50)"/></g>` +
      `<g clip-path="url(#l0p1c1)"><path d="M0 10L30 10L30 15L0 15Z" transform="matrix(1 0 0 -1 10 50)"/></g>` +
      `<path d="M0 0L30 0L30 5L0 5Z" transform="matrix(1 0 0 -1 10 50)"/>`],
  },
  {
    name: "the color stack and the literals' colors: glyphs are filled, a rule at most 1bp thin is stroked; the stack's color starts the next page",
    pages: [[
      { at: [10, 20], mark: "\\pdfcolorstack 0 push {1 0 0 rg 1 0 0 RG}" },
      { at: [10, 20], glyph: A }, { at: [20, 20], rule: [10, 5] }, { at: [20, 22], rule: [10, 0.4] },
      // pgf's picture: its own fill color until Q, the stroke color still the stack's
      lit(40, 20, "q"), lit(40, 20, "0 0 1 rg"),
      { at: [40, 20], glyph: A }, { at: [50, 20], rule: [10, 5] }, { at: [50, 22], rule: [10, 0.4] },
      lit(40, 20, "Q"),
      { at: [70, 20], glyph: A },
      { at: [80, 20], mark: "\\pdfcolorstack 0 push {0 1 0 rg 0 1 0 RG}" },
      { at: [80, 20], glyph: A },
      { at: [90, 20], mark: "\\pdfcolorstack 0 pop" },
      { at: [90, 20], glyph: A },
    ], [
      { at: [10, 20], glyph: A },
      { at: [20, 20], mark: "\\pdfcolorstack 0 pop" },
      { at: [20, 20], glyph: A },
    ]],
    svg: [`<rect x="20" y="15" width="10" height="5" fill="#ff0000"/><rect x="20" y="21.6" width="10" height="0.4" fill="#ff0000"/>${text(10, 20, ` fill="#ff0000"`)}` +
      `<rect x="50" y="15" width="10" height="5" fill="#0000ff"/><rect x="50" y="21.6" width="10" height="0.4" fill="#ff0000"/>${text(40, 20, ` fill="#0000ff"`)}` +
      `${text(70, 20, ` fill="#ff0000"`)}${text(80, 20, ` fill="#00ff00"`)}${text(90, 20, ` fill="#ff0000"`)}`,
    `${text(10, 20, ` fill="#ff0000"`)}${text(20, 20)}`],
  },
  {
    name: "paint order: images, glyphs, rules and literals in the order of the page (a \\colorbox's rule under its text, an image over a fill)",
    pages: [[
      { at: [10, 20], glyph: A },
      lit(10, 20, "0 0 50 10 re f"),
      { at: [10, 20], image: "a.png", size: [20, 10] },
      { at: [30, 20], rule: [10, 10] },
      { at: [10, 20], mark: "\\pdfcolorstack 0 push {1 g 1 G}" },
      { at: [12, 20], glyph: A },
      { at: [10, 20], mark: "\\pdfcolorstack 0 pop" },
      { at: [40, 20], image: "b.png", size: [20, 10] },
      { at: [70, 20], glyph: A },
    ]],
    svg: [`${text(10, 20)}<path d="M0 0L50 0L50 10L0 10Z" transform="matrix(1 0 0 -1 10 20)"/>` +
      `<image href="/files/a.png" x="10" y="10" width="20" height="10" preserveAspectRatio="none"/><rect x="30" y="10" width="10" height="10"/>` +
      `${text(12, 20, ` fill="#ffffff"`)}<image href="/files/b.png" x="40" y="10" width="20" height="10" preserveAspectRatio="none"/>${text(70, 20)}`],
  },
  {
    name: "pdfTeX's origin: a literal moves it to its position, `direct` and `page` do not, text moves it back; whatsits that draw nothing keep a run of glyphs whole",
    pages: [[
      lit(10, 50, "0 0 m 5 0 l S"),
      { at: [30, 50], mark: "\\pdfliteral direct{0 0 m 5 0 l S}" },
      { at: [30, 50], mark: "\\pdfliteral page{0 5 m 5 5 l S}" },
      lit(30, 40, "0 0 m 5 0 l S"),
      { at: [10, 20], glyph: A },
      { at: [20, 20], mark: "\\pdfstartlink attr{/Border[0 0 1]}" }, { at: [20, 20], mark: "\\write1{x}" },
      { at: [20, 20], glyph: A },
      { at: [30, 20], mark: "\\pdfendlink" },
      // text puts the origin back at the paper's lower left corner
      { at: [30, 20], mark: "\\pdfliteral page{0 0 m 5 5 l S}" },
    ]],
    svg: [`<path d="M0 0L5 0" transform="matrix(1 0 0 -1 10 50)" fill="none" stroke="#000"/><path d="M0 0L5 0" transform="matrix(1 0 0 -1 10 50)" fill="none" stroke="#000"/>` +
      `<path d="M0 5L5 5" transform="matrix(1 0 0 -1 10 50)" fill="none" stroke="#000"/><path d="M0 0L5 0" transform="matrix(1 0 0 -1 30 40)" fill="none" stroke="#000"/>` +
      `<text x="10 20" y="20" font-family="l0-cmr10" font-size="10">AA</text><path d="M0 0L5 5" transform="matrix(1 0 0 -1 0 100)" fill="none" stroke="#000"/>`],
  },
  {
    name: "a form (\\pdfrefxform) with an axial shading (`/Sh sh`: pgf's \\pgfuseshading), clipped to its box, under the page's transformation",
    pages: [[
      lit(10, 50, "q 2 0 0 1 0 0 cm"),
      { at: [10, 50], form: 7, size: [30, 10] },
      lit(10, 50, "Q"),
    ]],
    forms: { 7: { size: [30, 10], steps: [lit(0, 10, "/Sh sh")], resources: SHADE } },
    // the form's lower left corner at the box's, (10, 50): the page's matrix there is matrix(2 0 0 -1 10 50)
    svg: [`<clipPath id="l0p1c1"><path d="M0 0H30V10H0Z" transform="matrix(2 0 0 -1 10 50)"/></clipPath>` +
      `<linearGradient id="l0p1s2" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="10"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient>` +
      `<g clip-path="url(#l0p1c1)"><path d="M-20000 0L-20000 10L20000 10L20000 0Z" transform="matrix(2 0 0 -1 10 50)" fill="url(#l0p1s2)"/></g>`],
  },
  {
    name: "a radial shading with a stitching function (three colors), extended inside its first circle",
    pages: [[{ at: [10, 50], form: 3, size: [50, 50] }]],
    forms: { 3: { size: [50, 50], steps: [lit(0, 50, "/Sh sh")], resources: "/Shading << /Sh << /ShadingType 3 /ColorSpace /DeviceRGB /Domain [0 25] /Coords [20 30 0 25 25 25] " +
      "/Function << /FunctionType 3 /Domain [0 25] /Functions [ << /FunctionType 2 /Domain [0 25] /C0 [1 1 1] /C1 [1 0 0] /N 1 >> << /FunctionType 2 /Domain [0 25] /C0 [1 0 0] /C1 [0 0 0] /N 1 >> ] /Bounds [ 10] /Encode [0 1 0 1] >> /Extend [true false] >> >>" } },
    svg: [`<clipPath id="l0p1c1"><path d="M0 0H50V50H0Z" transform="matrix(1 0 0 -1 10 50)"/></clipPath>` +
      `<radialGradient id="l0p1s2" gradientUnits="userSpaceOnUse" cx="25" cy="25" r="25" fx="20" fy="30" fr="0"><stop offset="0" stop-color="#ffffff"/><stop offset="0.4" stop-color="#ff0000"/><stop offset="0.4" stop-color="#ff0000"/><stop offset="1" stop-color="#000"/></radialGradient>` +
      `<g clip-path="url(#l0p1c1)"><path d="M0 25a25 25 0 1 0 50 0a25 25 0 1 0 -50 0Z" transform="matrix(1 0 0 -1 10 50)" fill="url(#l0p1s2)"/></g>`],
  },
  {
    name: "opacity (pgf's /pgf@ca and /pgf@CA) and a soft mask (pgf's fading, /pgfsmask<form>): the mask's form drawn where it is set",
    pages: [[
      lit(10, 50, "q /pgf@ca0.5 gs /pgf@CA0.25 gs 0 0 10 10 re B Q"),
      lit(10, 50, "q 1 0 0 1 20 0 cm /pgfsmask9 gs 1 0 0 1 -20 0 cm 1 0 0 rg 20 0 30 10 re f 20 0 30 10 re f Q"),
      lit(10, 50, "0 0 10 10 re f"),
    ]],
    forms: { 9: { size: [30, 10], steps: [lit(0, 10, "/Sh sh")], resources: SHADE.replace("[1 0 0]", "[0 0 0]").replace("[0 0 1]", "[1 1 1]") } },
    svg: [`<path d="M0 0L10 0L10 10L0 10Z" transform="matrix(1 0 0 -1 10 50)" fill-opacity="0.5" stroke="#000" stroke-opacity="0.25"/>` +
      `<mask id="l0p1m1" maskUnits="userSpaceOnUse" x="0" y="0" width="200" height="100"><clipPath id="l0p1c2"><path d="M0 0H30V10H0Z" transform="matrix(1 0 0 -1 30 50)"/></clipPath>` +
      `<linearGradient id="l0p1s3" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="10"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#ffffff"/></linearGradient>` +
      `<g clip-path="url(#l0p1c2)"><path d="M-20000 0L-20000 10L20000 10L20000 0Z" transform="matrix(1 0 0 -1 30 50)" fill="url(#l0p1s3)"/></g></mask>` +
      // (each masked object in a group of its own)
      `<g mask="url(#l0p1m1)"><path d="M20 0L50 0L50 10L20 10Z" transform="matrix(1 0 0 -1 10 50)" fill="#ff0000"/></g>` +
      `<g mask="url(#l0p1m1)"><path d="M20 0L50 0L50 10L20 10Z" transform="matrix(1 0 0 -1 10 50)" fill="#ff0000"/></g>` +
      `<path d="M0 0L10 0L10 10L0 10Z" transform="matrix(1 0 0 -1 10 50)"/>`],
  },
  {
    name: "what is not drawn is named, and the rest is drawn",
    pages: [[
      lit(10, 50, "BT /F1 10 Tf (x) Tj ET"),
      lit(10, 50, "/pgfprgb cs 1 0 0 /pgfpat4 scn 0 0 10 10 re f"),
      lit(10, 50, "/Fm3 Do"),
      lit(10, 50, "/other gs /pgfsmask99 gs /Sh sh"),
      lit(10, 50, "1 2 m 3 l Q"),
      { at: [10, 50], form: 12, size: [10, 10] },
      { at: [10, 50], image: "missing.png", size: [10, 10] },
      { at: [10, 50], mark: "\\pdfcolorstack 1 push {1 0 0 rg}" },
      { at: [10, 50], mark: "\\special{ps:: 0 0 moveto}" },
      { at: [20, 50], glyph: A },
    ]],
    svg: [`<path d="M0 0L10 0L10 10L0 10Z" transform="matrix(1 0 0 -1 10 50)"/>${text(20, 50)}`],
    warnings: [
      "\\pdfliteral operator BT (text)", "\\pdfliteral operator Tf (text)", "\\pdfliteral operator Tj (text)", "\\pdfliteral operator ET (text)",
      "\\pdfliteral operator cs (a color space)", "\\pdfliteral operator scn (a pattern or a color in a color space)", "\\pdfliteral operator Do (an XObject)",
      "the graphics state /other", "the soft mask /pgfsmask99 (its form is not known): what it fades is drawn unfaded", "the shading /Sh (not among the resources)",
      "\\pdfliteral operator l (its operands)", "\\pdfliteral operator Q (nothing saved)", "the form XObject 12 (its content is not known)", "the image missing.png (no file given)",
      "\\pdfcolorstack 1 (a color stack other than 0)", "\\special{ps:…} (PostScript, the dvips driver's drawing)",
    ],
  },
]

/** `view:check`: the status is 1 if a page is not drawn as written here */
export function viewCheck(print = false): number {
  let bad = 0
  for (const c of CASES) {
    let got: { svg: string[]; warnings: string[] }
    try { got = draw(c) } catch (e) { console.log(`✗ ${c.name}\n  threw ${(e as Error).message}`); bad++; continue }
    if (print) { console.log(`${c.name}\n${got.svg.map((s) => `  ${s}`).join("\n")}${got.warnings.length ? `\n  warnings: ${JSON.stringify(got.warnings)}` : ""}`); continue }
    const problems: string[] = []
    got.svg.forEach((s, i) => { if (s !== c.svg[i]) problems.push(`page ${i + 1}\n    drawn:    ${s}\n    expected: ${c.svg[i]}`) })
    if (got.svg.length !== c.svg.length) problems.push(`${got.svg.length} page(s), expected ${c.svg.length}`)
    if (JSON.stringify(got.warnings) !== JSON.stringify(c.warnings ?? [])) problems.push(`warnings\n    given:    ${JSON.stringify(got.warnings)}\n    expected: ${JSON.stringify(c.warnings ?? [])}`)
    if (problems.length) bad++
    console.log(`${problems.length ? "✗" : "✓"} ${c.name}${problems.map((p) => `\n  ${p}`).join("")}`)
  }
  if (!print) console.log(bad ? `\n${bad} of ${CASES.length} cases are not drawn as expected` : `\n✓ the exact page view draws all ${CASES.length} cases`)
  return bad ? 1 : 0
}
