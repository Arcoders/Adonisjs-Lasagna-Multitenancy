import type { HttpContext } from '@adonisjs/core/http'
import { TenantWebhook } from '@adonisjs-lasagna/multitenancy'
import { WebhookService } from '@adonisjs-lasagna/multitenancy/services'

const webhooks = new WebhookService()

/**
 * Subscriber CRUD + a "fire a test event" endpoint.
 *
 * Real apps usually expose this through their own admin UI; the routes here
 * are deliberately bare so the wiring is obvious.
 */
export default class WebhooksController {
  async list({ request, response }: HttpContext) {
    const tenant = await request.tenant()
    const subs = await TenantWebhook.query().where('tenant_id', tenant.id)
    return response.ok({ subscriptions: subs })
  }

  async subscribe({ request, response }: HttpContext) {
    const tenant = await request.tenant()
    const body = request.body() as {
      url?: string
      events?: string[]
      secret?: string
    }
    if (!body.url || !body.events?.length) {
      return response.badRequest({ error: { message: 'url and events[] are required' } })
    }
    const sub = await new TenantWebhook()
      .merge({
        tenantId: tenant.id,
        url: body.url,
        events: body.events,
        secret: body.secret ?? null,
        enabled: true,
      })
      .save()
    return response.created({ subscription: sub })
  }

  async fire({ request, response }: HttpContext) {
    const tenant = await request.tenant()
    const body = request.body() as { event?: string; payload?: Record<string, unknown> }
    if (!body.event) return response.badRequest({ error: { message: 'event is required' } })
    await webhooks.dispatch(tenant.id, body.event, body.payload ?? {})
    return response.accepted({
      dispatched: body.event,
      hint: 'Run `node ace tenant:webhooks:retry` to flush failed deliveries',
    })
  }
}
