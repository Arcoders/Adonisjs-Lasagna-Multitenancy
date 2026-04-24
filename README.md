# @adonisjs-lasagna/multitenancy

Schema-based multi-tenancy for AdonisJS 7. Each tenant gets an isolated PostgreSQL schema with connection pooling, circuit breaking, background jobs, and optional satellite features (audit logs, webhooks, feature flags, branding, SSO, metrics).

## Requirements

- Node.js 24+
- AdonisJS 7
- `@adonisjs/lucid` with PostgreSQL
- `@adonisjs/redis`
- `@adonisjs/queue`

## Installation

```bash
npm install @adonisjs-lasagna/multitenancy
node ace configure @adonisjs-lasagna/multitenancy
```

The configure command will:
- Register the provider and commands in `adonisrc.ts`
- Publish `config/multitenancy.ts`
- Scaffold `app/models/backoffice/tenant.ts` if it doesn't exist

## Database setup

The package uses three connection contexts:

| Context | Schema | Purpose |
|---------|--------|---------|
| `central` | `public` | Shared data (countries, plans) |
| `backoffice` | `backoffice` | Admin models (tenants, admins) |
| `tenant_<uuid>` | `tenant_<schema>` | Per-tenant isolated data |

Add these connections to `config/database.ts`:

```ts
backoffice: {
  client: 'pg',
  connection: { ...mainConn, searchPath: 'backoffice' },
},
```

Run setup:

```bash
node ace backoffice:setup
node ace migration:run --connection=public
node ace migration:run --connection=backoffice
```

## Configuration

`config/multitenancy.ts` — full reference:

```ts
export default {
  // Schema names
  backofficeSchemaName: 'backoffice',
  centralSchemaName: 'public',

  // Connection names (must match config/database.ts)
  backofficeConnectionName: 'backoffice',
  centralConnectionName: 'public',
  tenantConnectionNamePrefix: 'tenant_',
  tenantSchemaPrefix: env.get('TENANT_SCHEMA_PREFIX', 'tenant_'),

  // Tenant resolution strategy
  resolverStrategy: 'header',  // 'header' | 'subdomain' | 'path'
  tenantHeaderKey: 'x-tenant-id',
  baseDomain: env.get('APP_DOMAIN'),  // required for 'subdomain' strategy

  // Cache
  schemaCacheTtl: 300,  // seconds
  ignorePaths: ['/admin', '/health'],

  // Circuit breaker (opossum)
  circuitBreaker: {
    threshold: 50,         // error percentage to open circuit
    resetTimeout: 30_000,  // ms before half-open
    volumeThreshold: 2,    // min requests before tripping
  },

  // Per-tenant queues (BullMQ — independent of @adonisjs/queue)
  queue: {
    tenantQueuePrefix: 'tenant_queue_',
    defaultConcurrency: 1,
    attempts: 3,
    redis: { host, port, db },
  },

  // Backup / restore
  backup: {
    storagePath: './storage/backups',
    pgConnection: { host, port, user, password, database },
    s3: { enabled: false, bucket, region, endpoint, accessKeyId, secretAccessKey },
  },
}
```

## Tenant model contract

Your `Tenant` model must implement `TenantModelContract`:

```ts
import { BackofficeBaseModel } from '@adonisjs-lasagna/multitenancy/base-models'
import type { TenantStatus } from '@adonisjs-lasagna/multitenancy/types'

export default class Tenant extends BackofficeBaseModel {
  declare id: string
  declare status: TenantStatus  // 'provisioning' | 'active' | 'suspended' | 'failed'
  get schemaName(): string { ... }
  get connectionName(): string { ... }
  get isActive(): boolean { ... }
  get isSuspended(): boolean { ... }
  async getConnection(): Promise<...> { ... }
  async install(): Promise<void> { ... }
  async uninstall(): Promise<void> { ... }
  async migrate(opts: { direction: 'up' | 'down' }): Promise<void> { ... }
  async invalidateCache(): Promise<void> { ... }
}
```

The scaffold stub (`node ace configure`) creates a fully working template.

## Repository binding

Register a `TenantRepositoryContract` binding so jobs and middleware can resolve tenants:

```ts
// providers/app_provider.ts
import { TENANT_REPOSITORY } from '@adonisjs-lasagna/multitenancy'

export default class AppProvider {
  async boot() {
    this.app.container.singleton(TENANT_REPOSITORY as any, async () => {
      const { default: Tenant } = await import('#models/backoffice/tenant')
      return {
        findById: (id: string) => Tenant.query().whereNull('deleted_at').where('id', id).first(),
        findByDomain: (host: string) => Tenant.query().whereNull('deleted_at').where('custom_domain', host).first(),
        all: (filters = {}) => {
          const q = Tenant.query().whereNull('deleted_at')
          if (filters.status) q.where('status', filters.status)
          return q
        },
      }
    })
  }
}
```

## Middleware

Add to `start/kernel.ts`:

```ts
// Resolve tenant from header/subdomain/path — use in tenant routes
server.use([() => import('@adonisjs-lasagna/multitenancy/middleware').then(m => ({ default: m.TenantGuardMiddleware }))])

// Custom domain → sets tenant header automatically
server.use([() => import('@adonisjs-lasagna/multitenancy/middleware').then(m => ({ default: m.CustomDomainMiddleware }))])

// Per-tenant rate limiting
router.use([() => import('@adonisjs-lasagna/multitenancy/middleware').then(m => ({ default: m.RateLimitMiddleware }))])
```

## `request.tenant()`

Available in any controller after `TenantGuardMiddleware`:

```ts
async show({ request }: HttpContext) {
  const tenant = await request.tenant()
  // tenant is TenantModelContract
}
```

## Available commands

```bash
node ace tenant:create --name="Acme" --email="acme@example.com"
node ace tenant:list
node ace tenant:activate <uuid>
node ace tenant:suspend <uuid>
node ace tenant:destroy <uuid>
node ace tenant:migrate <uuid>
node ace tenant:migrate-rollback <uuid>
node ace tenant:run-migrations        # all active tenants
node ace tenant:rollback-migrations   # all active tenants
node ace tenant:seed <uuid>
node ace tenant:backup <uuid>
node ace tenant:backup:list <uuid>
node ace tenant:restore <uuid> --file=<backup.sql>
node ace tenant:clone <source-uuid> --name="Clone" --email="clone@example.com"
node ace tenant:import-sql <uuid> --file=<dump.sql>
node ace tenant:queue:stats
node ace backoffice:setup
```

## Satellite features

Import from the package and use directly:

```ts
import {
  AuditLogService,
  FeatureFlagService,
  WebhookService,
  BrandingService,
  SsoService,
  MetricsService,
} from '@adonisjs-lasagna/multitenancy/services'

import {
  TenantAuditLog,
  TenantFeatureFlag,
  TenantWebhook,
  TenantBranding,
  TenantSsoConfig,
  TenantMetric,
} from '@adonisjs-lasagna/multitenancy/models/satellites'
```

Each satellite model has its own migration in `database/migrations/backoffice/`.

## Events

```ts
import { TenantCreated, TenantActivated, TenantSuspended } from '@adonisjs-lasagna/multitenancy/events'

emitter.on(TenantCreated, async ({ tenant }) => {
  // provision infrastructure, send welcome email, etc.
})
```

## Jobs

Powered by `@adonisjs/queue`. Dispatch via the static `dispatch` method — no queue service import needed:

```ts
import { InstallTenant, UninstallTenant, CloneTenant, BackupTenant, RestoreTenant } from '@adonisjs-lasagna/multitenancy/jobs'

await InstallTenant.dispatch({ tenantId: tenant.id })
await CloneTenant.dispatch({ sourceTenantId, destinationTenantId, schemaOnly: false, clearSessions: true })
```

Make sure `config/queue.ts` includes the package jobs location:

```ts
locations: [
  './packages/multitenancy/src/jobs/**/*.{ts,js}',
  './app/jobs/**/*.{ts,js}',
],
```

## Circuit breaker

Automatically wraps tenant DB calls. Access the service:

```ts
import { CircuitBreakerService } from '@adonisjs-lasagna/multitenancy/services'

const cb = new CircuitBreakerService(config)
await cb.execute(tenantId, () => someDbCall())
// Throws CircuitOpenException if circuit is open
```

## Exceptions

```ts
import {
  MissingTenantHeaderException,  // 400 — no tenant identifier in request
  TenantNotFoundException,        // 404 — tenant not found
  TenantSuspendedException,       // 403 — tenant is suspended
  TenantNotReadyException,        // 503 — tenant still provisioning
  CircuitOpenException,           // 503 — circuit breaker open
} from '@adonisjs-lasagna/multitenancy/exceptions'
```

## License

See `LICENSE` file. Contact maintainers for licensing terms.
