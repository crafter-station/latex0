"use client"

import { useCallback, useEffect, useState, useRef } from "react"
import { useFiles } from "@/hooks/use-files"
import { useFileStore } from "@/lib/file-store"
import { bundleLatexFiles } from "@/lib/latex-bundler"
import { findMainFile } from "@/lib/file-utils"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { IconSparkles } from "@tabler/icons-react"
import { LatexRenderer, RenderError } from "latex-renderer-sdk"
import { useDocumentStore } from "@/lib/document-store"
import { getCachedPdf, cachePdf } from "@/lib/pdf-cache"
import type { PDFDocumentProxy } from "pdfjs-dist"

async function getPdfjs() {
  const pdfjsLib = await import("pdfjs-dist")
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString()
  return pdfjsLib
}

const client = new LatexRenderer({
  apiKey: process.env.NEXT_PUBLIC_LATEX_API_KEY!,
  baseUrl: process.env.NEXT_PUBLIC_LATEX_API_URL,
})

function parseErrorLines(errorText: string): number[] {
  const lines: number[] = []
  const patterns = [
    /l\.(\d+)/g,
    /[Ll]ine\s+(\d+)/g,
    /on input line (\d+)/g,
  ]
  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(errorText)) !== null) {
      const lineNum = parseInt(match[1], 10)
      if (lineNum > 0 && !lines.includes(lineNum)) {
        lines.push(lineNum)
      }
    }
  }
  return lines
}

interface PdfViewerProps {
  zoom?: number
}

const PLAYGROUND_CACHE_KEY = "playground"

export function PdfViewer({ zoom = 100 }: PdfViewerProps) {
  const { requestAIFix } = useFiles()
  const triggerCompile = useFileStore((s) => s.triggerCompile)
  const setGoToLine = useFileStore((s) => s.setGoToLine)
  const activeDocumentId = useDocumentStore((s) => s.activeDocumentId)
  const activeTabId = useFileStore((s) => s.activeTabId)
  const getFileContent = useFileStore((s) => s.getFileContent)
  const activeContent = activeTabId ? getFileContent(activeTabId) : null

  const cacheKey = activeDocumentId || PLAYGROUND_CACHE_KEY

  const [isCompiling, setIsCompiling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showSkeleton, setShowSkeleton] = useState(false)

  const pdfDataRef = useRef<Uint8Array | null>(null)
  const canvasContainerRef = useRef<HTMLDivElement>(null)
  const cacheLoadedRef = useRef(false)

  const handleFixWithAI = useCallback(() => {
    if (error) {
      const prompt = `Fix this LaTeX compilation error:\n\n${error}\n\nPlease modify the document to resolve this error while keeping the content intact.`
      requestAIFix(prompt, error)
    }
  }, [error, requestAIFix])

  // Render PDF pages to canvases
  const renderPages = useCallback(async (data: Uint8Array, scale: number) => {
    const container = canvasContainerRef.current
    if (!container) return

    const pdfjsLib = await getPdfjs()
    // Pass a copy — pdfjs detaches the buffer it receives
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(data) }).promise

    // Clear previous canvases
    container.innerHTML = ""

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const viewport = page.getViewport({ scale: scale * (window.devicePixelRatio || 1) })
      const cssViewport = page.getViewport({ scale })

      const canvas = document.createElement("canvas")
      canvas.width = viewport.width
      canvas.height = viewport.height
      canvas.style.width = `${cssViewport.width}px`
      canvas.style.height = `${cssViewport.height}px`
      canvas.style.display = "block"

      if (i > 1) {
        const separator = document.createElement("div")
        separator.style.height = "8px"
        separator.style.flexShrink = "0"
        container.appendChild(separator)
      }

      container.appendChild(canvas)

      const ctx = canvas.getContext("2d")!
      await page.render({ canvasContext: ctx, canvas, viewport }).promise
    }
  }, [])

  // Load cached PDF on mount
  useEffect(() => {
    if (cacheLoadedRef.current) return
    cacheLoadedRef.current = true

    getCachedPdf(cacheKey).then((cached) => {
      if (cached && !pdfDataRef.current) {
        pdfDataRef.current = new Uint8Array(cached)
        renderPages(pdfDataRef.current, zoom / 100)
      }
    })
  }, [cacheKey, zoom, renderPages])

  // Re-render when zoom changes
  useEffect(() => {
    if (pdfDataRef.current) {
      renderPages(pdfDataRef.current, zoom / 100)
    }
  }, [zoom, renderPages])

  const compileLatex = useCallback(async () => {
    const files = useFileStore.getState().files
    if (!files.length) return

    setIsCompiling(true)
    setError(null)

    const attempt = async () => {
      const files = useFileStore.getState().files
      const mainFile = findMainFile(files)
      const { source, images } = await bundleLatexFiles(files, mainFile)

      const pdfBuffer = await client.renderPDF(source, {
        images: Object.keys(images).length > 0 ? images : undefined,
      })

      // Copy before pdfjs detaches the underlying ArrayBuffer
      pdfDataRef.current = new Uint8Array(pdfBuffer)
      await renderPages(pdfDataRef.current, zoom / 100)
      cachePdf(cacheKey, pdfDataRef.current)
    }

    try {
      await attempt()
    } catch (err) {
      // Retry once after a delay — the compile service may need time to warm up for image downloads
      await new Promise((r) => setTimeout(r, 1500))
      try {
        await attempt()
      } catch (retryErr) {
        if (retryErr instanceof RenderError && retryErr.detail) {
          setError(retryErr.detail)
        } else if (retryErr instanceof Error) {
          setError(retryErr.message)
        } else {
          setError("Compilation failed")
        }
      }
    } finally {
      setIsCompiling(false)
    }
  }, [zoom, renderPages, cacheKey])

  // Compile on triggerCompile from store (Cmd+Enter, command palette, or toolbar)
  useEffect(() => {
    if (triggerCompile > 0) {
      compileLatex()
    }
  }, [triggerCompile, compileLatex])

  // Auto-compile after user stops typing (debounced)
  useEffect(() => {
    if (!activeContent) return

    const timer = setTimeout(() => {
      compileLatex()
    }, 1500) // Wait 1.5s after last change

    return () => clearTimeout(timer)
  }, [activeContent, compileLatex])

  // Listen for download PDF event
  useEffect(() => {
    const handleDownload = () => {
      if (pdfDataRef.current) {
        const blob = new Blob([pdfDataRef.current as BlobPart], { type: "application/pdf" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = "document.pdf"
        a.click()
        URL.revokeObjectURL(url)
      }
    }
    window.addEventListener("latex0:download-pdf", handleDownload)
    return () => window.removeEventListener("latex0:download-pdf", handleDownload)
  }, [])

  useEffect(() => {
    let timeout: NodeJS.Timeout
    if (isCompiling) {
      timeout = setTimeout(() => setShowSkeleton(true), 300)
    } else {
      setShowSkeleton(false)
    }
    return () => clearTimeout(timeout)
  }, [isCompiling])

  const handleErrorLineClick = useCallback((lineNumber: number) => {
    setGoToLine(lineNumber)
  }, [setGoToLine])

  const renderErrorText = useCallback((errorText: string) => {
    const result = errorText
    const elements: React.ReactNode[] = []
    let lastIndex = 0

    const allMatches: { index: number; length: number; line: number }[] = []
    const patterns = [
      /l\.(\d+)/g,
      /[Ll]ine\s+(\d+)/g,
      /on input line (\d+)/g,
    ]
    for (const pattern of patterns) {
      let match
      while ((match = pattern.exec(result)) !== null) {
        allMatches.push({
          index: match.index,
          length: match[0].length,
          line: parseInt(match[1], 10),
        })
      }
    }

    allMatches.sort((a, b) => a.index - b.index)

    for (const match of allMatches) {
      if (match.index < lastIndex) continue
      if (match.index > lastIndex) {
        elements.push(result.slice(lastIndex, match.index))
      }
      elements.push(
        <button
          key={`line-${match.index}`}
          type="button"
          className="underline underline-offset-2 decoration-dotted hover:decoration-solid cursor-pointer font-semibold text-destructive hover:text-destructive/80"
          onClick={() => handleErrorLineClick(match.line)}
        >
          {result.slice(match.index, match.index + match.length)}
        </button>
      )
      lastIndex = match.index + match.length
    }
    if (lastIndex < result.length) {
      elements.push(result.slice(lastIndex))
    }

    return <>{elements}</>
  }, [handleErrorLineClick])

  return (
    <ScrollArea className="relative h-full flex-1">
      <div className="flex items-start justify-center p-4 min-h-full">
        {error ? (
          <div className="w-full max-w-2xl rounded-lg border border-destructive/50 bg-destructive/10 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold text-destructive">
                Compilation Error
              </h3>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={handleFixWithAI}
              >
                <IconSparkles className="size-3.5" />
                Fix with AI
              </Button>
            </div>
            <pre className="whitespace-pre-wrap text-sm text-destructive/80">
              {renderErrorText(error)}
            </pre>
            {parseErrorLines(error).length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                Click on line numbers to jump to the error location.
              </p>
            )}
          </div>
        ) : (
          <div className="w-full max-w-[210mm] bg-white shadow-lg rounded-lg overflow-hidden dark:invert dark:hue-rotate-180">
            <div className="relative">
              <div
                ref={canvasContainerRef}
                className="flex flex-col items-center bg-white"
              />
              {showSkeleton && (
                <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center">
                  <PdfSkeleton />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  )
}

function PdfSkeleton() {
  return (
    <div className="w-full max-w-[210mm] p-8 space-y-4 animate-pulse">
      <div className="h-6 w-1/2 bg-gray-300 rounded" />
      <div className="h-4 w-full bg-gray-300 rounded" />
      <div className="h-4 w-full bg-gray-300 rounded" />
      <div className="h-4 w-5/6 bg-gray-300 rounded" />
      <div className="h-4 w-4/6 bg-gray-300 rounded" />
      <div className="h-32 w-full bg-gray-200 rounded mt-6" />
      <div className="h-4 w-full bg-gray-300 rounded" />
      <div className="h-4 w-3/4 bg-gray-300 rounded" />
    </div>
  )
}
