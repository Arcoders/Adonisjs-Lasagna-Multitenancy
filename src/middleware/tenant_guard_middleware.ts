import { getConfig } from '../config.js'
import CircuitOpenException from '../exceptions/circuit_open_exception.js'
import TenantNotReadyException from '../exceptions/tenant_not_ready_exception.js'
import TenantSuspendedException from '../exceptions/tenant_suspended_exception.js'
import CircuitBreakerService from '../services/circuit_breaker_service.js'
import app from '@adonisjs/core/services/app'
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

export default class TenantGuardMiddleware {
  async handle({ request }: HttpContext, next: NextFn) {
    const path = request.url(false).split('?')[0]
    const ignored = getConfig().ignorePaths.some((p) => path === p || path.startsWith(`${p}/`))
    if (ignored) return next()

    const tenant = await request.tenant()

    if (tenant.isSuspended || tenant.isDeleted) {
      throw new TenantSuspendedException()
    }

    if (tenant.isProvisioning || tenant.isFailed) {
      throw new TenantNotReadyException()
    }

    const cbService = await app.container.make(CircuitBreakerService)
    if (cbService.isOpen(tenant.id)) {
      throw new CircuitOpenException()
    }

    return next()
  }
}
