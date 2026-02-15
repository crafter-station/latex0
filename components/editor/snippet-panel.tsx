"use client"

import { useState } from "react"
import { snippetTemplates } from "@/lib/templates"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { IconCode } from "@tabler/icons-react"

interface SnippetPanelProps {
  onInsert: (content: string) => void
}

export function SnippetPanel({ onInsert }: SnippetPanelProps) {
  const [open, setOpen] = useState(false)

  const handleInsert = (content: string) => {
    onInsert(content)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 rounded-full px-3 text-xs text-muted-foreground hover:text-foreground"
        >
          <IconCode className="size-3.5" />
          Tools
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start" side="bottom">
        <div className="border-b px-3 py-2">
          <h4 className="text-sm font-medium">LaTeX Snippets</h4>
          <p className="text-xs text-muted-foreground">Click to insert at cursor</p>
        </div>
        <ScrollArea className="h-64">
          <div className="flex flex-col gap-0.5 p-1">
            {snippetTemplates.map((snippet) => (
              <button
                key={snippet.id}
                type="button"
                className="flex flex-col gap-0.5 rounded-md px-3 py-2 text-left hover:bg-accent transition-colors"
                onClick={() => handleInsert(snippet.content)}
              >
                <span className="text-sm font-medium">{snippet.name}</span>
                <span className="text-xs text-muted-foreground">{snippet.description}</span>
              </button>
            ))}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}
