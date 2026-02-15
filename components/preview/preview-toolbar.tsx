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
    <div className="flex h-10 shrink-0 items-center justify-between px-3">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            onClick={onCompile}
            disabled={isCompiling}
            className="h-7 gap-1.5 text-xs"
          >
            {isCompiling ? (
              <IconRefresh className="size-3.5 animate-spin" />
            ) : (
              <IconPlayerPlay className="size-3.5" />
            )}
            Compile
          </Button>
        </TooltipTrigger>
        <TooltipContent>Compile LaTeX (Ctrl+Enter)</TooltipContent>
      </Tooltip>

      <div className="flex items-center gap-0.5">
        <span className="text-xs text-muted-foreground tabular-nums min-w-[2.5rem] text-center">
          {zoom}%
        </span>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onZoomOut}>
              <IconZoomOut className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Zoom Out</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onZoomIn}>
              <IconZoomIn className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Zoom In</TooltipContent>
        </Tooltip>

        <Separator orientation="vertical" className="mx-1 h-4" />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onDownload}>
              <IconDownload className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Download PDF</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
