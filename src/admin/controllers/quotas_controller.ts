import app from '@adonisjs/core/services/app'
import type { HttpContext } from '@adonisjs/core/http'
import QuotaService from '../../services/quota_service.js'
import { loadTenantOr404, isNonEmptyString } from './helpers.js'

export default class QuotasController {
  async show(ctx: HttpContext) {
    const tenant = await loadTenantOr404(ctx)
    if (!tenant) return
    const svc = await app.container.make(QuotaService)
    try {
      const snapshot = await svc.snapshot(tenant)
      return ctx.response.ok({ data: snapshot })
    } catch (err: any) {
      // Most common cause: `config.plans` not configured. Return a clean
      // 503 instead of letting the exception bubble — the admin probably
      // wants to see "quotas not enabled" rather than a stack trace.
      return ctx.response.serviceUnavailable({
        error: 'quotas_unavailable',
        message: err?.message ?? 'unknown',
      })
    }
  }

  async setUsage(ctx: HttpContext) {
    const tenant = await loadTenantOr404(ctx)
    if (!tenant) return

    const quota = ctx.request.input('quota')
    const value = ctx.request.input('value')
    if (!isNonEmptyString(quota)) {
      return ctx.response.badRequest({ error: 'quota_required' })
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      return ctx.response.badRequest({ error: 'value_must_be_non_negative_number' })
    }
    const svc = await app.container.make(QuotaService)
    await svc.setUsage(tenant, quota, value)
    return ctx.response.ok({ tenantId: tenant.id, quota, usage: value })
  }

  async reset(ctx: HttpContext) {
    const tenant = await loadTenantOr404(ctx)
    if (!tenant) return
    const quota = ctx.request.input('quota')
    const svc = await app.container.make(QuotaService)
    await svc.reset(tenant, isNonEmptyString(quota) ? quota : undefined)
    return ctx.response.ok({ tenantId: tenant.id, reset: quota ?? 'all' })
  }
}
