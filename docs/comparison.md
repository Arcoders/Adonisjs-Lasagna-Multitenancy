# Lasagna vs Tenancy for Laravel — Comparativa para Reverse Engineering

> Documento estratégico para identificar qué falta en `@adonisjs-lasagna/multitenancy` para convertirlo en el referente de multi-tenancy del ecosistema AdonisJS, tomando como benchmark a [stancl/tenancy](https://tenancyforlaravel.com/) (Tenancy for Laravel v3).

---

## 0. Contexto

| | Lasagna | Tenancy for Laravel |
|---|---|---|
| Runtime | AdonisJS 7 (Node ≥ 24) | Laravel (PHP) |
| Versión actual | 1.1.1 (2025) | v3 estable desde feb 2019 |
| Tests | 238 unit + 111 e2e | extensa suite oficial |
| Comunidad | Naciente | Discord activo, libro, curso, SaaS boilerplate |
| Modelo de negocio | OSS MIT | OSS MIT + sponsor-only premium tier |
| Web | github | tenancyforlaravel.com (producto) |
| Docs | README + `examples/api/` | sitio dedicado v3 con docs por sección |

**Conclusión rápida:** Tenancy for Laravel gana en madurez, marketing y ecosistema. Lasagna gana en *kit operativo SaaS* listo de fábrica (backups, quotas, webhooks, SSO, circuit breaker, métricas). Para ser el #1 en Adonis, Lasagna necesita igualar la flexibilidad de aislamiento, los bootstrappers automáticos que aún faltan, y construir un producto/ecosistema alrededor.

---

## 1. Identificación de tenants

| Estrategia | Lasagna | Tenancy for Laravel | Acción reverse-eng |
|---|---|---|---|
| Subdominio | ✅ | ✅ | — |
| Dominio principal | ✅ ([custom_domain_middleware.ts](../src/middleware/custom_domain_middleware.ts)) | ✅ | — |
| Dominio + subdominio combinados | ⚠️ separados | ✅ resolver único | **Añadir** resolver `domain-or-subdomain` |
| Path | ✅ | ✅ | — |
| Header | ✅ | ⚠️ vía custom resolver | ya ganamos |
| Request data (body/query) | ❌ | ✅ | **Añadir** resolver de query/body |
| Initialization manual (sin middleware) | ⚠️ parcial | ✅ `tenancy()->initialize($tenant)` | **Añadir** API imperativa `tenancy.run(tenant, fn)` |
| Cached tenant resolution | ✅ BentoCache | ✅ | — |

---

## 2. Aislamiento de datos

| | Lasagna | Tenancy for Laravel | Acción |
|---|---|---|---|
| Schema PostgreSQL | ✅ (único modo) | ✅ | — |
| BD separada (DB-per-tenant) | ❌ | ✅ MySQL/PG/SQLite | **Añadir** modo `database-per-tenant` con driver pluggable |
| Single-database (row scoping con `tenant_id`) | ❌ | ✅ traits `BelongsToTenant` | **Añadir** un mixin/decorator equivalente para Lucid |
| MySQL / MariaDB | ❌ | ✅ | **Decisión estratégica:** ¿soportar MySQL? |
| SQLite (testing) | ❌ | ✅ | Útil para tests |
| Pool de conexiones por tenant | ✅ | ✅ | — |
| Read replicas | ✅ round-robin / random / sticky | ➖ vía Laravel | ya ganamos |
| Connection naming determinista | ✅ | ✅ | — |
| Lazy provisioning de conexión | ✅ | ✅ | — |

> **Punto crítico:** Tenancy for Laravel deja al usuario elegir entre 3 estrategias (DB-per-tenant, schema, single-DB). Lasagna sólo ofrece schema. Esto es la mayor brecha funcional.

---

## 3. Bootstrappers automáticos (context switching)

| Recurso | Lasagna | Tenancy for Laravel | Acción |
|---|---|---|---|
| DB switching | ✅ adapters | ✅ | — |
| Cache prefix por tenant | ✅ BentoCache | ✅ | — |
| **Filesystem prefix** | ❌ | ✅ | **Añadir** Drive provider que prefije `tenants/{id}/` |
| Queue context (tenantId en jobs) | ✅ BullMQ | ✅ | — |
| Redis store separation | ✅ | ✅ | — |
| **Mail driver context** | ❌ | ✅ | **Añadir** mail bootstrapper (DKIM/SMTP por tenant) |
| **Session scoping** | ❌ | ✅ | **Añadir** session prefix automático |
| **Broadcasting/Pusher por tenant** | ❌ | ✅ | **Añadir** transmit/socket scoping |
| Logger contextual | ✅ AsyncLocalStorage | ✅ | — |

---

## 4. Lifecycle, eventos y hooks

| | Lasagna | Tenancy for Laravel | Acción |
|---|---|---|---|
| Eventos tipados | 11 ([src/events/](../src/events/)) | extenso (TenantCreated, DatabaseCreated, …) | — |
| Hooks declarativos | ✅ [hook_registry.ts](../src/services/hook_registry.ts) | parcial | ya ganamos |
| Pipeline de jobs por evento | ✅ 5 jobs (Install/Uninstall/Clone/Backup/Restore) | ✅ | — |
| `before` / `after` hooks por fase | ✅ | parcial | — |
| Soft delete + retención | ✅ con `tenant:purge-expired` | parcial | ya ganamos |

---

## 5. Comandos / CLI

### Tenancy for Laravel (artisan)
1. `tenants:migrate`
2. `tenants:rollback`
3. `tenants:seed`
4. `tenants:migrate-fresh`
5. `tenants:run` (ejecuta cualquier comando bajo el contexto de N tenants)
6. `tenants:list`
7. `cache:clear --tags`

### Lasagna (24 comandos en [src/commands/](../src/commands/))
- Provisioning: `create_tenant`, `destroy_tenant`, `activate_tenant`, `suspend_tenant`, `list_tenants`
- Migraciones: `run_tenant_migrations`, `rollback_tenant_migrations`, `tenant_migrate`, `tenant_migrate_rollback`, `tenant_seed`
- Operaciones: `tenant_clone`, `tenant_backup`, `tenant_backup_list`, `tenant_backups_run`, `tenant_restore`, `import_tenant_sql`
- Mantenimiento: `tenant_doctor`, `tenant_purge_expired`, `tenant_metrics_flush`, `tenant_webhooks_retry`, `tenant_queue_stats`
- Backoffice: `setup_backoffice`, `tenant_repl`

| | Lasagna | Tenancy for Laravel | Acción |
|---|---|---|---|
| Total | **24** | 7 | ya ganamos |
| `tenants:run <cmd>` (genérico) | ❌ | ✅ | **Añadir** `tenant:exec --tenants=...` para ejecutar cualquier ace command bajo contexto tenant |
| `migrate-fresh` | ❌ | ✅ | **Añadir** `tenant:migrate:fresh` |

---

## 6. Features de operación SaaS (donde Lasagna domina)

| Feature | Lasagna | Tenancy for Laravel | Notas |
|---|---|---|---|
| Backup automatizado (pg_dump) | ✅ | ❌ (manual) | retention tiers + S3 + JSON sidecar |
| Restore desde dump | ✅ | ❌ | — |
| Clone de tenant | ✅ | ❌ | copia schema completo |
| Import SQL externo | ✅ | ❌ | con [sql_splitter.ts](../src/utils/sql_splitter.ts) |
| Doctor (auto-diagnóstico) | ✅ 8 checks + `--fix` `--json` `--watch` | ❌ | killer feature |
| REPL por tenant | ✅ | ❌ | — |

---

## 7. Satélites y features SaaS

| Feature | Lasagna | Tenancy for Laravel | Acción |
|---|---|---|---|
| Audit log | ✅ [audit_log_service.ts](../src/services/audit_log_service.ts) | ❌ (Spatie) | — |
| Feature flags | ✅ [feature_flag_service.ts](../src/services/feature_flag_service.ts) | ❌ | — |
| Webhooks (HMAC + retries + state machine) | ✅ [webhook_service.ts](../src/services/webhook_service.ts) | ❌ | — |
| Branding por tenant | ✅ [branding_service.ts](../src/services/branding_service.ts) | ❌ | — |
| SSO/OIDC config | ✅ con cache de discovery | ❌ | — |
| Métricas por tenant | ✅ SCAN cursor-based | ❌ | — |
| Quotas + planes | ✅ rolling + snapshot | ❌ | — |
| **User impersonation** | ❌ | ✅ | **Añadir** servicio + middleware de impersonation |
| **Maintenance mode per tenant** | ⚠️ vía suspended | ✅ explícito | **Añadir** flag `maintenance` independiente del status |
| **Encrypted tenant attributes** | ✅ [crypto.ts](../src/utils/crypto.ts) | ✅ | — |

---

## 8. Fiabilidad y observabilidad (donde Lasagna domina)

| | Lasagna | Tenancy for Laravel |
|---|---|---|
| Circuit breaker per-tenant (Opossum) | ✅ [circuit_breaker_service.ts](../src/services/circuit_breaker_service.ts) | ❌ |
| Health checks + endpoints `/livez /readyz /healthz` | ✅ [src/health/](../src/health/) | ❌ |
| Prometheus `/metrics` (sin peer dep) | ✅ [metrics_exporter.ts](../src/health/metrics_exporter.ts) | ❌ |
| OpenTelemetry | ✅ [telemetry_service.ts](../src/services/telemetry_service.ts) | ❌ |
| Rate-limit middleware | ✅ | ❌ |
| Tenant logger con `AsyncLocalStorage` | ✅ | ✅ |

---

## 9. Routing y application structure

| | Lasagna | Tenancy for Laravel | Acción |
|---|---|---|---|
| Central routes vs Tenant routes | ⚠️ implícito (middleware) | ✅ explícito (`routes/tenant.php`) | **Añadir** convención `start/tenant.ts` y `start/routes.ts` con loader oficial |
| Universal routes | ❌ | ✅ | **Añadir** soporte de rutas que funcionan en ambos contextos |
| Path prefix automático | ⚠️ vía resolver `path` | ✅ | — |

---

## 10. Testing helpers

| | Lasagna | Tenancy for Laravel | Acción |
|---|---|---|---|
| `buildTestTenant` | ✅ | ✅ | — |
| `MockTenantRepository` | ✅ | ✅ | — |
| `setRequestTenant` | ✅ | ✅ | — |
| Subpath dedicado `/testing` | ✅ | ✅ | — |
| **In-memory adapter (sin DB)** | ❌ | ✅ SQLite | **Añadir** SQLite adapter para tests rápidos |
| **`refresh_tenant` por test** | ❌ | ✅ | **Añadir** helper Japa/test plugin |

---

## 11. Integraciones de ecosistema (la mayor brecha)

| Integración | Lasagna | Tenancy for Laravel |
|---|---|---|
| Admin panel oficial (Nova/Orchid) | ❌ admin REST (DIY UI) | ✅ Nova ready-made |
| OAuth (Passport / Sanctum equivalente) | ❌ | ✅ |
| Real-time (Livewire / Reverb) | ❌ | ✅ |
| Queues (Horizon / BullMQ) | ✅ BullMQ | ✅ Horizon |
| Cashier/billing | ❌ | ✅ premium |
| Telescope/debug | ❌ | ✅ |
| Vapor/serverless | n/a | ✅ |
| Vite | n/a | ✅ |

> **Lasagna ofrece** una REST admin API ([src/admin/](../src/admin/)) con 9 endpoints, pero no UI oficial.

---

## 12. Premium / monetización (lo que stancl ha construido sobre el OSS)

Tenancy for Laravel tiene un **sponsor-tier** con:
- SaaS boilerplate completo
- Billing con Cashier
- SSO entre central y tenants
- HTTPS para custom domains via Ploi
- Onboarding con colas
- Testing optimizado
- Estructura de codebase recomendada
- Nova universal
- Libro + curso en vídeo

**Acción reverse-eng (modelo de negocio):**
1. **Lasagna OSS** queda completo y mejor que stancl OSS.
2. **Lasagna Pro / sponsor**: SaaS template, billing, custom domain HTTPS automation, dashboard UI con AdonisJS+InertiaJS.
3. **Curso/libro** "Multi-tenant SaaS con AdonisJS".

---

## 13. Roadmap propuesto para superar a Tenancy for Laravel

### Fase 1 — Paridad core (lo imprescindible para no perder usuarios)
1. **DB-per-tenant adapter** (no sólo schema) — driver pluggable.
2. **Single-DB row-scoping** mixin para Lucid — captura el segmento de devs que hoy no necesitan aislamiento físico.
3. **Filesystem prefix bootstrapper** automático sobre `@adonisjs/drive`.
4. **Mail driver per-tenant** bootstrapper.
5. **Session scoping** automático.
6. **`tenant:exec <command>`** comando genérico equivalente a `tenants:run`.
7. **`tenant:migrate:fresh`**.
8. **Domain OR subdomain resolver** combinado.
9. **Request-data resolver** (body/query).
10. **`tenancy.run(tenant, fn)`** API imperativa para inicialización manual.

### Fase 2 — Igualar diferenciadores de stancl
11. **User impersonation** service + middleware + comando.
12. **Maintenance mode per tenant** (independiente de suspended).
13. **Universal routes** + convención `start/tenant.ts`.
14. **In-memory/SQLite adapter** para tests veloces.
15. **Cross-domain redirect helpers**.
16. **Real-time facades / broadcasting bootstrapper**.

### Fase 3 — Superar a stancl (donde ya somos mejores, pulir)
17. Pulir doctor: añadir 4–6 checks más (replicas lag, queue stalled, backup freshness, schema drift).
18. UI dashboard oficial (Inertia + Vue/React) reusando admin REST.
19. Helm chart + Docker compose oficial para deploy.
20. CLI `tenant init` que genere stub completo de SaaS.

### Fase 4 — Ecosistema y producto
21. Sitio dedicado `multitenancy.adonisjs-lasagna.dev` con docs por sección estilo stancl.
22. Discord oficial.
23. Sponsor tier con SaaS boilerplate Adonis 7 + Inertia.
24. Integración con `@adonisjs/auth` para SSO central → tenant.
25. Plugin Cashier-equivalent (Stripe/Lemon Squeezy) integrado con plans/quotas.
26. Curso en vídeo + libro.

---

## 14. Tabla resumen ejecutiva

| Categoría | Ganador hoy | Acción |
|---|---|---|
| Identificación de tenants | empate | añadir `domain-or-subdomain` y request-data |
| Aislamiento de datos | **stancl** (3 modos vs 1) | añadir DB-per-tenant + row-scoping |
| Bootstrappers automáticos | **stancl** (mail/fs/session faltan) | añadir 3 bootstrappers |
| Operación SaaS (backup/clone/doctor) | **lasagna** | mantener ventaja, pulir doctor |
| Satélites SaaS | **lasagna** | añadir impersonation, maintenance mode |
| Fiabilidad/observabilidad | **lasagna** | mantener |
| Comandos CLI | **lasagna** (24 vs 7) | añadir `tenant:exec` y `migrate:fresh` |
| Routing/structure | **stancl** | añadir convención central/tenant routes |
| Testing | empate | añadir SQLite adapter |
| Integraciones de ecosistema | **stancl** | construir admin UI, billing, SSO |
| Madurez y comunidad | **stancl** | invertir en docs, Discord, contenido |
| Producto y monetización | **stancl** | crear sponsor tier + boilerplate |

---

## 15. Conclusión

Lasagna ya **supera** a Tenancy for Laravel en lo operativo y observacional. La brecha real está en:

1. **Flexibilidad de aislamiento** (3 modos vs 1).
2. **Bootstrappers** que aún faltan (filesystem, mail, session).
3. **Producto/ecosistema** (sitio web, libro, curso, boilerplate, dashboard UI).

Cubriendo Fase 1 + 2 del roadmap, Lasagna se convierte funcionalmente en *superset* de stancl. Cubriendo Fase 4, se convierte en el *referente del ecosistema AdonisJS*, equivalente a lo que stancl es para Laravel.
