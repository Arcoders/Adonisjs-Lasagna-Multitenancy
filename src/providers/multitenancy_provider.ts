import type { ApplicationService } from '@adonisjs/core/types'
import { Database } from '@adonisjs/lucid/database'
import { setConfig } from '../config.js'
import type { MultitenancyConfig } from '../types/config.js'
import { BackofficeAdapter, TenantAdapter } from '../models/adapters/index.js'
import { BackofficeBaseModel, TenantBaseModel, CentralBaseModel } from '../models/base/index.js'

export default class MultitenancyProvider {
  constructor(protected app: ApplicationService) {}

  async boot() {
    const config = this.app.config.get<MultitenancyConfig>('multitenancy')
    setConfig(config)

    BackofficeBaseModel.connection = config.backofficeConnectionName
    CentralBaseModel.connection = config.centralConnectionName

    const db = await this.app.container.make(Database)
    BackofficeBaseModel.$adapter = new BackofficeAdapter(db)
    TenantBaseModel.$adapter = new TenantAdapter(db)
  }

  async start() {
    await import('../extensions/request.js')
  }
}
