import app from '@adonisjs/core/services/app'
import type { HttpContext } from '@adonisjs/core/http'
import BrandingService, { type BrandingData } from '../../services/branding_service.js'
import TenantBranding from '../../models/satellites/tenant_branding.js'
import { loadTenantOr404 } from './helpers.js'

function serialize(b: TenantBranding | null) {
  if (!b) return null
  return {
    tenantId: b.tenantId,
    fromName: b.fromName,
    fromEmail: b.fromEmail,
    logoUrl: b.logoUrl,
    primaryColor: b.primaryColor,
    supportUrl: b.supportUrl,
    emailFooter: b.emailFooter,
    createdAt: b.createdAt?.toISO?.() ?? null,
    updatedAt: b.updatedAt?.toISO?.() ?? null,
  }
}

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}){1,2}$/

function looksLikeUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}

function pickIfDefined<T>(input: any, key: string, validator?: (v: unknown) => boolean): T | undefined {
  if (input[key] === undefined) return undefined
  if (input[key] === null) return null as unknown as T
  if (validator && !validator(input[key])) {
    throw new Error(`invalid_${key}`)
  }
  return input[key] as T
}

export default class BrandingController {
  async show(ctx: HttpContext) {
    const tenant = await loadTenantOr404(ctx)
    if (!tenant) return
    const svc = await app.container.make(BrandingService)
    const branding = await svc.getForTenant(tenant.id)
    return ctx.response.ok({ data: serialize(branding) })
  }

  async update(ctx: HttpContext) {
    const tenant = await loadTenantOr404(ctx)
    if (!tenant) return

    const body = ctx.request.body()
    let data: BrandingData
    try {
      data = {
        fromName: pickIfDefined<string>(body, 'fromName', (v) => typeof v === 'string'),
        fromEmail: pickIfDefined<string>(body, 'fromEmail', (v) => typeof v === 'string' && /@/.test(v)),
        logoUrl: pickIfDefined<string>(body, 'logoUrl', looksLikeUrl),
        primaryColor: pickIfDefined<string>(body, 'primaryColor', (v) => typeof v === 'string' && HEX_COLOR.test(v)),
        supportUrl: pickIfDefined<string>(body, 'supportUrl', looksLikeUrl),
        emailFooter: pickIfDefined<Record<string, unknown>>(body, 'emailFooter', (v) => typeof v === 'object'),
      }
    } catch (err: any) {
      return ctx.response.badRequest({ error: err.message })
    }

    const svc = await app.container.make(BrandingService)
    const branding = await svc.upsert(tenant.id, data)
    return ctx.response.ok({ data: serialize(branding) })
  }
}
