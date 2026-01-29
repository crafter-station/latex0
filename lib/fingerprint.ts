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

// Famous women researchers and scientists
const FAMOUS_WOMEN_RESEARCHERS = [
  "Marie Curie",
  "Ada Lovelace",
  "Rosalind Franklin",
  "Grace Hopper",
  "Katherine Johnson",
  "Dorothy Hodgkin",
  "Barbara McClintock",
  "Emmy Noether",
  "Lise Meitner",
  "Chien-Shiung Wu",
  "Vera Rubin",
  "Rachel Carson",
  "Jane Goodall",
  "Mary Anning",
  "Hypatia",
  "Sofia Kovalevskaya",
  "Maria Mitchell",
  "Cecilia Payne",
  "Hedy Lamarr",
  "Maryam Mirzakhani",
  "Tu Youyou",
  "Jocelyn Bell",
  "Rita Levi-Montalcini",
  "Françoise Barré-Sinoussi",
  "Jennifer Doudna",
  "Mae Jemison",
  "Sally Ride",
  "Margaret Hamilton",
  "Dian Fossey",
  "Mary Somerville",
]

export function generateUserName(id: string): string {
  // Generate consistent name from fingerprint
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash)
  }
  const index = Math.abs(hash) % FAMOUS_WOMEN_RESEARCHERS.length
  return FAMOUS_WOMEN_RESEARCHERS[index]
}
