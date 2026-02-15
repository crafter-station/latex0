import type { FileNode } from "@/lib/file-store"

export function parseDocumentContent(content: string): FileNode[] {
  try {
    const parsed = JSON.parse(content)
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0]?.id) {
      return parsed as FileNode[]
    }
  } catch {
    // Not JSON — legacy plain LaTeX format
  }

  return [
    {
      id: "main",
      name: "main.tex",
      type: "file",
      content,
    },
  ]
}

export function serializeFileTree(files: FileNode[]): string {
  return JSON.stringify(files)
}
