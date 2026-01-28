import FingerprintJS from "@fingerprintjs/fingerprintjs"

let cachedId: string | null = null

export async function getFingerprint(): Promise<string> {
  if (cachedId) return cachedId

  const fp = await FingerprintJS.load()
  const result = await fp.get()
  cachedId = result.visitorId
  return cachedId
}

export function generateColor(id: string): string {
  // Generate consistent HSL color from fingerprint
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash)
  }
  const hue = Math.abs(hash % 360)
  return `hsl(${hue}, 70%, 60%)`
}

export function generateUserName(id: string): string {
  // Generate "User XXXX" from last 4 chars of fingerprint
  return `User ${id.slice(-4).toUpperCase()}`
}
