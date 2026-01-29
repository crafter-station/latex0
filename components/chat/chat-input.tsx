"use client"

import { useRef, useImperativeHandle, forwardRef, useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { IconPhoto, IconWaveSine, IconSend, IconPlayerStop, IconCode, IconX, IconChevronDown, IconChevronUp } from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import { useSelectionContext, type SelectionContext } from "@/stores/selection-context-store"
import { motion, AnimatePresence } from "motion/react"

interface ChatInputProps {
  onSend?: (message: string, context?: SelectionContext) => void
  onImageUpload?: (file: File) => void
  onVoiceStart?: () => void
  onStop?: () => void
  onFocus?: () => void
  disabled?: boolean
  isLoading?: boolean
  value?: string
  onChange?: (value: string) => void
  isExpanded?: boolean
}

export interface ChatInputRef {
  focus: () => void
}

export const ChatInput = forwardRef<ChatInputRef, ChatInputProps>(function ChatInput({
  onSend,
  onImageUpload,
  onVoiceStart,
  onStop,
  onFocus,
  disabled = false,
  isLoading = false,
  value,
  onChange,
  isExpanded = false,
}, ref) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Selection context from store
  const globalContext = useSelectionContext((state) => state.context)
  const clearGlobalContext = useSelectionContext((state) => state.clearContext)

  // Local attached context (captured when user focuses input)
  const [attachedContext, setAttachedContext] = useState<SelectionContext | null>(null)
  const [isContextExpanded, setIsContextExpanded] = useState(false)

  useImperativeHandle(ref, () => ({
    focus: () => {
      textareaRef.current?.focus()
    },
  }))

  // Capture context when user focuses the input
  const handleInputFocus = () => {
    if (globalContext && !attachedContext) {
      setAttachedContext(globalContext)
      clearGlobalContext()
    }
    onFocus?.()
  }

  const handleDismissContext = () => {
    setAttachedContext(null)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (value?.trim() && onSend) {
      onSend(value.trim(), attachedContext || undefined)
      onChange?.("")
      setAttachedContext(null)
      // Reset textarea height
      if (textareaRef.current) {
        textareaRef.current.style.height = "28px"
      }
    }
  }

  // Truncate text for preview
  const truncateText = (text: string, maxLength: number = 100) => {
    if (text.length <= maxLength) return text
    return text.slice(0, maxLength) + "..."
  }

  // Get line range string
  const lineRange = attachedContext
    ? attachedContext.startLine === attachedContext.endLine
      ? `Line ${attachedContext.startLine}`
      : `Lines ${attachedContext.startLine}-${attachedContext.endLine}`
    : ""

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file && onImageUpload) {
      onImageUpload(file)
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange?.(e.target.value)
    // Auto-resize textarea
    e.target.style.height = "28px"
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`
  }

  // Expanded style - inside the chat panel
  if (isExpanded) {
    return (
      <form onSubmit={handleSubmit} className="flex flex-col">
        <AnimatePresence mode="wait">
          {attachedContext && (
            <motion.div
              key="context-preview"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="mx-1 mb-1"
            >
              <div className="rounded-xl bg-neutral-800/50 border border-neutral-700/50 overflow-hidden">
                <div className="flex items-center justify-between px-3 py-1.5 bg-neutral-700/30">
                  <div className="flex items-center gap-2 text-xs text-neutral-400">
                    <IconCode className="size-3.5" />
                    <span className="font-medium">{lineRange}</span>
                    <span className="text-neutral-500">from {attachedContext.fileName}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 text-neutral-400 hover:text-white hover:bg-neutral-600"
                      onClick={() => setIsContextExpanded(!isContextExpanded)}
                    >
                      {isContextExpanded ? <IconChevronUp className="size-3" /> : <IconChevronDown className="size-3" />}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 text-neutral-400 hover:text-red-400 hover:bg-neutral-600"
                      onClick={handleDismissContext}
                    >
                      <IconX className="size-3" />
                    </Button>
                  </div>
                </div>
                <div className="px-3 py-2">
                  <pre className={cn(
                    "text-xs text-neutral-300 font-mono whitespace-pre-wrap break-all",
                    !isContextExpanded && "line-clamp-2"
                  )}>
                    {isContextExpanded ? attachedContext.text : truncateText(attachedContext.text, 150)}
                  </pre>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />

        <div className="flex items-end">
          <div className="flex flex-1 items-center py-1.5">
            <textarea
              ref={textareaRef}
              value={value}
              onChange={handleTextareaChange}
              onKeyDown={handleKeyDown}
              onFocus={handleInputFocus}
              placeholder={attachedContext ? "Ask about the selected code..." : "Ask anything..."}
              rows={1}
              className="flex-1 resize-none overflow-hidden bg-transparent pl-3 text-base leading-7 text-white placeholder:text-neutral-500 focus:placeholder:text-transparent focus:outline-none"
              style={{ height: "28px" }}
              disabled={disabled}
            />
          </div>

          <div className="flex shrink-0 items-center gap-0.5 pb-1 pr-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-full text-neutral-400 hover:bg-neutral-700 hover:text-white"
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled}
              >
                <IconPhoto className="size-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Upload Image</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-full text-neutral-400 hover:bg-neutral-700 hover:text-white"
                onClick={onVoiceStart}
                disabled={disabled}
              >
                <IconWaveSine className="size-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Voice Input</TooltipContent>
          </Tooltip>

          {isLoading ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  className="h-9 w-9 rounded-full bg-red-500 text-white hover:bg-red-600"
                  onClick={onStop}
                >
                  <IconPlayerStop className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Stop</TooltipContent>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="submit"
                  size="icon"
                  className="h-9 w-9 rounded-full text-neutral-400 hover:bg-neutral-700 hover:text-white disabled:text-neutral-600"
                  disabled={disabled || !value?.trim()}
                >
                  <IconSend className="size-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Send Message</TooltipContent>
            </Tooltip>
          )}
          </div>
        </div>
      </form>
    )
  }

  // Collapsed style - floating rounded bar
  return (
    <div className="p-3 pb-4">
      <div className="rounded-[24px] border border-neutral-700 bg-neutral-900 shadow-lg shadow-black/20">
        <form onSubmit={handleSubmit} className="flex flex-col p-1">
          <AnimatePresence mode="wait">
            {attachedContext && (
              <motion.div
                key="context-preview-collapsed"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="mx-1 mb-1"
              >
                <div className="rounded-xl bg-neutral-800/50 border border-neutral-700/50 overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-1.5 bg-neutral-700/30">
                    <div className="flex items-center gap-2 text-xs text-neutral-400">
                      <IconCode className="size-3.5" />
                      <span className="font-medium">{lineRange}</span>
                      <span className="text-neutral-500">from {attachedContext.fileName}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 text-neutral-400 hover:text-white hover:bg-neutral-600"
                        onClick={() => setIsContextExpanded(!isContextExpanded)}
                      >
                        {isContextExpanded ? <IconChevronUp className="size-3" /> : <IconChevronDown className="size-3" />}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 text-neutral-400 hover:text-red-400 hover:bg-neutral-600"
                        onClick={handleDismissContext}
                      >
                        <IconX className="size-3" />
                      </Button>
                    </div>
                  </div>
                  <div className="px-3 py-2">
                    <pre className={cn(
                      "text-xs text-neutral-300 font-mono whitespace-pre-wrap break-all",
                      !isContextExpanded && "line-clamp-2"
                    )}>
                      {isContextExpanded ? attachedContext.text : truncateText(attachedContext.text, 150)}
                    </pre>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />

          <div className="flex items-end">
            <div className="flex flex-1 items-center py-1.5">
              <textarea
                ref={textareaRef}
                value={value}
                onChange={handleTextareaChange}
                onKeyDown={handleKeyDown}
                onFocus={handleInputFocus}
                placeholder={attachedContext ? "Ask about the selected code..." : "Ask anything..."}
                rows={1}
                className="flex-1 resize-none overflow-hidden bg-transparent pl-3 text-base leading-7 text-white placeholder:text-neutral-500 focus:placeholder:text-transparent focus:outline-none"
                style={{ height: "28px" }}
                disabled={disabled}
              />
            </div>

          <div className="flex shrink-0 items-center gap-0.5 pb-1 pr-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 rounded-full text-neutral-400 hover:bg-neutral-800 hover:text-white"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={disabled}
                >
                  <IconPhoto className="size-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Upload Image</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 rounded-full text-neutral-400 hover:bg-neutral-800 hover:text-white"
                  onClick={onVoiceStart}
                  disabled={disabled}
                >
                  <IconWaveSine className="size-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Voice Input</TooltipContent>
            </Tooltip>

            {isLoading ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    className="h-9 w-9 rounded-full bg-red-500 text-white hover:bg-red-600"
                    onClick={onStop}
                  >
                    <IconPlayerStop className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Stop</TooltipContent>
              </Tooltip>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="submit"
                    size="icon"
                    className="h-9 w-9 rounded-full text-neutral-400 hover:bg-neutral-800 hover:text-white disabled:text-neutral-600"
                    disabled={disabled || !value?.trim()}
                  >
                    <IconSend className="size-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Send Message</TooltipContent>
              </Tooltip>
            )}
            </div>
          </div>
        </form>
      </div>
    </div>
  )
})
