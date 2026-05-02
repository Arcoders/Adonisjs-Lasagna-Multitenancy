import type { HttpContext } from '@adonisjs/core/http'
import { SsoService } from '@adonisjs-lasagna/multitenancy/services'

const sso = new SsoService()

interface SsoBody {
  clientId?: string
  clientSecret?: string
  issuerUrl?: string
  redirectUri?: string
  scopes?: string[]
}

/**
 * Read / write tenant SSO config. The `clientSecret` is never echoed back —
 * we return a presence boolean only.
 */
export default class SsoController {
  async show({ request, response }: HttpContext) {
    const tenant = await request.tenant()
    const config = await sso.getConfig(tenant.id)
    if (!config) return response.ok({ tenantId: tenant.id, configured: false })
    return response.ok({
      tenantId: tenant.id,
      configured: true,
      provider: config.provider,
      clientId: config.clientId,
      issuerUrl: config.issuerUrl,
      redirectUri: config.redirectUri,
      scopes: config.scopes,
      enabled: config.enabled,
      hasClientSecret: Boolean(config.clientSecret),
    })
  }

  async update({ request, response }: HttpContext) {
    const tenant = await request.tenant()
    const body = request.body() as SsoBody
    const missing = ['clientId', 'clientSecret', 'issuerUrl', 'redirectUri'].filter(
      (k) => !body[k as keyof SsoBody]
    )
    if (missing.length) {
      return response.badRequest({
        error: { message: `missing required fields: ${missing.join(', ')}` },
      })
    }
    const row = await sso.upsertConfig(tenant.id, {
      clientId: body.clientId!,
      clientSecret: body.clientSecret!,
      issuerUrl: body.issuerUrl!,
      redirectUri: body.redirectUri!,
      scopes: body.scopes,
    })
    return response.ok({
      tenantId: tenant.id,
      configured: true,
      provider: row.provider,
      clientId: row.clientId,
      issuerUrl: row.issuerUrl,
      redirectUri: row.redirectUri,
      scopes: row.scopes,
      enabled: row.enabled,
      hasClientSecret: Boolean(row.clientSecret),
    })
  }
}
