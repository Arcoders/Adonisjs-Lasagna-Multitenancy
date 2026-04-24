import { getConfig } from '../config.js'
import { Exception } from '@adonisjs/core/exceptions'
import app from '@adonisjs/core/services/app'
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import redis from '@adonisjs/redis/services/main'

export interface RateLimitOptions {
  limit: number
  windowSeconds: number
  prefix?: string
}

class TooManyRequestsException extends Exception {
  static readonly status = 429
  static readonly code = 'E_TOO_MANY_REQUESTS'
  static readonly message = 'Too many requests. Please slow down and try again later'
}

export default class RateLimitMiddleware {
  async handle({ request, response }: HttpContext, next: NextFn, options: RateLimitOptions) {
    const { limit, windowSeconds, prefix = 'rl' } = options

    const ip = request.ip()
    const tenantId = request.header(getConfig().tenantHeaderKey) ?? 'global'
    const key = `${prefix}:${tenantId}:${ip}`

    const now = Date.now()
    const windowStart = now - windowSeconds * 1000

    if (!app.inTest) {
      try {
        const pipeline = redis.pipeline()
        pipeline.zremrangebyscore(key, '-inf', windowStart)
        pipeline.zadd(key, now, `${now}`)
        pipeline.zcard(key)
        pipeline.expire(key, windowSeconds)

        const results = await pipeline.exec()
        const count = results?.[2]?.[1] as number

        response.header('X-RateLimit-Limit', String(limit))
        response.header('X-RateLimit-Remaining', String(Math.max(0, limit - count)))
        response.header('X-RateLimit-Reset', String(Math.ceil((now + windowSeconds * 1000) / 1000)))

        if (count > limit) {
          response.header('Retry-After', String(windowSeconds))
          throw new TooManyRequestsException()
        }
      } catch (error) {
        if (error instanceof TooManyRequestsException) throw error
      }
    }

    return next()
  }
}
