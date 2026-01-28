"use client"

import { useState, useEffect } from "react"
import { GithubLogo } from "@/components/logos/github"

export function GithubBadge() {
  const [stars, setStars] = useState<number | null>(null)

  useEffect(() => {
    const fetchStars = async () => {
      try {
        const response = await fetch(
          "https://api.github.com/repos/crafter-station/latex0"
        )
        if (response.ok) {
          const data = await response.json()
          setStars(data.stargazers_count)
        }
      } catch (error) {
        console.warn("Failed to fetch GitHub stars:", error)
      }
    }
    fetchStars()
  }, [])

  return (
    <a
      href="https://github.com/crafter-station/latex0"
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-1.5 sm:gap-2 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/20 rounded-md transition-colors"
    >
      <GithubLogo className="size-4" />
      <span className="text-xs font-medium text-white/80">Star</span>
      {stars !== null && (
        <span className="flex text-xs font-medium text-white/60 items-center gap-1">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="text-yellow-500"
          >
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
          {stars}
        </span>
      )}
    </a>
  )
}
