"use client"

import { useTheme } from "next-themes"
import { useEffect, useState, useRef } from "react"
import { motion, AnimatePresence } from "motion/react"
import { Moon, Sun } from "lucide-react"
import { Button } from "@/components/ui/button"
import { create } from "zustand"

// Zustand store for theme transition state
interface ThemeTransitionStore {
  isTransitioning: boolean
  originX: number
  originY: number
  startTransition: (x: number, y: number) => void
  endTransition: () => void
}

export const useThemeTransition = create<ThemeTransitionStore>((set) => ({
  isTransitioning: false,
  originX: 0,
  originY: 0,
  startTransition: (x, y) => set({ isTransitioning: true, originX: x, originY: y }),
  endTransition: () => set({ isTransitioning: false }),
}))

export function ThemeSwitcherButton() {
  const { theme, setTheme, resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const { startTransition, endTransition } = useThemeTransition()

  useEffect(() => {
    setMounted(true)
  }, [])

  const toggleTheme = () => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      const x = rect.left + rect.width / 2
      const y = rect.top + rect.height / 2
      startTransition(x, y)
    }

    const newTheme = resolvedTheme === "dark" ? "light" : "dark"
    setTheme(newTheme)

    // End transition after animation completes
    setTimeout(endTransition, 600)
  }

  if (!mounted) {
    return (
      <Button variant="ghost" size="icon" className="h-9 w-9">
        <span className="sr-only">Toggle theme</span>
      </Button>
    )
  }

  const isDark = resolvedTheme === "dark"

  return (
    <Button
      ref={buttonRef}
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      className="relative h-9 w-9 overflow-hidden"
    >
      <AnimatePresence mode="wait" initial={false}>
        {isDark ? (
          <motion.div
            key="moon"
            initial={{ scale: 0, rotate: -90 }}
            animate={{ scale: 1, rotate: 0 }}
            exit={{ scale: 0, rotate: 90 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="absolute inset-0 flex items-center justify-center"
          >
            <Moon className="h-4 w-4" />
          </motion.div>
        ) : (
          <motion.div
            key="sun"
            initial={{ scale: 0, rotate: 90 }}
            animate={{ scale: 1, rotate: 0 }}
            exit={{ scale: 0, rotate: -90 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="absolute inset-0 flex items-center justify-center"
          >
            <Sun className="h-4 w-4" />
          </motion.div>
        )}
      </AnimatePresence>
      <span className="sr-only">Toggle theme</span>
    </Button>
  )
}

// Circular reveal overlay component - add this to your layout
export function ThemeTransitionOverlay() {
  const { isTransitioning, originX, originY } = useThemeTransition()
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) return null

  // Calculate the maximum radius needed to cover the entire screen
  const maxRadius = Math.sqrt(
    Math.max(originX, window.innerWidth - originX) ** 2 +
    Math.max(originY, window.innerHeight - originY) ** 2
  )

  return (
    <AnimatePresence>
      {isTransitioning && (
        <motion.div
          initial={{ clipPath: `circle(0px at ${originX}px ${originY}px)` }}
          animate={{ clipPath: `circle(${maxRadius * 2}px at ${originX}px ${originY}px)` }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
          className="fixed inset-0 z-[9999] pointer-events-none"
          style={{
            backgroundColor: resolvedTheme === "dark" ? "#0A0A0A" : "#ffffff",
          }}
        />
      )}
    </AnimatePresence>
  )
}
