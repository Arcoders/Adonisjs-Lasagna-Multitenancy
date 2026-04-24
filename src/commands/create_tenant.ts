import { BaseCommand, args } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import app from '@adonisjs/core/services/app'
import { TENANT_REPOSITORY } from '../types/contracts.js'
import type { TenantRepositoryContract } from '../types/contracts.js'

export default class CreateTenant extends BaseCommand {
  static readonly commandName = 'tenant:create'
  static readonly description = 'Create a new tenant and queue schema provisioning'
  static readonly options: CommandOptions = { startApp: true }

  @args.string({ description: 'Tenant name' })
  declare name: string

  @args.string({ description: 'Tenant contact email' })
  declare email: string

  async run() {
    const repo = (await app.container.make(TENANT_REPOSITORY as any)) as TenantRepositoryContract

    const task = this.ui.tasks()

    await task
      .add(`Creating tenant "${this.name}"`, async (t) => {
        try {
          const tenant = await repo.create({ name: this.name, email: this.email, status: 'provisioning' })
          t.update(`Tenant created — ID: ${tenant.id}`)
          return 'completed'
        } catch (error) {
          return t.error(error.message)
        }
      })
      .run()

    this.logger.info(
      'Schema provisioning has been queued. Run "node ace queue:listen" to process it.'
    )
  }
}
