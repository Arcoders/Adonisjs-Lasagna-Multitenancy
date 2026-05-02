import type { HttpContext } from '@adonisjs/core/http'
import { QuotaService } from '@adonisjs-lasagna/multitenancy/services'
import type { DemoMeta } from '#app/models/backoffice/tenant'

const quota = new QuotaService()

/**
 * Two routes that demystify the quota story:
 *  - GET  /demo/quota/state     → snapshot of plan + limits + current usage
 *  - POST /demo/quota/track     → bump a rolling counter without blocking
 */
export default class QuotaController {
  async state({ request, response }: HttpContext) {
    const tenant = await request.tenant<DemoMeta>()
    const snapshot = await quota.snapshot(tenant)
    return response.ok({ tenantId: tenant.id, ...snapshot })
  }

  async track({ request, response }: HttpContext) {
    const tenant = await request.tenant<DemoMeta>()
    const body = request.body() as { quota?: string; amount?: number }
    if (!body.quota) {
      return response.badRequest({ error: { message: 'quota name is required' } })
    }
    const next = await quota.track(tenant, body.quota, body.amount ?? 1)
    return response.ok({ quota: body.quota, current: next })
  }
}
