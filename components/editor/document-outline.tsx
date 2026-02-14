"use client"

import { useMemo } from "react"
import { useFiles } from "@/hooks/use-files"
import { useFileStore } from "@/lib/file-store"
import { cn } from "@/lib/utils"
import { IconSection, IconSubtask, IconPoint, IconPhoto, IconTable, IconMath } from "@tabler/icons-react"

interface OutlineItem {
  type: "part" | "chapter" | "section" | "subsection" | "subsubsection" | "figure" | "table" | "equation"
  title: string
  line: number
}

const SECTION_DEPTH: Record<string, number> = {
  part: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
}

function parseOutline(content: string): OutlineItem[] {
  const items: OutlineItem[] = []
  const lines = content.split("\n")

  const sectionRegex = /\\(part|chapter|section|subsection|subsubsection)\*?\{([^}]+)\}/
  const figureRegex = /\\begin\{figure\}/
  const tableRegex = /\\begin\{table\}/
  const equationRegex = /\\begin\{(equation|align)\*?\}/
  const captionRegex = /\\caption\{([^}]+)\}/
  const labelRegex = /\\label\{([^}]+)\}/

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNumber = i + 1

    const sectionMatch = sectionRegex.exec(line)
    if (sectionMatch) {
      items.push({
        type: sectionMatch[1] as OutlineItem["type"],
        title: sectionMatch[2],
        line: lineNumber,
      })
      continue
    }

    if (figureRegex.test(line)) {
      // Look ahead for caption
      let caption = "Figure"
      for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
        const capMatch = captionRegex.exec(lines[j])
        if (capMatch) {
          caption = capMatch[1]
          break
        }
        if (/\\end\{figure\}/.test(lines[j])) break
      }
      items.push({ type: "figure", title: caption, line: lineNumber })
      continue
    }

    if (tableRegex.test(line)) {
      let caption = "Table"
      for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
        const capMatch = captionRegex.exec(lines[j])
        if (capMatch) {
          caption = capMatch[1]
          break
        }
        if (/\\end\{table\}/.test(lines[j])) break
      }
      items.push({ type: "table", title: caption, line: lineNumber })
      continue
    }

    if (equationRegex.test(line)) {
      // Look for label
      let label = "Equation"
      for (let j = i; j < Math.min(i + 5, lines.length); j++) {
        const labMatch = labelRegex.exec(lines[j])
        if (labMatch) {
          label = labMatch[1]
          break
        }
        if (/\\end\{(equation|align)\*?\}/.test(lines[j])) break
      }
      items.push({ type: "equation", title: label, line: lineNumber })
    }
  }

  return items
}

const iconMap: Record<string, React.ReactNode> = {
  part: <IconSection className="size-3.5 text-purple-500" />,
  chapter: <IconSection className="size-3.5 text-blue-500" />,
  section: <IconSection className="size-3.5 text-foreground" />,
  subsection: <IconSubtask className="size-3.5 text-muted-foreground" />,
  subsubsection: <IconPoint className="size-3.5 text-muted-foreground" />,
  figure: <IconPhoto className="size-3.5 text-green-500" />,
  table: <IconTable className="size-3.5 text-amber-500" />,
  equation: <IconMath className="size-3.5 text-blue-400" />,
}

const indentMap: Record<string, string> = {
  part: "pl-0",
  chapter: "pl-2",
  section: "pl-0",
  subsection: "pl-4",
  subsubsection: "pl-8",
  figure: "pl-2",
  table: "pl-2",
  equation: "pl-2",
}

export function DocumentOutline() {
  const { activeContent } = useFiles()
  const setGoToLine = useFileStore((s) => s.setGoToLine)

  const items = useMemo(() => {
    if (!activeContent) return []
    return parseOutline(activeContent)
  }, [activeContent])

  if (items.length === 0) {
    return (
      <div className="p-3 text-xs text-muted-foreground text-center">
        No sections found in document
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-0.5 p-1">
      {items.map((item, index) => (
        <button
          key={`${item.type}-${item.line}-${index}`}
          type="button"
          className={cn(
            "flex items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-accent transition-colors text-left w-full",
            indentMap[item.type]
          )}
          onClick={() => setGoToLine(item.line)}
        >
          {iconMap[item.type]}
          <span className="truncate">{item.title}</span>
          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground tabular-nums">
            {item.line}
          </span>
        </button>
      ))}
    </div>
  )
}
