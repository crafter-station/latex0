// The exact page view: each shipped page as an SVG drawing of the paper, every glyph and rule where the
// trace puts it (the positions pdfTeX writes to the PDF), images where their boxes are, in the colors of
// the color stack. Glyphs are drawn with the web fonts tools/webfonts/build.py makes from the Type 1 fonts
// pdfTeX embeds; the browser only draws them, so the page is the PDF's.

import { webfontData } from "../latex/data"
import type { Trace, TraceGlyph } from "../trace/schema"
import type { PageMark } from "./trace"

/** What drawing the pages needs besides the trace */
export interface PageView {
  /** \paperwidth and \paperheight */
  paper: { width: number; height: number }
  /** where the DVI origin is on the paper: pdfTeX's \pdfhorigin and \pdfvorigin, 1in, plus \hoffset and \voffset */
  origin: { h: number; v: number }
  /** each page's whatsits and images (emit/trace's shipOut) */
  marks: PageMark[][]
}

export interface SvgOptions {
  /** an image file's URL (an \includegraphics name); none: the image is left out */
  image?: (name: string) => string | undefined
}

export interface SvgPages {
  /** each page as an <svg> element sized in PostScript points (bp, CSS's pt) */
  pages: string[]
  /** the web font files the pages use (public/fonts/tex/<file>.woff2), font family `l0-<file>` */
  fonts: string[]
}

/** sp as PostScript points (bp), the PDF's and CSS's unit: 72.27pt = 72bp */
const pt = (sp: number) => +((sp * 72) / (65536 * 72.27)).toFixed(3)
const escape = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)

/** A color stack operand as CSS: pdfTeX's `r g b rg …` / `g g …` / `c m y k k …`, or dvips's `rgb r g b` / `gray g` / `cmyk c m y k` */
function cssColor(spec: string): string {
  const pdf = spec.match(/^\{([^}]*)\}$/)
  const words = (pdf ? pdf[1] : spec).trim().split(/\s+/)
  let model: string, v: number[]
  if (pdf) {
    const op = words.findIndex((w) => /^[a-zA-Z]+$/.test(w))
    model = { rg: "rgb", g: "gray", k: "cmyk" }[words[op]] ?? ""
    v = words.slice(0, op).map(Number)
  } else {
    model = words[0]
    v = words.slice(1).map(Number)
  }
  const rgb = model === "rgb" ? v : model === "gray" ? [v[0], v[0], v[0]] : model === "cmyk" ? v.slice(0, 3).map((c) => (1 - c) * (1 - v[3])) : [0, 0, 0]
  const hex = rgb.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, "0")).join("")
  return hex === "000000" ? "" : `#${hex}`
}

/** The color stack's push and pop whatsits, under either driver: the color pushed, "" for a pop, null for anything else */
function colorOf(text: string): string | null {
  const dvips = text.match(/^\\special\{color (push (.*)|pop)\}$/)
  if (dvips) return dvips[1] === "pop" ? "" : `\0${dvips[2]}`
  const pdf = text.match(/^\\pdfcolorstack 0 (push (\{.*\})|pop)$/)
  if (pdf) return pdf[1] === "pop" ? "" : `\0${pdf[2]}`
  return null
}

/** The pages of a layout as SVG */
export function svgPages(trace: Trace, view: PageView, { image }: SvgOptions = {}): SvgPages {
  const { fonts: webfonts, codes } = webfontData()
  const used = new Set<string>()
  const W = pt(view.paper.width), H = pt(view.paper.height)
  const x = (h: number) => pt(view.origin.h + h), y = (v: number) => pt(view.origin.v + v)
  /** the color stack, across pages as pdfTeX's is: the current color is its top ("" black) */
  const stack: string[] = [""]
  const pages = trace.pages.map((page, i) => {
    const marks = view.marks[i] ?? []
    const glyphColor: string[] = [], ruleColor: string[] = []
    const images: string[] = []
    let g = 0, r = 0
    const advance = (glyphs: number, rules: number) => {
      for (; g < glyphs; g++) glyphColor[g] = stack[stack.length - 1]
      for (; r < rules; r++) ruleColor[r] = stack[stack.length - 1]
    }
    for (const m of marks) {
      if (m.kind === "image") {
        const url = image?.(m.name)
        if (url) images.push(`<image href="${escape(url)}" x="${x(m.h)}" y="${y(m.v - m.height)}" width="${pt(m.width)}" height="${pt(m.height + m.depth)}" preserveAspectRatio="none"/>`)
        continue
      }
      const c = colorOf(m.text)
      if (c === null) continue
      advance(m.glyphs, m.rules)
      if (c === "") { if (stack.length > 1) stack.pop() } else stack.push(cssColor(c.slice(1)))
    }
    advance(page.glyphs.length, page.rules.length)

    const out: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}pt" height="${H}pt">`, `<rect width="${W}" height="${H}" fill="#fff"/>`, ...images]
    page.rules.forEach((rule, j) => {
      const fill = ruleColor[j] ? ` fill="${ruleColor[j]}"` : ""
      out.push(`<rect x="${x(rule.h)}" y="${y(rule.v - rule.height)}" width="${pt(rule.width)}" height="${pt(rule.height)}"${fill}/>`)
    })
    // a run of glyphs on one baseline in one font and color is one <text>, each glyph at its own x
    let run: TraceGlyph[] = [], runColor = ""
    const flush = () => {
      if (!run.length) return
      const [file, vector] = webfonts[run[0].font]
      used.add(file)
      const chars = run.map((gl) => String.fromCodePoint(codes[vector][gl.char] || 0xfffd)).join("")
      const fill = runColor ? ` fill="${runColor}"` : ""
      out.push(`<text x="${run.map((gl) => x(gl.h)).join(" ")}" y="${y(run[0].v)}" font-family="l0-${file}" font-size="${pt(run[0].size)}"${fill}>${escape(chars)}</text>`)
      run = []
    }
    page.glyphs.forEach((gl, j) => {
      const prev = run[run.length - 1]
      if (prev && (prev.font !== gl.font || prev.size !== gl.size || prev.v !== gl.v || runColor !== glyphColor[j])) flush()
      if (!webfonts[gl.font]) throw new Error(`no web font for ${gl.font}`)
      if (!run.length) runColor = glyphColor[j]
      run.push(gl)
    })
    flush()
    out.push("</svg>")
    return out.join("")
  })
  return { pages, fonts: [...used].sort() }
}
