import type { FileNode } from "@/lib/file-store"
import { findAllFiles } from "@/lib/file-utils"
import { isImageFile, formatFileSize } from "@/lib/upload-helpers"

export async function bundleLatexFiles(
  files: FileNode[],
  mainFile: FileNode
): Promise<string> {
  if (!mainFile.content) {
    throw new Error("Main file has no content")
  }

  let bundled = mainFile.content
  const allFiles = findAllFiles(files)

  // 1. Bundle \input{} and \include{} (text files)
  for (const file of allFiles) {
    if (file.type !== "file" || file.id === mainFile.id) continue
    if (!file.content) continue

    const baseName = file.name.replace(/\.tex$/, "")

    // Build path variants: "name", "name.tex", "folder/name", "folder/name.tex"
    const pathVariants = [baseName, file.name]

    // If file has a parent folder, also match with folder prefix
    const parentPath = findParentPath(files, file.id)
    if (parentPath) {
      pathVariants.push(`${parentPath}/${baseName}`, `${parentPath}/${file.name}`)
    }

    for (const variant of pathVariants) {
      const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      const inputPattern = new RegExp(`\\\\input\\{${escaped}\\}`, "g")
      const includePattern = new RegExp(`\\\\include\\{${escaped}\\}`, "g")
      bundled = bundled.replace(inputPattern, file.content)
      bundled = bundled.replace(includePattern, file.content)
    }
  }

  // 2. Replace \includegraphics{} for images with blob URLs
  // pdflatex can't fetch URLs or decode data URIs, so we generate a
  // visual placeholder box that compiles cleanly and shows image metadata.
  const imageFiles = allFiles.filter(
    (f) => f.blobUrl && isImageFile(f.name)
  )

  for (const imageFile of imageFiles) {
    const basename = imageFile.name
    const parentPath = findParentPath(files, imageFile.id)
    const pathVariants = [basename]
    if (parentPath) pathVariants.push(`${parentPath}/${basename}`)

    const noExt = basename.replace(/\.[^.]+$/, "")
    pathVariants.push(noExt)
    if (parentPath) pathVariants.push(`${parentPath}/${noExt}`)

    const isReferenced = pathVariants.some((v) => bundled.includes(v))
    if (!isReferenced) continue

    // Build a placeholder that compiles: a framed box with image info
    const meta = imageFile.blobMetadata
    const dimStr = meta?.width && meta?.height
      ? `${meta.width}\\times${meta.height}px`
      : ""
    const sizeStr = meta ? formatFileSize(meta.size) : ""
    const infoLine = [dimStr, sizeStr].filter(Boolean).join(" -- ")

    // The placeholder replaces the entire \includegraphics[...]{path} command
    // with a visible gray box so the figure/caption/label still work
    const placeholder =
      `\\fbox{\\parbox{0.7\\textwidth}{\\centering\\vspace{12pt}{\\sffamily\\small\\textbf{${escapeLatex(basename)}}}` +
      (infoLine ? `\\\\[4pt]{\\sffamily\\scriptsize ${escapeLatex(infoLine)}}` : "") +
      `\\vspace{12pt}}}`

    for (const variant of pathVariants) {
      const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      // Match \includegraphics[...]{path} or \includegraphics{path}
      const pattern = new RegExp(
        `\\\\includegraphics(?:\\[[^\\]]*\\])?\\{${escaped}\\}`,
        "g"
      )
      bundled = bundled.replace(pattern, placeholder)
    }
  }

  // 3. Auto-inject \usepackage{graphicx} if the document uses \includegraphics
  // but doesn't load graphicx (prevents "Undefined control sequence" errors)
  if (
    bundled.includes("\\includegraphics") &&
    !bundled.includes("\\usepackage{graphicx}") &&
    !bundled.match(/\\usepackage\[.*\]\{graphicx\}/)
  ) {
    // Insert after \documentclass line
    bundled = bundled.replace(
      /(\\documentclass(?:\[[^\]]*\])?\{[^}]+\})/,
      "$1\n\\usepackage{graphicx}"
    )
  }

  return bundled
}

function findParentPath(
  files: FileNode[],
  targetId: string,
  currentPath = ""
): string | null {
  for (const file of files) {
    if (file.children) {
      const childPath = currentPath ? `${currentPath}/${file.name}` : file.name
      for (const child of file.children) {
        if (child.id === targetId) return childPath
      }
      const found = findParentPath(file.children, targetId, childPath)
      if (found) return found
    }
  }
  return null
}

/** Escape special LaTeX characters in user-provided text */
function escapeLatex(text: string): string {
  return text
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/[&%$#_{}~^]/g, (ch) => `\\${ch}`)
}
