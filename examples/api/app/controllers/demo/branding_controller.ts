import type { HttpContext } from '@adonisjs/core/http'
import { BrandingService } from '@adonisjs-lasagna/multitenancy/services'

const branding = new BrandingService()

interface BrandingBody {
  fromName?: string | null
  fromEmail?: string | null
  logoUrl?: string | null
  primaryColor?: string | null
  supportUrl?: string | null
  emailFooter?: Record<string, unknown> | null
}

/**
 * Read / write tenant branding via `BrandingService`. Returns the
 * `renderEmailContext()` shape so callers see the resolved defaults even when
 * no row has been persisted yet.
 */
export default class BrandingController {
  async show({ request, response }: HttpContext) {
    const tenant = await request.tenant()
    const row = await branding.getForTenant(tenant.id)
    return response.ok({
      tenantId: tenant.id,
      hasRow: row !== null,
      branding: branding.renderEmailContext(row),
    })
  }

  async update({ request, response }: HttpContext) {
    const tenant = await request.tenant()
    const body = request.body() as BrandingBody
    const row = await branding.upsert(tenant.id, {
      fromName: body.fromName ?? null,
      fromEmail: body.fromEmail ?? null,
      logoUrl: body.logoUrl ?? null,
      primaryColor: body.primaryColor ?? null,
      supportUrl: body.supportUrl ?? null,
      emailFooter: body.emailFooter ?? null,
    })
    return response.ok({
      tenantId: tenant.id,
      branding: branding.renderEmailContext(row),
    })
  }
}
