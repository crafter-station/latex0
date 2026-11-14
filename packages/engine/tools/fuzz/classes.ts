// Class documents for the document fuzzer (#360): amsart (its top matter, abstract and \maketitle, sections down to
// \subparagraph, theorem styles and proofs with \qedhere, lists, quote, quotation, verse, center, footnotes, displays,
// \cite and \ref, thebibliography with amsplain or not, running heads over several pages), each class with the
// constructs it lays out. fuzzDocuments draws them from a stream of their own.

const WORDS = `the of and a to in is was that for it as with on by be at from this which are or an have but not they
were his her one all their there been has more when will would who so no if out up into than them can only other new
some could time these two may first then do any like my now over such our man even most made after also did many
before must through back years where much your way well down should because each just those people how too little
state good very make world still own see men work long get here between both life being under never day same another
know while last might great old year off come since against go came right used take three office official efficient
difficult different affluent baffled sufficient fluffy offline staff stuff fifty fifteen Typesetting composition
paragraphs hyphenation algorithm demerits badness tolerance Knuth Plass Paris London. Yes! Really? (indeed) well-known
infinitely theorem lemma integral manifold quadratic stochastic Riemannian`.split(/\s+/)

export const FUZZ_CLASSES = ["amsart"] as const

export function makeClassDocument(r: () => number): string {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]
  const cls = pick(FUZZ_CLASSES)
  const words = (n: number) => Array.from({ length: n }, () => pick(WORDS)).join(" ")
  const plain = (n: number, fallback: string) => words(n).replace(/[^A-Za-z ]/g, "").replace(/\s+/g, " ").trim() || fallback
  const math = () => pick(["$x$", "$x^2+y^2=z^2$", "$a_i\\leq b_i$", "$\\frac{1}{2}$", "$\\alpha\\to\\beta$", "$\\mathbb{Z}$", "$\\mathcal{S}$", "$a\\equiv 1\\pmod 4$", "$\\gcd(a,q)=1$", "$f(x)=\\sum_{i=1}^n a_i x^i$"])
  const labels: string[] = [], bib: string[] = []
  let notes = 0
  const text = (n: number, notesHere = true): string => {
    const ws = words(n).split(" ")
    if (r() < 0.3) ws.splice(Math.floor(r() * ws.length), 0, math())
    if (r() < 0.2) ws.splice(Math.floor(r() * ws.length), 0, `\\${pick(["emph", "textbf", "textit", "textsc"])}{${words(2)}}`)
    if (r() < 0.1) ws.splice(Math.floor(r() * ws.length), 0, `${pick(["Section", "Theorem", "see"])}~${labels.length && r() < 0.7 ? `\\ref{${pick(labels)}}` : "1"}`)
    if (r() < 0.1) ws.splice(Math.floor(r() * ws.length), 0, `\\cite{${bib.length ? pick(bib) : "k0"}}`)
    if (notesHere && r() < 0.12 && notes++ < 6) { const j = Math.floor(r() * ws.length); ws[j] += `\\footnote{${words(3 + Math.floor(r() * 20))}${r() < 0.3 ? ` ${math()}` : ""}.}` }
    return ws.join(" ")
  }
  const display = () => pick(["x^2+y^2=z^2", "\\sum_{i=1}^n i=\\frac{n(n+1)}{2}", "(a^2+b^2)(c^2+d^2) = (ac-bd)^2 + (ad+bc)^2", "\\int_0^1 f(x)\\,dx", "\\lim_{n\\to\\infty} a_n = 0"])
  const opts = [pick(["", "11pt", "12pt"]), r() < 0.2 ? pick(["a4paper", "oneside"]) : ""].filter(Boolean)
  const out = [`\\documentclass${opts.length ? `[${opts.join(",")}]` : ""}{${cls}}`]
  if (r() < 0.3) out.push("\\usepackage{amssymb}")
  if (r() < 0.2) out.push("\\usepackage[T1]{fontenc}")
  if (r() < 0.1) out.push("\\usepackage{lmodern}")
  if (r() < 0.15) out.push(`\\usepackage[${pick(["margin=1in", "margin=2.5cm", "hmargin=3cm", "textwidth=400pt"])}]{geometry}`)
  const enumitem = r() < 0.15
  if (enumitem) out.push("\\usepackage{enumitem}")
  const thms = r() < 0.6
  if (thms) out.push("\\newtheorem{theorem}{Theorem}[section]", "\\newtheorem{lemma}[theorem]{Lemma}", "\\theoremstyle{definition}", "\\newtheorem{definition}[theorem]{Definition}", "\\theoremstyle{remark}", "\\newtheorem*{remark}{Remark}")
  const style = r()
  if (style < 0.15) out.push("\\pagestyle{empty}")
  else if (style < 0.3) out.push("\\pagestyle{plain}")
  out.push("\\begin{document}")
  // the top matter, the abstract and \maketitle
  if (r() < 0.6) {
    const t = plain(3 + Math.floor(r() * 12), "Title")
    out.push(r() < 0.3 ? `\\title[${t.split(" ").slice(0, 2).join(" ")}]{${t}}` : `\\title{${t}}`)
    const authors = 1 + Math.floor(r() * 2)
    for (let i = 0; i < authors; i++) {
      out.push(`\\author{${pick(["Helena Costa", "Pieter de Vries", "Ann Author", "Bob Writer"])}}`)
      if (r() < 0.7) out.push(`\\address{${plain(4, "Somewhere")}${r() < 0.4 ? ` \\\\ ${plain(2, "Else")}` : ""}}`)
      if (r() < 0.6) out.push(`\\email{${pick(["hcosta@example.br", "p.devries@example.nl", "ann@example.org"])}}`)
    }
    if (r() < 0.5) out.push(`\\date{${pick(["\\today", "May 2026", "January 1, 2025"])}}`)
    if (r() < 0.4) out.push(`\\subjclass${r() < 0.5 ? "[2020]" : ""}{Primary 11E25; Secondary 11N13}`)
    if (r() < 0.4) out.push(`\\keywords{${plain(4, "words")}}`)
    out.push("")
    if (r() < 0.6) out.push("\\begin{abstract}", text(20 + Math.floor(r() * 50), false), ...(r() < 0.2 ? ["", text(10, false)] : []), "\\end{abstract}", "")
    out.push("\\maketitle", "")
  }
  const nbib = r() < 0.4 ? 1 + Math.floor(r() * 4) : 0
  for (let i = 0; i < nbib; i++) bib.push(`k${i}`)
  const list = (depth: number): string[] => {
    const env = pick(["itemize", "enumerate", "enumerate", "description"])
    const lines = [`\\begin{${env}}${enumitem && env === "enumerate" && r() < 0.5 ? `[label=${pick(["\\textup{(\\roman*)}", "(\\alph*)", "\\arabic*.", "\\Roman*)"])}]` : ""}`]
    for (let i = 0, n = 1 + Math.floor(r() * 3); i < n; i++) {
      lines.push(`\\item${env === "description" ? `[${plain(1, "Term")}]` : ""} ${text(3 + Math.floor(r() * 25))}`)
      if (r() < 0.15) lines.push("", text(5 + Math.floor(r() * 20)))
      if (depth < 3 && r() < 0.2 && env !== "description") lines.push(...list(depth + 1))
    }
    lines.push(`\\end{${env}}`)
    return lines
  }
  const sections = 1 + Math.floor(r() * 4)
  for (let s = 0; s < sections; s++) {
    const star = r() < 0.15
    out.push(`\\section${star ? "*" : ""}{${plain(1 + Math.floor(r() * (r() < 0.1 ? 14 : 4)), "Section")}}`)
    if (!star && r() < 0.3) { labels.push(`sec:${s}`); out.push(`\\label{sec:${s}}`) }
    const blocks = 1 + Math.floor(r() * 6)
    for (let b = 0; b < blocks; b++) {
      const x = r()
      if (x < 0.3) out.push(text(10 + Math.floor(r() * 80)), "")
      else if (x < 0.4) out.push(`\\${pick(["subsection", "subsection", "subsubsection", "paragraph", "subparagraph"])}${r() < 0.1 ? "*" : ""}{${words(1 + Math.floor(r() * 3)).replace(/[^A-Za-z ?]/g, "").trim() || "Part"}}`, text(10 + Math.floor(r() * 40)), "")
      else if (x < 0.55) out.push(...list(1), r() < 0.5 ? "" : text(5), "")
      else if (x < 0.75 && thms) {
        const env = pick(["theorem", "lemma", "definition", "remark"])
        const label = env !== "remark" && r() < 0.3 ? `t:${labels.length}` : ""
        if (label) labels.push(label)
        out.push(`\\begin{${env}}${r() < 0.2 ? `[${plain(1, "Note")}]` : ""}${label ? `\\label{${label}}` : ""}`, text(8 + Math.floor(r() * 30)), `\\end{${env}}`)
        if (r() < 0.5) {
          const here = r() < 0.4
          out.push("\\begin{proof}", here ? `${text(6 + Math.floor(r() * 20))}\n\\[\n${display()}. \\qedhere\n\\]` : text(8 + Math.floor(r() * 30)), "\\end{proof}")
        }
        out.push(r() < 0.5 ? "" : text(4))
      } else if (x < 0.85) {
        const env = pick(["\\[ ~ \\]", "\\begin{align*} ~ \\end{align*}", "\\begin{gather*} ~ \\end{gather*}", "$$ ~ $$"])
        out.push(`${text(5 + Math.floor(r() * 20))}\n${env.replace("~", env.includes("align") ? `a &= ${display()} \\\\ &= b` : display())}\n${text(3 + Math.floor(r() * 15))}`, "")
      } else if (x < 0.93) { const env = pick(["quote", "quotation", "verse", "center", "flushleft"]); out.push(`\\begin{${env}}`, text(10 + Math.floor(r() * 40), false), ...(r() < 0.4 ? ["", text(5, false)] : []), `\\end{${env}}`, "") }
      else out.push(pick(["\\smallskip", "\\bigskip", "\\newpage", "\\noindent", "\\pagebreak", "\\thispagestyle{empty}"]), text(6 + Math.floor(r() * 30)), "")
    }
  }
  if (nbib) {
    if (r() < 0.6) out.push("", "\\bibliographystyle{amsplain}", "")
    out.push(`\\begin{thebibliography}{${nbib}}`)
    for (let i = 0; i < nbib; i++) out.push(`\\bibitem{k${i}} ${words(3)}, \\emph{${words(4)}}, ${words(3)}, ${2000 + i}.`)
    out.push("\\end{thebibliography}")
  }
  out.push("\\end{document}", "")
  return out.join("\n")
}
