import { create } from 'zustand'

export interface FileNode {
  id: string
  name: string
  type: 'file' | 'folder'
  content?: string
  children?: FileNode[]
  parentId?: string
}

export interface PendingChange {
  fileId: string
  originalContent: string  // The original content before any changes
  currentContent: string   // The current content after all changes
  descriptions: string[]   // List of all change descriptions
}

export interface PendingAIRequest {
  prompt: string
  context?: string
}

interface FileStore {
  files: FileNode[]
  openTabs: string[]
  activeTabId: string | null
  compiledHtml: string | null
  pendingChange: PendingChange | null
  pendingAIRequest: PendingAIRequest | null
  goToLine: number | null
  triggerCompile: number
  setFiles: (files: FileNode[]) => void
  openFile: (id: string) => void
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void
  updateFileContent: (id: string, content: string) => void
  updateFileContentWithDiff: (id: string, content: string, description: string) => void
  setCompiledHtml: (html: string | null) => void
  getFileById: (id: string) => FileNode | undefined
  getFileContent: (id: string) => string | undefined
  setPendingChange: (change: PendingChange | null) => void
  acceptChange: () => void
  rejectChange: () => void
  requestAIFix: (prompt: string, context?: string) => void
  clearAIRequest: () => void
  setGoToLine: (line: number | null) => void
  requestCompile: () => void
  resetToDefaults: () => void
}

const defaultFiles: FileNode[] = [
  {
    id: '1',
    name: 'main.tex',
    type: 'file',
    content: `\\documentclass[12pt]{article}

\\usepackage[T1]{fontenc}
\\usepackage{lmodern}

\\title{The Shipping Bible}
\\author{Crafter Station}
\\date{A Playbook for Building in Public}

\\begin{document}

\\maketitle

\\begin{center}
\\textit{Ship > Perfect. A working demo beats a perfect plan.}
\\end{center}

\\section{Philosophy}

Building great software isn't about perfection---it's about momentum. Every feature shipped is a lesson learned, every demo is feedback collected, every launch is progress made.

\\begin{quote}
\\textbf{The best code is code that ships.}
\\end{quote}

\\section{The Shipping Cycle}

The cycle that drives continuous improvement:

\\begin{center}
\\textbf{Think} $\\rightarrow$ \\textbf{Share} $\\rightarrow$ \\textbf{Build} $\\rightarrow$ \\textbf{Ship} $\\rightarrow$ \\textbf{Learn} $\\rightarrow$ \\textit{(repeat)}
\\end{center}

\\section{Six-Phase Lifecycle}

\\subsection{Phase 1: Spark}
Every project begins with an idea. Capture it quickly, validate it with others, and decide if it's worth pursuing.

\\subsection{Phase 2: Plan}
Keep plans lightweight. A simple list of milestones beats a complex roadmap.

\\begin{itemize}
  \\item Define the MVP scope
  \\item Set a ship date (and stick to it)
  \\item Identify the first users
\\end{itemize}

\\subsection{Phase 3: Build}
Focus on the core value proposition. Cut features ruthlessly.

\\subsection{Phase 4: Ship}
Launch early. Launch often. Every release is a chance to learn.

\\subsection{Phase 5: Learn}
Collect feedback systematically. Metrics + user conversations = insights.

\\subsection{Phase 6: Iterate}
Apply learnings to the next cycle. Compound improvements over time.

\\section{Key Principles}

\\begin{enumerate}
  \\item \\textbf{Speed over perfection} --- Ship fast, fix fast
  \\item \\textbf{Public over private} --- Build in the open
  \\item \\textbf{Users over features} --- Solve real problems
  \\item \\textbf{Learning over planning} --- Adapt continuously
\\end{enumerate}

\\section{Conclusion}

The best products aren't built in isolation---they're shaped by continuous shipping, feedback, and iteration. Start small, ship often, and let your users guide the way.

\\begin{center}
---

\\textit{Made with LaTeX0}
\\end{center}

\\end{document}
`,
  },
  {
    id: '2',
    name: 'references.bib',
    type: 'file',
    content: `@article{einstein1905,
  author = {Einstein, Albert},
  title = {On the Electrodynamics of Moving Bodies},
  journal = {Annalen der Physik},
  year = {1905},
  volume = {322},
  number = {10},
  pages = {891--921}
}
`,
  },
  {
    id: '3',
    name: 'images',
    type: 'folder',
    children: [
      {
        id: '4',
        name: 'figure1.png',
        type: 'file',
        parentId: '3',
      },
    ],
  },
]

function findFile(files: FileNode[], id: string): FileNode | undefined {
  for (const file of files) {
    if (file.id === id) return file
    if (file.children) {
      const found = findFile(file.children, id)
      if (found) return found
    }
  }
  return undefined
}

function updateFile(files: FileNode[], id: string, content: string): FileNode[] {
  return files.map((file) => {
    if (file.id === id) {
      return { ...file, content }
    }
    if (file.children) {
      return { ...file, children: updateFile(file.children, id, content) }
    }
    return file
  })
}

export const useFileStore = create<FileStore>((set, get) => ({
  files: defaultFiles,
  openTabs: ['1'],
  activeTabId: '1',
  compiledHtml: null,
  pendingChange: null,
  pendingAIRequest: null,
  goToLine: null,
  triggerCompile: 0,

  setFiles: (files) => set({ files }),

  openFile: (id) => {
    const { openTabs, files } = get()
    const file = findFile(files, id)
    if (!file || file.type === 'folder') return

    if (!openTabs.includes(id)) {
      set({ openTabs: [...openTabs, id], activeTabId: id })
    } else {
      set({ activeTabId: id })
    }
  },

  closeTab: (id) => {
    const { openTabs, activeTabId } = get()
    const newTabs = openTabs.filter((tabId) => tabId !== id)

    let newActiveTab = activeTabId
    if (activeTabId === id) {
      const closedIndex = openTabs.indexOf(id)
      newActiveTab = newTabs[Math.min(closedIndex, newTabs.length - 1)] || null
    }

    set({ openTabs: newTabs, activeTabId: newActiveTab })
  },

  setActiveTab: (id) => set({ activeTabId: id }),

  updateFileContent: (id, content) => {
    set((state) => ({
      files: updateFile(state.files, id, content),
    }))
  },

  updateFileContentWithDiff: (id, content, description) => {
    const { pendingChange } = get()
    const currentFileContent = get().getFileContent(id) || ''

    // If there's already a pending change for this file, accumulate changes
    if (pendingChange && pendingChange.fileId === id) {
      set((state) => ({
        pendingChange: {
          fileId: id,
          originalContent: pendingChange.originalContent, // Keep the original
          currentContent: content,
          descriptions: [...pendingChange.descriptions, description],
        },
        files: updateFile(state.files, id, content),
      }))
    } else {
      // New pending change - store the current content as original
      set((state) => ({
        pendingChange: {
          fileId: id,
          originalContent: currentFileContent,
          currentContent: content,
          descriptions: [description],
        },
        files: updateFile(state.files, id, content),
      }))
    }
  },

  setCompiledHtml: (html) => set({ compiledHtml: html }),

  getFileById: (id) => findFile(get().files, id),

  getFileContent: (id) => {
    const file = findFile(get().files, id)
    return file?.content
  },

  setPendingChange: (change) => set({ pendingChange: change }),

  acceptChange: () => {
    // Simply clear the pending change - the content is already applied
    set({ pendingChange: null })
  },

  rejectChange: () => {
    const { pendingChange } = get()
    if (pendingChange) {
      // Restore the original content (before all changes)
      set((state) => ({
        files: updateFile(state.files, pendingChange.fileId, pendingChange.originalContent),
        pendingChange: null,
      }))
    }
  },

  requestAIFix: (prompt, context) => {
    set({ pendingAIRequest: { prompt, context } })
  },

  clearAIRequest: () => {
    set({ pendingAIRequest: null })
  },

  setGoToLine: (line) => set({ goToLine: line }),

  requestCompile: () => set((state) => ({ triggerCompile: state.triggerCompile + 1 })),

  resetToDefaults: () => {
    set({
      files: defaultFiles,
      openTabs: ['1'],
      activeTabId: '1',
      compiledHtml: null,
      pendingChange: null,
      pendingAIRequest: null,
      goToLine: null,
      triggerCompile: 0,
    })
  },
}))
