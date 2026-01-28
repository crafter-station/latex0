"use client"

import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { useRef, useEffect, useState, useMemo, useCallback } from "react"
import { useFiles } from "@/hooks/use-files"
import { ChatInput, type ChatInputRef } from "./chat-input"
import { ChatMessages } from "./chat-messages"
import { cn } from "@/lib/utils"
import { IconMessageX, IconChevronDown } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { ScrollArea } from "@/components/ui/scroll-area"

export function ChatPanel() {
  const { activeContent, updateFileContentWithDiff, activeTabId, pendingAIRequest, clearAIRequest } = useFiles()
  const scrollRef = useRef<HTMLDivElement>(null)
  const collapsedInputRef = useRef<ChatInputRef>(null)
  const expandedInputRef = useRef<ChatInputRef>(null)
  const [input, setInput] = useState("")
  const [isExpanded, setIsExpanded] = useState(false)

  // Use refs to always get current values in async callbacks
  const activeContentRef = useRef(activeContent)
  const activeTabIdRef = useRef(activeTabId)

  useEffect(() => {
    activeContentRef.current = activeContent
  }, [activeContent])

  useEffect(() => {
    activeTabIdRef.current = activeTabId
  }, [activeTabId])

  const transport = useMemo(() => new DefaultChatTransport({
    api: "/api/chat",
    body: {
      documentContent: activeContent,
    },
  }), [activeContent])

  const {
    messages,
    sendMessage,
    setMessages,
    status,
    stop,
    addToolResult,
  } = useChat({
    transport,
    onToolCall: async ({ toolCall }) => {
      // Get current values from refs to avoid stale closures
      const currentContent = activeContentRef.current
      const currentTabId = activeTabIdRef.current

      // Handle client-side tool execution
      if (toolCall.toolName === "searchDocument") {
        const { query, caseSensitive } = toolCall.input as {
          query: string
          caseSensitive?: boolean
        }

        if (!currentContent) {
          addToolResult({
            tool: "searchDocument" as never,
            toolCallId: toolCall.toolCallId,
            output: { found: false, message: "No document is currently open" } as never,
          })
          return
        }

        const flags = caseSensitive ? "g" : "gi"
        try {
          const regex = new RegExp(query, flags)
          const matches = currentContent.match(regex)

          if (matches) {
            const lines = currentContent.split("\n")
            const matchLines: { line: number; content: string }[] = []

            lines.forEach((line, index) => {
              if (caseSensitive ? line.includes(query) : line.toLowerCase().includes(query.toLowerCase())) {
                matchLines.push({ line: index + 1, content: line.trim() })
              }
            })

            addToolResult({
              tool: "searchDocument" as never,
              toolCallId: toolCall.toolCallId,
              output: {
                found: true,
                count: matches.length,
                matches: matchLines.slice(0, 10),
              } as never,
            })
          } else {
            addToolResult({
              tool: "searchDocument" as never,
              toolCallId: toolCall.toolCallId,
              output: { found: false, message: `No matches found for "${query}"` } as never,
            })
          }
        } catch {
          addToolResult({
            tool: "searchDocument" as never,
            toolCallId: toolCall.toolCallId,
            output: { found: false, message: "Invalid search pattern" } as never,
          })
        }
        return
      }

      if (toolCall.toolName === "editDocument") {
        const { oldText, newText, explanation } = toolCall.input as {
          oldText: string
          newText: string
          explanation: string
        }

        if (!currentContent || !currentTabId) {
          addToolResult({
            tool: "editDocument" as never,
            toolCallId: toolCall.toolCallId,
            output: { success: false, message: "No document is currently open" } as never,
          })
          return
        }

        if (!currentContent.includes(oldText)) {
          addToolResult({
            tool: "editDocument" as never,
            toolCallId: toolCall.toolCallId,
            output: { success: false, message: `Could not find the text to replace: "${oldText.slice(0, 50)}..."` } as never,
          })
          return
        }

        const newContent = currentContent.replace(oldText, newText)
        updateFileContentWithDiff(currentTabId, newContent, explanation || "AI edited the document")

        addToolResult({
          tool: "editDocument" as never,
          toolCallId: toolCall.toolCallId,
          output: { success: true, explanation } as never,
        })
        return
      }

      if (toolCall.toolName === "insertText") {
        const { position, text, explanation } = toolCall.input as {
          position: string
          text: string
          explanation: string
        }

        if (!currentContent || !currentTabId) {
          addToolResult({
            tool: "insertText" as never,
            toolCallId: toolCall.toolCallId,
            output: { success: false, message: "No document is currently open" } as never,
          })
          return
        }

        let newContent = currentContent

        switch (position) {
          case "beginning":
            newContent = text + "\n" + currentContent
            break
          case "end":
            newContent = currentContent + "\n" + text
            break
          case "after-preamble": {
            const beginDocIndex = currentContent.indexOf("\\begin{document}")
            if (beginDocIndex !== -1) {
              const insertPos = currentContent.indexOf("\n", beginDocIndex) + 1
              newContent = currentContent.slice(0, insertPos) + text + "\n" + currentContent.slice(insertPos)
            } else {
              newContent = currentContent + "\n" + text
            }
            break
          }
          case "before-end-document": {
            const endDocIndex = currentContent.indexOf("\\end{document}")
            if (endDocIndex !== -1) {
              newContent = currentContent.slice(0, endDocIndex) + text + "\n" + currentContent.slice(endDocIndex)
            } else {
              newContent = currentContent + "\n" + text
            }
            break
          }
        }

        updateFileContentWithDiff(currentTabId, newContent, explanation || "AI inserted text")

        addToolResult({
          tool: "insertText" as never,
          toolCallId: toolCall.toolCallId,
          output: { success: true, explanation } as never,
        })
        return
      }

      if (toolCall.toolName === "getDocumentInfo") {
        const { infoType } = toolCall.input as { infoType: string }

        if (!currentContent) {
          addToolResult({
            tool: "getDocumentInfo" as never,
            toolCallId: toolCall.toolCallId,
            output: { message: "No document is currently open" } as never,
          })
          return
        }

        const info: Record<string, unknown> = {}

        if (infoType === "sections" || infoType === "all") {
          const sectionRegex = /\\(section|subsection|subsubsection|chapter|part)\{([^}]+)\}/g
          const sections: { type: string; title: string }[] = []
          let match
          while ((match = sectionRegex.exec(currentContent)) !== null) {
            sections.push({ type: match[1], title: match[2] })
          }
          info.sections = sections
        }

        if (infoType === "packages" || infoType === "all") {
          const packageRegex = /\\usepackage(?:\[[^\]]*\])?\{([^}]+)\}/g
          const packages: string[] = []
          let match
          while ((match = packageRegex.exec(currentContent)) !== null) {
            packages.push(match[1])
          }
          info.packages = packages
        }

        if (infoType === "environments" || infoType === "all") {
          const envRegex = /\\begin\{([^}]+)\}/g
          const environments: string[] = []
          let match
          while ((match = envRegex.exec(currentContent)) !== null) {
            if (!environments.includes(match[1])) {
              environments.push(match[1])
            }
          }
          info.environments = environments
        }

        if (infoType === "commands" || infoType === "all") {
          info.documentClass = currentContent.match(/\\documentclass(?:\[[^\]]*\])?\{([^}]+)\}/)?.[1]
          info.hasTitle = currentContent.includes("\\title{")
          info.hasAuthor = currentContent.includes("\\author{")
          info.hasMaketitle = currentContent.includes("\\maketitle")
          info.lineCount = currentContent.split("\n").length
        }

        addToolResult({
          tool: "getDocumentInfo" as never,
          toolCallId: toolCall.toolCallId,
          output: info as never,
        })
        return
      }

      if (toolCall.toolName === "suggestTemplate") {
        const { templateType, customDescription } = toolCall.input as {
          templateType: string
          customDescription?: string
        }

        const templates: Record<string, string> = {
          article: `\\documentclass[12pt]{article}

\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{amsmath,amssymb,amsthm}
\\usepackage{graphicx}
\\usepackage{hyperref}

\\title{Your Title Here}
\\author{Author Name}
\\date{\\today}

\\begin{document}

\\maketitle

\\begin{abstract}
Your abstract here.
\\end{abstract}

\\section{Introduction}
Your introduction here.

\\section{Main Content}
Your main content here.

\\section{Conclusion}
Your conclusion here.

\\end{document}`,
          report: `\\documentclass[12pt]{report}

\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{amsmath,amssymb}
\\usepackage{graphicx}
\\usepackage{hyperref}

\\title{Report Title}
\\author{Author Name}
\\date{\\today}

\\begin{document}

\\maketitle
\\tableofcontents

\\chapter{Introduction}
Your introduction here.

\\chapter{Background}
Background information here.

\\chapter{Methodology}
Your methodology here.

\\chapter{Results}
Your results here.

\\chapter{Conclusion}
Your conclusion here.

\\end{document}`,
          beamer: `\\documentclass{beamer}

\\usetheme{Madrid}
\\usecolortheme{default}

\\title{Presentation Title}
\\author{Author Name}
\\institute{Institution}
\\date{\\today}

\\begin{document}

\\begin{frame}
\\titlepage
\\end{frame}

\\begin{frame}{Outline}
\\tableofcontents
\\end{frame}

\\section{Introduction}
\\begin{frame}{Introduction}
\\begin{itemize}
  \\item First point
  \\item Second point
  \\item Third point
\\end{itemize}
\\end{frame}

\\section{Main Content}
\\begin{frame}{Main Content}
Your content here.
\\end{frame}

\\section{Conclusion}
\\begin{frame}{Conclusion}
\\begin{itemize}
  \\item Summary point 1
  \\item Summary point 2
\\end{itemize}
\\end{frame}

\\end{document}`,
          book: `\\documentclass[12pt]{book}

\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{amsmath,amssymb}
\\usepackage{graphicx}
\\usepackage{hyperref}

\\title{Book Title}
\\author{Author Name}
\\date{\\today}

\\begin{document}

\\frontmatter
\\maketitle
\\tableofcontents

\\mainmatter

\\chapter{Introduction}
Your introduction here.

\\chapter{Chapter One}
Content of chapter one.

\\chapter{Chapter Two}
Content of chapter two.

\\backmatter

\\end{document}`,
          letter: `\\documentclass{letter}

\\signature{Your Name}
\\address{Your Address \\\\ City, State ZIP}

\\begin{document}

\\begin{letter}{Recipient Name \\\\ Recipient Address \\\\ City, State ZIP}

\\opening{Dear Sir or Madam,}

Your letter content here.

\\closing{Sincerely,}

\\end{letter}

\\end{document}`,
          figure: `\\begin{center}
  % Image placeholder - use \\includegraphics with graphicx package for real images
  \\textit{[Figure: Your caption here]}
\\end{center}`,
          table: `\\begin{center}
\\textbf{Table: Your Title}

\\begin{quote}
\\textbf{Column 1} \\quad \\textbf{Column 2} \\quad \\textbf{Column 3}

Value 1 \\quad Value 2 \\quad Value 3

Value 4 \\quad Value 5 \\quad Value 6
\\end{quote}

\\textit{Note: Tables with borders are not supported in browser preview.}
\\end{center}`,
          equation: `\\begin{equation}
  f(x) = ax^2 + bx + c
  \\label{eq:label}
\\end{equation}`,
          itemize: `\\begin{itemize}
  \\item First item
  \\item Second item
  \\item Third item
\\end{itemize}`,
          enumerate: `\\begin{enumerate}
  \\item First item
  \\item Second item
  \\item Third item
\\end{enumerate}`,
          bibliography: `\\begin{thebibliography}{9}
  \\bibitem{ref1}
    Author Name,
    \\textit{Title of the Work},
    Publisher, Year.
\\end{thebibliography}`,
        }

        const template = templates[templateType] || `% Template for ${templateType}${customDescription ? `: ${customDescription}` : ''}`

        // For full document templates (article, report, book, beamer, letter), replace the entire document
        const isFullDocument = ["article", "report", "book", "beamer", "letter"].includes(templateType)

        if (isFullDocument && currentTabId) {
          // Replace entire document with the template
          updateFileContentWithDiff(currentTabId, template, `Created new ${templateType} document`)

          addToolResult({
            tool: "suggestTemplate" as never,
            toolCallId: toolCall.toolCallId,
            output: {
              success: true,
              templateType,
              message: `Created new ${templateType} document. You can now customize it based on the user's requirements.`,
            } as never,
          })
        } else {
          // For snippets, just return the template for the AI to use
          addToolResult({
            tool: "suggestTemplate" as never,
            toolCallId: toolCall.toolCallId,
            output: {
              template,
              templateType,
              message: "Use insertText or editDocument to add this to the document.",
            } as never,
          })
        }
        return
      }
    },
  })

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      const viewport = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]')
      if (viewport) {
        viewport.scrollTop = viewport.scrollHeight
      }
    }
  }, [messages])

  // Expand when there are messages or when loading
  const isLoading = status === "streaming" || status === "submitted"
  const hasMessages = messages.length > 0

  // Auto-expand when loading or has messages
  useEffect(() => {
    if (isLoading || hasMessages) {
      setIsExpanded(true)
    }
  }, [isLoading, hasMessages])

  // Handle pending AI fix requests from compilation errors
  useEffect(() => {
    if (pendingAIRequest && pendingAIRequest.prompt) {
      setIsExpanded(true)
      sendMessage({ text: pendingAIRequest.prompt })
      clearAIRequest()
      // Focus the expanded input after sending
      setTimeout(() => {
        expandedInputRef.current?.focus()
      }, 0)
    }
  }, [pendingAIRequest, sendMessage, clearAIRequest])

  const handleSend = useCallback((text: string) => {
    if (text.trim()) {
      setIsExpanded(true)
      sendMessage({ text })
      setInput("")
      // Focus the expanded input after sending
      setTimeout(() => {
        expandedInputRef.current?.focus()
      }, 0)
    }
  }, [sendMessage])

  const handleFocus = useCallback(() => {
    if (!isExpanded) {
      setIsExpanded(true)
      // Focus the expanded input after expansion
      setTimeout(() => {
        expandedInputRef.current?.focus()
      }, 0)
    }
  }, [isExpanded])

  const handleCollapse = () => {
    setIsExpanded(false)
  }

  const handleClearChat = () => {
    setMessages([])
  }

  // Collapsed state - just the floating input bar
  if (!isExpanded) {
    return (
      <div className="absolute bottom-0 left-0 right-0 z-10 pointer-events-none">
        <div className="pointer-events-auto">
          <ChatInput
            ref={collapsedInputRef}
            onSend={handleSend}
            disabled={isLoading}
            onStop={stop}
            isLoading={isLoading}
            value={input}
            onChange={setInput}
            onFocus={handleFocus}
          />
        </div>
      </div>
    )
  }

  // Expanded state - full chat panel
  return (
    <div className="absolute bottom-0 left-0 right-0 z-10 flex flex-col">
      <div
        className={cn(
          "flex flex-col overflow-hidden rounded-t-3xl rounded-b-[32px] border border-neutral-700 bg-neutral-900 shadow-lg shadow-black/30",
          "mx-3 mb-3"
        )}
        style={{ height: "300px" }}
      >
        {/* Header with drag handle and actions */}
        <div className="flex flex-col">
          {/* Drag handle */}
          <div className="flex w-full items-center justify-center p-1">
            <div className="h-1 w-10 rounded-full bg-neutral-600" />
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-between px-2 py-1">
            <div className="flex-1" />
            <div className="flex shrink-0 items-center">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 rounded-full text-neutral-400 hover:bg-neutral-800 hover:text-white"
                    onClick={handleClearChat}
                  >
                    <IconMessageX className="size-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Clear Chat</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 rounded-full text-neutral-400 hover:bg-neutral-800 hover:text-white"
                    onClick={handleCollapse}
                  >
                    <IconChevronDown className="size-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Collapse</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>

        {/* Messages area */}
        <div className="flex min-h-0 flex-1 flex-col">
          <ScrollArea className="h-full" ref={scrollRef}>
            <ChatMessages messages={messages} isLoading={isLoading} />
          </ScrollArea>
        </div>

        {/* Input area with highlighted background */}
        <div className="relative">
          <div className="m-1.5 rounded-3xl bg-neutral-800 p-1 pt-1 pl-1">
            <ChatInput
              ref={expandedInputRef}
              onSend={handleSend}
              disabled={isLoading}
              onStop={stop}
              isLoading={isLoading}
              value={input}
              onChange={setInput}
              onFocus={handleFocus}
              isExpanded
            />
          </div>
        </div>
      </div>
    </div>
  )
}
