import type { FileNode } from "@/lib/file-store"
import { findAllFiles } from "@/lib/file-utils"
import { isImageFile } from "@/lib/upload-helpers"

export interface ImageMap {
  [filename: string]: { url: string }
}

export async function bundleLatexFiles(
  files: FileNode[],
  mainFile: FileNode
): Promise<{ source: string; images: ImageMap }> {
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

  // 2. Collect images with blob URLs for the SDK
  const images: ImageMap = {}
  const imageFiles = allFiles.filter(
    (f) => f.blobUrl && isImageFile(f.name)
  )

  for (const imageFile of imageFiles) {
    const basename = imageFile.name
    const parentPath = findParentPath(files, imageFile.id)

    // Map all path variants the document might reference
    images[basename] = { url: imageFile.blobUrl! }
    if (parentPath) {
      images[`${parentPath}/${basename}`] = { url: imageFile.blobUrl! }
    }
  }

  // 3. Auto-inject \usepackage{graphicx} if the document uses \includegraphics
  // but doesn't load graphicx (prevents "Undefined control sequence" errors)
  if (
    bundled.includes("\\includegraphics") &&
    !bundled.includes("\\usepackage{graphicx}") &&
    !bundled.match(/\\usepackage\[.*\]\{graphicx\}/)
  ) {
    bundled = bundled.replace(
      /(\\documentclass(?:\[[^\]]*\])?\{[^}]+\})/,
      "$1\n\\usepackage{graphicx}"
    )
  }

  return { source: bundled, images }
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
