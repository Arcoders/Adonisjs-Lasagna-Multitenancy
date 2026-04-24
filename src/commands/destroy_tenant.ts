import { BaseCommand, args, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import app from '@adonisjs/core/services/app'
import { TENANT_REPOSITORY } from '../types/contracts.js'
import type { TenantRepositoryContract } from '../types/contracts.js'

export default class DestroyTenant extends BaseCommand {
  static readonly commandName = 'tenant:destroy'
  static readonly description = 'Soft-delete a tenant and tear down its schema'
  static readonly options: CommandOptions = { startApp: true }

  @args.string({ description: 'Tenant ID to destroy' })
  declare tenantId: string

  @flags.boolean({ description: 'Skip confirmation prompt', alias: 'y', default: false })
  declare force: boolean

  async run() {
    const repo = (await app.container.make(TENANT_REPOSITORY as any)) as TenantRepositoryContract

    try {
      const tenant = await repo.findByIdOrFail(this.tenantId)

      if (!this.force) {
        const confirmed = await this.prompt.confirm(
          `Are you sure you want to destroy tenant "${tenant.name}" (${tenant.email})? This cannot be undone.`
        )
        if (!confirmed) {
          this.logger.info('Aborted.')
          return
        }
      }

      const { DateTime } = await import('luxon')
      tenant.deletedAt = DateTime.now()
      await tenant.save()
      await tenant.invalidateCache()

      this.logger.info(`Tenant "${tenant.name}" soft-deleted. Uninstalling schema...`)
      await tenant.uninstall()

      this.logger.success(`Tenant "${tenant.name}" has been destroyed.`)
    } catch (error) {
      this.logger.error(`Failed to destroy tenant: ${error.message}`)
      this.exitCode = 1
    }
  }
}
