import type { Monaco } from "@monaco-editor/react"
import type { editor, Position } from "monaco-editor"
import { useFileStore } from "@/lib/file-store"
import { findImageByPath, formatFileSize } from "@/lib/upload-helpers"

let registered = false

export function registerLatexImageHoverProvider(monaco: Monaco) {
  if (registered) return
  registered = true

  monaco.languages.registerHoverProvider("latex", {
    provideHover: (model: editor.ITextModel, position: Position) => {
      const line = model.getLineContent(position.lineNumber)

      // Match \includegraphics[...]{path} or \includegraphics{path}
      const regex = /\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/g
      let match: RegExpExecArray | null

      while ((match = regex.exec(line)) !== null) {
        const startCol = match.index + 1
        const endCol = match.index + match[0].length + 1

        // Check if cursor is within this match
        if (position.column >= startCol && position.column <= endCol) {
          const imagePath = match[1]

          // Skip data URIs (already embedded)
          if (imagePath.startsWith("data:")) return null

          const files = useFileStore.getState().files
          const imageFile = findImageByPath(files, imagePath)

          if (!imageFile?.blobUrl) {
            return {
              range: new monaco.Range(
                position.lineNumber,
                startCol,
                position.lineNumber,
                endCol
              ),
              contents: [
                { value: `**${imagePath}**` },
                { value: "_Image not found in project files_" },
              ],
            }
          }

          const contents: { value: string }[] = [
            { value: `**${imageFile.name}**` },
            { value: `![Preview](${imageFile.blobUrl})` },
          ]

          if (imageFile.blobMetadata) {
            const meta = imageFile.blobMetadata
            const parts: string[] = []
            if (meta.width && meta.height) {
              parts.push(`${meta.width}×${meta.height}`)
            }
            parts.push(formatFileSize(meta.size))
            contents.push({ value: parts.join(" · ") })
          }

          return {
            range: new monaco.Range(
              position.lineNumber,
              startCol,
              position.lineNumber,
              endCol
            ),
            contents,
          }
        }
      }

      return null
    },
  })
}
