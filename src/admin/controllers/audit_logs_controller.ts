import app from '@adonisjs/core/services/app'
import type { HttpContext } from '@adonisjs/core/http'
import AuditLogService from '../../services/audit_log_service.js'
import { loadTenantOr404, clamp } from './helpers.js'

export default class AuditLogsController {
  async list(ctx: HttpContext) {
    const tenant = await loadTenantOr404(ctx)
    if (!tenant) return

    const page = clamp(ctx.request.input('page'), 1, 10000, 1)
    const limit = clamp(ctx.request.input('limit'), 1, 200, 50)

    const svc = await app.container.make(AuditLogService)
    const paginated = await svc.listForTenant(tenant.id, page, limit)
    return ctx.response.ok(paginated)
  }
}
