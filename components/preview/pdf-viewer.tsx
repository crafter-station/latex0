"use client"

import { useCallback, useEffect, useState, useRef } from "react"
import { useFiles } from "@/hooks/use-files"
import { PreviewToolbar } from "./preview-toolbar"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { IconSparkles } from "@tabler/icons-react"

// Packages that latex.js doesn't support well
const UNSUPPORTED_PACKAGES = [
  "inputenc",
  "fontenc",
  "babel",
  "graphicx",
  "hyperref",
  "geometry",
  "fancyhdr",
  "tikz",
  "pgf",
  "listings",
  "minted",
  "algorithm",
  "algorithmic",
]

// Environments that latex.js doesn't support
const UNSUPPORTED_ENVIRONMENTS = [
  { name: "table", suggestion: "Tables are not supported. Use formatted text or describe data in prose." },
  { name: "tabular", suggestion: "Tables are not supported. Use formatted text or describe data in prose." },
  { name: "array", suggestion: "Arrays are not supported. Use inline math or formatted text instead." },
  { name: "figure", suggestion: "Use \\begin{center} with descriptive text instead." },
  { name: "equation", suggestion: "Use \\[ ... \\] or $ ... $ for math instead." },
  { name: "align", suggestion: "Use multiple \\[ ... \\] blocks for multi-line equations." },
  { name: "eqnarray", suggestion: "Use multiple \\[ ... \\] blocks for multi-line equations." },
  { name: "lstlisting", suggestion: "Use \\begin{verbatim} instead." },
]

// Macros that latex.js doesn't support
const UNSUPPORTED_MACROS = [
  { name: "\\rule", suggestion: "Use --- or \\hrulefill instead" },
  { name: "\\includegraphics", suggestion: "Remove or comment out image includes" },
  { name: "\\url", suggestion: "Use \\texttt{url} instead" },
  { name: "\\href", suggestion: "Use plain text or \\texttt{}" },
  { name: "\\caption", suggestion: "Use \\textit{Caption: your text} instead" },
  { name: "\\label", suggestion: "Remove labels or use % to comment them out" },
]

function getHelpfulErrorMessage(error: Error, content: string): string {
  const message = error.message

  // Check for unknown environment errors
  if (message.includes("unknown environment:")) {
    const envMatch = message.match(/unknown environment:\s*(\w+)/)
    const envName = envMatch?.[1]

    if (envName) {
      const unsupported = UNSUPPORTED_ENVIRONMENTS.find(e => e.name === envName)
      if (unsupported) {
        return `The "${envName}" environment is not supported by the browser preview.\n\n${unsupported.suggestion}\n\nNote: This preview uses latex.js which supports basic LaTeX. For full environment support, use a server-side compiler.`
      }
      return `The "${envName}" environment is not supported by the browser preview.\n\nTry using a simpler alternative or removing this environment.\n\nNote: This preview uses latex.js which supports basic LaTeX.`
    }
  }

  // Check for unknown macro errors
  if (message.includes("unknown macro:")) {
    const macroMatch = message.match(/unknown macro:\s*(\\?\w+)/)
    const macroName = macroMatch?.[1]

    if (macroName) {
      const unsupported = UNSUPPORTED_MACROS.find(m => m.name === macroName || m.name === `\\${macroName}`)
      if (unsupported) {
        return `The "${macroName}" command is not supported by the browser preview.\n\n${unsupported.suggestion}\n\nNote: This preview uses latex.js which supports basic LaTeX.`
      }
      return `The "${macroName}" command is not supported by the browser preview.\n\nTry removing or replacing this command with a simpler alternative.`
    }
  }

  // Check for package loading errors
  if (message.includes("loading package") || message.includes("Cannot find module")) {
    const packageMatch = message.match(/package "([^"]+)"/)
    const packageName = packageMatch?.[1]

    if (packageName) {
      return `Package "${packageName}" is not supported by the browser-based LaTeX preview.\n\nTry removing the \\usepackage{${packageName}} line from your document.\n\nNote: This preview uses latex.js which supports basic LaTeX. For full package support, use a server-side compiler.`
    }
  }

  // Check for common unsupported packages in the source
  for (const pkg of UNSUPPORTED_PACKAGES) {
    if (content.includes(`\\usepackage{${pkg}}`) || content.includes(`\\usepackage[`)) {
      const match = content.match(new RegExp(`\\\\usepackage(?:\\[[^\\]]*\\])?\\{${pkg}\\}`))
      if (match) {
        return `The package "${pkg}" is not fully supported by the browser preview.\n\nTry removing or commenting out the \\usepackage line.\n\nOriginal error: ${message}`
      }
    }
  }

  return message
}

export function PdfViewer() {
  const { activeContent, compiledHtml, setCompiledHtml, requestAIFix } = useFiles()
  const [isCompiling, setIsCompiling] = useState(false)
  const [zoom, setZoom] = useState(100)
  const [error, setError] = useState<string | null>(null)
  const [iframeHeight, setIframeHeight] = useState(1000)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const handleIframeLoad = useCallback(() => {
    const iframe = iframeRef.current
    if (iframe?.contentDocument?.body) {
      // Get the actual content height
      const height = iframe.contentDocument.body.scrollHeight
      setIframeHeight(Math.max(height + 40, 500)) // Add padding, minimum 500px
    }
  }, [])

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
      // Dynamic import of latex.js
      const { parse, HtmlGenerator } = await import("latex.js")

      const generator = new HtmlGenerator({ hyphenate: false })
      const doc = parse(activeContent, { generator })
      const html = doc.htmlDocument().documentElement.outerHTML

      setCompiledHtml(html)
    } catch (err) {
      console.error("LaTeX compilation error:", err)

      if (err instanceof Error) {
        setError(getHelpfulErrorMessage(err, activeContent))
      } else {
        setError("Failed to compile LaTeX")
      }
    } finally {
      setIsCompiling(false)
    }
  }, [activeContent, setCompiledHtml])

  // Auto-compile on first load
  useEffect(() => {
    if (activeContent && !compiledHtml) {
      compileLatex()
    }
  }, [activeContent, compiledHtml, compileLatex])

  const handleZoomIn = () => {
    setZoom((prev) => Math.min(prev + 10, 200))
  }

  const handleZoomOut = () => {
    setZoom((prev) => Math.max(prev - 10, 50))
  }

  const handleDownload = () => {
    // For now, just download the HTML
    // In the future, we can add server-side PDF compilation
    if (compiledHtml) {
      const blob = new Blob([compiledHtml], { type: "text/html" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = "document.html"
      a.click()
      URL.revokeObjectURL(url)
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
        <div
          className="flex items-start justify-center p-4"
          style={{
            minHeight: compiledHtml ? `${(iframeHeight * zoom / 100) + 32}px` : '100%'
          }}
        >
          {error ? (
            <div className="w-full max-w-2xl rounded-lg border border-destructive/50 bg-destructive/10 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-semibold text-destructive">
                  Compilation Error
                </h3>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
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
          ) : compiledHtml ? (
            <div
              className="w-full max-w-[210mm] bg-white shadow-lg rounded-lg overflow-hidden"
              style={{
                transform: `scale(${zoom / 100})`,
                transformOrigin: "top center",
              }}
            >
              <iframe
                ref={iframeRef}
                srcDoc={compiledHtml}
                title="LaTeX Preview"
                className="w-full border-0"
                style={{ height: `${iframeHeight}px` }}
                sandbox="allow-same-origin allow-scripts"
                onLoad={handleIframeLoad}
              />
            </div>
          ) : (
            <div className="flex h-64 items-center justify-center text-muted-foreground">
              <p>Click "Compile" to preview your document</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
