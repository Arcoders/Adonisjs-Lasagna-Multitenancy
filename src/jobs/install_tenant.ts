import { Job } from '@adonisjs/queue'
import app from '@adonisjs/core/services/app'
import logger from '@adonisjs/core/services/logger'
import { TENANT_REPOSITORY } from '../types/contracts.js'
import type { TenantRepositoryContract } from '../types/contracts.js'
import TenantQueueService from '../services/tenant_queue_service.js'

interface InstallTenantPayload {
  tenantId: string
}

export default class InstallTenant extends Job<InstallTenantPayload> {
  async execute(): Promise<void> {
    const { tenantId } = this.payload
    const repo = (await app.container.make(TENANT_REPOSITORY as any)) as TenantRepositoryContract
    const tenant = await repo.findByIdOrFail(tenantId)
    logger.info({ tenantId: tenant.id }, 'Provisioning tenant schema')
    await tenant.install()
    logger.info({ tenantId: tenant.id }, 'Tenant provisioned successfully')

    new TenantQueueService().getOrCreate(tenant.id)
    logger.info({ tenantId: tenant.id }, 'Tenant queue initialized')
  }

  async failed(error: Error): Promise<void> {
    logger.error({ tenantId: this.payload.tenantId, error: error.message }, 'Failed to install tenant')
  }
}
