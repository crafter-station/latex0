import type { FileNode } from "@/lib/file-store"

export function findMainFile(files: FileNode[]): FileNode {
  // 1. Look for "main.tex"
  let main = findFileByName(files, "main.tex")
  if (main) return main

  // 2. Look for file with \documentclass
  main = findFileWithPattern(files, /\\documentclass/)
  if (main) return main

  // 3. First .tex file
  const firstTex = findAllFiles(files).find((f) => f.name.endsWith(".tex"))
  if (firstTex) return firstTex

  // 4. Fallback to first file
  return files[0]
}

export function findFileByName(
  files: FileNode[],
  name: string
): FileNode | null {
  for (const file of files) {
    if (file.name === name) return file
    if (file.children) {
      const found = findFileByName(file.children, name)
      if (found) return found
    }
  }
  return null
}

export function findFileWithPattern(
  files: FileNode[],
  pattern: RegExp
): FileNode | null {
  for (const file of files) {
    if (file.type === "file" && file.content?.match(pattern)) {
      return file
    }
    if (file.children) {
      const found = findFileWithPattern(file.children, pattern)
      if (found) return found
    }
  }
  return null
}

export function findAllFiles(files: FileNode[]): FileNode[] {
  const result: FileNode[] = []
  for (const file of files) {
    if (file.type === "file") result.push(file)
    if (file.children) result.push(...findAllFiles(file.children))
  }
  return result
}
