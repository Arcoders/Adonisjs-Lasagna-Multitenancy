# @adonisjs-lasagna/multitenancy

Schema-based multi-tenancy for AdonisJS 7. Each tenant lives in its own isolated PostgreSQL schema, giving you complete data separation without the overhead of separate databases.

If you're building a SaaS app on AdonisJS and want true tenant isolation (not just a `tenant_id` column), this package handles the heavy lifting: schema provisioning, connection routing, circuit breaking, background jobs, and a suite of optional satellite features like webhooks, audit logs, and SSO.

---

## What you get out of the box

- **Schema isolation.** Every tenant gets a `tenant_<uuid>` schema automatically.
- **Three resolution strategies.** Identify tenants by header, subdomain, or URL path.
- **Circuit breaker.** Wraps tenant DB calls and opens automatically on repeated failures.
- **Satellite features.** Audit logs, feature flags, webhooks, branding, SSO, and metrics. All optional, all scoped to the backoffice schema.
- **Background jobs.** Install, uninstall, backup, restore, and clone tenants via `@adonisjs/queue`.
- **CLI commands.** Create, manage, and migrate tenants straight from the terminal.

---

## Requirements

- Node.js 24+
- AdonisJS 7
- `@adonisjs/lucid` configured with PostgreSQL
- `@adonisjs/redis`
- `@adonisjs/queue`

---

## 🚀 Getting started

### 1. Install and configure

```bash
npm install @adonisjs-lasagna/multitenancy
node ace configure @adonisjs-lasagna/multitenancy
```

The configure command registers the provider in `adonisrc.ts`, publishes `config/multitenancy.ts`, and scaffolds `app/models/backoffice/tenant.ts` for you.

### 2. Set up your database connections

The package works with three connection contexts. Add them to `config/database.ts`:

```ts
// config/database.ts
export default defineConfig({
  connections: {
    // Shared global data like countries and plans
    public: {
      client: 'pg',
      connection: { ...baseConn, searchPath: 'public' },
    },

    // Admin data: tenants, admins, satellite tables
    backoffice: {
      client: 'pg',
      connection: { ...baseConn, searchPath: 'backoffice' },
    },

    // Tenant connections are created dynamically at runtime.
    // No entry needed here; the package manages them.
  },
})
```

| Connection | Schema | Purpose |
|---|---|---|
| `public` | `public` | Shared global data |
| `backoffice` | `backoffice` | Tenant registry and satellite features |
| `tenant_<uuid>` | `tenant_<uuid>` | Per-tenant isolated data, created at runtime |

### 3. Bootstrap the backoffice

```bash
node ace backoffice:setup
```

This creates the `backoffice` schema and runs the satellite table migrations in one step.

### 4. Register a tenant repository

The package needs a way to look up tenants without knowing your model's import path. Wire it up in your app provider:

```ts
// providers/app_provider.ts
import { TENANT_REPOSITORY } from '@adonisjs-lasagna/multitenancy'

export default class AppProvider {
  async boot() {
    this.app.container.singleton(TENANT_REPOSITORY, async () => {
      const { default: Tenant } = await import('#models/backoffice/tenant')
      return {
        findById: (id: string) =>
          Tenant.query().whereNull('deleted_at').where('id', id).first(),

        findByDomain: (host: string) =>
          Tenant.query().whereNull('deleted_at').where('custom_domain', host).first(),

        all: (filters: { status?: string } = {}) => {
          const q = Tenant.query().whereNull('deleted_at')
          if (filters.status) q.where('status', filters.status)
          return q
        },
      }
    })
  }
}
```

### 5. Add middleware

In `start/kernel.ts`, register the middleware you need:

```ts
// Validates that every request carries a resolvable tenant identity.
// Put this on tenant-facing route groups, not as global middleware.
router.use([
  () => import('@adonisjs-lasagna/multitenancy/middleware')
    .then(m => ({ default: m.TenantGuardMiddleware })),
])

// Optional. If you support custom domains, this reads the Host header
// and injects the matching x-tenant-id before your routes run.
server.use([
  () => import('@adonisjs-lasagna/multitenancy/middleware')
    .then(m => ({ default: m.CustomDomainMiddleware })),
])

// Optional. Per-tenant rate limiting.
router.use([
  () => import('@adonisjs-lasagna/multitenancy/middleware')
    .then(m => ({ default: m.RateLimitMiddleware })),
])
```

### 6. Create your first tenant

```bash
node ace tenant:create --name="Acme Corp" --email="admin@acme.example.com"
```

This provisions the schema, runs migrations, and sets the status to `active`. That's it.

---

## Using `request.tenant()` in controllers

After `TenantGuardMiddleware` has run, you can access the current tenant from any controller:

```ts
async show({ request }: HttpContext) {
  const tenant = await request.tenant()
  // Same object reference on every call within the same request
}
```

The result is memoized per-request, so calling it multiple times from middleware, models, or controllers costs exactly one database lookup.

---

## Choosing a resolution strategy

Set `resolverStrategy` in `config/multitenancy.ts`:

| Strategy | How it works | Best for |
|---|---|---|
| `header` (default) | Reads `x-tenant-id` from request headers | Internal APIs, mobile clients |
| `subdomain` | Extracts UUID from `<uuid>.yourdomain.com` | SaaS web apps |
| `path` | Reads the first path segment `/tenant/<uuid>/...` | API versioning, embeds |

For the subdomain strategy, also set `baseDomain: env.get('APP_DOMAIN')`.

---

## Configuration reference

`config/multitenancy.ts` with every option and its default:

```ts
export default defineConfig({
  // Schema and connection names
  backofficeSchemaName: 'backoffice',
  centralSchemaName: 'public',
  backofficeConnectionName: 'backoffice',
  centralConnectionName: 'public',
  tenantConnectionNamePrefix: 'tenant_',
  tenantSchemaPrefix: env.get('TENANT_SCHEMA_PREFIX', 'tenant_'),

  // How requests identify their tenant
  resolverStrategy: 'header',       // 'header' | 'subdomain' | 'path'
  tenantHeaderKey: 'x-tenant-id',
  baseDomain: env.get('APP_DOMAIN'), // required for subdomain strategy

  // Paths that bypass tenant resolution entirely
  ignorePaths: ['/health', '/admin'],

  // Cache TTL for resolved tenant objects (seconds)
  schemaCacheTtl: 300,

  // Circuit breaker, wraps every tenant DB call
  circuitBreaker: {
    threshold: 50,        // open after this % of requests error
    resetTimeout: 30_000, // ms before trying again in half-open state
    volumeThreshold: 2,   // minimum requests before the breaker can trip
  },

  // Separate Redis for the cache layer
  cache: {
    ttl: 300,
    redis: {
      host: env.get('CACHE_REDIS_HOST', '127.0.0.1'),
      port: env.get('CACHE_REDIS_PORT', 6379),
      db: env.get('CACHE_REDIS_DB', 2),
    },
  },

  // BullMQ per-tenant job queues
  queue: {
    tenantQueuePrefix: 'tenant_queue_',
    defaultConcurrency: 1,
    attempts: 3,
    redis: {
      host: env.get('QUEUE_REDIS_HOST', '127.0.0.1'),
      port: env.get('QUEUE_REDIS_PORT', 6379),
      db: env.get('QUEUE_REDIS_DB', 1),
    },
  },

  // Backups via pg_dump. S3 upload is optional.
  backup: {
    storagePath: env.get('BACKUP_STORAGE_PATH', './storage/backups'),
    pgConnection: {
      host: env.get('DB_HOST'),
      port: env.get('DB_PORT', 5432),
      user: env.get('DB_USER'),
      password: env.get('DB_PASSWORD'),
      database: env.get('DB_DATABASE'),
    },
    s3: {
      enabled: env.get('BACKUP_S3_ENABLED', false),
      bucket: env.get('BACKUP_S3_BUCKET', ''),
      region: env.get('BACKUP_S3_REGION', 'us-east-1'),
      endpoint: env.get('BACKUP_S3_ENDPOINT', ''),
      accessKeyId: env.get('AWS_ACCESS_KEY_ID', ''),
      secretAccessKey: env.get('AWS_SECRET_ACCESS_KEY', ''),
    },
  },
})
```

---

## 📦 Satellite features

These are optional features that live in the `backoffice` schema. Import the services and models you need:

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

Each satellite model has a corresponding migration stub. Run `backoffice:setup` to apply them all, or publish individual stubs with `node ace configure`.

**Webhook delivery** uses HMAC-SHA256 signing when a secret is configured. Secrets are encrypted at rest using AES-256-GCM.

**SSO via OIDC** caches the discovery document for one hour, so you won't see extra HTTP round-trips on every login.

**Metrics** accumulates counters in Redis under the key pattern `metrics:<tenantId>:<YYYY-MM-DD>:<metric>` with a 48-hour TTL, then flushes to the database on demand via the `tenant:metrics:flush` command.

---

## 🗃️ Available commands

```bash
# Tenant lifecycle
node ace tenant:create --name="Acme" --email="acme@example.com"
node ace tenant:list
node ace tenant:activate <uuid>
node ace tenant:suspend <uuid>
node ace tenant:destroy <uuid>

# Migrations
node ace tenant:migrate <uuid>
node ace tenant:migrate-rollback <uuid>
node ace tenant:run-migrations        # all active tenants
node ace tenant:rollback-migrations   # all active tenants

# Backups
node ace tenant:backup <uuid>
node ace tenant:backup:list <uuid>
node ace tenant:restore <uuid> --file=<backup.sql>

# Cloning and importing
node ace tenant:clone <source-uuid> --name="Clone" --email="clone@example.com"
node ace tenant:import-sql <uuid> --file=<dump.sql>

# Maintenance
node ace tenant:webhooks:retry        # retry pending webhook deliveries
node ace tenant:metrics:flush         # flush Redis metrics to the database
node ace tenant:queue:stats

# One-time setup
node ace backoffice:setup
```

Add `tenant:webhooks:retry` and `tenant:metrics:flush` to your cron schedule. They're built to run frequently, every 1 to 5 minutes and daily respectively.

---

## 🔔 Events

Listen for tenant lifecycle changes anywhere in your app:

```ts
import {
  TenantCreated,
  TenantActivated,
  TenantSuspended,
} from '@adonisjs-lasagna/multitenancy/events'

emitter.on(TenantCreated, async ({ tenant }) => {
  await sendWelcomeEmail(tenant)
  await provisionExternalServices(tenant)
})

emitter.on(TenantSuspended, async ({ tenant }) => {
  await notifyAdmins(tenant)
})
```

---

## ⚡ Background jobs

Dispatch long-running operations as queue jobs so they don't block the HTTP response:

```ts
import {
  InstallTenant,
  UninstallTenant,
  CloneTenant,
  BackupTenant,
  RestoreTenant,
} from '@adonisjs-lasagna/multitenancy/jobs'

await InstallTenant.dispatch({ tenantId: tenant.id })
await CloneTenant.dispatch({
  sourceTenantId,
  destinationTenantId,
  schemaOnly: false,
  clearSessions: true,
})
```

Make sure `config/queue.ts` includes the package jobs:

```ts
locations: [
  './packages/multitenancy/src/jobs/**/*.{ts,js}',
  './app/jobs/**/*.{ts,js}',
],
```

---

## 🚨 Exceptions

The middleware and `request.tenant()` throw typed exceptions you can handle in your error handler:

```ts
import {
  MissingTenantHeaderException, // 400, no tenant identifier found
  TenantNotFoundException,       // 404, tenant doesn't exist
  TenantSuspendedException,      // 403, tenant is suspended
  TenantNotReadyException,       // 503, tenant still provisioning
  CircuitOpenException,          // 503, circuit breaker is open
} from '@adonisjs-lasagna/multitenancy/exceptions'
```

Map these in `app/exceptions/handler.ts` to return appropriate API responses.

---

## 🔩 What's under the hood

When a request arrives, the package extracts a tenant UUID using your configured resolution strategy (header, subdomain, or path). It then looks up the tenant in the backoffice schema via your registered repository and sets up a named Lucid connection pointing to `tenant_<uuid>` schema on the fly. That connection is pooled and reused across requests.

Every tenant DB call passes through a circuit breaker powered by [opossum](https://github.com/nodeshift/opossum), which is shared as a singleton across all requests. If a tenant's schema becomes unreachable, the breaker opens after a configurable error threshold and returns `CircuitOpenException` immediately, protecting your database from thundering-herd reconnection storms.

Tenant resolution results are memoized per HTTP request using a Symbol-keyed property on the request object. You can call `request.tenant()` as many times as you like within a single request cycle and it only hits the repository once.

The cache layer is powered by [BentoCache](https://bentocache.dev) and uses a dedicated Redis connection with its own DB number, completely separate from your queue Redis, to avoid key namespace collisions.

---

## 🔁 Next steps

Once tenants are creating successfully, here's where to go next:

- **Wire up events.** `TenantCreated` is the right place to send welcome emails, provision external services, or set default feature flags.
- **Enable webhooks.** Let tenants subscribe to events in your system. Secrets are encrypted and signatures verified automatically.
- **Configure S3 backups.** Set `backup.s3.enabled = true` and fill in the env vars. Backups upload automatically after `pg_dump` finishes.
- **Add tenant-scoped Lucid models.** Extend `TenantBaseModel` from `@adonisjs-lasagna/multitenancy/base-models` and your model will automatically route to the right schema.
- **Schedule maintenance commands.** Add `tenant:webhooks:retry` (every minute) and `tenant:metrics:flush` (daily) to your cron.

---

## 🐛 Troubleshooting

**`MissingTenantHeaderException` on every request**

You're using `subdomain` or `path` strategy but the config still says `resolverStrategy: 'header'`, or you simply aren't sending the `x-tenant-id` header. Check your config and confirm the header (or subdomain/path segment) is present in the request.

**Circuit breaker opens immediately at startup**

`volumeThreshold` defaults to `2`, meaning two consecutive failures are enough to trip it. If health checks or seed scripts hit the tenant DB very early before the PG connection is ready, you can hit this easily. Raise `volumeThreshold` to `10` or more in staging, and make sure PostgreSQL is accepting connections before your app starts taking traffic.

**Tenant schema migration fails with `relation already exists`**

This happens when `tenant:migrate` is run twice on the same tenant without a rollback in between. Lucid tracks migration state in an `adonis_schema` table inside each tenant schema. Check that table to see which migrations already ran. If the table doesn't exist at all, the schema was likely created but the `InstallTenant` job didn't finish cleanly; check your queue worker logs.

**`luxon` not found during build**

`luxon` is a transitive dependency pulled in by AdonisJS internals. If your package manager doesn't hoist it (common with pnpm), add it explicitly with `npm install luxon` or add it to your pnpm workspace's `shamefully-hoist` list.

---

## License

See `LICENSE` file. Contact the maintainers for licensing terms.
