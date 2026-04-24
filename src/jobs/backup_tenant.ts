import { Job } from '@adonisjs/queue'
import app from '@adonisjs/core/services/app'
import logger from '@adonisjs/core/services/logger'
import { TENANT_REPOSITORY } from '../types/contracts.js'
import type { TenantRepositoryContract } from '../types/contracts.js'
import BackupService from '../services/backup_service.js'

interface BackupTenantPayload {
  tenantId: string
}

export default class BackupTenant extends Job<BackupTenantPayload> {
  async execute(): Promise<void> {
    const { tenantId } = this.payload
    const repo = (await app.container.make(TENANT_REPOSITORY as any)) as TenantRepositoryContract
    const tenant = await repo.findByIdOrFail(tenantId)
    logger.info({ tenantId: tenant.id }, 'Starting tenant backup')

    const meta = await new BackupService().backup(tenant)

    logger.info({ tenantId: tenant.id, file: meta.file }, 'Tenant backup completed')
  }

  async failed(error: Error): Promise<void> {
    logger.error({ tenantId: this.payload.tenantId, error: error.message }, 'Failed to backup tenant')
  }
}
