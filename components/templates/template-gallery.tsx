"use client"

import { useState } from "react"
import { IconCode, IconFileDescription } from "@tabler/icons-react"
import { documentTemplates, snippetTemplates } from "@/lib/templates"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface TemplateGalleryProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelectTemplate: (content: string, name: string) => void
}

type Tab = "documents" | "snippets"

export function TemplateGallery({
  open,
  onOpenChange,
  onSelectTemplate,
}: TemplateGalleryProps) {
  const [activeTab, setActiveTab] = useState<Tab>("documents")

  const templates =
    activeTab === "documents" ? documentTemplates : snippetTemplates

  const handleSelect = (content: string, name: string) => {
    onSelectTemplate(content, name)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Template Gallery</DialogTitle>
          <DialogDescription>
            Choose a template to start your document
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            className={cn(
              "gap-1.5",
              activeTab === "documents"
                ? "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
                : "bg-muted text-muted-foreground"
            )}
            onClick={() => setActiveTab("documents")}
          >
            <IconFileDescription className="size-4" />
            Documents
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className={cn(
              "gap-1.5",
              activeTab === "snippets"
                ? "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
                : "bg-muted text-muted-foreground"
            )}
            onClick={() => setActiveTab("snippets")}
          >
            <IconCode className="size-4" />
            Snippets
          </Button>
        </div>

        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pb-2">
            {templates.map((template) => (
              <button
                key={template.id}
                type="button"
                className="border rounded-lg p-4 hover:border-primary/50 hover:bg-accent/50 cursor-pointer transition-colors text-left flex flex-col gap-2"
                onClick={() => handleSelect(template.content, template.name)}
              >
                <span className="font-semibold text-sm">{template.name}</span>
                <span className="text-xs text-muted-foreground">
                  {template.description}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-auto w-full"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleSelect(template.content, template.name)
                  }}
                >
                  Use Template
                </Button>
              </button>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
