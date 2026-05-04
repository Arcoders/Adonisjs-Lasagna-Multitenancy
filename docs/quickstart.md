# Quickstart

From `npm install` to a live tenant in five minutes. The configure
command does most of the wiring — you only fill in connections and the
repository binding.

## Requirements

- Node.js 24 or newer
- AdonisJS 7
- `@adonisjs/lucid` configured against PostgreSQL 14+
- `@adonisjs/redis` (cache + counters)
- `@adonisjs/queue` (background jobs that provision schemas)
- `@aws-sdk/client-s3` *(optional, only for S3 backup uploads)*
- `jose` *(optional, only when SSO is enabled)*

## 1. Install and configure

```bash
npm install @adonisjs-lasagna/multitenancy
node ace configure @adonisjs-lasagna/multitenancy
```

The configure command does three things:

1. Registers `MultitenancyProvider` in `adonisrc.ts`.
2. Publishes `config/multitenancy.ts` from a typed `defineConfig({...})` stub.
3. Scaffolds `app/models/backoffice/tenant.ts`.

By default it also publishes migration stubs for **every satellite**
(audit, feature_flags, webhooks, branding, sso, metrics). You usually
want to be selective:

```bash
# Only audit logs and webhooks
node ace configure @adonisjs-lasagna/multitenancy --with=audit,webhooks

# Interactive (prompts you with a checkbox list)
node ace configure @adonisjs-lasagna/multitenancy

# CI-friendly: explicit list, no prompt
node ace configure @adonisjs-lasagna/multitenancy --no-interaction --with=audit,branding,feature_flags
```

## 2. Set up your database connections

Three connection contexts live side by side. Add them to
`config/database.ts`:

```ts
// config/database.ts
export default defineConfig({
  connections: {
    // Shared global data: countries, plans, anything cross-tenant.
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

| Connection      | Schema           | Purpose                                  |
| --------------- | ---------------- | ---------------------------------------- |
| `public`        | `public`         | Shared global data                       |
| `backoffice`    | `backoffice`     | Tenant registry + satellite features     |
| `tenant_<uuid>` | `tenant_<uuid>`  | Per-tenant data, created on demand       |

::: tip Why three connections?
Three lifecycles, three schemas. Data owned by **your app** (`public`),
data owned by **your operators** (`backoffice`), and data owned by
**individual customers** (per-tenant). Mixing them eventually bites —
tenant exports leak admin rows, backups balloon, migrations target the
wrong schema.
:::

## 3. Bootstrap the backoffice

```bash
node ace backoffice:setup
```

Creates the `backoffice` schema and runs all satellite-table migrations
in one shot. Idempotent — re-run it any time.

## 4. Bind the tenant repository

The package never imports your `Tenant` model — it asks the IoC
container for a `TenantRepositoryContract` so model class names and
import paths stay your concern, not the package's.

Wire it once in your app provider:

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

## 5. Register middleware

```ts
// start/kernel.ts

// Tenant-facing route groups: validate every request resolves to a tenant.
router.use([
  () => import('@adonisjs-lasagna/multitenancy/middleware')
    .then(m => ({ default: m.TenantGuardMiddleware })),
])

// Optional: custom domains — maps Host header to x-tenant-id before routes run.
server.use([
  () => import('@adonisjs-lasagna/multitenancy/middleware')
    .then(m => ({ default: m.CustomDomainMiddleware })),
])

// Optional: per-tenant rate limiting on top of TenantGuardMiddleware.
router.use([
  () => import('@adonisjs-lasagna/multitenancy/middleware')
    .then(m => ({ default: m.RateLimitMiddleware })),
])
```

## 6. Create your first tenant

```bash
node ace tenant:create "Acme Corp" "admin@acme.example.com"
node ace queue:work    # in another terminal — this is what actually provisions the schema
```

Once the `InstallTenant` job finishes, the row flips to
`status: 'active'` and tenant-scoped routes light up.

## 7. Use `request.tenant()` in controllers

```ts
async show({ request }: HttpContext) {
  const tenant = await request.tenant()
  // Memoized per request, same reference no matter how many times you call it.
}
```

Call it from middleware, controllers, models, or services — the
package memoizes the resolution per request and hits your repository
exactly once.

## How tenant resolution works

Three strategies, one mental model: extract a UUID, look it up, route
to its schema. Configure via `resolverStrategy` in
`config/multitenancy.ts`:

| Strategy           | How it works                                            | Best for              |
| ------------------ | ------------------------------------------------------- | --------------------- |
| `header` (default) | Reads `x-tenant-id` from request headers                | Internal APIs, mobile |
| `subdomain`        | Extracts UUID from `<uuid>.yourdomain.com`              | SaaS web apps         |
| `path`             | Reads the first path segment `/<uuid>/...`              | API versioning, embeds|
| `request-data`     | Reads from query string or body                         | Webhook receivers     |
| `domain-or-subdomain` | Custom domain wins, falls back to subdomain          | Mixed deployments     |

For `subdomain`, also set `baseDomain: env.get('APP_DOMAIN')`. For
custom domains (`acme.com` resolves to a tenant UUID), enable
`CustomDomainMiddleware` — it rewrites the request to the canonical
header form before the resolver runs.

You can also chain resolvers (`config.resolverChain`) and register
your own implementing the `TenantResolver` contract.

## What's next?

- **Add satellites** as you need them — audit logs first, webhooks
  second, the rest when the demand surfaces.
- **Wire `tenant:doctor` into your CI**: `node ace tenant:doctor --json`
  exits non-zero on detected problems.
- **Set up backups** with retention tiers (`config.backup.retention`)
  and run `tenant:backups:run` on a cron.
- **Read [the security guide](/security)** before you ship — covers
  what the package guarantees, what you own, and how to harden the
  HTTP surface.
- **Deploying?** [The deployment guide](/deployment) covers the
  Dockerfile, docker-compose stack, and the Helm chart.

::: info Reference app
The full feature surface lives in [examples/api](https://github.com/Arcoders/Adonisjs-Lasagna-Multitenancy/tree/master/examples/api)
— a real AdonisJS 7 app with a 111-test e2e suite. `npm run test:e2e`
brings up Postgres + Redis + MailCatcher and exercises everything end
to end.
:::
