import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import app from '@adonisjs/core/services/app'
import { TENANT_REPOSITORY } from '../types/contracts.js'
import type { TenantRepositoryContract } from '../types/contracts.js'

export default class TenantMigrateRollback extends BaseCommand {
  static readonly commandName = 'tenant:migrate:rollback'
  static readonly description = 'Rollback last migration for one or all tenant schemas'
  static readonly options: CommandOptions = { startApp: true }

  @flags.array({
    alias: 't',
    flagName: 'tenant',
    required: false,
    description: 'Tenant ID(s) to rollback. Omit for all tenants',
  })
  declare tenantsIds?: string[]

  @flags.boolean({ default: false, flagName: 'dry-run', description: 'Print SQL without executing' })
  declare dryRun: boolean

  @flags.boolean({ default: false, flagName: 'disable-locks' })
  declare disableLocks: boolean

  @flags.boolean({ default: false, flagName: 'verbose' })
  declare verbose: boolean

  async run() {
    const repo = (await app.container.make(TENANT_REPOSITORY as any)) as TenantRepositoryContract
    const tenants =
      this.tenantsIds && this.tenantsIds.length > 0
        ? await repo.whereIn(this.tenantsIds)
        : await repo.all()

    if (tenants.length === 0) {
      this.logger.info('No tenants found.')
      return
    }

    let succeeded = 0
    let failed = 0

    for (const tenant of tenants) {
      const tasks = this.ui.tasks({ verbose: this.verbose })

      await tasks
        .add(`Rolling back "${tenant.name}" (${tenant.schemaName})`, async (task) => {
          try {
            task.update('Connecting...')
            tenant.getConnection()

            task.update('Rolling back last migration...')
            await tenant.migrate({
              direction: 'down',
              disableLocks: this.disableLocks,
              dryRun: this.dryRun,
            })

            succeeded++
            return 'completed'
          } catch (error: any) {
            failed++
            return this.verbose ? task.error(error.message) : task.error('failed')
          }
        })
        .run()
    }

    this.logger.info(`Done: ${succeeded} succeeded, ${failed} failed`)
  }
}
