import router from '@adonisjs/core/services/router'
import { middleware } from './kernel.js'

router.get('/health', async ({ response }) => {
  return response.ok({ status: 'ok' })
})

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
  })
  .prefix('tenant')
  .use(middleware.tenantGuard())
