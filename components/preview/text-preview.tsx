"use client"

import type { FileNode } from "@/lib/file-store"
import { ScrollArea } from "@/components/ui/scroll-area"

interface TextPreviewProps {
  file: FileNode
}

export function TextPreview({ file }: TextPreviewProps) {
  const content = file.content || ""
  const lines = content.split("\n")

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-4 py-2">
        <h3 className="text-sm font-medium">{file.name}</h3>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4">
          <pre className="text-sm font-mono whitespace-pre-wrap break-words">
            <table className="border-collapse">
              <tbody>
                {lines.map((line, i) => (
                  <tr key={i}>
                    <td className="pr-4 text-right text-muted-foreground/50 select-none align-top">
                      {i + 1}
                    </td>
                    <td className="whitespace-pre-wrap break-all">{line || " "}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </pre>
        </div>
      </ScrollArea>
    </div>
  )
}
