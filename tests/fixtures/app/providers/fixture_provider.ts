import type { ApplicationService } from '@adonisjs/core/types'
import { TENANT_REPOSITORY } from '@adonisjs-lasagna/multitenancy/types'
import { CircuitBreakerService } from '@adonisjs-lasagna/multitenancy/services'
import TenantRepository from '../repositories/tenant_repository.js'

export default class FixtureProvider {
  constructor(protected app: ApplicationService) {}

  async boot() {
    this.app.container.bind(TENANT_REPOSITORY as any, () => new TenantRepository())
    this.app.container.singleton(CircuitBreakerService, () => new CircuitBreakerService())
  }
}
