import { getConfig } from '../config.js'
import type { TenantModelContract } from '../types/contracts.js'
import type { HttpRequest } from '@adonisjs/core/http'

export interface BuildUrlOptions {
  /**
   * Preserve query string from the source request when called via
   * `fromRequest()`. Default: false.
   */
  preserveQuery?: boolean
  /**
   * Override the protocol (http / https). Defaults to the request's protocol
   * when going through `fromRequest()`, otherwise `https`.
   */
  protocol?: 'http' | 'https'
  /**
   * Force a port suffix (e.g. `3333`). Defaults to no explicit port (relies
   * on the protocol's default).
   */
  port?: number
}

/**
 * Build absolute URLs that bridge the central domain and tenant subdomains
 * (or custom domains). The hostname strategy is read from
 * `MultitenancyConfig.baseDomain`; when a tenant has a `customDomain`, that
 * takes precedence over the subdomain form.
 *
 * This service does NOT perform redirects itself — it constructs the URL
 * string, leaving the call site to use `response.redirect(url)` or whatever
 * mechanism is appropriate.
 */
export default class CrossDomainRedirectService {
  /** Build a URL that lands the user on the given tenant's host. */
  toTenant(
    tenant: TenantModelContract,
    path: string,
    opts: BuildUrlOptions = {}
  ): string {
    const host = tenant.customDomain ?? this.toTenantSubdomainHost(tenant.id)
    return this.#assemble(host, path, opts)
  }

  /** Build a URL on the central (apex / non-tenant) host. */
  toCentral(path: string, opts: BuildUrlOptions = {}): string {
    return this.#assemble(this.#baseDomain(), path, opts)
  }

  /**
   * Build a URL on a tenant subdomain when only the slug/id is available,
   * without loading the model. Useful in signup flows where the tenant has
   * just been created and you only have the id / slug to hand.
   */
  toTenantSubdomain(slug: string, path: string, opts: BuildUrlOptions = {}): string {
    return this.#assemble(this.toTenantSubdomainHost(slug), path, opts)
  }

  /**
   * Convenience: redirect-style URL builder that mirrors the protocol/port
   * of the current request. Pass `preserveQuery: true` to forward the
   * source request's query string onto the destination path.
   */
  fromRequest(
    request: HttpRequest,
    target: { tenant: TenantModelContract; path: string } | { central: true; path: string },
    opts: BuildUrlOptions = {}
  ): string {
    const protocol = (opts.protocol ?? request.protocol()) as 'http' | 'https'
    const merged: BuildUrlOptions = { ...opts, protocol }
    let path = 'tenant' in target ? target.path : target.path
    if (opts.preserveQuery) {
      const qs = request.parsedUrl?.query
      if (qs && typeof qs === 'string' && qs.length > 0) {
        path = path.includes('?') ? `${path}&${qs}` : `${path}?${qs}`
      }
    }
    if ('central' in target) return this.toCentral(path, merged)
    return this.toTenant(target.tenant, path, merged)
  }

  /** Hostname for a tenant's subdomain on the configured base domain. */
  toTenantSubdomainHost(slug: string): string {
    const base = this.#baseDomain()
    return `${slug}.${base}`
  }

  #baseDomain(): string {
    const cfg = getConfig()
    return cfg.baseDomain
  }

  #assemble(host: string, path: string, opts: BuildUrlOptions): string {
    const protocol = opts.protocol ?? 'https'
    const portSuffix = opts.port ? `:${opts.port}` : ''
    const normalizedPath = path.startsWith('/') ? path : `/${path}`
    return `${protocol}://${host}${portSuffix}${normalizedPath}`
  }
}
