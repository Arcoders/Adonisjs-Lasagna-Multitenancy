import { TENANT_REPOSITORY } from '../types/contracts.js'
import type { TenantRepositoryContract } from '../types/contracts.js'
import app from '@adonisjs/core/services/app'
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

export default class CustomDomainMiddleware {
  async handle({ request }: HttpContext, next: NextFn) {
    if (!request.header('x-tenant-id')) {
      const host = request.header('host')?.split(':')[0]
      if (host) {
        const repo = (await app.container.make(TENANT_REPOSITORY as any)) as TenantRepositoryContract
        const tenant = await repo.findByDomain(host)
        if (tenant) {
          request.request.headers['x-tenant-id'] = tenant.id
        }
      }
    }
    return next()
  }
}
