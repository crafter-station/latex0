"use client"

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { GithubBadge } from "@/components/github-badge"
import { UserBadge } from "@/components/user-badge"
import { AuthButtons } from "@/components/auth-buttons"
import { CrafterStationLogo } from "@/components/logos/crafter-station"
import { useUser } from "@clerk/nextjs"

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const router = useRouter()
  const { isSignedIn } = useUser()

  // Prefetch target routes immediately
  useEffect(() => {
    router.prefetch("/projects")
    router.prefetch("/playground")
  }, [router])

  // Handle Enter key to navigate
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        router.push(isSignedIn ? "/projects" : "/playground")
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [router, isSignedIn])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    resize()
    window.addEventListener("resize", resize)

    // Grid parameters
    const dotSize = 2
    const spacing = 40
    const perspective = 800
    const centerY = canvas.height * 0.5

    let time = 0

    const draw = () => {
      ctx.fillStyle = "#FAFAFA"
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      const centerX = canvas.width / 2

      // Draw perspective grid of dots
      for (let z = 20; z > 0; z--) {
        const scale = perspective / (perspective + z * 50)
        const y = centerY + (z - 10) * spacing * scale * 0.5
        const rowWidth = canvas.width * scale
        const startX = centerX - rowWidth / 2
        const dotsInRow = Math.floor(rowWidth / (spacing * scale))

        for (let i = 0; i <= dotsInRow; i++) {
          const x = startX + i * spacing * scale
          const distFromCenter = Math.abs(x - centerX) / (canvas.width / 2)
          const verticalDist = Math.abs(y - centerY) / (canvas.height / 2)
          const dist = Math.sqrt(distFromCenter ** 2 + verticalDist ** 2)

          // Pulsing effect
          const pulse = Math.sin(time * 0.02 + dist * 3) * 0.3 + 0.7
          const alpha = (1 - dist * 0.7) * scale * pulse

          if (alpha > 0.05) {
            ctx.beginPath()
            ctx.arc(x, y, dotSize * scale, 0, Math.PI * 2)
            ctx.fillStyle = `rgba(0, 0, 0, ${alpha * 0.25})`
            ctx.fill()
          }
        }
      }

      // Draw central portal (concentric circles)
      const portalRadius = 120
      const rings = 8
      for (let i = rings; i >= 0; i--) {
        const radius = portalRadius - i * 12
        const pulseOffset = Math.sin(time * 0.03 + i * 0.5) * 2
        ctx.beginPath()
        ctx.arc(centerX, centerY, radius + pulseOffset, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(0, 0, 0, ${0.06 + i * 0.03})`
        ctx.lineWidth = 1
        ctx.stroke()
      }

      // Inner glow
      const gradient = ctx.createRadialGradient(
        centerX,
        centerY,
        0,
        centerX,
        centerY,
        portalRadius
      )
      gradient.addColorStop(0, "rgba(0, 0, 0, 0.04)")
      gradient.addColorStop(0.5, "rgba(0, 0, 0, 0.01)")
      gradient.addColorStop(1, "rgba(0, 0, 0, 0)")
      ctx.fillStyle = gradient
      ctx.beginPath()
      ctx.arc(centerX, centerY, portalRadius, 0, Math.PI * 2)
      ctx.fill()

      time++
      requestAnimationFrame(draw)
    }

    const animationId = requestAnimationFrame(draw)

    return () => {
      window.removeEventListener("resize", resize)
      cancelAnimationFrame(animationId)
    }
  }, [])

  return (
    <div className="relative h-svh w-full overflow-hidden bg-[#FAFAFA]">
      {/* Animated background */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
      />

      {/* Content overlay */}
      <div className="relative z-10 flex h-full flex-col items-center justify-center">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center">
          <div className="relative mb-6">
            {/* Outer ring */}
            <div className="absolute -inset-4 rounded-full border border-neutral-200" />
            <div className="absolute -inset-8 rounded-full border border-neutral-100" />

            {/* Logo circle */}
            <div className="flex h-24 w-24 items-center justify-center rounded-full border border-neutral-300 bg-white/80 backdrop-blur-sm">
              <span className="font-mono text-4xl font-bold tracking-tighter text-neutral-900">
                0
              </span>
            </div>
          </div>

          <div className="mb-2 flex items-center gap-3">
            <h1 className="font-mono text-2xl font-bold tracking-[0.2em] text-neutral-900">
              LATEX
              <span className="text-neutral-400">0</span>
            </h1>
            <span className="rounded border border-neutral-300 bg-neutral-100 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-neutral-500">
              Beta
            </span>
          </div>

          <p className="font-mono text-xs tracking-[0.3em] text-neutral-400">
            THE FUTURE OF TYPESETTING
          </p>
        </div>

        {/* Tagline */}
        <p className="mb-4 max-w-md text-center font-mono text-sm leading-relaxed text-neutral-500">
          An AI-powered LaTeX editor for the modern era.
          <br />
          Write. Compile. Ship.
        </p>

        {/* Open source message */}
        <p className="mb-12 font-mono text-xs tracking-wide text-neutral-600">
          Researchers deserve{" "}
          <span className="border-b border-neutral-400 text-neutral-900">open source</span>{" "}
          tools.
        </p>

        {/* CTA Buttons */}
        <div className="flex flex-col gap-4 items-center">
          {/* Primary CTA - Always visible */}
          <Link href={isSignedIn ? "/projects" : "/playground"}>
            <Button
              variant="outline"
              className="group relative overflow-hidden border-neutral-300 bg-white px-8 py-6 font-mono text-sm tracking-[0.15em] text-neutral-700 transition-all duration-500 hover:border-neutral-400 hover:bg-neutral-50 hover:text-neutral-900"
            >
              <span className="relative z-10">
                {isSignedIn ? "OPEN EDITOR" : "GET STARTED"}
              </span>
              <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-neutral-200/50 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
            </Button>
          </Link>

          <AuthButtons />
        </div>

        {/* Keyboard shortcut hint */}
        <p className="mt-8 font-mono text-[10px] tracking-widest text-neutral-300">
          PRESS ENTER TO CONTINUE
        </p>
      </div>

      {/* Vignette overlay */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,#FAFAFA_70%)]" />

      {/* Corner decorations */}
      <div className="absolute left-8 top-8 font-mono text-[10px] tracking-widest text-neutral-300">
        v0.1.0
      </div>
      <div className="absolute right-8 top-8 z-20 flex items-center gap-3">
        <GithubBadge />
        <UserBadge />
      </div>
      <a
        href="https://www.crafterstation.com"
        target="_blank"
        rel="noopener noreferrer"
        className="absolute bottom-6 left-6 flex items-center gap-2.5 px-3 py-2 rounded-lg bg-white/80 border border-neutral-200 hover:bg-neutral-50 hover:border-neutral-300 transition-all z-20"
      >
        <CrafterStationLogo className="size-5 text-[#FFD500]" />
        <span className="font-mono text-xs tracking-wide text-neutral-600">Crafter Station</span>
      </a>
      <div className="absolute bottom-8 right-8 font-mono text-[10px] tracking-widest text-neutral-300">
        AI-POWERED
      </div>
    </div>
  )
}
