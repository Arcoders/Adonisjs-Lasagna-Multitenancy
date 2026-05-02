import type { HttpContext } from '@adonisjs/core/http'
import { tenantLogger } from '@adonisjs-lasagna/multitenancy/services'
import type { DemoMeta } from '#app/models/backoffice/tenant'

/**
 * Demonstrates schema isolation, generic TenantModelContract<TMeta>, contextual
 * logging, and (combined with enforceQuota in start/routes.ts) quota enforcement.
 */
export default class NotesController {
  async list({ request, response }: HttpContext) {
    const tenant = await request.tenant<DemoMeta>()
    try {
      const result = await tenant
        .getConnection()
        .rawQuery('SELECT id, title, body, created_at FROM notes ORDER BY id DESC')
      ;(await tenantLogger()).info({ count: result.rows.length }, 'listed notes')
      return response.ok({ tenantId: tenant.id, plan: tenant.metadata?.plan, notes: result.rows })
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error('[notes.list]', err?.message)
      throw err
    }
  }

  async listFromReplica({ request, response }: HttpContext) {
    const tenant = await request.tenant<DemoMeta>()
    try {
      // Falls back to the primary connection when no replica is configured
      // OR when the tenant model doesn't implement the optional method.
      const conn = tenant.getReadConnection
        ? await tenant.getReadConnection()
        : tenant.getConnection()
      const result = await conn.rawQuery(
        'SELECT id, title, body, created_at FROM notes ORDER BY id DESC'
      )
      return response.ok({
        readFrom: conn.connectionName,
        isReplica: conn.connectionName.endsWith('_read_0'),
        notes: result.rows,
      })
    } catch (err: any) {
      return response.status(500).send({
        error: { message: err?.message ?? 'unknown', stack: err?.stack?.split('\n').slice(0, 3) },
      })
    }
  }

  async create({ request, response }: HttpContext) {
    const tenant = await request.tenant<DemoMeta>()
    const body = request.body() as { title?: string; body?: string }
    if (!body.title) return response.badRequest({ error: { message: 'title is required' } })

    const conn = tenant.getConnection()
    const result = await conn.rawQuery(
      'INSERT INTO notes (title, body) VALUES (?, ?) RETURNING id, title, body, created_at',
      [body.title, body.body ?? null]
    )
    const row = result.rows[0]
    ;(await tenantLogger()).info({ noteId: row?.id }, 'note created')
    return response.created({ tenantId: tenant.id, note: row })
  }
}
