export interface Template {
  id: string
  name: string
  description: string
  category: "document" | "snippet"
  content: string
}

export const documentTemplates: Template[] = [
  {
    id: "article",
    name: "Academic Article",
    description: "Standard academic paper with abstract, sections, and references",
    category: "document",
    content: `\\documentclass[12pt]{article}

\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{amsmath,amssymb,amsthm}
\\usepackage{graphicx}
\\usepackage{hyperref}

\\title{Your Title Here}
\\author{Author Name}
\\date{\\today}

\\begin{document}

\\maketitle

\\begin{abstract}
Your abstract here.
\\end{abstract}

\\section{Introduction}
Your introduction here.

\\section{Main Content}
Your main content here.

\\section{Conclusion}
Your conclusion here.

\\end{document}`,
  },
  {
    id: "report",
    name: "Thesis / Report",
    description: "Multi-chapter report with table of contents",
    category: "document",
    content: `\\documentclass[12pt]{report}

\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{amsmath,amssymb}
\\usepackage{graphicx}
\\usepackage{hyperref}

\\title{Report Title}
\\author{Author Name}
\\date{\\today}

\\begin{document}

\\maketitle
\\tableofcontents

\\chapter{Introduction}
Your introduction here.

\\chapter{Background}
Background information here.

\\chapter{Methodology}
Your methodology here.

\\chapter{Results}
Your results here.

\\chapter{Conclusion}
Your conclusion here.

\\end{document}`,
  },
  {
    id: "beamer",
    name: "Beamer Presentation",
    description: "Slide deck with title page, outline, and content frames",
    category: "document",
    content: `\\documentclass{beamer}

\\usetheme{Madrid}
\\usecolortheme{default}

\\title{Presentation Title}
\\author{Author Name}
\\institute{Institution}
\\date{\\today}

\\begin{document}

\\begin{frame}
\\titlepage
\\end{frame}

\\begin{frame}{Outline}
\\tableofcontents
\\end{frame}

\\section{Introduction}
\\begin{frame}{Introduction}
\\begin{itemize}
  \\item First point
  \\item Second point
  \\item Third point
\\end{itemize}
\\end{frame}

\\section{Main Content}
\\begin{frame}{Main Content}
Your content here.
\\end{frame}

\\section{Conclusion}
\\begin{frame}{Conclusion}
\\begin{itemize}
  \\item Summary point 1
  \\item Summary point 2
\\end{itemize}
\\end{frame}

\\end{document}`,
  },
  {
    id: "book",
    name: "Book",
    description: "Full book layout with front matter, chapters, and back matter",
    category: "document",
    content: `\\documentclass[12pt]{book}

\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{amsmath,amssymb}
\\usepackage{graphicx}
\\usepackage{hyperref}

\\title{Book Title}
\\author{Author Name}
\\date{\\today}

\\begin{document}

\\frontmatter
\\maketitle
\\tableofcontents

\\mainmatter

\\chapter{Introduction}
Your introduction here.

\\chapter{Chapter One}
Content of chapter one.

\\chapter{Chapter Two}
Content of chapter two.

\\backmatter

\\end{document}`,
  },
  {
    id: "letter",
    name: "Letter",
    description: "Formal letter with sender/recipient addresses",
    category: "document",
    content: `\\documentclass{letter}

\\signature{Your Name}
\\address{Your Address \\\\ City, State ZIP}

\\begin{document}

\\begin{letter}{Recipient Name \\\\ Recipient Address \\\\ City, State ZIP}

\\opening{Dear Sir or Madam,}

Your letter content here.

\\closing{Sincerely,}

\\end{letter}

\\end{document}`,
  },
  {
    id: "homework",
    name: "Homework / Assignment",
    description: "Clean homework layout with problem/solution structure",
    category: "document",
    content: `\\documentclass[12pt]{article}

\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{amsmath,amssymb}
\\usepackage[margin=1in]{geometry}

\\title{Homework \\#1}
\\author{Your Name}
\\date{\\today}

\\newcounter{problem}
\\newcommand{\\problem}{\\stepcounter{problem}\\paragraph{Problem \\theproblem.}}

\\begin{document}

\\maketitle

\\problem
State the problem here.

\\textbf{Solution.}
Write your solution here.

\\problem
State the next problem here.

\\textbf{Solution.}
Write your solution here.

\\end{document}`,
  },
  {
    id: "resume",
    name: "Resume / CV",
    description: "Clean one-page resume with sections for experience and education",
    category: "document",
    content: `\\documentclass[11pt]{article}

\\usepackage[margin=0.75in]{geometry}
\\usepackage[T1]{fontenc}
\\usepackage{enumitem}
\\usepackage{hyperref}

\\pagestyle{empty}
\\setlength{\\parindent}{0pt}

\\begin{document}

\\begin{center}
{\\LARGE \\textbf{Your Name}}\\\\[4pt]
your.email@example.com \\quad | \\quad (123) 456-7890 \\quad | \\quad City, State
\\end{center}

\\vspace{8pt}
\\hrule
\\vspace{8pt}

\\section*{Education}
\\textbf{University Name} \\hfill Expected May 2025\\\\
B.S. in Computer Science, GPA: 3.9/4.0

\\section*{Experience}
\\textbf{Company Name} --- Software Engineer Intern \\hfill Jun 2024 -- Aug 2024
\\begin{itemize}[nosep, leftmargin=*]
  \\item Built and deployed features used by 10K+ users
  \\item Reduced API latency by 40\\% through query optimization
\\end{itemize}

\\section*{Skills}
\\textbf{Languages:} Python, TypeScript, C++, SQL\\\\
\\textbf{Tools:} Git, Docker, AWS, React, Node.js

\\end{document}`,
  },
]

export const snippetTemplates: Template[] = [
  {
    id: "figure",
    name: "Figure",
    description: "Figure with image, caption, and label",
    category: "snippet",
    content: `\\begin{figure}[htbp]
  \\centering
  % \\includegraphics[width=0.8\\textwidth]{filename}
  \\caption{Your caption here}
  \\label{fig:label}
\\end{figure}`,
  },
  {
    id: "table",
    name: "Table",
    description: "Table with header row and sample data",
    category: "snippet",
    content: `\\begin{table}[htbp]
  \\centering
  \\caption{Your Title}
  \\label{tab:label}
  \\begin{tabular}{lcc}
    \\hline
    \\textbf{Column 1} & \\textbf{Column 2} & \\textbf{Column 3} \\\\
    \\hline
    Value 1 & Value 2 & Value 3 \\\\
    Value 4 & Value 5 & Value 6 \\\\
    \\hline
  \\end{tabular}
\\end{table}`,
  },
  {
    id: "equation",
    name: "Equation",
    description: "Labeled equation environment",
    category: "snippet",
    content: `\\begin{equation}
  f(x) = ax^2 + bx + c
  \\label{eq:label}
\\end{equation}`,
  },
  {
    id: "align",
    name: "Align",
    description: "Multi-line aligned equations",
    category: "snippet",
    content: `\\begin{align}
  a &= b + c \\\\
  d &= e + f
\\end{align}`,
  },
  {
    id: "itemize",
    name: "Bullet List",
    description: "Unordered list with items",
    category: "snippet",
    content: `\\begin{itemize}
  \\item First item
  \\item Second item
  \\item Third item
\\end{itemize}`,
  },
  {
    id: "enumerate",
    name: "Numbered List",
    description: "Ordered list with items",
    category: "snippet",
    content: `\\begin{enumerate}
  \\item First item
  \\item Second item
  \\item Third item
\\end{enumerate}`,
  },
  {
    id: "bibliography",
    name: "Bibliography",
    description: "Manual bibliography with entries",
    category: "snippet",
    content: `\\begin{thebibliography}{9}
  \\bibitem{ref1}
    Author Name,
    \\textit{Title of the Work},
    Publisher, Year.
\\end{thebibliography}`,
  },
  {
    id: "matrix",
    name: "Matrix",
    description: "Matrix with parentheses",
    category: "snippet",
    content: `\\begin{equation}
  A = \\begin{pmatrix}
    a_{11} & a_{12} \\\\
    a_{21} & a_{22}
  \\end{pmatrix}
\\end{equation}`,
  },
  {
    id: "tikz-simple",
    name: "TikZ Diagram",
    description: "Simple TikZ diagram with nodes and arrows",
    category: "snippet",
    content: `% Requires \\usepackage{tikz} in preamble
\\begin{figure}[htbp]
  \\centering
  \\begin{tikzpicture}[node distance=2cm, auto]
    \\node (A) {Start};
    \\node (B) [right of=A] {Process};
    \\node (C) [right of=B] {End};
    \\draw[->] (A) -- (B);
    \\draw[->] (B) -- (C);
  \\end{tikzpicture}
  \\caption{Simple flow diagram}
  \\label{fig:tikz}
\\end{figure}`,
  },
  {
    id: "code-listing",
    name: "Code Listing",
    description: "Code block with syntax highlighting",
    category: "snippet",
    content: `% Requires \\usepackage{listings} in preamble
\\begin{lstlisting}[language=Python, caption={Your caption}]
def hello():
    print("Hello, World!")
\\end{lstlisting}`,
  },
]

export const allTemplates = [...documentTemplates, ...snippetTemplates]
