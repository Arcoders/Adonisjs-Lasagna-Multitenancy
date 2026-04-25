import { TENANT_REPOSITORY } from '../types/contracts.js'
import type { TenantRepositoryContract, TenantModelContract } from '../types/contracts.js'
import MissingTenantHeaderException from '../exceptions/missing_tenant_header_exception.js'
import TenantNotFoundException from '../exceptions/tenant_not_found_exception.js'
import { getConfig } from '../config.js'
import { HttpRequest } from '@adonisjs/core/http'
import app from '@adonisjs/core/services/app'
import assert from 'node:assert'

declare module '@adonisjs/core/http' {
  interface HttpRequest {
    tenant(): Promise<TenantModelContract>
  }
}

export function resolveTenantId(request: HttpRequest): string | undefined {
  const { resolverStrategy, tenantHeaderKey, baseDomain } = getConfig()

  if (resolverStrategy === 'subdomain') {
    const hostname = request.hostname()
    const host = hostname?.split(':')[0] ?? ''
    const suffix = baseDomain.startsWith('.') ? baseDomain : `.${baseDomain}`
    if (host.endsWith(suffix)) {
      const sub = host.slice(0, host.length - suffix.length)
      return sub || undefined
    }
    if (host === baseDomain) return undefined
    const labels = host.split('.')
    return labels.length > 1 ? labels[0] : undefined
  }

  if (resolverStrategy === 'path') {
    const segment = request.url(false).split('/').find(Boolean)
    return segment || undefined
  }

  return request.header(tenantHeaderKey) ?? undefined
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TENANT_MEMO_KEY = Symbol('resolved_tenant')

;(HttpRequest as any).macro('tenant', async function (this: HttpRequest) {
  if ((this as any)[TENANT_MEMO_KEY]) {
    return (this as any)[TENANT_MEMO_KEY] as TenantModelContract
  }

  const tenantId = resolveTenantId(this)
  assert(tenantId && UUID_V4.test(tenantId), new MissingTenantHeaderException())

  const repo = (await app.container.make(TENANT_REPOSITORY as any)) as TenantRepositoryContract
  const tenant = await repo.findById(tenantId, true)
  if (!tenant) throw new TenantNotFoundException()

  tenant.getConnection()
  ;(this as any)[TENANT_MEMO_KEY] = tenant
  return tenant
})
