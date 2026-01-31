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

  const systemPrompt = `You are LaTeX0, an AI assistant for a LaTeX IDE. You help users write, edit, and improve their LaTeX documents.

Current document content:
\`\`\`latex
${documentContent || "No document open"}
\`\`\`

CAPABILITIES:
- Answer questions about LaTeX syntax and commands
- Search for content in the document
- Edit and improve existing content
- Create new documents from templates
- Add figures, tables, equations, and other elements

IMPORTANT - LATEX.JS BROWSER LIMITATIONS:
This IDE uses latex.js for browser-based preview. You MUST only use supported features.

SUPPORTED document classes: article, book, report (NOT beamer, letter)

SUPPORTED environments:
- Lists: itemize, enumerate, description
- Text blocks: quote, quotation, verse, verbatim
- Alignment: center, flushleft, flushright
- Other: abstract, document

SUPPORTED sectioning: \\part, \\chapter, \\section, \\subsection, \\subsubsection, \\paragraph

SUPPORTED text formatting: \\textbf, \\textit, \\texttt, \\emph, \\underline, \\textrm, \\textsf

SUPPORTED math: Inline math with $...$ or \\(...\\), display math with \\[...\\]

NOT SUPPORTED - DO NOT USE:
- Environments: table, tabular, figure, equation, align, eqnarray, lstlisting, array
- Macros: \\rule, \\caption, \\label, \\ref, \\includegraphics, \\url, \\href, \\hfill, \\vfill
- Packages: Most packages including geometry, fancyhdr, tikz, listings, minted, algorithm
- Document classes: beamer, letter

ALTERNATIVES for common needs:
- For tables → Use formatted text with spacing, or describe data in prose
- For figures → Use \\begin{center} with descriptive text
- For horizontal lines → Use --- or \\hrulefill
- For links → Use \\texttt{url text}
- For captions → Use \\textit{Description: your text}
- For equations → Use $...$ for inline or \\[...\\] for display math

WORKFLOW:
1. When user wants a NEW DOCUMENT: Use suggestTemplate with a document type (article/report/book/beamer/letter). This automatically replaces the document. Then use editDocument to customize title, sections, and content.
2. When user wants to ADD content: Use editDocument or insertText to add specific content.
3. When user wants to MODIFY content: Use editDocument to make precise changes.
4. When FIXING ERRORS: Replace unsupported environments/macros with the compatible alternatives listed above.

RESPONSE RULES:
- ALWAYS include a brief text response after EACH tool call explaining what you did
- You can make multiple tool calls in sequence to complete a task
- After creating a document, customize it with the user's specific topic using editDocument
- Be concise but informative in your responses
- Example: After calling editDocument, say "I updated the title to reflect your topic."
- Example: After suggestTemplate, say "I created an article template. Now customizing it for your topic..."`

  const result = streamText({
    model: gateway("openai/gpt-4o-mini"),
    system: systemPrompt,
    messages: modelMessages,
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
