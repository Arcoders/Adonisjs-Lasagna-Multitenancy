import type { HttpContext } from '@adonisjs/core/http'
import { FeatureFlagService } from '@adonisjs-lasagna/multitenancy/services'

const flags = new FeatureFlagService()

/**
 * Per-tenant feature flag CRUD. Demonstrates `FeatureFlagService` from the
 * package. Real apps would expose this via an admin UI; the demo route is
 * deliberately bare.
 */
export default class FeatureFlagsController {
  async list({ request, response }: HttpContext) {
    const tenant = await request.tenant()
    const rows = await flags.listForTenant(tenant.id)
    return response.ok({
      tenantId: tenant.id,
      flags: rows.map((r) => ({
        flag: r.flag,
        enabled: r.enabled,
        config: r.config ?? null,
      })),
    })
  }

  async set({ request, response }: HttpContext) {
    const tenant = await request.tenant()
    const body = request.body() as {
      flag?: string
      enabled?: boolean
      config?: Record<string, unknown>
    }
    if (!body.flag) {
      return response.badRequest({ error: { message: 'flag is required' } })
    }
    const enabled = body.enabled !== false
    const row = await flags.set(tenant.id, body.flag, enabled, body.config)
    return response.created({
      tenantId: tenant.id,
      flag: row.flag,
      enabled: row.enabled,
      config: row.config ?? null,
    })
  }

  async destroy({ params, request, response }: HttpContext) {
    const tenant = await request.tenant()
    await flags.delete(tenant.id, params.flag)
    return response.ok({ deleted: true, flag: params.flag })
  }
}
