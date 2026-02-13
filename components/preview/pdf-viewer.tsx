"use client"

import { useCallback, useEffect, useState, useRef } from "react"
import { useFiles } from "@/hooks/use-files"
import { PreviewToolbar } from "./preview-toolbar"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { IconSparkles } from "@tabler/icons-react"

import {
  LatexRenderer,
} from "latex-renderer-sdk"

const client = new LatexRenderer({
  apiKey: process.env.NEXT_PUBLIC_LATEX_API_KEY!, // use env variable
  baseUrl: process.env.NEXT_PUBLIC_LATEX_API_URL, // optional
})

export function PdfViewer() {
  const { activeContent, requestAIFix } = useFiles()

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
      const pdfBuffer = await client.renderPDF(activeContent)
  
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
      setError("Compilation failed")
    } finally {
      setIsCompiling(false)
    }
  }, [activeContent])

  useEffect(() => {
    if (!activeContent) return
  
    const timeout = setTimeout(() => {
      compileLatex()
    }, 800)
  
    return () => clearTimeout(timeout)
  }, [activeContent])
  
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
                {error}
              </pre>
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