import router from '@adonisjs/core/services/router'
import AdminController from './admin_controller.js'

export type AdminRouteMiddleware =
  | string
  | string[]
  | ((...args: any[]) => any)
  | Array<string | ((...args: any[]) => any)>

export interface MultitenancyAdminRoutesOptions {
  /**
   * URL prefix for the admin endpoints. Default: `/admin/multitenancy`.
   * Pass an empty string to mount at root.
   */
  prefix?: string
  /**
   * Middleware applied to every admin route. Pass a name (registered in the
   * app kernel), a callable, or an array of either. Without this, the routes
   * are PUBLIC — securing them is the consumer's responsibility.
   */
  middleware?: AdminRouteMiddleware
}

const DEFAULT_PREFIX = '/admin/multitenancy'

/**
 * Mount the admin REST API. Call from `start/routes.ts`:
 *
 * ```ts
 * import { multitenancyAdminRoutes } from '@adonisjs-lasagna/multitenancy/admin'
 * import { middleware } from '#start/kernel'
 *
 * multitenancyAdminRoutes({ middleware: middleware.adminAuth() })
 * ```
 *
 * Endpoints (relative to the prefix):
 *   GET    /tenants                       List tenants (?status=&includeDeleted=)
 *   POST   /tenants                       Create tenant + dispatch InstallTenant
 *   GET    /tenants/:id                   Show tenant
 *   POST   /tenants/:id/activate          Activate
 *   POST   /tenants/:id/suspend           Suspend
 *   POST   /tenants/:id/destroy           Destroy (?keepSchema=true|false)
 *   POST   /tenants/:id/restore           Restore (clear deletedAt)
 *   GET    /tenants/:id/queue/stats       BullMQ stats
 *   GET    /health/report                 DoctorService.run() report
 */
export function multitenancyAdminRoutes(options: MultitenancyAdminRoutesOptions = {}): void {
  const { prefix = DEFAULT_PREFIX, middleware } = options

  const define = () => {
    const c = new AdminController()
    router.get('/tenants', (ctx) => c.list(ctx))
    router.post('/tenants', (ctx) => c.create(ctx))
    router.get('/tenants/:id', (ctx) => c.show(ctx))
    router.post('/tenants/:id/activate', (ctx) => c.activate(ctx))
    router.post('/tenants/:id/suspend', (ctx) => c.suspend(ctx))
    router.post('/tenants/:id/destroy', (ctx) => c.destroy(ctx))
    router.post('/tenants/:id/restore', (ctx) => c.restore(ctx))
    router.get('/tenants/:id/queue/stats', (ctx) => c.queueStats(ctx))
    router.post('/tenants/:id/maintenance', (ctx) => c.enterMaintenance(ctx))
    router.delete('/tenants/:id/maintenance', (ctx) => c.exitMaintenance(ctx))
    router.post('/tenants/:id/impersonations', (ctx) => c.startImpersonation(ctx))
    router.delete('/impersonations/:token', (ctx) => c.stopImpersonation(ctx))
    router.delete('/impersonations/by-id/:sessionId', (ctx) => c.stopImpersonation(ctx))
    router.get('/health/report', (ctx) => c.healthReport(ctx))
  }

  const group = router.group(define)
  if (prefix) group.prefix(prefix)
  if (middleware) (group as any).use(middleware)
}
