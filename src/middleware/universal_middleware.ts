import { TENANT_REPOSITORY } from '../types/contracts.js'
import type {
  TenantModelContract,
  TenantRepositoryContract,
} from '../types/contracts.js'
import { resolveTenant, __setMemoizedTenant } from '../extensions/request.js'
import { getActiveDriver } from '../services/isolation/active_driver.js'
import TenantLogContext from '../services/tenant_log_context.js'
import app from '@adonisjs/core/services/app'
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * Universal routes: try to resolve a tenant, but fall through cleanly when
 * there isn't one. When a tenant IS resolved, behave like the tenant guard
 * (memoize, attach log context, connect the driver). When it isn't, just
 * call `next()` so the same handler can serve both contexts.
 *
 * Unlike `TenantGuardMiddleware`, this middleware NEVER throws on a missing
 * or invalid tenant — it silently degrades to "central" mode. Suspended /
 * deleted / not-ready tenants are also passed through as if they didn't
 * exist; the route handler is responsible for deciding what to render in
 * the absence of a tenant context.
 */
export default class UniversalMiddleware {
  async handle({ request }: HttpContext, next: NextFn) {
    const tenant = await this.#tryResolve(request)
    if (!tenant) return next()

    const logCtx = await app.container.make(TenantLogContext)
    return logCtx.run({ tenantId: tenant.id }, () => next())
  }

  async #tryResolve(request: HttpContext['request']): Promise<TenantModelContract | null> {
    let result
    try {
      result = await resolveTenant(request)
    } catch {
      return null
    }
    if (!result) return null

    let repo: TenantRepositoryContract | null = null
    try {
      repo = (await app.container.make(TENANT_REPOSITORY as any)) as TenantRepositoryContract
    } catch {
      return null
    }
    if (!repo) return null

    let tenant: TenantModelContract | null = null
    try {
      if (result.type === 'id') {
        if (!UUID_V4.test(result.tenantId)) return null
        tenant = await repo.findById(result.tenantId, false)
      } else if (result.type === 'domain') {
        tenant = await repo.findByDomain(result.domain)
      }
    } catch {
      return null
    }

    if (!tenant) return null
    if (tenant.isSuspended || tenant.isDeleted) return null
    if (tenant.isProvisioning || tenant.isFailed) return null

    try {
      const driver = await getActiveDriver()
      await driver.connect(tenant)
    } catch {
      return null
    }
    __setMemoizedTenant(request, tenant)
    return tenant
  }
}
