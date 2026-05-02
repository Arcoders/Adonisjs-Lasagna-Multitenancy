import { DateTime } from 'luxon'
import { getConfig } from '../config.js'
import type { TenantModelContract } from '../types/contracts.js'
import type { PlanDefinition, PlansConfig } from '../types/config.js'
import QuotaExceededException from '../exceptions/quota_exceeded_exception.js'
import TenantQuotaExceeded from '../events/tenant_quota_exceeded.js'

const lazyRedis = () =>
  import('@adonisjs/redis/services/main')
    .then((m) => m.default)
    .catch(() => null)

const ROLLING_TTL_SECONDS = 60 * 60 * 48

export type QuotaMode = 'rolling-day' | 'snapshot'

export interface QuotaCheckResult {
  allowed: boolean
  current: number
  limit: number
  attempted: number
}

export interface QuotaStateSnapshot {
  plan: string
  limits: Record<string, number>
  usage: Record<string, number>
}

const DEFAULT_FALLBACK: PlansConfig = {
  defaultPlan: '__default__',
  definitions: { __default__: { limits: {} } },
}

export default class QuotaService {
  /**
   * Returns the plan name + definition currently applied to a tenant.
   * Throws if the resolved plan name is not declared in `definitions`.
   */
  async getPlanFor(
    tenant: TenantModelContract
  ): Promise<{ name: string; plan: PlanDefinition }> {
    const cfg = getConfig().plans ?? DEFAULT_FALLBACK
    const resolved = (await cfg.getPlan?.(tenant)) ?? cfg.defaultPlan
    const plan = cfg.definitions[resolved]
    if (!plan) {
      throw new Error(
        `QuotaService: plan "${resolved}" is not declared in config.plans.definitions`
      )
    }
    return { name: resolved, plan }
  }

  /**
   * Numeric limit for a quota on the tenant's plan, or `Infinity` if the
   * plan does not declare it (treated as unlimited).
   */
  async getLimit(tenant: TenantModelContract, quota: string): Promise<number> {
    const { plan } = await this.getPlanFor(tenant)
    const value = plan.limits[quota]
    return typeof value === 'number' && Number.isFinite(value) ? value : Number.POSITIVE_INFINITY
  }

  /**
   * Increment a rolling-day counter (default mode). Use this for things
   * like API calls per day. Counter expires after 48h.
   */
  async track(tenant: TenantModelContract, quota: string, amount: number = 1): Promise<number> {
    const redis = await lazyRedis()
    if (!redis) return 0
    const key = this.#rollingKey(tenant.id, quota)
    const next = await redis.incrby(key, amount)
    await redis.expire(key, ROLLING_TTL_SECONDS)
    return Number(next) || 0
  }

  /**
   * Set a snapshot value (e.g. seats, storageMb). Snapshot values are not
   * incremented automatically — the user reports them when they change.
   * Snapshots have no TTL.
   */
  async setUsage(tenant: TenantModelContract, quota: string, value: number): Promise<void> {
    const redis = await lazyRedis()
    if (!redis) return
    await redis.set(this.#snapshotKey(tenant.id, quota), String(Math.max(0, Math.floor(value))))
  }

  /**
   * Read the current usage. Tries the rolling-day counter first; falls back
   * to the snapshot if no rolling counter exists.
   */
  async getUsage(tenant: TenantModelContract, quota: string): Promise<number> {
    const redis = await lazyRedis()
    if (!redis) return 0
    const rolling = await redis.get(this.#rollingKey(tenant.id, quota))
    if (rolling !== null) return Number(rolling) || 0
    const snapshot = await redis.get(this.#snapshotKey(tenant.id, quota))
    return snapshot !== null ? Number(snapshot) || 0 : 0
  }

  /**
   * Pure check: is the tenant allowed to consume `amount` of `quota`?
   * Does not increment any counter, does not throw.
   */
  async check(
    tenant: TenantModelContract,
    quota: string,
    amount: number = 1
  ): Promise<QuotaCheckResult> {
    const limit = await this.getLimit(tenant, quota)
    const current = await this.getUsage(tenant, quota)
    return {
      allowed: current + amount <= limit,
      current,
      limit,
      attempted: amount,
    }
  }

  /**
   * Atomic-ish: check, then increment if allowed. Throws QuotaExceededException
   * (and dispatches `TenantQuotaExceeded`) if the limit would be exceeded.
   *
   * Race-safe up to a small window: if two parallel callers race the gap
   * between `check` and `track`, both may succeed even when only one slot
   * remained. For strict quotas, prefer DB-backed counting outside this
   * service (transactional decrement).
   */
  async consume(
    tenant: TenantModelContract,
    quota: string,
    amount: number = 1
  ): Promise<number> {
    const result = await this.check(tenant, quota, amount)
    if (!result.allowed) {
      await TenantQuotaExceeded.dispatch(
        tenant,
        quota,
        result.limit,
        result.current,
        amount
      )
      throw new QuotaExceededException({
        tenantId: tenant.id,
        quota,
        limit: result.limit,
        current: result.current,
        attempted: amount,
      })
    }
    return await this.track(tenant, quota, amount)
  }

  /**
   * Returns plan + limits + current usage for every limit declared in the
   * tenant's plan. Useful for a tenant-facing /usage endpoint.
   */
  async snapshot(tenant: TenantModelContract): Promise<QuotaStateSnapshot> {
    const { name, plan } = await this.getPlanFor(tenant)
    const usage: Record<string, number> = {}
    for (const quota of Object.keys(plan.limits)) {
      usage[quota] = await this.getUsage(tenant, quota)
    }
    return { plan: name, limits: { ...plan.limits }, usage }
  }

  /**
   * Reset both rolling and snapshot keys for a tenant + quota. Useful on
   * plan change or admin reset.
   */
  async reset(tenant: TenantModelContract, quota?: string): Promise<void> {
    const redis = await lazyRedis()
    if (!redis) return
    if (quota) {
      await redis.del(this.#rollingKey(tenant.id, quota))
      await redis.del(this.#snapshotKey(tenant.id, quota))
      return
    }
    // wildcard cleanup for the tenant
    const pattern = `quota:${tenant.id}:*`
    const pending: string[] = []
    let cursor = '0'
    do {
      const [next, batch] = (await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200)) as [
        string,
        string[],
      ]
      pending.push(...batch)
      cursor = next
    } while (cursor !== '0')
    if (pending.length > 0) await redis.del(...pending)
  }

  #periodToday(): string {
    return DateTime.utc().toFormat('yyyy-MM-dd')
  }

  #rollingKey(tenantId: string, quota: string): string {
    return `quota:${tenantId}:${this.#periodToday()}:${quota}`
  }

  #snapshotKey(tenantId: string, quota: string): string {
    return `quota:${tenantId}:snap:${quota}`
  }
}
