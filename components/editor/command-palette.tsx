"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
} from "@/components/ui/command"
import {
  IconFileDescription,
  IconPlayerPlay,
  IconDownload,
  IconSun,
  IconMoon,
  IconMessageX,
  IconBold,
  IconItalic,
  IconMath,
  IconList,
  IconListNumbers,
  IconTable,
  IconPhoto,
  IconMathFunction,
} from "@tabler/icons-react"
import { useDocumentStore } from "@/lib/document-store"
import { useFileStore } from "@/lib/file-store"
import { useProjectStore, docUrl } from "@/lib/project-store"
import { useTheme } from "next-themes"
import { snippetTemplates } from "@/lib/templates"

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const router = useRouter()
  const { resolvedTheme, setTheme } = useTheme()
  const documents = useDocumentStore((s) => s.documents)
  const requestCompile = useFileStore((s) => s.requestCompile)
  const activeProjectId = useProjectStore((s) => s.activeProjectId)

  // Global Cmd+K shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  const runAndClose = useCallback((fn: () => void) => {
    fn()
    setOpen(false)
  }, [])

  const handleToggleTheme = useCallback(() => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark")
  }, [resolvedTheme, setTheme])

  const handleInsertSnippet = useCallback((content: string) => {
    // Dispatch a custom event that the code editor listens for
    window.dispatchEvent(new CustomEvent("latex0:insert-snippet", { detail: content }))
  }, [])

  const snippetIcons: Record<string, React.ReactNode> = {
    figure: <IconPhoto className="size-4" />,
    table: <IconTable className="size-4" />,
    equation: <IconMathFunction className="size-4" />,
    align: <IconMath className="size-4" />,
    itemize: <IconList className="size-4" />,
    enumerate: <IconListNumbers className="size-4" />,
    matrix: <IconMath className="size-4" />,
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen} showCloseButton={false}>
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {/* Actions */}
        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => runAndClose(() => requestCompile())}>
            <IconPlayerPlay className="size-4" />
            <span>Compile PDF</span>
            <CommandShortcut>⌘↵</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => runAndClose(handleToggleTheme)}>
            {resolvedTheme === "dark" ? (
              <IconSun className="size-4" />
            ) : (
              <IconMoon className="size-4" />
            )}
            <span>Toggle Theme</span>
          </CommandItem>
          <CommandItem onSelect={() => runAndClose(() => {
            window.dispatchEvent(new CustomEvent("latex0:download-pdf"))
          })}>
            <IconDownload className="size-4" />
            <span>Download PDF</span>
          </CommandItem>
          <CommandItem onSelect={() => runAndClose(() => {
            window.dispatchEvent(new CustomEvent("latex0:clear-chat"))
          })}>
            <IconMessageX className="size-4" />
            <span>Clear Chat</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        {/* Text Formatting */}
        <CommandGroup heading="Formatting">
          <CommandItem onSelect={() => runAndClose(() => {
            window.dispatchEvent(new CustomEvent("latex0:wrap-selection", { detail: { prefix: "\\textbf{", suffix: "}" } }))
          })}>
            <IconBold className="size-4" />
            <span>Bold</span>
            <CommandShortcut>⌘B</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => runAndClose(() => {
            window.dispatchEvent(new CustomEvent("latex0:wrap-selection", { detail: { prefix: "\\textit{", suffix: "}" } }))
          })}>
            <IconItalic className="size-4" />
            <span>Italic</span>
            <CommandShortcut>⌘I</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => runAndClose(() => {
            window.dispatchEvent(new CustomEvent("latex0:wrap-selection", { detail: { prefix: "$", suffix: "$" } }))
          })}>
            <IconMath className="size-4" />
            <span>Math Mode</span>
            <CommandShortcut>⌘⇧M</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        {/* LaTeX Snippets */}
        <CommandGroup heading="Snippets">
          {snippetTemplates.map((snippet) => (
            <CommandItem
              key={snippet.id}
              onSelect={() => runAndClose(() => handleInsertSnippet(snippet.content))}
            >
              {snippetIcons[snippet.id] || <IconFileDescription className="size-4" />}
              <span>{snippet.name}</span>
            </CommandItem>
          ))}
        </CommandGroup>

        {/* Documents */}
        {documents.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Documents">
              {documents.map((doc) => (
                <CommandItem
                  key={doc.id}
                  onSelect={() => runAndClose(() => router.push(docUrl(doc.id, activeProjectId)))}
                >
                  <IconFileDescription className="size-4" />
                  <span>{doc.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  )
}
