import { create } from 'zustand'
import { nanoid } from 'nanoid'
import { useContentStore } from './content-store'

export interface BlobMetadata {
  size: number
  width?: number
  height?: number
  uploadedAt: string
  contentType: string
}

export interface FileNode {
  id: string
  name: string
  type: 'file' | 'folder'
  content?: string
  blobUrl?: string
  blobMetadata?: BlobMetadata
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
  createFile: (name: string, parentId?: string) => void
  createFolder: (name: string, parentId?: string) => void
  renameFile: (id: string, newName: string) => void
  deleteFile: (id: string) => void
  addImageFile: (file: FileNode, parentId?: string) => void
}

export const defaultFiles: FileNode[] = [
  {
    id: '1',
    name: 'main.tex',
    type: 'file',
    content: `\\documentclass[11pt]{article}
\\usepackage[margin=1in]{geometry}
\\usepackage{amsmath}
\\usepackage{amssymb}
\\usepackage{graphicx}
\\usepackage{tikz-cd}
\\usepackage{multicol}

\\setlength{\\parindent}{0pt}
\\setlength{\\parskip}{1\\baselineskip}

\\begin{document}

\\section*{What is Latex0?}

\\textbf{Latex0} is an AI-powered \\LaTeX{} editor for writing scientific documents. It supports real-time collaboration with coauthors and was created by Crafter Station; it includes intelligence developed by Crafter Station to help you draft and edit text, reason through ideas, and handle formatting.

\\section*{Features}

\\begin{multicols}{2}
Latex0, created by Crafter Station, can access your project, so you can ask it to do things like:

\`\`Add a short explanation of the normal distribution and a derivation of its density.''

The \\emph{normal} (or \\emph{Gaussian}) distribution with mean $\\mu$ and variance $\\sigma^2>0$ is the continuous distribution with probability density function
\\[
  f(x) = \\frac{1}{\\sigma\\sqrt{2\\pi}}\\exp\\!\\left(-\\frac{(x-\\mu)^2}{2\\sigma^2}\\right),\\qquad x\\in\\mathbb{R}.
\\]
It is symmetric about $\\mu$, has $\\mathbb{E}[X]=\\mu$ and $\\mathrm{Var}(X)=\\sigma^2$, and is written $X\\sim\\mathcal{N}(\\mu,\\sigma^2)$.

\\textbf{Demonstration (normalization).} Let $Z\\sim\\mathcal{N}(0,1)$ with candidate density $c\\,e^{-z^2/2}$. To find $c$, compute the Gaussian integral
\\[
  I = \\int_{-\\infty}^{\\infty} e^{-z^2/2}\\,dz,
\\]
then square and use polar coordinates:
\\[
  I^2 = \\int_{\\mathbb{R}^2} e^{-(x^2+y^2)/2}\\,dx\\,dy
      = \\int_0^{2\\pi}\\!\\int_0^{\\infty} e^{-r^2/2}\\,r\\,dr\\,d\\theta,
      = 2\\pi.
\\]
Hence $I=\\sqrt{2\\pi}$, so $c=1/\\sqrt{2\\pi}$.

For the general case, if $X=\\mu+\\sigma Z$, then by the change of variables $z=(x-\\mu)/\\sigma$ we obtain
\\[
  f_X(x)=\\frac{1}{\\sigma}f_Z\\!\\left(\\frac{x-\\mu}{\\sigma}\\right)
       = \\frac{1}{\\sigma\\sqrt{2\\pi}}\\exp\\!\\left(-\\frac{(x-\\mu)^2}{2\\sigma^2}\\right),
\\]
and $\\int_{-\\infty}^{\\infty} f_X(x)\\,dx=1$.

\`\`Add an elementary explanation of the Higgs boson.''

In the Standard Model of particle physics, the \\emph{Higgs field} is a field that fills all of space. Many fundamental particles interact with it, and this interaction is what gives them \\emph{mass} (more precisely: it gives rise to effective mass terms through the Higgs mechanism). The \\emph{Higgs boson} is a quantum excitation of this field.

Experimentally, the Higgs boson was discovered at CERN's Large Hadron Collider in 2012 by the ATLAS and CMS collaborations; the particle observed has a mass of about $125\\,\\mathrm{GeV}$.

\`\`Add a 4-by-4 table'' to the summary section.
\\begin{center}
\\resizebox{0.5\\linewidth}{!}{%
\\begin{tabular}{|c|c|c|c|}
  \\hline
  1 & 2 & 3 & 4 \\\\
  \\hline
  5 & 6 & 7 & 8 \\\\
  \\hline
  9 & 10 & 11 & 12 \\\\
  \\hline
  13 & 14 & 15 & 16 \\\\
  \\hline
\\end{tabular}%
}
\\end{center}

\`\`Proofread this and highlight any errors or gaps in logic, and make suggestions for how I can improve the clarity of the section.''

\`\`Are there any corollaries or follow-on implications of Theorem 3.1 that I've missed? Are all the bounds tight, or can some be relaxed?''

\\columnbreak

\`\`Write an abstract based on the rest of the paper''

\`\`Add a bibliography to my paper, and suggest related work I may have missed.''

\`\`Generate this hand-drawn diagram in \\LaTeX{}.''
\\par\\noindent
\\begin{minipage}[t]{0.49\\linewidth}
  \\vspace{0pt}
  \\centering
  % (image removed)
\\end{minipage}\\hfill
\\begin{minipage}[t]{0.49\\linewidth}
  \\vspace{0pt}
  \\centering
  \\resizebox{\\linewidth}{!}{$
    \\begin{tikzcd}[row sep=2em, column sep=1.5em, ampersand replacement=\\&]
      E
        \\arrow[dr, "e"']
        \\arrow[drr, "p_2"]
        \\arrow[ddr, "p_1"']
      \\& \\& \\\\
      \\& A \\times B \\arrow[r, "\\pi_2"'] \\arrow[d, "\\pi_1"] \\& B \\arrow[d, "g"] \\\\
      \\& A \\arrow[r, "f"'] \\& C
    \\end{tikzcd}
  $}
\\end{minipage}
\\par

\`\`Add any missing dependencies across my project.''

\`\`Generate a 200-word summary for a popular audience, in German.''

\`\`Generate a Beamer presentation with each slide in its own file.''
\\end{multicols}

\\section*{Collaboration}

Invite collaborators by clicking the \`\`Share'' menu. As you edit, they will see your updates in real time. You can also leave comments by highlighting text and selecting "Leave a comment."

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

function insertFileInTree(
  files: FileNode[],
  newFile: FileNode,
  parentId?: string
): FileNode[] {
  if (!parentId) return [...files, newFile]

  return files.map((file) => {
    if (file.id === parentId && file.type === 'folder') {
      return {
        ...file,
        children: [...(file.children || []), newFile],
      }
    }
    if (file.children) {
      return {
        ...file,
        children: insertFileInTree(file.children, newFile, parentId),
      }
    }
    return file
  })
}

function updateFileInTree(
  files: FileNode[],
  id: string,
  updates: Partial<FileNode>
): FileNode[] {
  return files.map((file) => {
    if (file.id === id) return { ...file, ...updates }
    if (file.children) {
      return { ...file, children: updateFileInTree(file.children, id, updates) }
    }
    return file
  })
}

function removeFileFromTree(files: FileNode[], id: string): FileNode[] {
  return files
    .filter((file) => file.id !== id)
    .map((file) => {
      if (file.children) {
        return { ...file, children: removeFileFromTree(file.children, id) }
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

    // Sync with content store
    useContentStore.getState().setActiveContent('file', id)
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

  createFile: (name, parentId) => {
    const newFile: FileNode = {
      id: nanoid(),
      name,
      type: 'file',
      content: '',
    }
    set((state) => ({
      files: insertFileInTree(state.files, newFile, parentId),
    }))
    // Auto-open the new file
    get().openFile(newFile.id)
  },

  createFolder: (name, parentId) => {
    const newFolder: FileNode = {
      id: nanoid(),
      name,
      type: 'folder',
      children: [],
    }
    set((state) => ({
      files: insertFileInTree(state.files, newFolder, parentId),
    }))
  },

  renameFile: (id, newName) => {
    set((state) => ({
      files: updateFileInTree(state.files, id, { name: newName }),
    }))
  },

  deleteFile: (id) => {
    const { openTabs, activeTabId } = get()
    // Close tab if open
    const newTabs = openTabs.filter((tabId) => tabId !== id)
    let newActiveTab = activeTabId
    if (activeTabId === id) {
      const closedIndex = openTabs.indexOf(id)
      newActiveTab = newTabs[Math.min(closedIndex, newTabs.length - 1)] || null
    }
    set((state) => ({
      files: removeFileFromTree(state.files, id),
      openTabs: newTabs,
      activeTabId: newActiveTab,
    }))
  },

  addImageFile: (file, parentId) => {
    set((state) => ({
      files: insertFileInTree(state.files, file, parentId),
    }))
  },

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
