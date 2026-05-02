import TenantQueueService from '../../tenant_queue_service.js'
import type { DoctorCheck, DiagnosisIssue } from '../types.js'

const FAILED_THRESHOLD = 1
const DELAYED_THRESHOLD = 50

const queueStuckCheck: DoctorCheck = {
  name: 'queue_health',
  description: 'Flags tenant queues with failed jobs or unusually large delayed backlogs.',

  async run(ctx): Promise<DiagnosisIssue[]> {
    const svc = new TenantQueueService()
    const issues: DiagnosisIssue[] = []

    for (const tenant of ctx.tenants) {
      if (!tenant.isActive && !tenant.isSuspended) continue
      try {
        const stats = await svc.getStats(tenant.id)
        if (stats.failed >= FAILED_THRESHOLD) {
          issues.push({
            code: 'queue_failed_jobs',
            severity: 'warn',
            message: `Tenant "${tenant.name}" queue has ${stats.failed} failed job(s)`,
            tenantId: tenant.id,
            meta: { ...stats },
          })
        }
        if (stats.delayed >= DELAYED_THRESHOLD) {
          issues.push({
            code: 'queue_delayed_backlog',
            severity: 'warn',
            message: `Tenant "${tenant.name}" queue has ${stats.delayed} delayed jobs (threshold ${DELAYED_THRESHOLD})`,
            tenantId: tenant.id,
            meta: { ...stats },
          })
        }
      } catch (error: any) {
        issues.push({
          code: 'queue_inspect_failed',
          severity: 'info',
          message: `Could not inspect queue for "${tenant.name}": ${error?.message ?? 'unknown'}`,
          tenantId: tenant.id,
        })
      }
    }

    return issues
  },
}

export default queueStuckCheck
