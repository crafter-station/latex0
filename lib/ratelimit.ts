import { Ratelimit } from "@upstash/ratelimit"
import { Redis } from "@upstash/redis"

// Lazy-load Redis client to avoid build-time errors
let redis: Redis | null = null

function getRedis(): Redis {
  if (!redis) {
    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
      throw new Error("Upstash Redis credentials not configured")
    }
    redis = Redis.fromEnv()
  }
  return redis
}

// Rate limiter for API routes - 20 requests per 10 seconds sliding window
let _ratelimit: Ratelimit | null = null
export function getRatelimit(): Ratelimit {
  if (!_ratelimit) {
    _ratelimit = new Ratelimit({
      redis: getRedis(),
      limiter: Ratelimit.slidingWindow(20, "10 s"),
      analytics: true,
      prefix: "latex0",
    })
  }
  return _ratelimit
}

// Stricter rate limiter for AI chat - 10 requests per minute
let _chatRatelimit: Ratelimit | null = null
export function getChatRatelimit(): Ratelimit {
  if (!_chatRatelimit) {
    _chatRatelimit = new Ratelimit({
      redis: getRedis(),
      limiter: Ratelimit.slidingWindow(10, "60 s"),
      analytics: true,
      prefix: "latex0:chat",
    })
  }
  return _chatRatelimit
}

// Check if rate limiting is configured
export function isRateLimitConfigured(): boolean {
  return !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
}
