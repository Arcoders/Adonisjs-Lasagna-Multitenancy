import router from '@adonisjs/core/services/router'
import emitter from '@adonisjs/core/services/emitter'
import { middleware } from '#start/kernel'
import { enforceQuota } from '@adonisjs-lasagna/multitenancy/middleware'
import { multitenancyRoutes } from '@adonisjs-lasagna/multitenancy/health'
import { multitenancyAdminRoutes } from '@adonisjs-lasagna/multitenancy/admin'
import {
  TenantCreated,
  TenantActivated,
  TenantSuspended,
  TenantBackedUp,
  TenantQuotaExceeded,
  TenantProvisioned,
  TenantMigrated,
  TenantRestored,
  TenantCloned,
  TenantUpdated,
  TenantDeleted,
} from '@adonisjs-lasagna/multitenancy/events'
import { TenantAuditLog } from '@adonisjs-lasagna/multitenancy'

// ─── Lifecycle event listeners (writes to backoffice.tenant_audit_logs) ────
// GET /demo/audit reads them back. Covers all 11 lifecycle events emitted
// by the package — proves the audit trail is complete.
emitter.on(TenantCreated, async ({ tenant }) => {
  await new TenantAuditLog()
    .merge({
      tenantId: tenant.id,
      actorType: 'system',
      action: 'tenant.created',
      metadata: { name: tenant.name, email: tenant.email },
    })
    .save()
})

emitter.on(TenantActivated, async ({ tenant }) => {
  await new TenantAuditLog()
    .merge({ tenantId: tenant.id, actorType: 'system', action: 'tenant.activated' })
    .save()
})

// Welcome email — fires on activation. Loads the tenant's branding row so
// each tenant's email carries their own from-address + colour scheme; falls
// back to defaults when no branding has been customised.
emitter.on(TenantActivated, async ({ tenant }) => {
  try {
    const [{ default: mail }, { default: TenantWelcomeMail }, { BrandingService }] =
      await Promise.all([
        import('@adonisjs/mail/services/main'),
        import('#app/mailers/tenant_welcome_mail'),
        import('@adonisjs-lasagna/multitenancy/services'),
      ])
    const svc = new BrandingService()
    const row = await svc.getForTenant(tenant.id)
    const ctx = svc.renderEmailContext(row)
    await mail.sendLater(
      new TenantWelcomeMail(
        { id: tenant.id, name: tenant.name, email: tenant.email },
        {
          fromName: ctx.fromName,
          fromEmail: ctx.fromEmail,
          primaryColor: ctx.primaryColor,
          supportUrl: ctx.supportUrl,
          logoUrl: ctx.logoUrl,
        }
      )
    )
  } catch {
    // Mail subsystem absent or unreachable — nothing to do. The mail.spec.ts
    // test detects this and skips gracefully.
  }
})

emitter.on(TenantSuspended, async ({ tenant }) => {
  await new TenantAuditLog()
    .merge({ tenantId: tenant.id, actorType: 'system', action: 'tenant.suspended' })
    .save()
})

emitter.on(TenantProvisioned, async ({ tenant }) => {
  await new TenantAuditLog()
    .merge({ tenantId: tenant.id, actorType: 'system', action: 'tenant.provisioned' })
    .save()
})

emitter.on(TenantMigrated, async ({ tenant, direction }) => {
  await new TenantAuditLog()
    .merge({
      tenantId: tenant.id,
      actorType: 'system',
      action: 'tenant.migrated',
      metadata: { direction },
    })
    .save()
})

emitter.on(TenantBackedUp, async ({ tenant, metadata }) => {
  await new TenantAuditLog()
    .merge({
      tenantId: tenant.id,
      actorType: 'system',
      action: 'tenant.backed_up',
      metadata: { file: metadata.file, sizeBytes: metadata.size },
    })
    .save()
})

emitter.on(TenantRestored, async ({ tenant, fileName }) => {
  await new TenantAuditLog()
    .merge({
      tenantId: tenant.id,
      actorType: 'system',
      action: 'tenant.restored',
      metadata: { fileName },
    })
    .save()
})

emitter.on(TenantCloned, async ({ source, destination, result }) => {
  // Logged against the destination tenant — that's the "new" tenant the
  // event is materialising.
  await new TenantAuditLog()
    .merge({
      tenantId: destination.id,
      actorType: 'system',
      action: 'tenant.cloned',
      metadata: {
        sourceId: source.id,
        tablesCopied: result.tablesCopied,
        rowsCopied: result.rowsCopied,
      },
    })
    .save()
})

emitter.on(TenantUpdated, async ({ tenant }) => {
  await new TenantAuditLog()
    .merge({
      tenantId: tenant.id,
      actorType: 'system',
      action: 'tenant.updated',
      metadata: { name: tenant.name, email: tenant.email },
    })
    .save()
})

emitter.on(TenantDeleted, async ({ tenant }) => {
  await new TenantAuditLog()
    .merge({ tenantId: tenant.id, actorType: 'system', action: 'tenant.deleted' })
    .save()
})

emitter.on(TenantQuotaExceeded, async ({ tenant, quota, limit, current, attempted }) => {
  await new TenantAuditLog()
    .merge({
      tenantId: tenant.id,
      actorType: 'system',
      action: 'tenant.quota_exceeded',
      metadata: { quota, limit, current, attempted },
    })
    .save()
})

// ─── Health & metrics (livez/readyz/healthz/metrics) ──────────────────────
multitenancyRoutes()

// ─── REST admin API (gated by demo header-based auth) ─────────────────────
multitenancyAdminRoutes({
  prefix: '/admin',
  middleware: [middleware.demoAdminAuth()],
})

// ─── /demo namespace — one or more endpoints per package feature ──────────
router
  .group(() => {
    // Tenant CRUD façade — must NOT be tenant-scoped (creating a tenant has no
    // tenant context yet).
    router.get('/tenants', '#app/controllers/demo/tenants_controller.list')
    router.post('/tenants', '#app/controllers/demo/tenants_controller.create')
    router.get('/tenants/:id', '#app/controllers/demo/tenants_controller.show')
    router.post('/tenants/:id/activate', '#app/controllers/demo/tenants_controller.activate')
    router.post('/tenants/:id/suspend', '#app/controllers/demo/tenants_controller.suspend')
    router.delete('/tenants/:id', '#app/controllers/demo/tenants_controller.destroy')
  })
  .prefix('/demo')

router
  .group(() => {
    router.get('/connection', async ({ request, response }) => {
      const tenant = await request.tenant()
      const conn = tenant.getConnection()
      return response.ok({ tenantId: tenant.id, connectionName: conn.connectionName })
    })

    router
      .post('/notes', '#app/controllers/demo/notes_controller.create')
      .use(enforceQuota('apiCallsPerDay'))
    router.get('/notes', '#app/controllers/demo/notes_controller.list')
    router.get('/notes/read', '#app/controllers/demo/notes_controller.listFromReplica')

    router.get('/quota/state', '#app/controllers/demo/quota_controller.state')
    router.post('/quota/track', '#app/controllers/demo/quota_controller.track')

    router.get('/doctor', '#app/controllers/demo/doctor_controller.run')

    router.get('/circuit', '#app/controllers/demo/circuit_controller.state')

    router.get('/webhooks', '#app/controllers/demo/webhooks_controller.list')
    router.post('/webhooks', '#app/controllers/demo/webhooks_controller.subscribe')
    router.post('/webhooks/fire', '#app/controllers/demo/webhooks_controller.fire')

    router.get('/audit', '#app/controllers/demo/audit_controller.list')

    // Feature flags / branding / SSO satellites
    router.get('/feature-flags', '#app/controllers/demo/feature_flags_controller.list')
    router.post('/feature-flags', '#app/controllers/demo/feature_flags_controller.set')
    router.delete(
      '/feature-flags/:flag',
      '#app/controllers/demo/feature_flags_controller.destroy'
    )

    router.get('/branding', '#app/controllers/demo/branding_controller.show')
    router.put('/branding', '#app/controllers/demo/branding_controller.update')

    router.get('/sso', '#app/controllers/demo/sso_controller.show')
    router.put('/sso', '#app/controllers/demo/sso_controller.update')

    // Probe for the contextual_logging test. The middleware wraps the rest
    // of the request in `TenantLogContext.run({ tenantId })`, so any
    // `tenantLogger()` call here returns a child logger bound to that id.
    // We reflect both the AsyncLocalStorage state and (where possible) the
    // bindings on the wrapped logger back to the caller.
    router.get('/log/emit', async ({ request, response }) => {
      const tenant = await request.tenant()
      const services = await import('@adonisjs-lasagna/multitenancy/services')
      const appMod = await import('@adonisjs/core/services/app')
      const ctxSvc = await appMod.default.container.make(services.TenantLogContext)
      const log = await services.tenantLogger()
      log.info({ source: 'log/emit' }, 'tenant context probe')

      let loggerBindings: Record<string, unknown> | null = null
      const bindingsFn = (log as any).bindings
      if (typeof bindingsFn === 'function') {
        try {
          loggerBindings = bindingsFn.call(log) ?? null
        } catch {
          loggerBindings = null
        }
      }

      return response.ok({
        ok: true,
        tenantId: tenant.id,
        contextTenantId: ctxSvc.currentTenantId() ?? null,
        loggerBindings,
      })
    })
  })
  .prefix('/demo')
  .use(middleware.tenantGuard())
