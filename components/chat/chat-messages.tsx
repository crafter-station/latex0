"use client"

import { UIMessage } from "ai"
import { IconRobot } from "@tabler/icons-react"
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message"
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool"
import {
  ConversationEmptyState,
} from "@/components/ai-elements/conversation"
import { Loader } from "@/components/ai-elements/loader"
import {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
} from "@/components/ai-elements/reasoning"

interface ChatMessagesProps {
  messages: UIMessage[]
  isLoading: boolean
  status?: string
}

export function ChatMessages({ messages, isLoading, status }: ChatMessagesProps) {
  if (messages.length === 0) {
    return (
      <ConversationEmptyState
        icon={<IconRobot className="size-8 text-neutral-400 dark:text-neutral-600" />}
        title="LaTeX0"
        description="Ask me to help with your LaTeX document."
        className="py-4 text-xs"
      />
    )
  }

  return (
    <div className="flex flex-col gap-2 px-3 py-2">
      {messages.map((message, index) => (
        <Message key={`${message.id}-${index}`} from={message.role} className="max-w-full">
          <MessageContent className="text-xs">
            {message.parts.map((part, index) => {
              // Handle text parts with markdown rendering
              if (part.type === "text") {
                return message.role === "assistant" ? (
                  <MessageResponse key={index} className="text-xs [&_*]:text-xs [&_pre]:text-[10px] [&_code]:text-[10px]">
                    {part.text}
                  </MessageResponse>
                ) : (
                  <span key={index} className="whitespace-pre-wrap text-xs">
                    {part.text}
                  </span>
                )
              }

              // Handle reasoning parts
              if (part.type === "reasoning") {
                const reasoningPart = part as {
                  type: "reasoning"
                  text: string
                  state?: "streaming" | "done"
                }
                const isStreamingReasoning = reasoningPart.state === "streaming"

                return (
                  <Reasoning
                    key={index}
                    isStreaming={isStreamingReasoning}
                    className="mb-1 [&_*]:text-xs"
                  >
                    <ReasoningTrigger className="text-xs" />
                    <ReasoningContent className="text-xs">
                      {reasoningPart.text}
                    </ReasoningContent>
                  </Reasoning>
                )
              }

              // Handle tool parts
              if (part.type.startsWith("tool-") || part.type === "dynamic-tool") {
                const toolPart = part as {
                  type: string
                  toolCallId: string
                  toolName?: string
                  input?: unknown
                  output?: unknown
                  errorText?: string
                  state?: string
                }
                const toolName = part.type === "dynamic-tool"
                  ? toolPart.toolName ?? "Tool"
                  : part.type.replace("tool-", "")

                return (
                  <Tool key={toolPart.toolCallId || index} defaultOpen={false} className="mb-1">
                    <ToolHeader
                      type={part.type as "dynamic-tool"}
                      state={(toolPart.state || "input-available") as "input-available"}
                      toolName={toolName}
                      title={getToolTitle(toolName)}
                      small
                    />
                    <ToolContent>
                      {toolPart.input !== undefined && toolPart.input !== null ? (
                        <ToolInput input={toolPart.input} className="p-2 [&_pre]:text-[10px] [&_code]:text-[10px]" />
                      ) : null}
                      {toolPart.output !== undefined || toolPart.errorText !== undefined ? (
                        <ToolOutput
                          output={toolPart.output}
                          errorText={toolPart.errorText}
                          className="p-2 [&_pre]:text-[10px] [&_code]:text-[10px]"
                        />
                      ) : null}
                    </ToolContent>
                  </Tool>
                )
              }

              return null
            })}
          </MessageContent>
        </Message>
      ))}

      {isLoading && (
        <Message from="assistant">
          <MessageContent className="text-xs">
            <Loader size={12} />
          </MessageContent>
        </Message>
      )}
    </div>
  )
}

function getToolTitle(toolName: string): string {
  const titles: Record<string, string> = {
    searchDocument: "Search Document",
    editDocument: "Edit Document",
    insertText: "Insert Text",
    getDocumentInfo: "Get Document Info",
    suggestTemplate: "Suggest Template",
  }
  return titles[toolName] || toolName
}
