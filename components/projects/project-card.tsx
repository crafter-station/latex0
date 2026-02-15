"use client"

import Link from "next/link"
import { IconFolder, IconDots, IconPencil, IconShare, IconDownload, IconTrash } from "@tabler/icons-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import type { Project } from "@/lib/db/schema"

interface ProjectWithDoc extends Project {
  firstDocumentId?: string | null
}

interface ProjectCardProps {
  project: ProjectWithDoc
  onRename?: (id: string) => void
  onDelete?: (id: string) => void
}

export function ProjectCard({ project, onRename, onDelete }: ProjectCardProps) {
  const href = project.firstDocumentId
    ? `/projects/${project.id}/${project.firstDocumentId}`
    : `/projects/${project.id}`

  return (
    <Link
      href={href}
      prefetch={true}
      className="group block cursor-pointer rounded-lg border border-border/50 bg-card p-4 transition-all hover:border-border hover:shadow-md"
    >
      <div className="flex items-start justify-between mb-3">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted"
        >
          <IconFolder className="size-5 text-muted-foreground" />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => e.stopPropagation()}
            >
              <IconDots className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onClick={() => onRename?.(project.id)}>
              <IconPencil className="size-4 mr-2" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem>
              <IconShare className="size-4 mr-2" />
              Share
            </DropdownMenuItem>
            <DropdownMenuItem>
              <IconDownload className="size-4 mr-2" />
              Export
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => onDelete?.(project.id)}
            >
              <IconTrash className="size-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <h3 className="font-medium truncate">{project.name}</h3>
      {project.description && (
        <p className="text-sm text-muted-foreground line-clamp-1 mt-1">{project.description}</p>
      )}
      <p className="text-xs text-muted-foreground/60 mt-2">
        {new Date(project.updatedAt).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}
      </p>
    </Link>
  )
}
