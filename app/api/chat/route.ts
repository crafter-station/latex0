import { createGateway } from "ai"
import { streamText, tool, zodSchema, convertToModelMessages, UIMessage, stepCountIs } from "ai"
import { z } from "zod"
import { getChatRatelimit, isRateLimitConfigured } from "@/lib/ratelimit"
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"

export const maxDuration = 60

export async function POST(req: NextRequest) {
  if (isRateLimitConfigured()) {
    // Try to get authenticated user ID first
    const { userId } = await auth()

    // Use Clerk user ID if authenticated, otherwise fall back to IP
    const identifier = userId ||
      req.headers.get("x-forwarded-for") ||
      req.headers.get("x-real-ip") ||
      "anonymous"

    const { success, limit, remaining, reset } = await getChatRatelimit().limit(identifier)

    if (!success) {
      return NextResponse.json(
        { error: "Too many requests. Please slow down." },
        {
          status: 429,
          headers: {
            "X-RateLimit-Limit": limit.toString(),
            "X-RateLimit-Remaining": remaining.toString(),
            "X-RateLimit-Reset": reset.toString(),
          },
        }
      )
    }
  }

  // Configure AI Gateway provider
  const gateway = createGateway({
    apiKey: process.env.AI_GATEWAY_API_KEY,
  })

  const { messages, documentContent }: { messages: UIMessage[]; documentContent?: string } = await req.json()

  // Convert UI messages to model messages format
  const modelMessages = await convertToModelMessages(messages)

  const systemPrompt = `You are LaTeX0, an expert AI assistant for a LaTeX IDE. You help users write, edit, and improve LaTeX documents of any complexity.

Current document content:
\`\`\`latex
${documentContent || "No document open"}
\`\`\`

CAPABILITIES:
- Answer questions about LaTeX syntax, best practices, and document design
- Search, edit, and improve existing content
- Create new documents from templates
- Add tables, figures, equations, bibliographies, code listings, and any other LaTeX elements

RENDERING ENGINE:
This IDE compiles LaTeX server-side with pdflatex. Almost all standard LaTeX is supported.

Supported document classes: article, report, book, beamer, letter, memoir
Supported packages (verified): amsmath, amssymb, amsthm, mathtools, bm, graphicx, geometry, hyperref, xcolor, booktabs, fancyhdr, listings, inputenc (utf8), babel, parskip, setspace, float, caption, subcaption, multirow, multicol, array, tabularx, longtable, tabulary, colortbl, makecell, tikz, pgfplots, natbib, verbatim, fancyvrb, titlesec, titling, tocloft, appendix, microtype, url, csquotes, lipsum, soul, ulem, pdfpages, lastpage, footmisc, etoolbox, xparse, ifthen, calc, environ, tcolorbox, mdframed, adjustbox, wrapfig, placeins
Supported math: equation, align, gather, multline, cases, all matrix variants, inline $..$ and display \\[..\\]
Supported features: \\label/\\ref, \\footnote, \\tableofcontents, \\rule, minipage, \\href, \\url

NOT AVAILABLE — do NOT use these:
- enumitem (font missing on server — use plain itemize/enumerate instead)
- fontenc with T1 (font missing — omit or use OT1)
- siunitx (not installed)
- biblatex (not installed — use natbib or thebibliography instead)
- minted (needs shell-escape — use listings instead)

CRITICAL RULES:
- \\usepackage MUST go in the preamble (BEFORE \\begin{document}). NEVER inside the document body.
- When adding packages to an existing document, insert them BEFORE \\begin{document} using editDocument or insertText with position "after-preamble" carefully.
- ALWAYS include the \\usepackage declaration for any package you use. Check the current document — if a package is not already in the preamble, add it.
- Use tabular (not tabularx) for simple tables unless the user specifically needs tabularx.
- Prefer natbib or \\begin{thebibliography} over biblatex for citations.
- Prefer listings over minted for code blocks.

Write idiomatic, professional LaTeX. Use proper environments (tabular for tables, figure for floats, align for multi-line equations).

WORKFLOW:
1. NEW DOCUMENT: Use suggestTemplate with a document type, then use editDocument to customize title, sections, and content for the user's topic.
2. ADD content: Use editDocument or insertText to add specific content.
3. MODIFY content: Use editDocument to make precise changes.

RESPONSE RULES:
- ALWAYS include a brief text response after EACH tool call explaining what you did
- You can make multiple tool calls in sequence to complete a task
- After creating a document, customize it with the user's specific topic using editDocument
- Be concise but informative in your responses`

  const result = streamText({
    model: gateway("openai/gpt-5-mini"),
    system: systemPrompt,
    messages: modelMessages,
    providerOptions: {
      openai: {
        reasoningSummary: "auto",
      },
    },
    stopWhen: stepCountIs(10), // Allow up to 10 steps for multi-tool workflows
    tools: {
      searchDocument: tool({
        description: "Search for text or patterns in the current LaTeX document",
        inputSchema: zodSchema(z.object({
          query: z.string().describe("The text or regex pattern to search for"),
          caseSensitive: z.boolean().optional().describe("Whether the search should be case sensitive"),
        })),
      }),
      editDocument: tool({
        description: "Edit the LaTeX document by replacing text. Use this when the user asks you to make changes to their document.",
        inputSchema: zodSchema(z.object({
          oldText: z.string().describe("The exact text to find and replace"),
          newText: z.string().describe("The new text to replace it with"),
          explanation: z.string().describe("Brief explanation of why this change is being made"),
        })),
      }),
      insertText: tool({
        description: "Insert new text at a specific location in the document",
        inputSchema: zodSchema(z.object({
          position: z.enum(["beginning", "end", "after-preamble", "before-end-document"]).describe("Where to insert the text"),
          text: z.string().describe("The text to insert"),
          explanation: z.string().describe("Brief explanation of what is being added"),
        })),
      }),
      getDocumentInfo: tool({
        description: "Get information about the current document structure",
        inputSchema: zodSchema(z.object({
          infoType: z.enum(["sections", "packages", "commands", "environments", "all"]).describe("What information to retrieve"),
        })),
      }),
      suggestTemplate: tool({
        description: "Create a new document from a template OR get a LaTeX code snippet. For document types (article, report, book, beamer, letter), this will REPLACE the entire document. For snippets (figure, table, equation, etc.), it returns the code to insert.",
        inputSchema: zodSchema(z.object({
          templateType: z.enum([
            "article",
            "report",
            "book",
            "letter",
            "beamer",
            "figure",
            "table",
            "equation",
            "itemize",
            "enumerate",
            "bibliography",
            "custom"
          ]).describe("The type of template. Document types (article/report/book/beamer/letter) replace the whole document."),
          customDescription: z.string().optional().describe("Additional context for the template"),
        })),
      }),
    },
  })

  return result.toUIMessageStreamResponse()
}
