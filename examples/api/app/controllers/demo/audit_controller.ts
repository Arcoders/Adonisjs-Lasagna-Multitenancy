import type { HttpContext } from '@adonisjs/core/http'
import { TenantAuditLog } from '@adonisjs-lasagna/multitenancy'

/**
 * Reads back rows the package's lifecycle event listener writes.
 * See start/routes.ts → `emitter.on(TenantCreated, ...)` for where the
 * audit row originates.
 */
export default class AuditController {
  async list({ request, response }: HttpContext) {
    const tenant = await request.tenant()
    const limit = Math.min(Number(request.input('limit', 50)) || 50, 200)
    const rows = await TenantAuditLog.query()
      .where('tenant_id', tenant.id)
      .orderBy('created_at', 'desc')
      .limit(limit)
    return response.ok({ tenantId: tenant.id, count: rows.length, rows })
  }
}
