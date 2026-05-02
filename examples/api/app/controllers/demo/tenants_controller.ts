import type { HttpContext } from '@adonisjs/core/http'
import Tenant from '#app/models/backoffice/tenant'
import { InstallTenant, UninstallTenant } from '@adonisjs-lasagna/multitenancy/jobs'
import { DateTime } from 'luxon'

/**
 * A friendlier façade over the package's admin endpoints — uses the same
 * jobs and lifecycle methods, but exposes simpler shapes for demo curls.
 *
 * Note: this exists alongside `multitenancyAdminRoutes()` (mounted at /admin)
 * to demonstrate both styles. Real apps usually pick one.
 */
export default class TenantsController {
  async list({ response }: HttpContext) {
    const tenants = await Tenant.query().orderBy('created_at', 'desc')
    return response.ok({ tenants })
  }

  async create({ request, response }: HttpContext) {
    const body = request.body() as {
      name?: string
      email?: string
      plan?: 'free' | 'pro'
      tier?: 'standard' | 'premium'
    }
    if (!body.name || !body.email) {
      return response.badRequest({ error: { message: 'name and email are required' } })
    }

    // Hooks beforeCreate (in config) will throw on emails that don't end in .test
    // — see config/multitenancy.ts. The error bubbles into our handler as a 500.
    const tenant = await new Tenant()
      .merge({
        name: body.name,
        email: body.email,
        status: 'provisioning',
        metadata: {
          plan: body.plan ?? 'free',
          tier: body.tier ?? 'standard',
        },
      })
      .save()

    await InstallTenant.dispatch({ tenantId: tenant.id })

    return response.accepted({
      tenantId: tenant.id,
      status: tenant.status,
      hint: 'Run `node ace queue:work` to materialise the schema',
    })
  }

  async show({ params, response }: HttpContext) {
    const tenant = await Tenant.query().where('id', params.id).first()
    if (!tenant) return response.notFound({ error: { message: 'tenant not found' } })
    return response.ok({ tenant })
  }

  async activate({ params, response }: HttpContext) {
    const tenant = await Tenant.findOrFail(params.id)
    await tenant.activate()
    return response.ok({ id: tenant.id, status: tenant.status })
  }

  async suspend({ params, response }: HttpContext) {
    const tenant = await Tenant.findOrFail(params.id)
    await tenant.suspend()
    return response.ok({ id: tenant.id, status: tenant.status })
  }

  // Demonstrates soft-delete with --keep-schema (?keepSchema=true) vs hard tear-down.
  async destroy({ params, request, response }: HttpContext) {
    const keepSchema = request.input('keepSchema') === 'true'
    const tenant = await Tenant.findOrFail(params.id)

    if (keepSchema) {
      tenant.deletedAt = DateTime.now()
      await tenant.save()
      return response.ok({
        id: tenant.id,
        softDeleted: true,
        hint: 'Schema preserved — `tenant:purge-expired` will drop it after retentionDays',
      })
    }

    await UninstallTenant.dispatch({ tenantId: tenant.id })
    return response.accepted({ id: tenant.id, scheduledFor: 'tear-down' })
  }
}
