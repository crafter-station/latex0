"use client"

import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { useRef, useEffect, useState, useMemo, useCallback } from "react"
import { useFiles } from "@/hooks/use-files"
import { useChatStore } from "@/lib/chat-store"
import { ChatInput, type ChatInputRef } from "./chat-input"
import type { SelectionContext } from "@/stores/selection-context-store"
import { ChatMessages } from "./chat-messages"
import { cn } from "@/lib/utils"
import { uploadAndAddToTree } from "@/lib/upload-helpers"
import { IconMessageX } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { ScrollArea } from "@/components/ui/scroll-area"

export function ChatInterface() {
  const { activeContent, updateFileContentWithDiff, activeTabId, pendingAIRequest, clearAIRequest } = useFiles()
  const activeSessionId = useChatStore((s) => s.activeSessionId)
  const session = useChatStore((s) =>
    s.sessions.find((sess) => sess.id === s.activeSessionId)
  )
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<ChatInputRef>(null)
  const [input, setInput] = useState("")

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
    sendAutomaticallyWhen({ messages: msgs }) {
      const lastMessage = msgs[msgs.length - 1]
      if (!lastMessage || lastMessage.role !== "assistant") return false
      const toolParts = lastMessage.parts.filter(
        (p) => p.type.startsWith("tool-") || p.type === "dynamic-tool"
      ) as Array<{ type: string; state?: string }>
      if (toolParts.length === 0) return false
      return toolParts.every(
        (p) => p.state === "output-available" || p.state === "output-error"
      )
    },
    onToolCall: async ({ toolCall }) => {
      const currentContent = activeContentRef.current
      const currentTabId = activeTabIdRef.current

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
        const { templateType } = toolCall.input as {
          templateType: string
          customDescription?: string
        }

        const templates: Record<string, string> = {
          article: `\\documentclass[12pt]{article}\n\n\\usepackage[utf8]{inputenc}\n\\usepackage[T1]{fontenc}\n\\usepackage{amsmath,amssymb,amsthm}\n\\usepackage{graphicx}\n\\usepackage{hyperref}\n\n\\title{Your Title Here}\n\\author{Author Name}\n\\date{\\today}\n\n\\begin{document}\n\n\\maketitle\n\n\\begin{abstract}\nYour abstract here.\n\\end{abstract}\n\n\\section{Introduction}\nYour introduction here.\n\n\\section{Conclusion}\nYour conclusion here.\n\n\\end{document}`,
        }

        const template = templates[templateType] || `% Template for ${templateType}`
        const isFullDocument = ["article", "report", "book", "beamer", "letter"].includes(templateType)

        if (isFullDocument && currentTabId) {
          updateFileContentWithDiff(currentTabId, template, `Created new ${templateType} document`)
          addToolResult({
            tool: "suggestTemplate" as never,
            toolCallId: toolCall.toolCallId,
            output: { success: true, templateType } as never,
          })
        } else {
          addToolResult({
            tool: "suggestTemplate" as never,
            toolCallId: toolCall.toolCallId,
            output: { template, templateType } as never,
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

  const isLoading = status === "streaming" || status === "submitted"

  // Handle pending AI fix requests
  useEffect(() => {
    if (pendingAIRequest && pendingAIRequest.prompt) {
      sendMessage({ text: pendingAIRequest.prompt })
      clearAIRequest()
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [pendingAIRequest, sendMessage, clearAIRequest])

  const handleSend = useCallback((text: string, context?: SelectionContext) => {
    if (text.trim()) {
      let messageText = text
      if (context) {
        const lineInfo = context.startLine === context.endLine
          ? `Line ${context.startLine}`
          : `Lines ${context.startLine}-${context.endLine}`
        messageText = `[Context from ${context.fileName}, ${lineInfo}]:\n\`\`\`\n${context.text}\n\`\`\`\n\n${text}`
      }

      sendMessage({ text: messageText })
      setInput("")
    }
  }, [sendMessage])

  const handleImageUpload = useCallback(async (file: File) => {
    try {
      await uploadAndAddToTree(file)
    } catch {
      // Error handled
    }
  }, [])

  const handleClearChat = () => {
    setMessages([])
  }

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p className="text-sm">Select a chat or create a new one</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-2">
        <h3 className="text-sm font-medium truncate">{session.name}</h3>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={handleClearChat}
            >
              <IconMessageX className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Clear Chat</TooltipContent>
        </Tooltip>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1" ref={scrollRef}>
        <ChatMessages messages={messages} isLoading={isLoading} status={status} />
      </ScrollArea>

      {/* Input */}
      <div className="border-t p-3">
        <div className="rounded-2xl border bg-muted/30 p-1">
          <ChatInput
            ref={inputRef}
            onSend={handleSend}
            onImageUpload={handleImageUpload}
            disabled={isLoading}
            onStop={stop}
            isLoading={isLoading}
            value={input}
            onChange={setInput}
            isExpanded={true}
          />
        </div>
      </div>
    </div>
  )
}
