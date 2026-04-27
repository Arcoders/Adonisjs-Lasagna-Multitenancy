# Changelog

All notable changes to `@adonisjs-lasagna/multitenancy` are documented here.

This project adheres to [Semantic Versioning](https://semver.org/).

---

## [1.0.3] — 2026-04-27

### Changed

- README now opens with a Lasagna ASCII banner, tagline, and status badges (Node.js, AdonisJS, PostgreSQL, Redis, tests, license)

---

## [1.0.2] — 2026-04-26

### Added

- MIT `LICENSE` file (© Ismael Haytam Tanane)
- `CONTRIBUTING.md` with setup, test, and PR workflow guidance
- `package.json` metadata: `author`, `homepage`, `repository`, `bugs`, `keywords`

### Changed

- `license` field switched from `UNLICENSED` to `MIT`
- README License section now points to the new `LICENSE` file
- README gained a Contributing section linking to `CONTRIBUTING.md`

---

## [1.0.1] — 2026-04-25

### Fixed

- `src/commands/commands.json` had a stray `]` at line 234 that closed the commands array early, leaving `tenant:webhooks:retry` and `tenant:metrics:flush` outside the array and breaking JSON parsing on install

---

## [1.0.0] — 2026-04-21

### Added

- **Core**
  - `MultitenancyProvider` — registers adapters, sets config, boots `request.tenant()` macro
  - `resolveTenantId()` — extracts tenant identifier via `header`, `subdomain`, or `path` strategy
  - `TENANT_REPOSITORY` symbol — DI token for `TenantRepositoryContract`
  - `getConfig()` / `setConfig()` — config accessor used across services

- **Base models**
  - `BackofficeBaseModel` — Lucid base for backoffice schema models
  - `TenantBaseModel` — Lucid base for tenant-scoped models (per-schema adapter)
  - `CentralBaseModel` — Lucid base for the central/public schema

- **Adapters**
  - `DefaultLucidAdapter` — standard Lucid adapter pass-through
  - `BackofficeAdapter` — forces schema search path for backoffice connection
  - `TenantAdapter` — dynamically routes queries to the correct tenant schema

- **Middleware**
  - `TenantGuardMiddleware` — resolves tenant from request, throws on missing/invalid
  - `CustomDomainMiddleware` — maps custom hostnames to tenant identifiers
  - `RateLimitMiddleware` — per-tenant rate limiting via Redis

- **Services**
  - `CircuitBreakerService` — per-tenant opossum circuit breakers
  - `TenantQueueService` — per-tenant BullMQ queues with stats
  - `TelemetryService` — OpenTelemetry span/counter helpers
  - `BackupService` — `pg_dump`/`pg_restore` with optional S3 upload
  - `CloneService` — schema-level tenant cloning
  - `SqlImportService` — raw SQL import with statement splitting
  - `AuditLogService` — structured audit trail per tenant
  - `FeatureFlagService` — per-tenant feature flags with percentage rollout
  - `WebhookService` — outbound webhooks with delivery tracking and retries
  - `BrandingService` — per-tenant branding (logo, colors)
  - `SsoService` — per-tenant SSO config (OIDC/SAML metadata)
  - `MetricsService` — time-series metrics storage per tenant

- **Satellite models** (backoffice schema)
  - `TenantAuditLog`, `TenantFeatureFlag`, `TenantWebhook`, `TenantWebhookDelivery`
  - `TenantBranding`, `TenantSsoConfig`, `TenantMetric`

- **Events**
  - `TenantCreated`, `TenantActivated`, `TenantSuspended`

- **Jobs** (BullMQ)
  - `InstallTenant`, `UninstallTenant`, `CloneTenant`, `BackupTenant`, `RestoreTenant`

- **Commands** (17 Ace commands)
  - `backoffice:setup`, `tenant:create`, `tenant:list`, `tenant:activate`, `tenant:suspend`
  - `tenant:destroy`, `tenant:migrate`, `tenant:migrate-rollback`, `tenant:run-migrations`
  - `tenant:rollback-migrations`, `tenant:seed`, `tenant:backup`, `tenant:backup:list`
  - `tenant:restore`, `tenant:clone`, `tenant:import-sql`, `tenant:queue:stats`

- **Exceptions**
  - `MissingTenantHeaderException` (400), `TenantNotFoundException` (404)
  - `TenantSuspendedException` (403), `TenantNotReadyException` (503)
  - `CircuitOpenException` (503)

- **configure hook** — `node ace configure @adonisjs-lasagna/multitenancy`
  - Registers provider + commands in `adonisrc.ts`
  - Publishes `config/multitenancy.ts` from stub
  - Scaffolds `app/models/backoffice/tenant.ts` if absent

- **Stubs**
  - `stubs/config/multitenancy.stub`
  - `stubs/models/tenant.stub`

- **Utilities**
  - `encrypt()` / `decrypt()` / `isEncrypted()` — field-level encryption helpers
  - `splitSqlStatements()` — splits multi-statement SQL for safe import
  - LRU cache utility for tenant resolution

---

[1.0.3]: https://github.com/Arcoders/Adonisjs-Lasagna-Multitenancy/releases/tag/v1.0.3
[1.0.2]: https://github.com/Arcoders/Adonisjs-Lasagna-Multitenancy/releases/tag/v1.0.2
[1.0.1]: https://github.com/Arcoders/Adonisjs-Lasagna-Multitenancy/releases/tag/v1.0.1
[1.0.0]: https://github.com/Arcoders/Adonisjs-Lasagna-Multitenancy/releases/tag/v1.0.0
