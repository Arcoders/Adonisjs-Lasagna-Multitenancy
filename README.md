# @adonisjs-lasagna/multitenancy

```
 ██╗      █████╗ ███████╗ █████╗  ██████╗ ███╗   ██╗ █████╗
 ██║     ██╔══██╗██╔════╝██╔══██╗██╔════╝ ████╗  ██║██╔══██╗
 ██║     ███████║███████╗███████║██║  ███╗██╔██╗ ██║███████║
 ██║     ██╔══██║╚════██║██╔══██║██║   ██║██║╚██╗██║██╔══██║
 ███████╗██║  ██║███████║██║  ██║╚██████╔╝██║ ╚████║██║  ██║
 ╚══════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝╚═╝  ╚═╝
```

Schema based multi tenancy for AdonisJS 7. Every tenant lives in its own isolated PostgreSQL schema, with a real package behind it: connection routing, circuit breaking, queues, contextual logging, plans and quotas, scheduled backups with retention, read replica routing, soft delete, and a satellite suite covering audit logs, webhooks, branding, SSO, feature flags, and metrics.

[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A524-green)](https://nodejs.org)
[![AdonisJS](https://img.shields.io/badge/AdonisJS-7-5a45ff)](https://adonisjs.com)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-%E2%89%A514-336791)](https://www.postgresql.org)
[![Redis](https://img.shields.io/badge/Redis-%E2%89%A56-DC382D)](https://redis.io)
[![Tests](https://img.shields.io/badge/tests-238%20unit%20%2B%20111%20e2e-brightgreen)](./tests)
[![License](https://img.shields.io/badge/License-MIT-blue)](./LICENSE)

I built this because the AdonisJS ecosystem deserved a proper multi tenancy foundation, and because every SaaS I touched eventually outgrew the `tenant_id` column. If you've ever exported one customer's data with a giant `WHERE tenant_id = ?` JOIN across forty tables and prayed nothing leaked, you already know the problem this solves.

If you'd rather see it run than read about it, jump to [examples/api/](examples/api/). It's a real AdonisJS 7 app that exercises every feature, and one `npm run test:e2e` brings up the stack and runs 111 tests against it.

## Highlights

| Feature | What it gives you | Jump to |
|---|---|---|
| Schema isolation | Each tenant gets its own `tenant_<uuid>` PostgreSQL schema, provisioned and routed automatically. | [Schema isolation](#schema-isolation) |
| Circuit breaker | Opossum wraps every tenant DB call. One bad schema can't take down the others. | [Circuit breaker](#circuit-breaker) |
| Lifecycle hooks and events | `before` / `after` hooks plus 11 typed events wired into commands and jobs. | [Lifecycle hooks and events](#lifecycle-hooks-and-events) |
| Contextual logging | `tenantId` rides along through HTTP and queue jobs via `AsyncLocalStorage`. No threading, no helper wrappers. | [Contextual logging](#contextual-logging) |
| `tenant:doctor` | One command, eight built in checks, `--fix`, `--json` for CI, `--watch` for a live TUI. | [tenant:doctor](#tenantdoctor) |
| Plans and quotas | Declarative plans, rolling counters, snapshot usage, an `enforceQuota()` middleware that returns 429 and emits the right event. | [Plans and quotas](#plans-and-quotas) |
| Scheduled backups + retention | Tier based intervals and `keepLast`, S3 mirror with purge awareness, idempotent cron command. | [Backups and retention](#backups-and-retention) |
| Health probes + Prometheus | `/livez`, `/readyz`, `/healthz`, `/metrics`. No `prom-client` peer dep. | [Health and metrics](#health-and-metrics) |
| Read replica routing | Round robin, random, or sticky by tenant id. Stable connection naming, lazy provisioning. | [Read replicas](#read-replicas) |
| `/testing` subpath | `buildTestTenant`, `MockTenantRepository`, `setRequestTenant`. Adoption friction, gone. | [Testing helpers](#testing-helpers) |
| REST admin API | Nine ready made admin endpoints. You bring the auth middleware. | [REST admin API](#rest-admin-api) |
| Soft delete TTL | Recycle bin pattern. `--keep-schema` on destroy, `tenant:purge-expired` on a cron. | [Soft delete and purge](#soft-delete-and-purge) |
| Typed metadata | `TenantModelContract<TMeta>` propagates through `request.tenant<MyMeta>()`. | [Typed tenant metadata](#typed-tenant-metadata) |
| Satellites | Audit logs, webhooks (HMAC signed), feature flags, branding, SSO (OIDC), metrics. All optional. | [Satellites](#satellites) |
| Reference API | A runnable AdonisJS v7 demo at [examples/api/](examples/api/) with a 111 test e2e suite. | [examples/api/README.md](examples/api/README.md) |

Two questions to ask before adopting:

1. Do you actually need true tenant isolation, or is a `tenant_id` column enough? If you want both at rest separation and per tenant migrations, this is for you. If you don't, save yourself the operational complexity.
2. Are you on PostgreSQL? Schemas are a Postgres native concept. MySQL and MariaDB users should look elsewhere.

## Table of contents

- [Requirements](#requirements)
- [Quick start](#quick-start)
- [How tenant resolution works](#how-tenant-resolution-works)
- [Configuration reference](#configuration-reference)
- [Core features](#core-features)
  - [Schema isolation](#schema-isolation)
  - [Circuit breaker](#circuit-breaker)
  - [Lifecycle hooks and events](#lifecycle-hooks-and-events)
  - [Contextual logging](#contextual-logging)
  - [Health and metrics](#health-and-metrics)
  - [tenant:doctor](#tenantdoctor)
  - [Plans and quotas](#plans-and-quotas)
  - [Backups and retention](#backups-and-retention)
  - [Read replicas](#read-replicas)
  - [Soft delete and purge](#soft-delete-and-purge)
  - [Typed tenant metadata](#typed-tenant-metadata)
  - [REST admin API](#rest-admin-api)
  - [Testing helpers](#testing-helpers)
- [Satellites](#satellites)
- [Reference API at examples/api](#reference-api-at-examplesapi)
- [Commands reference](#commands-reference)
- [Background jobs](#background-jobs)
- [Exceptions](#exceptions)
- [Under the hood](#under-the-hood)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

## Requirements

- Node.js 24 or newer
- AdonisJS 7
- `@adonisjs/lucid` configured with PostgreSQL 14 or newer
- `@adonisjs/redis` for cache and counters
- `@adonisjs/queue` for background jobs
- `@aws-sdk/client-s3` (optional, only if you want S3 backup uploads)

## Quick start

Five steps from `npm install` to a live tenant. The configure command does most of the wiring; you fill in the connections and the repository.

### 1. Install and configure

```bash
npm install @adonisjs-lasagna/multitenancy
node ace configure @adonisjs-lasagna/multitenancy
```

The configure command registers the provider in `adonisrc.ts`, publishes `config/multitenancy.ts`, and scaffolds `app/models/backoffice/tenant.ts`.

### 2. Set up your database connections

Three connection contexts live side by side. Add them to `config/database.ts`:

```ts
// config/database.ts
export default defineConfig({
  connections: {
    // Shared global data: countries, plans, anything cross tenant.
    public: {
      client: 'pg',
      connection: { ...baseConn, searchPath: 'public' },
    },

    // Admin data: tenants registry, audit logs, satellite tables.
    backoffice: {
      client: 'pg',
      connection: { ...baseConn, searchPath: 'backoffice' },
    },

    // Tenant connections are created at runtime, no entry needed here.
  },
})
```

| Connection | Schema | Purpose |
|---|---|---|
| `public` | `public` | Shared global data |
| `backoffice` | `backoffice` | Tenant registry and satellite features |
| `tenant_<uuid>` | `tenant_<uuid>` | Per tenant isolated data, created on demand |

Why three? It keeps three lifecycles clean. Data owned by your app (public), data owned by operators of the app (backoffice), and data owned by individual customers (per tenant). Mixing them eventually bites. Tenant exports leak admin rows, backups get bloated, migrations target the wrong schema.

### 3. Bootstrap the backoffice

```bash
node ace backoffice:setup
```

Creates the `backoffice` schema and runs the satellite table migrations in one shot.

### 4. Register a tenant repository

The package needs a way to look up tenants without knowing your model's import path. Wire it once in your app provider:

```ts
// providers/app_provider.ts
import { TENANT_REPOSITORY } from '@adonisjs-lasagna/multitenancy'

export default class AppProvider {
  async boot() {
    this.app.container.singleton(TENANT_REPOSITORY, async () => {
      const { default: Tenant } = await import('#models/backoffice/tenant')
      return {
        findById: (id) =>
          Tenant.query().whereNull('deleted_at').where('id', id).first(),

        findByDomain: (host) =>
          Tenant.query().whereNull('deleted_at').where('custom_domain', host).first(),

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

Why a contract instead of a hard import? Because the package shouldn't care whether you call your model `Tenant`, `Account`, or `Workspace`, and circular import paths in AdonisJS get gnarly fast. A bound contract is the clean seam.

### 5. Add middleware

```ts
// start/kernel.ts

// Tenant facing route groups: validate that every request resolves to a tenant.
router.use([
  () => import('@adonisjs-lasagna/multitenancy/middleware')
    .then(m => ({ default: m.TenantGuardMiddleware })),
])

// Optional: custom domains. Maps Host header to x-tenant-id before routes run.
server.use([
  () => import('@adonisjs-lasagna/multitenancy/middleware')
    .then(m => ({ default: m.CustomDomainMiddleware })),
])

// Optional: per tenant rate limiting.
router.use([
  () => import('@adonisjs-lasagna/multitenancy/middleware')
    .then(m => ({ default: m.RateLimitMiddleware })),
])
```

### 6. Create your first tenant

```bash
node ace tenant:create "Acme Corp" "admin@acme.example.com"
node ace queue:work    # in another terminal, this is what actually provisions the schema
```

Once `InstallTenant` finishes, the row flips to `status: 'active'` and tenant scoped routes light up.

### 7. Use `request.tenant()` in controllers

```ts
async show({ request }: HttpContext) {
  const tenant = await request.tenant()
  // Memoized per request, same reference no matter how many times you call it.
}
```

You can call this from middleware, controllers, models, or services within the same request and it will hit your repository exactly once. See [Typed tenant metadata](#typed-tenant-metadata) for the generic form.

## How tenant resolution works

Three strategies, one mental model: extract a UUID, look it up, route to its schema.

Set `resolverStrategy` in `config/multitenancy.ts`:

| Strategy | How it works | Best for |
|---|---|---|
| `header` (default) | Reads `x-tenant-id` from request headers | Internal APIs, mobile clients |
| `subdomain` | Extracts UUID from `<uuid>.yourdomain.com` | SaaS web apps |
| `path` | Reads the first path segment `/<uuid>/...` | API versioning, embeds |

For `subdomain`, also set `baseDomain: env.get('APP_DOMAIN')`. For custom domains (`acme.com` resolves to `<uuid>`), enable `CustomDomainMiddleware`. It rewrites the request to the canonical header form before the resolver runs.

## Configuration reference

`config/multitenancy.ts` with every option and its default. Sections are independent. Leave the optional ones off until you need them.

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
  resolverStrategy: 'header',          // 'header' | 'subdomain' | 'path'
  tenantHeaderKey: 'x-tenant-id',
  baseDomain: env.get('APP_DOMAIN'),   // required for 'subdomain'

  // Paths that bypass tenant resolution entirely
  ignorePaths: ['/health', '/admin'],

  // Cache TTL for resolved tenants (seconds)
  schemaCacheTtl: 300,

  // Circuit breaker, wraps every tenant DB call
  circuitBreaker: {
    threshold: 50,
    resetTimeout: 30_000,
    rollingCountTimeout: 10_000,
    volumeThreshold: 10,
  },

  // BullMQ per tenant job queues
  queue: {
    tenantQueuePrefix: 'tenant_queue_',
    defaultConcurrency: 1,
    attempts: 3,
    redis: { /* host, port, db ... */ },
  },

  // pg_dump / pg_restore + optional S3
  backup: {
    storagePath: env.get('BACKUP_STORAGE_PATH', './storage/backups'),
    metadataTtl: 300,
    pgConnection: { host, port, user, password, database },
    s3: { enabled: false, bucket, region, endpoint, accessKeyId, secretAccessKey },

    // Optional: tier based retention. See "Backups and retention".
    retention: {
      defaultTier: 'standard',
      tiers: {
        standard: { intervalHours: 24, keepLast: 7 },
        premium:  { intervalHours: 6,  keepLast: 30 },
      },
      getTier: (tenant) => tenant.metadata?.tier,
    },
  },

  // Cache (BentoCache), separate Redis db number to avoid collisions
  cache: {
    ttl: 300,
    redis: { /* host, port, db ... */ },
  },

  // ─── Everything below is optional ────────────────────────────────

  onboarding: {
    wizardTtl: 3600,
    wizardKeyPrefix: 'onboarding:',
  },

  // Lifecycle hooks declared as config, see "Lifecycle hooks and events"
  hooks: {
    beforeProvision: async ({ tenant }) => { /* … */ },
    afterCreate:     async ({ tenant }) => { /* … */ },
  },

  // Soft delete TTL, see "Soft delete and purge"
  softDelete: {
    retentionDays: 30,
  },

  // Plans and quotas, see "Plans and quotas"
  plans: {
    defaultPlan: 'free',
    definitions: {
      free: { limits: { apiCallsPerDay: 1_000, seats: 3 } },
      pro:  { limits: { apiCallsPerDay: 100_000, seats: 50 } },
    },
    getPlan: (tenant) => tenant.metadata?.plan,
  },

  // Read replicas, see "Read replicas"
  tenantReadReplicas: {
    hosts: [
      { host: 'replica-1.db.internal' },
      { host: 'replica-2.db.internal' },
    ],
    strategy: 'sticky',     // 'round-robin' | 'random' | 'sticky'
    connectionSuffix: '_read',
  },
})
```

## Core features

### Schema isolation

Every tenant gets its own PostgreSQL schema. No `tenant_id WHERE` clauses, no leaks.

When `InstallTenant` runs, the package creates `tenant_<uuid>`, applies your tenant migrations against it, and registers a Lucid connection pointing at it. From then on, anything that calls `tenant.getConnection()` (or extends `TenantBaseModel`) routes to the right schema automatically.

```ts
// app/models/tenant_scoped/order.ts
import { TenantBaseModel } from '@adonisjs-lasagna/multitenancy/base-models'

export default class Order extends TenantBaseModel {
  // Will be queried inside tenant_<uuid>.orders. No manual connection switch.
}
```

A real use case: a B2B SaaS exports tenant data on offboarding. Schema isolation makes this a one liner:

```bash
pg_dump --schema=tenant_<uuid> mydb > customer-export.sql
```

No filters across forty tables. No risk of leaking another customer's row.

### Circuit breaker

One bad schema shouldn't take down the others.

Every tenant DB call is wrapped in [opossum](https://github.com/nodeshift/opossum). When a single tenant's DB starts erroring (network flake, locked schema, exhausted connection pool), the breaker opens for that tenant only and returns `CircuitOpenException` (HTTP 503) immediately. No thundering herd reconnection storm.

```ts
circuitBreaker: {
  threshold: 50,         // open after this percentage of errors
  resetTimeout: 30_000,  // ms before half open retry
  volumeThreshold: 10,   // min requests before breaker can trip, raise in staging
}
```

The default `volumeThreshold: 10` keeps CI tolerant of a few flaky seed run failures. Bump it higher in staging if you want even more headroom, lower it for prod when you want the breaker more sensitive.

### Lifecycle hooks and events

11 typed events for everything that happens to a tenant, plus `before` / `after` hooks where you actually need to abort.

The package emits these events automatically. Wire from a service provider, a config block, or anywhere with access to `emitter`:

```ts
import {
  TenantCreated, TenantActivated, TenantSuspended,
  TenantProvisioned, TenantDeleted, TenantUpdated, TenantMigrated,
  TenantBackedUp, TenantRestored, TenantCloned, TenantQuotaExceeded,
} from '@adonisjs-lasagna/multitenancy/events'

emitter.on(TenantCreated, async ({ tenant }) => {
  await sendWelcomeEmail(tenant)
  await provisionStripeCustomer(tenant)
})

emitter.on(TenantQuotaExceeded, async ({ tenant, quota, limit }) => {
  await notifyAccountManager(tenant, `${quota} hit limit ${limit}`)
})
```

The reference API at [examples/api/](examples/api/) wires listeners for all 11 events into the audit log table. [tests/e2e/lifecycle_events.spec.ts](examples/api/tests/e2e/lifecycle_events.spec.ts) reads them back to verify nothing was forgotten.

Hooks (declarative form, in `config/multitenancy.ts`) give you abort semantics that events can't:

```ts
hooks: {
  // Throwing here aborts tenant provisioning, e.g. enforce email allowlist
  beforeProvision: async ({ tenant }) => {
    if (!tenant.email.endsWith('@trusted.com')) throw new Error('Untrusted domain')
  },

  afterMigrate: async ({ tenant, direction }) => {
    if (direction === 'up') await reindexSearch(tenant)
  },
}
```

`before*` hooks abort on throw. `after*` hooks are best effort. A single failing `after*` hook is logged and others still run. The reason is simple: you don't want a flaky Slack notification to roll back a successful migration.

### Contextual logging

Every log line in an HTTP request, from your code, from the package, from any awaited service, carries the right `tenantId`. You don't do anything to make this happen.

Powered by `AsyncLocalStorage`. The middleware runs `next()` inside a context. Jobs run `execute()` inside a context. Every Pino log inherits the `tenantId` binding automatically.

```ts
import { tenantLogger, TenantLogContext } from '@adonisjs-lasagna/multitenancy/services'

// Inside any code path during an HTTP request or queue job:
;(await tenantLogger()).info({ orderId }, 'order placed')
// → { msg: 'order placed', tenantId: 'abc-123', orderId: 'ord_42' }

// Need the current id without a logger? It's just:
const ctx = await app.container.make(TenantLogContext)
ctx.currentTenantId()
```

Real use case: a 3 AM page from PagerDuty. Filter your log aggregator by `tenantId: <uuid>` and you have the full request trace, across HTTP, jobs, and any async work, without grepping for stack frames.

### Health and metrics

Stop hand rolling `/livez`. Stop wrapping prom-client. Get table stakes observability in one line.

```ts
// start/routes.ts
import { multitenancyRoutes } from '@adonisjs-lasagna/multitenancy/health'

multitenancyRoutes()
// Exposes /livez, /readyz, /healthz, /metrics
```

- `/livez` is up if the process is up
- `/readyz` is up if backoffice DB and Redis are reachable and no breakers are OPEN
- `/healthz` is the full diagnostic, extends `/readyz` with subsystem detail
- `/metrics` is Prometheus 0.0.4 text exposition with `multitenancy_tenants_total`, `multitenancy_tenants_by_status`, `multitenancy_circuit_state` (0/1/2), `multitenancy_queue_jobs`, `multitenancy_uptime_seconds`

Why our own exporter? No `prom-client` peer dep. The Prometheus text format is about thirty lines of code. Pulling 80 KB of dependencies for it was overkill.

Add custom checks:

```ts
import { HealthService } from '@adonisjs-lasagna/multitenancy/health'

HealthService.addCheck('stripe', async () => {
  const ok = await Stripe.healthcheck()
  return { ok, message: ok ? 'reachable' : 'unreachable' }
})
```

### tenant:doctor

Eight built in checks, auto fix, JSON for CI, a live TUI dashboard. Run it in a deploy pipeline, an oncall ritual, or a panic.

```bash
# One off diagnosis
node ace tenant:doctor

# Auto fix the fixable issues (stalled provisioning, half open circuits)
node ace tenant:doctor --fix

# CI friendly: exit code reflects severity, output is a JSON report
node ace tenant:doctor --json

# Focus on a single tenant
node ace tenant:doctor --tenant=<uuid>

# Discover available checks
node ace tenant:doctor --check=list

# Run only specific checks
node ace tenant:doctor --check=schema_drift --check=migration_state

# Live TUI dashboard, refreshes every 5s (or --interval=2000)
node ace tenant:doctor --watch
```

The eight built in checks: `failed_tenants`, `provisioning_stalled` (fixable), `schema_drift`, `migration_state`, `circuit_breakers` (fixable), `queue_health`, `backup_recency`, plus your own.

Real use case: before every prod deploy, `node ace tenant:doctor --json | jq '.summary'`. Block the deploy if any error severity issue exists.

Plug in your own checks:

```ts
import { DoctorService } from '@adonisjs-lasagna/multitenancy/services'

DoctorService.register({
  name: 'stripe_subscription_drift',
  description: 'Tenants whose Stripe subscription status disagrees with our DB',
  async run({ tenants }) {
    const issues = []
    for (const t of tenants) {
      const sub = await Stripe.subscriptions.retrieve(t.stripe_id)
      if (sub.status !== t.subscription_status) {
        issues.push({ tenantId: t.id, severity: 'warn', message: `${sub.status} != ${t.subscription_status}` })
      }
    }
    return issues
  },
})
```

### Plans and quotas

Tiered limits, rolling counters, snapshot usage, 429 plus event in one line.

Declare plans in config:

```ts
plans: {
  defaultPlan: 'free',
  definitions: {
    free: { limits: { apiCallsPerDay: 1_000, seats: 3, storageMb: 100 } },
    pro:  { limits: { apiCallsPerDay: 100_000, seats: 50, storageMb: 10_000 } },
  },
  getPlan: (tenant) => tenant.metadata?.plan,
}
```

Two tracking modes:

| Mode | Use for | API |
|---|---|---|
| Rolling daily counter | API calls, jobs queued, emails sent | `quotaSvc.track`, `quotaSvc.consume` |
| Snapshot value | Seats, storage, projects | `quotaSvc.setUsage` |

```ts
import { QuotaService } from '@adonisjs-lasagna/multitenancy/services'

const quota = new QuotaService()

// Rolling counter, increments today's bucket
await quota.track(tenant, 'apiCallsPerDay', 1)

// Consume + enforce, throws QuotaExceededException (HTTP 429) and emits TenantQuotaExceeded
await quota.consume(tenant, 'apiCallsPerDay', 1)

// Snapshot, overwrites current value
await quota.setUsage(tenant, 'seats', activeSeats.length)
```

The middleware factory wires consumption into routes:

```ts
import { enforceQuota } from '@adonisjs-lasagna/multitenancy/middleware'

router.post('/api/messages', () => MessageController.create)
  .use(enforceQuota('apiCallsPerDay'))

router.post('/api/exports', () => ExportController.create)
  .use(enforceQuota('exportsPerDay', { amount: 1 }))
```

Real use case: free tier users hit `apiCallsPerDay`. The middleware throws 429 with `Retry-After`, your error handler returns a friendly upgrade prompt, and `TenantQuotaExceeded` triggers a CRM event so sales gets a warm lead automatically.

### Backups and retention

Backups are not "set the storagePath and forget". Tier based intervals, retention sweeps, S3 mirror, idempotent cron command.

```ts
backup: {
  storagePath: './storage/backups',
  pgConnection: { /* ... */ },
  s3: { enabled: true, bucket: 'tenant-backups', region: 'eu-west-1', /* ... */ },

  retention: {
    defaultTier: 'standard',
    tiers: {
      standard:   { intervalHours: 24, keepLast: 7 },
      premium:    { intervalHours: 6,  keepLast: 30 },
      enterprise: { intervalHours: 1,  keepLast: 90 },
    },
    getTier: (tenant) => tenant.metadata?.tier ?? 'standard',
  },
}
```

The cron is a single idempotent command:

```bash
# Suggested: hourly. Skips tenants whose interval hasn't elapsed.
0 * * * * node ace tenant:backups:run

# Dry run mode prints decisions without touching anything
node ace tenant:backups:run --dry-run

# Force a backup for one tenant regardless of tier interval
node ace tenant:backups:run --tenant=<uuid> --force

# Skip retention sweep (just back up, don't purge old archives)
node ace tenant:backups:run --no-retention
```

The retention sweep purges from local storage and from S3 if S3 is enabled.

Restore, import, and clone all live next to backup. The reference API exercises all three end to end in [tests/e2e/backups_real.spec.ts](examples/api/tests/e2e/backups_real.spec.ts), with a fixture dump that includes a table absent from the migrations so you can prove the import really happened.

```bash
node ace tenant:restore --tenant=<uuid> --file=tenant_<id>_<ts>.dump
node ace tenant:import  --tenant=<uuid> --file=./dump.sql --schema-replace=public --force
node ace tenant:clone   --source=<src-uuid> --name="Acme Clone" --email="clone@acme.test"
```

Real use case: premium customers want point in time style protection on a six hour cadence with 30 days of history; the standard tier sticks at daily and keeps seven. One config block, no per tier branching in app code.

### Read replicas

Send read traffic to replicas. Three strategies. Connection naming stays stable, replica connections are reused, not recreated per request.

```ts
tenantReadReplicas: {
  hosts: [
    { host: 'replica-1.db.internal' },
    { host: 'replica-2.db.internal', user: 'reader', password: env.get('REPLICA_PW') },
  ],
  strategy: 'sticky',          // 'round-robin' (default) | 'random' | 'sticky'
  connectionSuffix: '_read',   // final name: tenant_<uuid>_read_<idx>
}
```

| Strategy | Behaviour |
|---|---|
| `round-robin` | Cycles through hosts globally. Good default for even spread. |
| `random` | Picks per call. Useful when tenants have wildly skewed traffic. |
| `sticky` | `sha1(tenantId) % hosts.length`. Same tenant always lands on the same replica. Warm caches, predictable replica lag for a given customer. |

Implement the optional contract method on your tenant model:

```ts
import { ReadReplicaService } from '@adonisjs-lasagna/multitenancy/services'

const replicas = new ReadReplicaService()

export default class Tenant extends TenantBaseModel {
  async getReadConnection() {
    return (await replicas.resolve(this)) ?? this.getConnection()
  }
}
```

`resolve()` returns `null` when no replicas are configured, so your app falls back to the primary connection without code changes. Why a model method instead of a global override? Because replica routing is a per call decision (some queries can tolerate replica lag, others can't), and exposing it as a method lets the caller choose.

[tests/e2e/replicas_strategies.spec.ts](examples/api/tests/e2e/replicas_strategies.spec.ts) flips the strategy at runtime via `setConfig` and confirms that round robin and random both hit every replica over enough iterations.

### Soft delete and purge

The recycle bin pattern your customers expect.

```ts
softDelete: {
  retentionDays: 30,   // default
}
```

```bash
# Soft delete: row marked deleted, schema preserved
node ace tenant:destroy <uuid> --keep-schema

# Cron the purge: drops schemas of tenants past the retention window
0 3 * * * node ace tenant:purge-expired --force

# Dry run first to see what would be dropped
node ace tenant:purge-expired --dry-run
```

Why two stages? Customers occasionally come back. Soft delete plus a 30 day grace lets you restore in one SQL statement; a hard drop on `tenant:destroy` would require restoring from backup.

### Typed tenant metadata

Stop casting `tenant.metadata as any`. Bring your shape, get it back.

```ts
interface MyTenantMetadata {
  plan: 'free' | 'pro' | 'enterprise'
  industry: string
  billingId: string
}

// In a controller:
async show({ request }: HttpContext) {
  const tenant = await request.tenant<MyTenantMetadata>()
  tenant.metadata.plan      // typed
  tenant.metadata.industry  // typed
}
```

The generic `TenantModelContract<TMeta extends object>` propagates through the repository contract, the request extension, and the testing helpers. Default is `Record<string, unknown>`, so existing code keeps working untouched.

### REST admin API

Nine admin endpoints, one mount call. You bring your own auth.

```ts
// start/routes.ts
import authMiddleware from '#middleware/admin_auth_middleware'
import { multitenancyAdminRoutes } from '@adonisjs-lasagna/multitenancy/admin'

multitenancyAdminRoutes({
  prefix: '/admin/tenants',
  middleware: [authMiddleware],
})
```

Endpoints exposed:

| Method | Path | Action |
|---|---|---|
| `GET` | `/` | List (filterable by `?status=` and `?includeDeleted=`) |
| `GET` | `/:id` | Show |
| `POST` | `/` | Create + dispatch `InstallTenant` |
| `POST` | `/:id/activate` | Activate |
| `POST` | `/:id/suspend` | Suspend |
| `POST` | `/:id/destroy` | Destroy with optional `keepSchema` body field |
| `POST` | `/:id/restore` | Restore from soft delete |
| `GET` | `/:id/queue/stats` | BullMQ stats for this tenant |
| `GET` | `/health/report` | Per fleet `DoctorService.run()` report |

Why opt in middleware? Nobody's auth model fits all cases. We hand you the routing, you decide whether it's session, JWT, mTLS, IP allowlist, or all four.

Every endpoint plus the auth gate is verified in [tests/e2e/admin_full.spec.ts](examples/api/tests/e2e/admin_full.spec.ts).

### Testing helpers

Stop reinventing `createTestTenant` in every consumer app.

```ts
import {
  buildTestTenant,
  MockTenantRepository,
  createTestTenant,
  destroyTestTenant,
  cleanupTenants,
  setRequestTenant,
} from '@adonisjs-lasagna/multitenancy/testing'
```

In memory tests (no DB):

```ts
const tenant = buildTestTenant<MyMetadata>({ status: 'active', metadata: { plan: 'pro' } })
const repo = new MockTenantRepository<MyMetadata>([tenant])
```

DB backed integration tests:

```ts
const tenant = await createTestTenant({ name: 'Acme Test', email: 'test@acme.test' })
// ... your test
await destroyTestTenant(tenant.id)
// or: await cleanupTenants()  // wipes everything created during the suite
```

HTTP tests with a memoized tenant:

```ts
import { test } from '@japa/runner'

test('protected endpoint', async ({ client }) => {
  const tenant = buildTestTenant()
  const response = await client.get('/api/orders').setup((request) => {
    setRequestTenant(request, tenant)
  })
  response.assertStatus(200)
})
```

## Satellites

These live in the `backoffice` schema and are entirely opt in. Use what you need, ignore the rest.

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
  TenantWebhookDelivery,
  TenantBranding,
  TenantSsoConfig,
  TenantMetric,
} from '@adonisjs-lasagna/multitenancy/models/satellites'
```

| Satellite | What you get | Notes |
|---|---|---|
| AuditLog | Append only `tenant_audit_logs` rows with `action`, `actor`, `metadata` | Searchable by action, actor, date range. The reference API uses it as the read back path for all 11 lifecycle events. |
| FeatureFlags | Per tenant boolean toggles with optional config blob | Cached for 60 seconds. Useful for staged rollouts. |
| Webhooks | Subscriptions, delivery, exponential backoff retries | HMAC SHA256 signature in `x-webhook-signature`, secrets encrypted at rest with AES 256 GCM. Run `node ace tenant:webhooks:retry` on a 1 minute cron. |
| Branding | `from_name`, `from_email`, `logo_url`, `primary_color`, `support_url`, `email_footer` | Cached in BentoCache for fast theme reads. Drives the welcome email in the reference API. |
| SSO (OIDC) | Per tenant identity providers with discovery doc cache | Discovery cached for one hour. State stored in Redis with a 10 minute TTL. |
| Metrics | Counter accumulator flushed to DB on demand | Counters live at `metrics:<tenantId>:<YYYY-MM-DD>:<metric>` with 48 hour TTL. Run `node ace tenant:metrics:flush` daily. |

The webhook delivery test is worth a look. [tests/e2e/webhooks_delivery.spec.ts](examples/api/tests/e2e/webhooks_delivery.spec.ts) spins up an in process HTTP listener, fires an event, and asserts the captured POST has a valid HMAC. The failure path exercises a closed port and confirms `tenant:webhooks:retry` exits cleanly even when the next retry isn't due yet.

## Reference API at examples/api

Every claim in this README is backed by a curl recipe and a test in [examples/api/](examples/api/). The folder is a real AdonisJS 7 app with:

- A v7-idiomatic layout: thin controllers, a [services](examples/api/app/services/) layer, [VineJS validators](examples/api/app/validators/) (422 on invalid input), and event side-effects in [app/listeners/](examples/api/app/listeners/) registered from `AppProvider.ready()` — `start/routes.ts` is route declarations only
- All 11 lifecycle event listeners writing to the audit log
- Three demo controllers for the satellites (feature flags, branding, SSO)
- A welcome email mailer fired from `TenantActivated`, captured by MailCatcher
- 12 e2e spec files, 111 tests, around 20 seconds wall time
- A Docker compose stack (Postgres 16, Redis 7, MailCatcher, pgAdmin)

To run it:

```bash
cd examples/api
npm install --legacy-peer-deps
npm run test:e2e
```

The script brings the stack up, runs `backoffice:setup`, executes the suite, and tears it back down. Pass `--keep` to inspect the data after a run. There's a PowerShell variant at `npm run test:e2e:win`.

Tests skip gracefully when their prerequisites aren't there: backups skip if `pg_dump` isn't on PATH, mail tests skip if MailCatcher isn't reachable. CI installs both, so all 111 run.

## Commands reference

```bash
# ─── One time setup ────────────────────────────────────────────────
node ace backoffice:setup                          # creates backoffice schema + migrations

# ─── Tenant lifecycle ──────────────────────────────────────────────
node ace tenant:create "Acme" "acme@example.com"
node ace tenant:list [--all]                       # --all includes soft deleted
node ace tenant:activate <uuid>
node ace tenant:suspend <uuid>
node ace tenant:destroy <uuid> [--keep-schema] [--force]

# ─── Migrations ────────────────────────────────────────────────────
node ace tenant:migrate [--tenant=<uuid>] [--dry-run] [--disable-locks] [--verbose]
node ace tenant:migrate:rollback [--tenant=<uuid>] [--dry-run] [--disable-locks]

# ─── Backups ───────────────────────────────────────────────────────
node ace tenant:backup [--tenant=<uuid>]                              # synchronous, one or all
node ace tenant:backup:list [--tenant=<uuid>]
node ace tenant:restore --tenant=<uuid> --file=<backup.dump>          # pg_restore (custom format)
node ace tenant:backups:run [--tenant=<uuid>] [--force] [--dry-run] [--no-retention]

# ─── Cloning and importing ─────────────────────────────────────────
node ace tenant:clone --source=<uuid> --name="..." --email="..." [--schema-only] [--clear-sessions]
node ace tenant:import --tenant=<uuid> --file=<dump.sql> [--schema-replace=...] [--dry-run] [--force]

# ─── Maintenance and cron ──────────────────────────────────────────
node ace tenant:webhooks:retry                                        # every 1 to 5 min via cron
node ace tenant:metrics:flush [period]                                # daily via cron (period = YYYY-MM-DD, default today UTC)
node ace tenant:queue:stats [--tenant=<uuid>]
node ace tenant:purge-expired [--retention-days=N] [--dry-run] [--force]

# ─── Diagnosis and DX ──────────────────────────────────────────────
node ace tenant:doctor [--tenant=<uuid>] [--check=<id>] [--fix] [--json] [--watch] [--interval=ms]
node ace tenant:seed [--tenant=<uuid>] [--files=<path>] [--continue-on-error]
node ace tenant:repl <tenantId>                                       # REPL with tenant, db, audit, metrics, ... preloaded
```

Restore vs import. `tenant:restore` shells out to `pg_restore`, which expects a custom format archive (`pg_dump -Fc`). For plain text `.sql` dumps, including those with `COPY ... FROM stdin` blocks, use `tenant:import`. It will shell out to `psql` automatically, so make sure `psql` is on PATH.

Recommended cron:

```
* * * * *   node ace tenant:webhooks:retry
0 * * * *   node ace tenant:backups:run
0 1 * * *   node ace tenant:metrics:flush
0 3 * * *   node ace tenant:purge-expired --force
*/5 * * * * node ace tenant:doctor --json | your-alerting-pipeline
```

## Background jobs

Long running operations are dispatched to BullMQ so they don't block the HTTP response:

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

Make sure `config/queue.ts` includes the package's job locations:

```ts
locations: [
  './node_modules/@adonisjs-lasagna/multitenancy/build/src/jobs/**/*.{ts,js}',
  './app/jobs/**/*.{ts,js}',
],
```

Each job runs inside the contextual logging scope, so log lines from job code automatically carry the tenant id. The `BackupTenant`, `RestoreTenant`, and `CloneTenant` jobs are also where the `TenantBackedUp`, `TenantRestored`, and `TenantCloned` events get emitted (the synchronous CLI commands run the same underlying services but stay event silent).

## Exceptions

The middleware, `request.tenant()`, and the quota middleware throw typed exceptions. Map them in your error handler:

```ts
import {
  MissingTenantHeaderException, // 400, no tenant identifier found
  TenantNotFoundException,      // 404, tenant doesn't exist
  TenantSuspendedException,     // 403, tenant is suspended
  TenantNotReadyException,      // 503, tenant still provisioning
  CircuitOpenException,         // 503, circuit breaker is open
  QuotaExceededException,       // 429, rate or usage limit hit
} from '@adonisjs-lasagna/multitenancy/exceptions'
```

`QuotaExceededException` carries `quota`, `limit`, `current`, and `attempted` so you can render an upgrade CTA in the response body.

## Under the hood

Cold path execution of a tenant request:

1. **Resolve.** The strategy reads the UUID from header, subdomain, or path. `CustomDomainMiddleware` (if enabled) rewrites custom hosts to header form first.
2. **Look up.** `TENANT_REPOSITORY` returns the tenant row from the `backoffice` schema. The result is memoized per request via a Symbol keyed property, so `request.tenant()` is free to call repeatedly.
3. **Connect.** A named Lucid connection (`tenant_<uuid>`) is created on demand pointing at `tenant_<uuid>` as `searchPath`. Pooled and reused across requests.
4. **Wrap.** Every DB call passes through the tenant's circuit breaker (one breaker per tenant, kept in a singleton `Map`). On repeated errors, the breaker opens and short circuits the call until `resetTimeout` elapses.
5. **Log.** The request body runs inside `TenantLogContext.run({ tenantId })`. Any Pino call inside, yours or the package's, inherits the binding.

The cache layer is [BentoCache](https://bentocache.dev) on a dedicated Redis db number (separate from queue Redis) so namespaces don't collide. Backups shell out to `pg_dump` and `pg_restore`. `tenant:import` shells out to `psql` for `COPY FROM stdin` support.

## Troubleshooting

**`MissingTenantHeaderException` on every request.**
You're using `subdomain` or `path` strategy but the config still says `resolverStrategy: 'header'`, or the header isn't being sent. Confirm the strategy and verify the request actually carries the identifier (header, subdomain, or path segment).

**Circuit breaker opens immediately at startup.**
`volumeThreshold: 10` is the default, ten consecutive failures will trip it. If health checks or seed scripts hit the tenant DB before PostgreSQL is fully accepting connections, you'll hit this. Raise `volumeThreshold` further in staging, and gate your readiness probe on PG availability.

**Tenant migration fails with `relation already exists`.**
`tenant:migrate` was probably run twice without a rollback. Lucid tracks state in `adonis_schema` inside each tenant schema. Inspect that table. If it's missing, the original `InstallTenant` job didn't finish; check `node ace queue:work` logs.

**`luxon` not found during build.**
Transitive AdonisJS dependency. With pnpm's strict hoisting, install it explicitly: `npm install luxon`, or add it to `shamefully-hoist` for the workspace.

**`tenant:doctor` reports schema drift after a clean migration.**
Double check `tenantSchemaPrefix` and `tenantConnectionNamePrefix` haven't been changed between deploys. Drift detection compares live PG schemas to the `tenants` table. A prefix mismatch makes everything look orphaned.

**npm install fails with peer dependency conflicts.**
Run with `--legacy-peer-deps`. AdonisJS 7 is still pre release in places (notably `@adonisjs/mail@10`'s peer range), so npm gets nervous about the resolution. The flag is safe; the resolved tree works.

**MailCatcher receives nothing in the reference API.**
Confirm the container is up. The mail listener uses dynamic imports inside try / catch, so a missing dep or unreachable host is swallowed silently to keep the rest of the suite green. The mail tests detect this and skip.

## Contributing

PRs, bug reports, and feature ideas are all welcome. Have a look at [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions, the test workflow, and a few notes on how to keep things tidy. If you're not sure whether something fits, open an issue first and we'll talk it through.

```bash
npm run typecheck                       # static type check
npm run test                            # unit tests (238 passing)
npm run build                           # required before integration tests
npm run test:integration                # integration suite

cd examples/api && npm run test:e2e     # full e2e suite (111 tests)
```

CI runs all three suites on every push and PR. Look at [.github/workflows/ci.yml](.github/workflows/ci.yml) for the Postgres + Redis + MailCatcher service definitions if you want to mirror them locally.

The repo lives at [github.com/Arcoders/Adonisjs-Lasagna-Multitenancy](https://github.com/Arcoders/Adonisjs-Lasagna-Multitenancy).

## License

MIT, [Ismael Haytam Tanane](https://github.com/Arcoders). See the [LICENSE](LICENSE) file for the full text.
