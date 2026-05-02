import type { ApplicationService } from '@adonisjs/core/types'
import { TENANT_REPOSITORY } from '@adonisjs-lasagna/multitenancy/types'
import {
  CircuitBreakerService,
  DoctorService,
  builtInChecks,
} from '@adonisjs-lasagna/multitenancy/services'
import TenantRepository from '#app/repositories/tenant_repository'

export default class AppProvider {
  constructor(protected app: ApplicationService) {}

  async boot() {
    // Bind the repository contract — required for request.tenant() and the package's services.
    this.app.container.bind(TENANT_REPOSITORY as any, () => new TenantRepository())

    // CircuitBreakerService needs to be a singleton so the same breaker is reused
    // across requests for the same tenant.
    this.app.container.singleton(CircuitBreakerService, () => new CircuitBreakerService())

    // Register the 7 built-in doctor checks plus a tiny demo check, so
    // `node ace tenant:doctor` and the GET /demo/doctor route both work.
    this.app.container.singleton(DoctorService, () => {
      const svc = new DoctorService()
      for (const check of builtInChecks) svc.register(check)
      svc.register({
        name: 'demo_marker_check',
        description: 'Demo-only check that always succeeds — proves custom checks work.',
        async run() {
          return [{ severity: 'info', message: 'Demo check ran. All good.' }]
        },
      })
      return svc
    })
  }
}
