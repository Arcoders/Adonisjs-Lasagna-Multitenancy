import router from '@adonisjs/core/services/router'
import { middleware } from './kernel.js'
import { multitenancyAdminRoutes } from '@adonisjs-lasagna/multitenancy/admin'

router.get('/health', async ({ response }) => {
  return response.ok({ status: 'ok' })
})

// Mount admin REST + OpenAPI docs without auth — the fixture is for tests
// only, and individual specs supply their own ad-hoc gating where needed.
multitenancyAdminRoutes({ prefix: '/admin/multitenancy' })

router
  .group(() => {
    router.get('/ping', async ({ request, response }) => {
      const tenant = await request.tenant()
      return response.ok({ id: tenant.id, status: tenant.status })
    })

    router.get('/connection', async ({ request, response }) => {
      const tenant = await request.tenant()
      return response.ok({ connectionName: `tenant_${tenant.id}` })
    })

    // Used by request_tenant_memo integration tests
    router.get('/double-fetch', async ({ request, response }) => {
      const t1 = await request.tenant()
      const t2 = await request.tenant()
      return response.ok({ id: t1.id, sameObject: t1 === t2 })
    })
  })
  .prefix('tenant')
  .use(middleware.tenantGuard())

// Used by custom_domain_middleware integration tests
router
  .get('/custom-domain-check', async ({ request, response }) => {
    return response.ok({ tenantId: request.header('x-tenant-id') ?? null })
  })
  .use(middleware.customDomain())
