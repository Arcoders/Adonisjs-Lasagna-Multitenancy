---
layout: home

hero:
  name: Lasagna
  text: Multi-tenancy for AdonisJS 7
  tagline: |
    Schema-isolated PostgreSQL tenants with the production plumbing your SaaS will eventually need — circuit breakers, queues, plans/quotas, backups, replicas, audit, webhooks, SSO. One package. Zero `tenant_id =` JOINs.
  image:
    src: /logo.svg
    alt: Lasagna Multitenancy
  actions:
    - theme: brand
      text: Quickstart
      link: /quickstart
    - theme: alt
      text: Why Lasagna?
      link: /#why-lasagna
    - theme: alt
      text: View on GitHub
      link: https://github.com/Arcoders/Adonisjs-Lasagna-Multitenancy

features:
  - icon: 🗄️
    title: Schema isolation, not column scoping
    details: |
      Each tenant lives in its own `tenant_<uuid>` PostgreSQL schema, provisioned and routed automatically. No giant `WHERE tenant_id = ?` JOINs across forty tables, no leaked rows, no exports prayer.

  - icon: ⚡
    title: Production plumbing on day one
    details: |
      Circuit breaker per tenant (Opossum), read-replica routing, scheduled backups with retention tiers + S3 mirror, OpenTelemetry, Prometheus `/metrics`, health probes. None of it is bolted on later.

  - icon: 📨
    title: Queues, mail, drive, session — all tenant-scoped
    details: |
      Bootstrappers wire BullMQ, `@adonisjs/mail`, `@adonisjs/drive`, `@adonisjs/session`, and Transmit so every job, email, file, and session key is automatically namespaced to the active tenant via AsyncLocalStorage.

  - icon: 🛰️
    title: Six built-in satellites
    details: |
      Audit logs, feature flags, signed webhooks (HMAC + retries + state machine), branding, SSO/OIDC, and operational metrics — opt-in tables with stubs you publish via the configure command.

  - icon: 🩺
    title: A doctor that actually fixes things
    details: |
      `node ace tenant:doctor` ships with eight built-in checks plus a plugin API. `--fix` for auto-recovery, `--json` for CI, `--watch` for a TUI. No equivalent in Tenancy for Laravel.

  - icon: 🧪
    title: Testable from the first commit
    details: |
      `/testing` subpath ships `buildTestTenant`, `MockTenantRepository`, `setRequestTenant`. The reference [examples/api](https://github.com/Arcoders/Adonisjs-Lasagna-Multitenancy/tree/master/examples/api) is a real AdonisJS 7 app with 111 e2e tests you can `npm run test:e2e`.

  - icon: 🧩
    title: Pluggable isolation drivers
    details: |
      Pick `schema-pg` (default), `database-pg`, `rowscope-pg`, or `sqlite-memory` (testing). Implement your own through the `IsolationDriver` contract — the registry takes care of the wiring.

  - icon: 🛡️
    title: Hardened by default
    details: |
      UUID-strict tenant ids, identifier guard against SQL injection, SSRF guard for SSO/webhook URLs (IPv6 brackets included), HMAC `timingSafeEqual` for impersonation tokens, full OIDC verification with JWKS, nonce, iss/aud/exp.
---

## Why Lasagna { #why-lasagna }

Multi-tenancy is one of those problems that looks easy from far away. A
`tenant_id` column. A few middlewares. Done.

Then production happens.

A backfill job touches the wrong rows because someone forgot the `WHERE`.
A customer asks for their data export, and you spend a weekend writing
JOIN-and-pray scripts. A tenant's connection pool exhausts and takes
down the others. A migration ships fine in dev but stalls in prod
because three tenants have a stale schema. You start writing per-tenant
audit code, then per-tenant feature flags, then per-tenant backups,
then per-tenant rate limits — and six months later you have an
operational nightmare none of which is your product.

`@adonisjs-lasagna/multitenancy` is the package I wish existed when I
hit that wall the first time. **It assumes you'll need every one of those
things eventually**, so it ships them on day one — but as opt-in
satellites, not a god-class.

Compared to the same problem in Laravel, [`stancl/tenancy`](https://tenancyforlaravel.com/)
is the gold standard. Lasagna covers the same ground (4 isolation
drivers, 6 bootstrappers, 5 resolvers, full lifecycle hooks) and adds
what stancl leaves to the user: the doctor command, integrated read
replicas, OpenTelemetry, Prometheus, the REST admin API + OpenAPI 3.1
spec, scheduled backups with retention tiers, the impersonation flow,
quotas-as-middleware, and 32 ace commands vs stancl's 7.

It's also strictly **PostgreSQL** — schemas are a Postgres-native
concept and we don't try to hide that. If you're on MySQL or MariaDB,
this isn't your package.

[Read the full comparison →](/comparison)

## What you can do in 5 minutes { #what-you-can-do }

```bash
npm install @adonisjs-lasagna/multitenancy
node ace configure @adonisjs-lasagna/multitenancy
```

After three minutes of editing `config/multitenancy.ts` and
`config/database.ts`, you can:

- `POST /admin/tenants` to provision a new tenant — schema is created,
  migrations run, lifecycle events fire.
- Send `x-tenant-id: <uuid>` on any request and your `Note.query()` hits
  `tenant_<uuid>.notes` automatically.
- Run `node ace tenant:doctor --watch` and watch the dashboard turn green.
- `node ace tenant:backup --tenant=<id>` produces a `.dump` you can
  restore into a fresh schema with `tenant:restore`.

[Take the full 5-minute quickstart →](/quickstart)

## Production-ready, not a prototype

| Feature | Lasagna | Tenancy for Laravel |
|---|---|---|
| Isolation drivers (schema / DB / rowscope) | ✅ 4 + pluggable | ✅ 3 hardcoded |
| Bootstrappers (cache, drive, mail, session, queue, broadcast) | ✅ 6 with LIFO registry | ✅ 6 ad-hoc |
| Resolvers (subdomain, header, path, request-data) | ✅ 5 + chainable | ✅ via custom code |
| Doctor command with `--fix` / `--json` / `--watch` | ✅ 8 checks + plugin API | ❌ |
| Read replica routing (round-robin / random / sticky) | ✅ integrated | ❌ user code |
| Scheduled backups + retention tiers + S3 | ✅ | ❌ manual |
| `tenant:clone`, `tenant:restore`, `tenant:import-sql` | ✅ | ❌ |
| Per-tenant maintenance mode + bypass token | ✅ | ✅ |
| OpenTelemetry + Prometheus `/metrics` | ✅ | ❌ |
| Health probes `/livez` `/readyz` `/healthz` | ✅ | ❌ |
| Audit log / feature flags / webhooks / SSO / branding satellites | ✅ all six | ❌ third parties |
| REST admin API + OpenAPI 3.1 + Swagger UI | ✅ | ❌ |
| Production deploy artefacts (Dockerfile + Helm chart) | ✅ | ❌ |

[See the full feature comparison →](/comparison)

## Stack

- **Node.js 24+**, ESM-native, `module: NodeNext`.
- **PostgreSQL 14+** (the package does not target MySQL/MariaDB).
- **AdonisJS 7** (`@adonisjs/lucid`, `@adonisjs/queue`, `@adonisjs/redis`).
- Optional peers: `@adonisjs/drive`, `@adonisjs/mail`, `@adonisjs/session`,
  `@aws-sdk/client-s3`, `jose` (only when SSO is enabled), `better-sqlite3`
  (in-memory testing driver).
- ~620 tests covering unit, integration, and e2e against a real Postgres
  + Redis + MailCatcher stack.

## Install

```bash
npm install @adonisjs-lasagna/multitenancy
```

[Continue to the quickstart →](/quickstart)
