import app from '@adonisjs/core/services/app'
import type { HttpContext } from '@adonisjs/core/http'
import { TENANT_REPOSITORY } from '../types/contracts.js'
import type {
  TenantRepositoryContract,
  TenantStatus,
  TenantModelContract,
} from '../types/contracts.js'
import InstallTenant from '../jobs/install_tenant.js'
import TenantQueueService from '../services/tenant_queue_service.js'
import DoctorService from '../services/doctor/doctor_service.js'
import HookRegistry from '../services/hook_registry.js'
import { getActiveDriver } from '../services/isolation/active_driver.js'
import TenantCreated from '../events/tenant_created.js'
import TenantActivated from '../events/tenant_activated.js'
import TenantSuspended from '../events/tenant_suspended.js'
import TenantDeleted from '../events/tenant_deleted.js'

const VALID_STATUSES: TenantStatus[] = [
  'provisioning',
  'active',
  'suspended',
  'failed',
  'deleted',
]

function serialize(t: TenantModelContract) {
  return {
    id: t.id,
    name: t.name,
    email: t.email,
    status: t.status,
    customDomain: t.customDomain,
    schemaName: t.schemaName,
    createdAt: t.createdAt?.toISO?.() ?? null,
    deletedAt: t.deletedAt?.toISO?.() ?? null,
    isActive: t.isActive,
    isDeleted: t.isDeleted,
    metadata: t.metadata ?? null,
  }
}

export default class AdminController {
  async list({ request, response }: HttpContext) {
    const repo = (await app.container.make(TENANT_REPOSITORY as any)) as TenantRepositoryContract
    const includeDeleted = request.input('includeDeleted', false) === true ||
      request.input('includeDeleted') === 'true'
    const status = request.input('status') as TenantStatus | undefined

    const statuses = status && VALID_STATUSES.includes(status) ? [status] : undefined
    const tenants = await repo.all({ includeDeleted, statuses })
    return response.ok({
      data: tenants.map(serialize),
      total: tenants.length,
    })
  }

  async show({ params, response }: HttpContext) {
    const repo = (await app.container.make(TENANT_REPOSITORY as any)) as TenantRepositoryContract
    const tenant = await repo.findById(params.id, true)
    if (!tenant) return response.notFound({ error: 'tenant_not_found' })
    return response.ok({ data: serialize(tenant) })
  }

  async create({ request, response }: HttpContext) {
    const name = String(request.input('name') ?? '').trim()
    const email = String(request.input('email') ?? '').trim()
    if (!name || !email) {
      return response.badRequest({ error: 'name_and_email_required' })
    }

    const repo = (await app.container.make(TENANT_REPOSITORY as any)) as TenantRepositoryContract
    const tenant = await repo.create({ name, email, status: 'provisioning' })
    await TenantCreated.dispatch(tenant)
    await InstallTenant.dispatch({ tenantId: tenant.id })
    return response.created({ data: serialize(tenant), provisioning: true })
  }

  async activate({ params, response }: HttpContext) {
    const repo = (await app.container.make(TENANT_REPOSITORY as any)) as TenantRepositoryContract
    const tenant = await repo.findById(params.id, true)
    if (!tenant) return response.notFound({ error: 'tenant_not_found' })
    if (tenant.isActive) return response.ok({ data: serialize(tenant), unchanged: true })

    await tenant.activate()
    await TenantActivated.dispatch(tenant)
    return response.ok({ data: serialize(tenant) })
  }

  async suspend({ params, response }: HttpContext) {
    const repo = (await app.container.make(TENANT_REPOSITORY as any)) as TenantRepositoryContract
    const tenant = await repo.findById(params.id, true)
    if (!tenant) return response.notFound({ error: 'tenant_not_found' })
    if (tenant.isSuspended) return response.ok({ data: serialize(tenant), unchanged: true })

    await tenant.suspend()
    await TenantSuspended.dispatch(tenant)
    return response.ok({ data: serialize(tenant) })
  }

  async destroy({ params, request, response }: HttpContext) {
    const repo = (await app.container.make(TENANT_REPOSITORY as any)) as TenantRepositoryContract
    const tenant = await repo.findById(params.id)
    if (!tenant) return response.notFound({ error: 'tenant_not_found' })

    const keepSchema =
      request.input('keepSchema') === true || request.input('keepSchema') === 'true'

    const hooks = await app.container.make(HookRegistry)
    await hooks.run('before', 'destroy', { tenant })

    const { DateTime } = await import('luxon')
    tenant.deletedAt = DateTime.now()
    await tenant.save()

    if (!keepSchema) {
      const driver = await getActiveDriver()
      await driver.destroy(tenant)
    }

    await hooks.run('after', 'destroy', { tenant })
    await TenantDeleted.dispatch(tenant)
    return response.ok({ data: serialize(tenant), schemaDropped: !keepSchema })
  }

  async restore({ params, response }: HttpContext) {
    const repo = (await app.container.make(TENANT_REPOSITORY as any)) as TenantRepositoryContract
    const tenant = await repo.findById(params.id, true)
    if (!tenant) return response.notFound({ error: 'tenant_not_found' })
    if (!tenant.isDeleted) return response.ok({ data: serialize(tenant), unchanged: true })

    tenant.deletedAt = null
    await tenant.save()
    return response.ok({ data: serialize(tenant) })
  }

  async queueStats({ params, response }: HttpContext) {
    const repo = (await app.container.make(TENANT_REPOSITORY as any)) as TenantRepositoryContract
    const tenant = await repo.findById(params.id, true)
    if (!tenant) return response.notFound({ error: 'tenant_not_found' })
    const stats = await new TenantQueueService().getStats(tenant.id)
    return response.ok({ data: stats })
  }

  async healthReport({ response }: HttpContext) {
    const doctor = await app.container.make(DoctorService)
    const result = await doctor.run()
    response.status(result.totals.error > 0 ? 503 : 200)
    return response.send(result)
  }
}
