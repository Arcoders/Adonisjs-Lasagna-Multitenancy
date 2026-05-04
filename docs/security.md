# Security hardening guide

This document describes the security boundaries the package enforces, the
boundaries it leaves to the host application, and the recommended hardening
steps for a production deployment.

## What the package guarantees

The following invariants are enforced inside the package and covered by
tests. You can rely on them without extra wiring.

### Tenant identifier validation

Every code path that consumes a tenant id (SQL DDL, Drive prefix, cache
namespace, session key, mail header, broadcast channel) routes through
`assertSafeIdentifier()` ([src/services/isolation/identifier.ts](../src/services/isolation/identifier.ts))
before the value reaches a sensitive sink. The contract is:

- Length ≤ 63 (PostgreSQL `NAMEDATALEN - 1`).
- Character class: `[a-zA-Z0-9_-]` only.
- UUID v4 always passes; the canonical id format the package generates is
  RFC-4122 v4 from `node:crypto.randomUUID()`.

Anything else — `..`, `/`, `\`, `;`, `"`, whitespace, shell metacharacters,
percent-encoded sequences — is rejected with a `Refusing to use unsafe …`
exception. There is no escape hatch and no per-tenant override.

`resolveTenantId()` ([src/extensions/request.ts](../src/extensions/request.ts))
additionally validates the canonical UUID v4 format before any cache or DB
access keyed by the resolved id.

### SQL injection

Tenant ids are interpolated only into quoted identifier slots
(`"tenant_<uuid>"`) and only after passing `assertSafeIdentifier`. Tenant
metadata, names, emails, and other free-form fields are written via Lucid's
parameterized queries. Search the codebase for `rawQuery(` — every usage is
either a constant string or interpolates a value that has been hard-validated
as a safe identifier first.

### HMAC-signed tokens

`ImpersonationService` and `WebhookService` both:

- Sign with HMAC-SHA256 over a fixed-size payload.
- Verify with `crypto.timingSafeEqual()` to defeat timing-based oracle
  attacks.
- Refuse to issue when the configured secret is shorter than 32 chars.

The impersonation secret is also validated at provider boot — a misconfigured
deploy fails fast on startup, not on the first admin request.

### Webhook delivery

Outbound webhooks include `x-webhook-signature: sha256=<hex>` computed over
the raw body using the per-subscription secret. The secret is encrypted at
rest with `AES-256-GCM` keyed by `APP_KEY`. The wire format and verification
recipe are documented in the README and OpenAPI spec.

### SSO / OIDC

`SsoService.handleCallback()` performs full OIDC verification:

1. State is generated with `randomBytes(16)`, single-use, 600 s TTL.
2. Nonce is generated with `randomBytes(16)`, bound to the state, included
   as a parameter on the auth URL.
3. The token endpoint must return an `id_token`.
4. The `id_token` is verified against the IdP's JWKS (fetched via
   discovery + cached 1 h).
5. `iss`, `aud`, and `exp` are checked by `jose.jwtVerify` (60 s clock
   tolerance).
6. `nonce` in the `id_token` payload must match the value bound to state.

Any mismatch throws and aborts the callback before claims are surfaced.

### Tenant enumeration

`TenantNotFoundException` is the same exception path whether the tenant
literally does not exist or the request was unauthorized for an existing
tenant. There is no observable difference in the response that lets an
attacker enumerate ids, names, or domains.

### Cache, Drive, session, mail prefixing

Every per-tenant key is namespaced with `tenants/<tenant.id>/` (Drive,
session) or a dedicated cache namespace (`branding`, `sso`, `oidc:discovery`,
…). Identifiers pass `assertSafeIdentifier` before forming the key.

## What the host application owns

The package does not, and cannot, control these surfaces. They are
production-required and need to be configured at the host level.

### Transport hardening

- **HSTS**: serve `Strict-Transport-Security: max-age=31536000;
  includeSubDomains` from the AdonisJS server. Subdomain-based tenant
  resolution amplifies the cost of any single TLS lapse.
- **TLS termination**: terminate at the load balancer / Ingress, not the
  Node process. The Helm chart in this repo configures
  `nginx.ingress.kubernetes.io/ssl-redirect: "true"` by default.

### Response headers (recommended)

Add a small middleware in the host app that sets:

```ts
// app/middleware/security_headers_middleware.ts
export default class SecurityHeadersMiddleware {
  async handle(ctx, next) {
    ctx.response.header('x-content-type-options', 'nosniff')
    ctx.response.header('x-frame-options', 'DENY')
    ctx.response.header('referrer-policy', 'strict-origin-when-cross-origin')
    ctx.response.header(
      'permissions-policy',
      'geolocation=(), microphone=(), camera=()'
    )
    // Adjust to the actual asset domains served by the tenant.
    ctx.response.header(
      'content-security-policy',
      "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'"
    )
    await next()
  }
}
```

Register it as global in `start/kernel.ts`. The package itself does not
enforce CSP because content sources vary per tenant.

### Webhook receivers

The package signs outbound webhooks; receivers must:

- Verify the signature with their configured secret using a
  constant-time comparison.
- Apply rate-limiting at the receiver — the package times out at 10 s but
  does not throttle per-endpoint outbound requests.
- Reject requests older than a small window (use the `x-webhook-delivery-id`
  + a database log on the receiver to defeat replay).

### Admin REST API

`/admin/multitenancy/*` routes are gated only by an `x-admin-token` header
checked against `config.adminToken`. The package does **not** add IP
allow-listing, mTLS, or auth integration. In production:

- Restrict the route group to a private network.
- Or, if exposed publicly, layer the host app's auth (Bouncer / Auth) in
  front of the admin route group via `Route.group(...).use([...])`.

### Database credentials

Tenant DB credentials live in the host app's environment. They are NEVER
logged by the package — verified by spot-check on `logger.info`,
`console.log`, `JSON.stringify`. Avoid committing them to the repo; use a
secret manager (Vault, AWS Secrets Manager, GCP Secret Manager, k8s
sealed-secrets).

## Operational hardening

### CI gates that ship with this repo

`.github/workflows/ci.yml` enforces on every PR:

- `npm run typecheck`
- `npm run knip` — surfaces unused exports / orphaned files.
- `npm run audit:prod` — fails on production-dep advisories of severity
  `high` or higher.
- Unit + integration tests against real PostgreSQL + Redis.
- Demo app E2E suite with all bootstrappers (mail, queue, drive) wired.

Mirror the equivalent gates in your downstream CI before publishing
container images.

### Recommended runtime monitoring

- Prometheus: scrape `/metrics`. Alert on
  `multitenancy_circuit_state{state="OPEN"}`,
  `multitenancy_provisioning_failures_total`, and replica-lag exceeding
  threshold.
- OpenTelemetry: the package ships spans for every tenant-scoped DB
  query, queue dispatch, and bootstrapper enter/leave. Forward to your
  APM and alert on per-tenant latency outliers — they tend to predict
  cache stampedes and connection pool exhaustion.
- Audit log: enable the `audit` satellite (`node ace configure
  @adonisjs-lasagna/multitenancy --with=audit`) and ship the
  `tenant_audit_logs` table to a long-term store. The admin REST API
  exposes a `from`/`to` date-range query that uses an index on
  `(tenant_id, created_at)` instead of OFFSET.

### Backup and recovery

`tenant:backup` writes a `.dump` file plus a JSON sidecar with checksums.
For production:

- Mirror to S3 with `config.backup.s3.enabled = true`. The bucket SHOULD
  have versioning enabled and a lifecycle policy that defers permanent
  delete behind your retention tier.
- Run `tenant:doctor --check=backups` weekly — it flags tenants whose
  last successful backup is older than the retention tier's
  `intervalHours`.
- Practice restore at least quarterly. `tenant:restore --tenant=<id>
  --file=<path>` round-trips the schema; verify the row count matches
  the source.

## Reporting a vulnerability

Security issues should not be reported as public GitHub issues. Email
the maintainer at the address listed in `package.json` `author`. Include:

- Affected version (`package.json` `version`).
- Reproduction steps and a proof-of-concept payload if possible.
- Impact assessment (confidentiality, integrity, availability).

Acknowledged reports get a CVE assignment and a coordinated release.
