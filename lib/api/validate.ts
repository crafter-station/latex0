import { NextResponse } from "next/server"
import { z } from "zod"

/**
 * Validates request body against a Zod schema.
 * Returns parsed data or an error response.
 */
export async function validateRequest<T>(
  req: Request,
  schema: z.ZodType<T>
): Promise<{ data: T } | { error: Response }> {
  try {
    const body = await req.json()
    const data = schema.parse(body)
    return { data }
  } catch (err) {
    if (err instanceof z.ZodError) {
      return {
        error: NextResponse.json(
          { error: "Validation failed", details: err.issues },
          { status: 400 }
        ),
      }
    }
    return {
      error: NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 }
      ),
    }
  }
}
