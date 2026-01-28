import sharp from "sharp"
import pngToIco from "png-to-ico"
import { writeFileSync } from "fs"
import { join } from "path"

// Brand colors - Monolithic Futurism
const COLORS = {
  void: "#0A0A0A",
  white: "#F5F5F5",
  ring1: "rgba(245, 245, 245, 0.20)",
  ring2: "rgba(245, 245, 245, 0.10)",
  ring3: "rgba(245, 245, 245, 0.05)",
}

// Generate the logo SVG with concentric rings
function generateLogoSVG(size: number, showText = false): string {
  const center = size / 2
  const logoRadius = size * 0.15
  const ring1 = logoRadius + size * 0.04
  const ring2 = logoRadius + size * 0.08
  const ring3 = logoRadius + size * 0.12

  const textSection = showText
    ? `
    <!-- LATEX0 text -->
    <text x="${center}" y="${center + logoRadius + size * 0.22}"
          font-family="ui-monospace, SFMono-Regular, 'JetBrains Mono', monospace"
          font-size="${size * 0.06}"
          font-weight="700"
          fill="${COLORS.white}"
          text-anchor="middle"
          letter-spacing="0.2em">LATEX<tspan fill-opacity="0.6">0</tspan></text>

    <!-- Tagline -->
    <text x="${center}" y="${center + logoRadius + size * 0.32}"
          font-family="ui-monospace, SFMono-Regular, 'JetBrains Mono', monospace"
          font-size="${size * 0.022}"
          fill="rgba(245, 245, 245, 0.4)"
          text-anchor="middle"
          letter-spacing="0.3em">THE FUTURE OF TYPESETTING</text>
  `
    : ""

  return `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <!-- Background -->
      <rect width="${size}" height="${size}" fill="${COLORS.void}"/>

      <!-- Subtle grid dots -->
      <defs>
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <circle cx="20" cy="20" r="1" fill="rgba(245, 245, 245, 0.08)"/>
        </pattern>
        <radialGradient id="vignette" cx="50%" cy="50%" r="70%">
          <stop offset="0%" stop-color="transparent"/>
          <stop offset="100%" stop-color="${COLORS.void}"/>
        </radialGradient>
        <radialGradient id="glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="rgba(245, 245, 245, 0.08)"/>
          <stop offset="50%" stop-color="rgba(245, 245, 245, 0.02)"/>
          <stop offset="100%" stop-color="transparent"/>
        </radialGradient>
      </defs>

      <!-- Grid pattern -->
      <rect width="${size}" height="${size}" fill="url(#grid)" opacity="0.5"/>

      <!-- Vignette overlay -->
      <rect width="${size}" height="${size}" fill="url(#vignette)"/>

      <!-- Inner glow -->
      <circle cx="${center}" cy="${center}" r="${ring3 + size * 0.05}" fill="url(#glow)"/>

      <!-- Outer rings -->
      <circle cx="${center}" cy="${center}" r="${ring3}" fill="none" stroke="${COLORS.ring3}" stroke-width="1"/>
      <circle cx="${center}" cy="${center}" r="${ring2}" fill="none" stroke="${COLORS.ring2}" stroke-width="1"/>
      <circle cx="${center}" cy="${center}" r="${ring1}" fill="none" stroke="${COLORS.ring1}" stroke-width="1"/>

      <!-- Main logo circle -->
      <circle cx="${center}" cy="${center}" r="${logoRadius}" fill="rgba(0,0,0,0.5)" stroke="rgba(245, 245, 245, 0.2)" stroke-width="1.5"/>

      <!-- Zero -->
      <text x="${center}" y="${center}"
            font-family="ui-monospace, SFMono-Regular, 'JetBrains Mono', monospace"
            font-size="${logoRadius * 1.2}"
            font-weight="700"
            fill="${COLORS.white}"
            text-anchor="middle"
            dominant-baseline="central">0</text>

      ${textSection}
    </svg>
  `
}

// Generate OG image (1200x630)
function generateOGSVG(): string {
  const width = 1200
  const height = 630
  const centerX = width / 2
  const centerY = height / 2 - 30
  const logoRadius = 60
  const ring1 = logoRadius + 16
  const ring2 = logoRadius + 32
  const ring3 = logoRadius + 48

  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <!-- Background -->
      <rect width="${width}" height="${height}" fill="${COLORS.void}"/>

      <!-- Subtle grid dots -->
      <defs>
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <circle cx="20" cy="20" r="1" fill="rgba(245, 245, 245, 0.06)"/>
        </pattern>
        <radialGradient id="vignette" cx="50%" cy="50%" r="70%">
          <stop offset="0%" stop-color="transparent"/>
          <stop offset="100%" stop-color="${COLORS.void}"/>
        </radialGradient>
        <radialGradient id="glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="rgba(245, 245, 245, 0.06)"/>
          <stop offset="60%" stop-color="rgba(245, 245, 245, 0.01)"/>
          <stop offset="100%" stop-color="transparent"/>
        </radialGradient>
      </defs>

      <!-- Grid pattern -->
      <rect width="${width}" height="${height}" fill="url(#grid)"/>

      <!-- Vignette overlay -->
      <rect width="${width}" height="${height}" fill="url(#vignette)"/>

      <!-- Inner glow -->
      <circle cx="${centerX}" cy="${centerY}" r="${ring3 + 60}" fill="url(#glow)"/>

      <!-- Outer rings -->
      <circle cx="${centerX}" cy="${centerY}" r="${ring3}" fill="none" stroke="${COLORS.ring3}" stroke-width="1"/>
      <circle cx="${centerX}" cy="${centerY}" r="${ring2}" fill="none" stroke="${COLORS.ring2}" stroke-width="1"/>
      <circle cx="${centerX}" cy="${centerY}" r="${ring1}" fill="none" stroke="${COLORS.ring1}" stroke-width="1"/>

      <!-- Main logo circle -->
      <circle cx="${centerX}" cy="${centerY}" r="${logoRadius}" fill="rgba(0,0,0,0.5)" stroke="rgba(245, 245, 245, 0.2)" stroke-width="2"/>

      <!-- Zero -->
      <text x="${centerX}" y="${centerY}"
            font-family="ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace"
            font-size="72"
            font-weight="700"
            fill="${COLORS.white}"
            text-anchor="middle"
            dominant-baseline="central">0</text>

      <!-- LATEX0 text -->
      <text x="${centerX}" y="${centerY + 130}"
            font-family="ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace"
            font-size="48"
            font-weight="700"
            fill="${COLORS.white}"
            text-anchor="middle"
            letter-spacing="0.2em">LATEX<tspan fill-opacity="0.6">0</tspan></text>

      <!-- Tagline -->
      <text x="${centerX}" y="${centerY + 180}"
            font-family="ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace"
            font-size="14"
            fill="rgba(245, 245, 245, 0.4)"
            text-anchor="middle"
            letter-spacing="0.3em">THE FUTURE OF TYPESETTING</text>

      <!-- Corner decorations -->
      <text x="40" y="40"
            font-family="ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace"
            font-size="10"
            fill="rgba(245, 245, 245, 0.2)"
            letter-spacing="0.15em"
            dominant-baseline="hanging">v0.1.0</text>

      <text x="${width - 40}" y="40"
            font-family="ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace"
            font-size="10"
            fill="rgba(245, 245, 245, 0.2)"
            letter-spacing="0.15em"
            text-anchor="end"
            dominant-baseline="hanging">2026</text>

      <text x="40" y="${height - 40}"
            font-family="ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace"
            font-size="10"
            fill="rgba(245, 245, 245, 0.2)"
            letter-spacing="0.15em">CRAFTER STATION</text>

      <text x="${width - 40}" y="${height - 40}"
            font-family="ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace"
            font-size="10"
            fill="rgba(245, 245, 245, 0.2)"
            letter-spacing="0.15em"
            text-anchor="end">AI-POWERED</text>
    </svg>
  `
}

// Generate favicon SVG (simple, clean)
function generateFaviconSVG(size: number): string {
  const center = size / 2
  const logoRadius = size * 0.35
  const ring1 = logoRadius + size * 0.08
  const ring2 = logoRadius + size * 0.16

  return `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <!-- Background -->
      <rect width="${size}" height="${size}" fill="${COLORS.void}"/>

      <!-- Outer rings -->
      <circle cx="${center}" cy="${center}" r="${ring2}" fill="none" stroke="${COLORS.ring2}" stroke-width="${size * 0.02}"/>
      <circle cx="${center}" cy="${center}" r="${ring1}" fill="none" stroke="${COLORS.ring1}" stroke-width="${size * 0.02}"/>

      <!-- Main logo circle -->
      <circle cx="${center}" cy="${center}" r="${logoRadius}" fill="rgba(0,0,0,0.6)" stroke="rgba(245, 245, 245, 0.25)" stroke-width="${size * 0.03}"/>

      <!-- Zero -->
      <text x="${center}" y="${center}"
            font-family="ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace"
            font-size="${logoRadius * 1.3}"
            font-weight="700"
            fill="${COLORS.white}"
            text-anchor="middle"
            dominant-baseline="central">0</text>
    </svg>
  `
}

async function main() {
  const publicDir = join(process.cwd(), "public")

  console.log("Generating brand assets for LATEX0...")

  // Generate OG image (1200x630)
  console.log("  Creating og.png (1200x630)...")
  const ogSvg = generateOGSVG()
  await sharp(Buffer.from(ogSvg)).png().toFile(join(publicDir, "og.png"))

  // Generate Twitter OG image (1200x600)
  console.log("  Creating og-twitter.png (1200x600)...")
  const twitterSvg = ogSvg.replace('height="630"', 'height="600"').replace('viewBox="0 0 1200 630"', 'viewBox="0 0 1200 600"')
  await sharp(Buffer.from(twitterSvg)).png().toFile(join(publicDir, "og-twitter.png"))

  // Generate favicon PNGs at different sizes
  console.log("  Creating favicon.ico (16x16, 32x32, 48x48)...")
  const faviconSizes = [16, 32, 48]
  const faviconPngs: Buffer[] = []

  for (const size of faviconSizes) {
    const svg = generateFaviconSVG(size)
    const png = await sharp(Buffer.from(svg)).png().toBuffer()
    faviconPngs.push(png)
  }

  // Convert to ICO
  const ico = await pngToIco(faviconPngs)
  writeFileSync(join(publicDir, "favicon.ico"), ico)

  // Also generate apple-touch-icon (180x180)
  console.log("  Creating apple-touch-icon.png (180x180)...")
  const appleTouchSvg = generateFaviconSVG(180)
  await sharp(Buffer.from(appleTouchSvg)).png().toFile(join(publicDir, "apple-touch-icon.png"))

  // Generate favicon-32x32.png for modern browsers
  console.log("  Creating favicon-32x32.png...")
  const favicon32Svg = generateFaviconSVG(32)
  await sharp(Buffer.from(favicon32Svg)).png().toFile(join(publicDir, "favicon-32x32.png"))

  // Generate favicon-16x16.png
  console.log("  Creating favicon-16x16.png...")
  const favicon16Svg = generateFaviconSVG(16)
  await sharp(Buffer.from(favicon16Svg)).png().toFile(join(publicDir, "favicon-16x16.png"))

  console.log("\nBrand assets generated successfully!")
  console.log("  - /public/og.png")
  console.log("  - /public/og-twitter.png")
  console.log("  - /public/favicon.ico")
  console.log("  - /public/apple-touch-icon.png")
  console.log("  - /public/favicon-32x32.png")
  console.log("  - /public/favicon-16x16.png")
}

main().catch(console.error)
