import { Job } from '@adonisjs/queue'
import app from '@adonisjs/core/services/app'
import logger from '@adonisjs/core/services/logger'
import { TENANT_REPOSITORY } from '../types/contracts.js'
import type { TenantRepositoryContract } from '../types/contracts.js'
import TenantQueueService from '../services/tenant_queue_service.js'
import CircuitBreakerService from '../services/circuit_breaker_service.js'

interface UninstallTenantPayload {
  tenantId: string
}

export default class UninstallTenant extends Job<UninstallTenantPayload> {
  async execute(): Promise<void> {
    const { tenantId } = this.payload
    const repo = (await app.container.make(TENANT_REPOSITORY as any)) as TenantRepositoryContract
    const tenant = await repo.findByIdOrFail(tenantId, true)
    logger.info({ tenantId: tenant.id }, 'Uninstalling tenant schema')

    await new TenantQueueService().destroy(tenant.id)
    await new CircuitBreakerService().destroy(tenant.id)

    await tenant.uninstall()
    logger.info({ tenantId: tenant.id }, 'Tenant uninstalled successfully')
  }

  async failed(error: Error): Promise<void> {
    logger.error({ tenantId: this.payload.tenantId, error: error.message }, 'Failed to uninstall tenant')
  }
}
