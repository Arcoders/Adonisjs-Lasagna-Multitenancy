import { Job } from '@adonisjs/queue'
import app from '@adonisjs/core/services/app'
import logger from '@adonisjs/core/services/logger'
import { TENANT_REPOSITORY } from '../types/contracts.js'
import type { TenantRepositoryContract } from '../types/contracts.js'
import CloneService from '../services/clone_service.js'
import TenantQueueService from '../services/tenant_queue_service.js'

export interface CloneTenantPayload {
  sourceTenantId: string
  destinationTenantId: string
  schemaOnly: boolean
  clearSessions: boolean
}

export default class CloneTenant extends Job<CloneTenantPayload> {
  async execute(): Promise<void> {
    const { sourceTenantId, destinationTenantId, schemaOnly, clearSessions } = this.payload
    const repo = (await app.container.make(TENANT_REPOSITORY as any)) as TenantRepositoryContract
    const [source, destination] = await Promise.all([
      repo.findByIdOrFail(sourceTenantId),
      repo.findByIdOrFail(destinationTenantId),
    ])

    logger.info({ sourceId: source.id, destId: destination.id }, 'CloneTenant job started')

    const result = await new CloneService().clone(source, destination, {
      schemaOnly,
      clearSessions,
    })

    new TenantQueueService().getOrCreate(result.destination.id)

    logger.info(
      {
        sourceId: source.id,
        destId: destination.id,
        tablesCopied: result.tablesCopied,
        rowsCopied: result.rowsCopied,
      },
      'CloneTenant job completed'
    )
  }

  async failed(error: Error): Promise<void> {
    const { sourceTenantId, destinationTenantId } = this.payload
    logger.error(
      {
        sourceId: sourceTenantId,
        destId: destinationTenantId,
        error: error.message,
      },
      'CloneTenant job failed'
    )
  }
}
