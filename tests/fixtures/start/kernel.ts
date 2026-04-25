import router from '@adonisjs/core/services/router'
import server from '@adonisjs/core/services/server'

server.use([() => import('@adonisjs/core/bodyparser_middleware')])

export const middleware = router.named({
  tenantGuard: () =>
    import('@adonisjs-lasagna/multitenancy/middleware').then((m) => ({
      default: m.TenantGuardMiddleware,
    })),
  customDomain: () =>
    import('@adonisjs-lasagna/multitenancy/middleware').then((m) => ({
      default: m.CustomDomainMiddleware,
    })),
})
