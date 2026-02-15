import { auth } from "@clerk/nextjs/server"
import { NextRequest, NextResponse } from "next/server"

type AuthContext<T> = { userId: string; params: T }

/**
 * Higher-order function that wraps API route handlers with authentication.
 * Returns 401 if not authenticated.
 */
export function withAuth<T = Record<string, never>>(
  handler: (req: NextRequest, context: AuthContext<T>) => Promise<Response>
) {
  return async (
    req: NextRequest,
    { params }: { params: Promise<T> }
  ): Promise<Response> => {
    const { userId } = await auth()

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const resolvedParams = await params

    return handler(req, { userId, params: resolvedParams })
  }
}
