import app from '@adonisjs/core/services/app'
import type { HttpContext } from '@adonisjs/core/http'
import { TENANT_REPOSITORY } from '../../types/contracts.js'
import type { TenantRepositoryContract, TenantModelContract } from '../../types/contracts.js'

/**
 * Resolve `params.id` to a tenant or short-circuit with a 404. Returns the
 * tenant on success and `null` on failure (the response has already been
 * sent — the caller must `return`).
 */
export async function loadTenantOr404(ctx: HttpContext): Promise<TenantModelContract | null> {
  const repo = (await app.container.make(TENANT_REPOSITORY as any)) as TenantRepositoryContract
  const tenant = await repo.findById(ctx.params.id, true)
  if (!tenant) {
    ctx.response.notFound({ error: 'tenant_not_found' })
    return null
  }
  return tenant
}

export function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

export function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

/**
 * Reject URLs that would let an admin pivot the package's outbound
 * fetcher (webhook delivery, OIDC discovery) at internal infrastructure.
 *
 * Rules:
 *   - scheme MUST be `https:` (no http/file/gopher/ftp/data)
 *   - hostname MUST NOT resolve, syntactically, to loopback, link-local,
 *     RFC 1918 private ranges, or AWS/GCP metadata IPs
 *   - hostname MUST NOT be an IPv6 literal in `::1`/`fc00::/7`/`fe80::/10`
 *
 * Returns `null` if the input is acceptable, or a stable error code if
 * it is rejected. Callers attach the code to a 400 response.
 */
export function validateExternalHttpsUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return 'url_required'
  let u: URL
  try {
    u = new URL(value)
  } catch {
    return 'url_invalid'
  }
  if (u.protocol !== 'https:') return 'url_must_be_https'
  const host = u.hostname.toLowerCase()
  if (host === 'localhost' || host === '0.0.0.0') return 'url_blocks_loopback'

  // IPv4 literal: split on dots, parse octets.
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const [, aS, bS, cS, dS] = v4
    const a = Number(aS)
    const b = Number(bS)
    if ([a, Number(bS), Number(cS), Number(dS)].some((n) => n < 0 || n > 255)) {
      return 'url_invalid_ipv4'
    }
    if (a === 127) return 'url_blocks_loopback'
    if (a === 10) return 'url_blocks_private'
    if (a === 169 && b === 254) return 'url_blocks_link_local' // includes 169.254.169.254 (AWS metadata)
    if (a === 172 && b >= 16 && b <= 31) return 'url_blocks_private'
    if (a === 192 && b === 168) return 'url_blocks_private'
    if (a === 100 && b >= 64 && b <= 127) return 'url_blocks_cgn'
    if (a === 0) return 'url_blocks_reserved'
  }

  // IPv6 literal: hostname is bracketed-stripped by URL parser.
  if (host.includes(':')) {
    if (host === '::1') return 'url_blocks_loopback'
    if (host.startsWith('fc') || host.startsWith('fd')) return 'url_blocks_private'
    if (host.startsWith('fe80')) return 'url_blocks_link_local'
    if (host === '::' || host === '::ffff:0:0') return 'url_blocks_reserved'
  }

  // GCP metadata server hostname. Resolves to 169.254.169.254 but a
  // crafty admin could exploit DNS-rebinding-style tricks if we only
  // checked literals; deny by name as well.
  if (host === 'metadata.google.internal' || host === 'metadata') {
    return 'url_blocks_metadata'
  }

  return null
}
