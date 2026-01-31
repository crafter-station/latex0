"use client"

import { useUser, SignInButton } from "@clerk/nextjs"
import { IconBrandGithub, IconBrandGoogle } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"

export function AuthButtons() {
  const { isSignedIn, isLoaded } = useUser()

  // Only show if user is NOT signed in and Clerk is loaded
  if (!isLoaded || isSignedIn) return null

  return (
    <div className="flex flex-col gap-2 items-center">
      <p className="font-mono text-[10px] tracking-widest text-white/30 mb-2">
        OR SIGN IN WITH
      </p>
      <div className="flex gap-3">
        <SignInButton mode="modal" forceRedirectUrl="/playground">
          <Button
            variant="outline"
            size="sm"
            className="border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white font-mono text-xs"
          >
            <IconBrandGoogle className="mr-2 h-4 w-4" />
            Google
          </Button>
        </SignInButton>
        <SignInButton mode="modal" forceRedirectUrl="/playground">
          <Button
            variant="outline"
            size="sm"
            className="border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white font-mono text-xs"
          >
            <IconBrandGithub className="mr-2 h-4 w-4" />
            GitHub
          </Button>
        </SignInButton>
      </div>
      <p className="font-mono text-[9px] tracking-wide text-white/20 mt-2">
        Continue as guest without signing in
      </p>
    </div>
  )
}
