"use client"

import { useCallback, useEffect, useState, useRef } from "react"
import { useFiles } from "@/hooks/use-files"
import { useFileStore } from "@/lib/file-store"
import { bundleLatexFiles } from "@/lib/latex-bundler"
import { findMainFile } from "@/lib/file-utils"
import { PreviewToolbar } from "./preview-toolbar"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { IconSparkles } from "@tabler/icons-react"

import {
  LatexRenderer,
  RenderError,
} from "latex-renderer-sdk"

const client = new LatexRenderer({
  apiKey: process.env.NEXT_PUBLIC_LATEX_API_KEY!, // use env variable
  baseUrl: process.env.NEXT_PUBLIC_LATEX_API_URL, // optional
})

function parseErrorLines(errorText: string): number[] {
  const lines: number[] = []
  // Match patterns like "l.42", "line 42", "Line 42"
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

export function PdfViewer() {
  const { activeContent, requestAIFix } = useFiles()
  const triggerCompile = useFileStore((s) => s.triggerCompile)
  const setGoToLine = useFileStore((s) => s.setGoToLine)

  const [isCompiling, setIsCompiling] = useState(false)
  const [zoom, setZoom] = useState(100)
  const [error, setError] = useState<string | null>(null)

  const iframeRef = useRef<HTMLIFrameElement>(null)
  const currentUrlRef = useRef<string | null>(null)
  const [showSkeleton, setShowSkeleton] = useState(false)

  const handleFixWithAI = useCallback(() => {
    if (error) {
      const prompt = `Fix this LaTeX compilation error:\n\n${error}\n\nPlease modify the document to resolve this error while keeping the content intact.`
      requestAIFix(prompt, error)
    }
  }, [error, requestAIFix])

  const compileLatex = useCallback(async () => {
    if (!activeContent) return

    setIsCompiling(true)
    setError(null)

    try {
      const files = useFileStore.getState().files
      const mainFile = findMainFile(files)
      const bundledContent = await bundleLatexFiles(files, mainFile)
      const pdfBuffer = await client.renderPDF(bundledContent)

      const arrayBuffer = new ArrayBuffer(pdfBuffer.byteLength)
      new Uint8Array(arrayBuffer).set(pdfBuffer)

      const blob = new Blob([arrayBuffer], {
        type: "application/pdf",
      })

      const url = URL.createObjectURL(blob)

      // Cleanup previous URL
      if (currentUrlRef.current) {
        URL.revokeObjectURL(currentUrlRef.current)
      }

      currentUrlRef.current = url

      const iframe = iframeRef.current
      if (iframe) {
        iframe.src = `${url}#toolbar=0&navpanes=0&scrollbar=0`
      }

    } catch (err) {
      if (err instanceof RenderError && err.detail) {
        setError(err.detail)
      } else if (err instanceof Error) {
        setError(err.message)
      } else {
        setError("Compilation failed")
      }
    } finally {
      setIsCompiling(false)
    }
  }, [activeContent])

  // Auto-compile on content change
  useEffect(() => {
    if (!activeContent) return

    const timeout = setTimeout(() => {
      compileLatex()
    }, 800)

    return () => clearTimeout(timeout)
  }, [activeContent])

  // Compile on triggerCompile from store (Cmd+Enter or command palette)
  useEffect(() => {
    if (triggerCompile > 0) {
      compileLatex()
    }
  }, [triggerCompile, compileLatex])

  // Listen for download PDF event from command palette
  useEffect(() => {
    const handleDownload = () => {
      if (currentUrlRef.current) {
        const a = document.createElement("a")
        a.href = currentUrlRef.current
        a.download = "document.pdf"
        a.click()
      }
    }
    window.addEventListener("latex0:download-pdf", handleDownload)
    return () => window.removeEventListener("latex0:download-pdf", handleDownload)
  }, [])

  useEffect(() => {
    let timeout: NodeJS.Timeout

    if (isCompiling) {
      timeout = setTimeout(() => {
        setShowSkeleton(true)
      }, 300)
    } else {
      setShowSkeleton(false)
    }

    return () => clearTimeout(timeout)
  }, [isCompiling])

  const handleZoomIn = () => {
    setZoom((prev) => Math.min(prev + 10, 200))
  }

  const handleZoomOut = () => {
    setZoom((prev) => Math.max(prev - 10, 50))
  }

  const handleDownload = () => {
    if (currentUrlRef.current) {
      const a = document.createElement("a")
      a.href = currentUrlRef.current
      a.download = "document.pdf"
      a.click()
    }
  }

  const handleErrorLineClick = useCallback((lineNumber: number) => {
    setGoToLine(lineNumber)
  }, [setGoToLine])

  // Render error text with clickable line numbers
  const renderErrorText = useCallback((errorText: string) => {
    const errorLines = parseErrorLines(errorText)
    if (errorLines.length === 0) {
      return <span>{errorText}</span>
    }

    // Replace line references with clickable spans
    let result = errorText
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

    // Sort by position and deduplicate overlapping
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
    <div className="flex h-full flex-col overflow-hidden">
      <PreviewToolbar
        onCompile={compileLatex}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onDownload={handleDownload}
        isCompiling={isCompiling}
        zoom={zoom}
      />

      <ScrollArea className="h-full flex-1 bg-muted/50">
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
                  Click on line numbers to jump to the error location in the editor.
                </p>
              )}
            </div>
          ) : iframeRef ? (
            <div
              className="w-full max-w-[210mm] bg-white shadow-lg rounded-lg overflow-hidden"
              style={{
                transform: `scale(${zoom / 100})`,
                transformOrigin: "top center",
              }}
            >
              <div className="relative w-full max-w-[210mm] bg-white shadow-lg rounded-lg overflow-hidden">

              <iframe
                ref={iframeRef}
                className="w-full h-[1000px] border-0"
                title="PDF Preview"
              />

              {showSkeleton && (
                <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center">
                  <PdfSkeleton />
                </div>
              )}

            </div>
            </div>
          ) : (
            <div className="flex h-64 items-center justify-center text-muted-foreground">
              <p>Click "Compile" to preview your PDF</p>
            </div>
          )}

        </div>
      </ScrollArea>
    </div>
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
