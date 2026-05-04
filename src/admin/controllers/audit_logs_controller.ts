import app from '@adonisjs/core/services/app'
import type { HttpContext } from '@adonisjs/core/http'
import AuditLogService from '../../services/audit_log_service.js'
import { loadTenantOr404, clamp } from './helpers.js'

export default class AuditLogsController {
  async list(ctx: HttpContext) {
    const tenant = await loadTenantOr404(ctx)
    if (!tenant) return

    // Page is hard-capped at 1000 to prevent OFFSET-based DOS — Postgres
    // OFFSET is O(n), so `?page=10000&limit=200` reads + discards 2M
    // rows. For deeper traversal, use a date range filter instead (TODO).
    const page = clamp(ctx.request.input('page'), 1, 1000, 1)
    const limit = clamp(ctx.request.input('limit'), 1, 200, 50)

    const svc = await app.container.make(AuditLogService)
    const paginated = await svc.listForTenant(tenant.id, page, limit)
    return ctx.response.ok(paginated)
  }
}
