import type { ApplicationService } from '@adonisjs/core/types'
import { Database } from '@adonisjs/lucid/database'
import { setConfig } from '../config.js'
import type { MultitenancyConfig } from '../types/config.js'
import { BackofficeAdapter, TenantAdapter } from '../models/adapters/index.js'
import { BackofficeBaseModel, TenantBaseModel, CentralBaseModel } from '../models/base/index.js'
import BootstrapperRegistry from '../services/bootstrapper_registry.js'
import cacheBootstrapper from '../services/bootstrappers/cache_bootstrapper.js'
import driveBootstrapper from '../services/bootstrappers/drive_bootstrapper.js'
import mailBootstrapper from '../services/bootstrappers/mail_bootstrapper.js'
import sessionBootstrapper from '../services/bootstrappers/session_bootstrapper.js'
import CircuitBreakerService from '../services/circuit_breaker_service.js'
import HookRegistry from '../services/hook_registry.js'
import IsolationDriverRegistry from '../services/isolation/registry.js'
import SchemaPgDriver from '../services/isolation/schema_pg_driver.js'
import DatabasePgDriver from '../services/isolation/database_pg_driver.js'
import RowScopePgDriver from '../services/isolation/rowscope_pg_driver.js'
import TenantResolverRegistry from '../services/resolvers/registry.js'
import { builtInResolvers } from '../services/resolvers/builtins.js'
import TenantLogContext from '../services/tenant_log_context.js'
import HealthService from '../health/health_service.js'
import DoctorService from '../services/doctor/doctor_service.js'
import { builtInChecks } from '../services/doctor/checks/index.js'
import QuotaService from '../services/quota_service.js'
import ReadReplicaService from '../services/read_replica_service.js'

export default class MultitenancyProvider {
  constructor(protected app: ApplicationService) {}

  register() {
    this.app.container.singleton(BootstrapperRegistry, () => new BootstrapperRegistry())
    this.app.container.singleton(IsolationDriverRegistry, () => new IsolationDriverRegistry())
    this.app.container.singleton(TenantResolverRegistry, () => new TenantResolverRegistry())
    this.app.container.singleton(CircuitBreakerService, () => new CircuitBreakerService())
    this.app.container.singleton(HookRegistry, () => new HookRegistry())
    this.app.container.singleton(TenantLogContext, () => new TenantLogContext())
    this.app.container.singleton(HealthService, () => new HealthService())
    this.app.container.singleton(DoctorService, () => {
      const svc = new DoctorService()
      for (const check of builtInChecks) svc.register(check)
      return svc
    })
    this.app.container.singleton(QuotaService, () => new QuotaService())
    this.app.container.singleton(ReadReplicaService, () => new ReadReplicaService())
  }

  async boot() {
    const config = this.app.config.get<MultitenancyConfig>('multitenancy')
    setConfig(config)

    BackofficeBaseModel.connection = config.backofficeConnectionName
    CentralBaseModel.connection = config.centralConnectionName

    const db = await this.app.container.make(Database)
    const drivers = await this.app.container.make(IsolationDriverRegistry)

    // Register the configured isolation driver before wiring the adapter,
    // because TenantAdapter consults the registry on every query.
    const choice = config.isolation?.driver ?? 'schema-pg'
    if (choice === 'schema-pg' && !drivers.has('schema-pg')) {
      drivers.register(
        new SchemaPgDriver({
          templateConnectionName: config.isolation?.templateConnectionName,
        }),
        { activate: true }
      )
    }
    if (choice === 'database-pg' && !drivers.has('database-pg')) {
      drivers.register(
        new DatabasePgDriver({
          templateConnectionName: config.isolation?.templateConnectionName,
          databasePrefix: config.isolation?.tenantDatabasePrefix,
        }),
        { activate: true }
      )
    }
    if (choice === 'rowscope-pg' && !drivers.has('rowscope-pg')) {
      drivers.register(
        new RowScopePgDriver({
          centralConnectionName: config.isolation?.templateConnectionName,
          scopedTables: config.isolation?.rowScopeTables,
          scopeColumn: config.isolation?.rowScopeColumn,
        }),
        { activate: true }
      )
    }

    BackofficeBaseModel.$adapter = new BackofficeAdapter(db)
    TenantBaseModel.$adapter = new TenantAdapter(db, drivers)

    // Seed the resolver registry with the built-ins and apply the
    // configured strategy (or chain). Apps can register additional
    // resolvers in their own provider's `boot()` after this one runs.
    const resolvers = await this.app.container.make(TenantResolverRegistry)
    for (const r of builtInResolvers) {
      if (!resolvers.has(r.name)) resolvers.register(r)
    }
    const chain =
      config.resolverChain && config.resolverChain.length > 0
        ? config.resolverChain
        : [config.resolverStrategy]
    resolvers.setChain(chain)

    const hooks = await this.app.container.make(HookRegistry)
    hooks.loadDeclarative(config.hooks)

    const bootstrappers = await this.app.container.make(BootstrapperRegistry)
    if (!bootstrappers.has('cache')) bootstrappers.register(cacheBootstrapper)
    await this.#registerOptionalBootstrappers(bootstrappers)
  }

  /**
   * Auto-register the bootstrappers whose peer dependencies are present.
   * Each `import(...)` is wrapped in a try/catch so missing optional
   * peers (`@adonisjs/drive`, `@adonisjs/mail`, `@adonisjs/session`)
   * don't fail boot — they just skip the corresponding bootstrapper.
   */
  async #registerOptionalBootstrappers(bootstrappers: BootstrapperRegistry): Promise<void> {
    const candidates = [
      { name: 'drive', module: '@adonisjs/drive/services/main', bootstrapper: driveBootstrapper },
      { name: 'mail', module: '@adonisjs/mail/services/main', bootstrapper: mailBootstrapper },
      {
        name: 'session',
        module: '@adonisjs/session/services/main',
        bootstrapper: sessionBootstrapper,
      },
    ] as const

    const { default: logger } = await import('@adonisjs/core/services/logger')

    for (const c of candidates) {
      if (bootstrappers.has(c.name)) continue
      try {
        await import(c.module)
        bootstrappers.register(c.bootstrapper)
      } catch {
        logger.debug(
          { bootstrapper: c.name, peerDep: c.module },
          'multitenancy: peer dependency not installed; skipping bootstrapper'
        )
      }
    }
  }

  async start() {
    await import('../extensions/request.js')
  }

  /**
   * Invalidate module-level caches that hold references to container
   * singletons. Without this, the next `tenancy.run()` (or any code that
   * called `getActiveDriver()`) keeps a reference to the old, now-dead
   * `TenantLogContext` / `IsolationDriverRegistry` instances, leading to
   * stale-state surprises in test runs that reuse the container or in
   * production hot-reload paths.
   */
  async shutdown() {
    const [{ __configureTenancyForTests }, { __resetActiveDriverCache }] = await Promise.all([
      import('../tenancy.js'),
      import('../services/isolation/active_driver.js'),
    ])
    __configureTenancyForTests({})
    __resetActiveDriverCache()
  }
}
