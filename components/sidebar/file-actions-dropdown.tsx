"use client"

import { useRef } from "react"
import { useFileStore } from "@/lib/file-store"
import {
  IconPlus,
  IconFilePlus,
  IconFolderPlus,
  IconUpload,
  IconFolderUp,
} from "@tabler/icons-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { isImageFile, uploadAndAddToTree } from "@/lib/upload-helpers"

export function FileActionsDropdown() {
  const createFile = useFileStore((s) => s.createFile)
  const createFolder = useFileStore((s) => s.createFolder)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || [])
    for (const file of files) {
      if (isImageFile(file.name)) {
        try {
          await uploadAndAddToTree(file)
        } catch {
          // Error handled by uploadAndAddToTree
        }
      }
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/svg+xml,image/webp,application/pdf"
        multiple
        className="hidden"
        onChange={handleFileUpload}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="h-5 w-5"
            onClick={(e) => e.stopPropagation()}
          >
            <IconPlus className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => createFile("untitled.tex")}>
            <IconFilePlus className="size-4 mr-2" />
            Add File
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => createFolder("folder")}>
            <IconFolderPlus className="size-4 mr-2" />
            Add Folder
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
            <IconUpload className="size-4 mr-2" />
            Upload File
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
