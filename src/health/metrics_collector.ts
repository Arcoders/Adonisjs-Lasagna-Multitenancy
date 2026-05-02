import app from '@adonisjs/core/services/app'
import CircuitBreakerService from '../services/circuit_breaker_service.js'
import TenantQueueService from '../services/tenant_queue_service.js'
import { TENANT_REPOSITORY } from '../types/contracts.js'
import type {
  TenantRepositoryContract,
  TenantStatus,
  TenantModelContract,
} from '../types/contracts.js'
import type { MetricsSnapshot } from './metrics_exporter.js'

const STATUSES: TenantStatus[] = ['provisioning', 'active', 'suspended', 'failed', 'deleted']

interface CollectOptions {
  /** Skip the tenants registry query (useful when DB is unreachable). */
  includeTenants?: boolean
  /** Skip queue stats lookup (BullMQ can be slow). */
  includeQueues?: boolean
}

const startedAt = Date.now()

export async function collectSnapshot(options: CollectOptions = {}): Promise<MetricsSnapshot> {
  const { includeTenants = true, includeQueues = true } = options

  const tenantsByStatus: Record<string, number> = {}
  for (const s of STATUSES) tenantsByStatus[s] = 0
  let tenantsTotal = 0

  if (includeTenants) {
    try {
      const repo = (await app.container.make(
        TENANT_REPOSITORY as any
      )) as TenantRepositoryContract
      const tenants = await repo.all({ includeDeleted: true })
      tenantsTotal = tenants.length
      for (const t of tenants as TenantModelContract[]) {
        tenantsByStatus[t.status] = (tenantsByStatus[t.status] ?? 0) + 1
      }
    } catch {
      // repository unavailable; surface zeros
    }
  }

  let circuits = {}
  try {
    const cb = await app.container.make(CircuitBreakerService)
    circuits = cb.getAllMetrics()
  } catch {}

  let queues: any[] = []
  if (includeQueues) {
    try {
      const qs = new TenantQueueService()
      queues = await qs.getAllStats()
    } catch {}
  }

  return {
    tenantsTotal,
    tenantsByStatus,
    circuits,
    queues,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
  }
}
