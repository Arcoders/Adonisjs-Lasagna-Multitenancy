import TenantSsoConfig from '../models/satellites/tenant_sso_config.js'
import redis from '@adonisjs/redis/services/main'
import { randomBytes } from 'node:crypto'

interface OidcDiscovery {
  authorization_endpoint: string
  token_endpoint: string
  userinfo_endpoint: string
}

export default class SsoService {
  async getConfig(tenantId: string): Promise<TenantSsoConfig | null> {
    return TenantSsoConfig.query().where('tenant_id', tenantId).where('enabled', true).first()
  }

  async upsertConfig(
    tenantId: string,
    data: {
      clientId: string
      clientSecret: string
      issuerUrl: string
      redirectUri: string
      scopes?: string[]
    }
  ): Promise<TenantSsoConfig> {
    return TenantSsoConfig.updateOrCreate(
      { tenantId },
      {
        provider: 'oidc',
        clientId: data.clientId,
        clientSecret: data.clientSecret,
        issuerUrl: data.issuerUrl,
        redirectUri: data.redirectUri,
        scopes: data.scopes ?? ['openid', 'email', 'profile'],
        enabled: true,
      }
    )
  }

  async buildAuthUrl(config: TenantSsoConfig): Promise<string> {
    const discovery = await this.discover(config.issuerUrl)
    const state = randomBytes(16).toString('hex')

    await redis.setex(`sso:state:${state}`, 600, config.tenantId)

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      scope: config.scopes.join(' '),
      state,
    })

    return `${discovery.authorization_endpoint}?${params}`
  }

  async handleCallback(
    state: string,
    code: string
  ): Promise<{ tenantId: string; claims: Record<string, unknown> }> {
    const tenantId = await redis.get(`sso:state:${state}`)
    if (!tenantId) throw new Error('Invalid or expired SSO state')
    await redis.del(`sso:state:${state}`)

    const config = await this.getConfig(tenantId)
    if (!config) throw new Error('SSO not configured for this tenant')

    const discovery = await this.discover(config.issuerUrl)

    const tokenRes = await fetch(discovery.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.redirectUri,
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }),
    })

    if (!tokenRes.ok) throw new Error('Token exchange failed')
    const tokens = (await tokenRes.json()) as { access_token: string }

    const userRes = await fetch(discovery.userinfo_endpoint, {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    })

    if (!userRes.ok) throw new Error('Userinfo fetch failed')
    const claims = (await userRes.json()) as Record<string, unknown>

    return { tenantId, claims }
  }

  private async discover(issuerUrl: string): Promise<OidcDiscovery> {
    const base = issuerUrl.replace(/\/$/, '')
    const res = await fetch(`${base}/.well-known/openid-configuration`)
    if (!res.ok) throw new Error(`OIDC discovery failed for ${issuerUrl}`)
    return res.json() as Promise<OidcDiscovery>
  }
}
