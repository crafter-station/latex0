import { nanoid } from "nanoid"
import type { FileNode } from "@/lib/file-store"
import { useFileStore } from "@/lib/file-store"

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "svg", "webp", "pdf"]
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

export function isImageFile(filename: string): boolean {
  const ext = filename.toLowerCase().split(".").pop()
  return IMAGE_EXTENSIONS.includes(ext || "")
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function generateLatexInclude(filename: string, folderPath?: string): string {
  const path = folderPath ? `${folderPath}/${filename}` : filename
  const label = filename.split(".")[0].replace(/[^a-zA-Z0-9]/g, "-")
  return `\\begin{figure}[htbp]
  \\centering
  \\includegraphics[width=0.8\\textwidth]{${path}}
  \\caption{Figure caption}
  \\label{fig:${label}}
\\end{figure}`
}

export function findOrCreateImagesFolder(files: FileNode[]): FileNode {
  const existing = files.find(
    (f) => f.type === "folder" && f.name === "images"
  )
  if (existing) return existing

  useFileStore.getState().createFolder("images")
  const updated = useFileStore.getState().files
  return updated.find((f) => f.type === "folder" && f.name === "images")!
}

export function validateImageFile(file: File): string | null {
  if (!isImageFile(file.name)) {
    return "Unsupported file type. Please upload PNG, JPEG, GIF, SVG, WebP, or PDF."
  }
  if (file.size > MAX_FILE_SIZE) {
    return `File too large (${formatFileSize(file.size)}). Maximum size is 10MB.`
  }
  return null
}

export async function uploadImageToBlob(
  file: File,
  onProgress?: (percent: number) => void
): Promise<FileNode> {
  const error = validateImageFile(file)
  if (error) throw new Error(error)

  const formData = new FormData()
  formData.append("file", file)

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100))
      }
    })

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const metadata = JSON.parse(xhr.responseText)
          resolve({
            id: nanoid(),
            name: file.name,
            type: "file",
            blobUrl: metadata.url,
            blobMetadata: {
              size: metadata.size,
              width: metadata.width,
              height: metadata.height,
              uploadedAt: metadata.uploadedAt,
              contentType: metadata.contentType,
            },
          })
        } catch {
          reject(new Error("Invalid response from upload server"))
        }
      } else {
        try {
          const err = JSON.parse(xhr.responseText)
          reject(new Error(err.error || "Upload failed"))
        } catch {
          reject(new Error("Upload failed"))
        }
      }
    })

    xhr.addEventListener("error", () => {
      reject(new Error("Network error. Please check your connection."))
    })

    xhr.open("POST", "/api/upload")
    xhr.send(formData)
  })
}

/** Upload an image and add it to the file tree under /images folder. */
export async function uploadAndAddToTree(
  file: File,
  onProgress?: (percent: number) => void
): Promise<FileNode> {
  const fileNode = await uploadImageToBlob(file, onProgress)
  const folder = findOrCreateImagesFolder(useFileStore.getState().files)
  useFileStore.getState().addImageFile(
    { ...fileNode, parentId: folder.id },
    folder.id
  )
  return fileNode
}

/** Find an image file by path (e.g. "images/fig.png" or "fig.png") */
export function findImageByPath(
  files: FileNode[],
  path: string
): FileNode | null {
  const parts = path.split("/")
  const filename = parts[parts.length - 1]

  function search(nodes: FileNode[]): FileNode | null {
    for (const node of nodes) {
      if (node.type === "file" && node.blobUrl && node.name === filename) {
        return node
      }
      if (node.children) {
        const found = search(node.children)
        if (found) return found
      }
    }
    return null
  }

  return search(files)
}
