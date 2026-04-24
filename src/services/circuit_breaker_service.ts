import CircuitBreaker from 'opossum'
import { getConfig } from '../config.js'

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN'

export interface CircuitMetrics {
  state: CircuitState
  failures: number
  successes: number
  fallbackCalls: number
  tenantId: string
}

const REDIS_KEY_PREFIX = 'cb:state:'

const lazyRedis = () =>
  import('@adonisjs/redis/services/main')
    .then((m) => m.default)
    .catch(() => null)

const lazyDb = () =>
  import('@adonisjs/lucid/services/db')
    .then((m) => m.default)
    .catch(() => null)

const lazyLogger = () =>
  import('@adonisjs/core/services/logger')
    .then((m) => m.default)
    .catch(() => null)

export default class CircuitBreakerService {
  private circuits = new Map<string, CircuitBreaker>()

  getCircuit(tenantId: string): CircuitBreaker {
    if (this.circuits.has(tenantId)) {
      return this.circuits.get(tenantId)!
    }

    const cfg = getConfig().circuitBreaker
    const connectionName = `${getConfig().tenantConnectionNamePrefix}${tenantId}`

    const probeFn = async () => {
      const db = await lazyDb()
      await db?.connection(connectionName).rawQuery('SELECT 1')
    }

    const breaker = new CircuitBreaker(probeFn, {
      timeout: 5000,
      errorThresholdPercentage: cfg.threshold,
      resetTimeout: cfg.resetTimeout,
      rollingCountTimeout: cfg.rollingCountTimeout,
      volumeThreshold: cfg.volumeThreshold,
      name: `tenant_${tenantId}`,
    })

    breaker.on('open', async () => {
      const logger = await lazyLogger()
      logger?.warn({ tenantId }, 'Circuit OPEN — tenant DB unavailable')
      this.#persistState(tenantId, 'OPEN').catch(() => {})
    })

    breaker.on('close', async () => {
      const logger = await lazyLogger()
      logger?.info({ tenantId }, 'Circuit CLOSED — tenant DB recovered')
      this.#persistState(tenantId, 'CLOSED').catch(() => {})
    })

    breaker.on('halfOpen', async () => {
      const logger = await lazyLogger()
      logger?.info({ tenantId }, 'Circuit HALF_OPEN — probing tenant DB')
      this.#persistState(tenantId, 'HALF_OPEN').catch(() => {})
    })

    this.circuits.set(tenantId, breaker)
    return breaker
  }

  isOpen(tenantId: string): boolean {
    if (!this.circuits.has(tenantId)) return false
    return this.circuits.get(tenantId)!.opened
  }

  getMetrics(tenantId: string): CircuitMetrics | null {
    const breaker = this.circuits.get(tenantId)
    if (!breaker) return null
    const stats = breaker.stats
    return {
      tenantId,
      state: breaker.opened ? 'OPEN' : breaker.halfOpen ? 'HALF_OPEN' : 'CLOSED',
      failures: stats.failures,
      successes: stats.successes,
      fallbackCalls: stats.fallbacks,
    }
  }

  getAllMetrics(): Record<string, CircuitMetrics> {
    const result: Record<string, CircuitMetrics> = {}
    for (const [tenantId] of this.circuits) {
      const m = this.getMetrics(tenantId)
      if (m) result[tenantId] = m
    }
    return result
  }

  reset(tenantId: string): void {
    const breaker = this.circuits.get(tenantId)
    if (breaker) {
      breaker.close()
      this.#persistState(tenantId, 'CLOSED').catch(() => {})
    }
  }

  async destroy(tenantId: string): Promise<void> {
    const breaker = this.circuits.get(tenantId)
    if (breaker) {
      breaker.shutdown()
      this.circuits.delete(tenantId)
    }
    try {
      const redis = await lazyRedis()
      await redis?.del(`${REDIS_KEY_PREFIX}${tenantId}`)
    } catch {}
  }

  async #persistState(tenantId: string, state: CircuitState): Promise<void> {
    try {
      const redis = await lazyRedis()
      await redis?.setex(`${REDIS_KEY_PREFIX}${tenantId}`, 3600, state)
    } catch {}
  }
}
