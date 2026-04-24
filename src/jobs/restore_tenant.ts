import { Job } from '@adonisjs/queue'
import app from '@adonisjs/core/services/app'
import logger from '@adonisjs/core/services/logger'
import { TENANT_REPOSITORY } from '../types/contracts.js'
import type { TenantRepositoryContract } from '../types/contracts.js'
import BackupService from '../services/backup_service.js'

interface RestoreTenantPayload {
  tenantId: string
  fileName: string
}

export default class RestoreTenant extends Job<RestoreTenantPayload> {
  async execute(): Promise<void> {
    const { tenantId, fileName } = this.payload
    const repo = (await app.container.make(TENANT_REPOSITORY as any)) as TenantRepositoryContract
    const tenant = await repo.findByIdOrFail(tenantId)
    logger.info({ tenantId: tenant.id, file: fileName }, 'Starting tenant restore')

    await new BackupService().restore(tenant, fileName)

    logger.info({ tenantId: tenant.id, file: fileName }, 'Tenant restore completed')
  }

  async failed(error: Error): Promise<void> {
    const { tenantId, fileName } = this.payload
    logger.error(
      { tenantId, file: fileName, error: error.message },
      'Failed to restore tenant'
    )
  }
}
