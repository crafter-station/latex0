import { put } from "@vercel/blob"
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"
import { getRatelimit, isRateLimitConfigured } from "@/lib/ratelimit"

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const ALLOWED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/svg+xml",
  "image/webp",
  "application/pdf",
]

export async function POST(req: NextRequest) {
  // Auth: use Clerk userId if signed in, fallback to IP for playground
  const { userId } = await auth()
  const identifier =
    userId ||
    req.headers.get("x-forwarded-for") ||
    req.headers.get("x-real-ip") ||
    "anonymous"

  // Rate limit
  if (isRateLimitConfigured()) {
    const { success } = await getRatelimit().limit(`upload:${identifier}`)
    if (!success) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Please wait before uploading again." },
        { status: 429 }
      )
    }
  }

  const formData = await req.formData()
  const file = formData.get("file") as File | null

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 })
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: "Unsupported file type. Allowed: PNG, JPEG, GIF, SVG, WebP, PDF" },
      { status: 400 }
    )
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: "File too large. Maximum size is 10MB." },
      { status: 400 }
    )
  }

  const blob = await put(`${identifier}/${Date.now()}-${file.name}`, file, {
    access: "public",
  })

  // Try to get image dimensions via metadata
  let width: number | undefined
  let height: number | undefined

  if (file.type.startsWith("image/") && file.type !== "image/svg+xml") {
    try {
      const arrayBuffer = await file.arrayBuffer()
      const dimensions = parseImageDimensions(new Uint8Array(arrayBuffer), file.type)
      if (dimensions) {
        width = dimensions.width
        height = dimensions.height
      }
    } catch {
      // Non-critical — skip dimensions
    }
  }

  return NextResponse.json({
    url: blob.url,
    size: file.size,
    contentType: file.type,
    width,
    height,
    uploadedAt: new Date().toISOString(),
  })
}

/** Parse image dimensions from binary data (PNG/JPEG only, server-side) */
function parseImageDimensions(
  data: Uint8Array,
  type: string
): { width: number; height: number } | null {
  if (type === "image/png" && data.length > 24) {
    // PNG: width at bytes 16-19, height at bytes 20-23 (big-endian)
    const width = (data[16] << 24) | (data[17] << 16) | (data[18] << 8) | data[19]
    const height = (data[20] << 24) | (data[21] << 16) | (data[22] << 8) | data[23]
    return { width, height }
  }

  if ((type === "image/jpeg" || type === "image/jpg") && data.length > 2) {
    // JPEG: scan for SOF0 marker (0xFF 0xC0)
    let offset = 2
    while (offset < data.length - 9) {
      if (data[offset] === 0xff) {
        const marker = data[offset + 1]
        if (marker >= 0xc0 && marker <= 0xc3) {
          const height = (data[offset + 5] << 8) | data[offset + 6]
          const width = (data[offset + 7] << 8) | data[offset + 8]
          return { width, height }
        }
        const segLen = (data[offset + 2] << 8) | data[offset + 3]
        offset += 2 + segLen
      } else {
        offset++
      }
    }
  }

  return null
}
