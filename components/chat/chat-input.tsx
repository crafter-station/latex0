"use client"

import { useRef, useImperativeHandle, forwardRef } from "react"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { IconPhoto, IconWaveSine, IconSend, IconPlayerStop } from "@tabler/icons-react"
import { cn } from "@/lib/utils"

interface ChatInputProps {
  onSend?: (message: string) => void
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

  useImperativeHandle(ref, () => ({
    focus: () => {
      textareaRef.current?.focus()
    },
  }))

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (value?.trim() && onSend) {
      onSend(value.trim())
      onChange?.("")
      // Reset textarea height
      if (textareaRef.current) {
        textareaRef.current.style.height = "28px"
      }
    }
  }

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
      <form onSubmit={handleSubmit} className="flex items-end">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />

        <div className="flex flex-1 items-center py-1.5">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            onFocus={onFocus}
            placeholder="Ask anything..."
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
      </form>
    )
  }

  // Collapsed style - floating rounded bar
  return (
    <div className="p-3 pb-4">
      <div className="rounded-[24px] border border-neutral-700 bg-neutral-900 shadow-lg shadow-black/20">
        <form onSubmit={handleSubmit} className="flex items-end p-1">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />

          <div className="flex flex-1 items-center py-1.5">
            <textarea
              ref={textareaRef}
              value={value}
              onChange={handleTextareaChange}
              onKeyDown={handleKeyDown}
              onFocus={onFocus}
              placeholder="Ask anything..."
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
        </form>
      </div>
    </div>
  )
})
