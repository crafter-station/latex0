"use client"

import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { IconPlayerPlay, IconDownload, IconZoomIn, IconZoomOut, IconRefresh } from "@tabler/icons-react"

interface PreviewToolbarProps {
  onCompile?: () => void
  onZoomIn?: () => void
  onZoomOut?: () => void
  onDownload?: () => void
  isCompiling?: boolean
  zoom?: number
}

export function PreviewToolbar({
  onCompile,
  onZoomIn,
  onZoomOut,
  onDownload,
  isCompiling = false,
  zoom = 100,
}: PreviewToolbarProps) {
  return (
    <div className="flex h-10 items-center justify-between border-b bg-background px-2">
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={onCompile}
              disabled={isCompiling}
              className="h-8 gap-2"
            >
              {isCompiling ? (
                <IconRefresh className="size-4 animate-spin" />
              ) : (
                <IconPlayerPlay className="size-4" />
              )}
              Compile
            </Button>
          </TooltipTrigger>
          <TooltipContent>Compile LaTeX (Ctrl+Enter)</TooltipContent>
        </Tooltip>
      </div>

      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={onZoomOut}
            >
              <IconZoomOut className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Zoom Out</TooltipContent>
        </Tooltip>

        <span className="min-w-[3rem] text-center text-xs text-muted-foreground">
          {zoom}%
        </span>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={onZoomIn}
            >
              <IconZoomIn className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Zoom In</TooltipContent>
        </Tooltip>

        <Separator orientation="vertical" className="mx-1 h-5" />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={onDownload}
            >
              <IconDownload className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Download PDF</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
