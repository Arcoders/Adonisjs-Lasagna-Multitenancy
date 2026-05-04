# Deployment guide

This document covers three target environments for an AdonisJS app using `@adonisjs-lasagna/multitenancy`:

1. **Single-VPS / Docker Compose** — recommended for staging or low-volume production.
2. **Kubernetes via Helm** — recommended for multi-region or HA production.
3. **Troubleshooting** — common gotchas around replicas, sticky sessions, and cache coherency.

All artifacts referenced live under [`deploy/`](../deploy/).

---

## 1. Docker Compose

### What you get

[`deploy/docker-compose.prod.yml`](../deploy/docker-compose.prod.yml) brings up:

| Service             | Image                    | Notes                                      |
|---------------------|--------------------------|--------------------------------------------|
| `postgres-primary`  | `postgres:16-alpine`     | `wal_level=replica`, replication user      |
| `postgres-replica`  | `postgres:16-alpine`     | Streaming replica, hot standby             |
| `redis`             | `redis:7-alpine`         | Password-protected, AOF persistence        |
| `app` (×3)          | Built from `deploy/Dockerfile` | Health checks against `/readyz`      |
| `nginx`             | `nginx:1.27-alpine`      | Reverse proxy, JSON access logs            |

### Prerequisites

- Docker 24+ (compose v2)
- ~3 GB RAM available

### First boot

```bash
# 1. Copy and fill env vars
cp deploy/docker-compose.prod.example.env .env
$EDITOR .env  # populate APP_KEY, DB credentials, REDIS_PASSWORD

# 2. Bring everything up
docker compose -f deploy/docker-compose.prod.yml --env-file .env up -d

# 3. Run package migrations the first time
docker compose -f deploy/docker-compose.prod.yml exec app node ace backoffice:setup

# 4. Verify
curl -i http://localhost/healthz
docker compose -f deploy/docker-compose.prod.yml exec app node ace tenant:doctor
```

### Subsequent deploys

```bash
docker compose -f deploy/docker-compose.prod.yml build app
docker compose -f deploy/docker-compose.prod.yml up -d --no-deps app
```

The compose file declares `replicas: 3` so a rolling update keeps at least one app pod serving traffic.

---

## 2. Kubernetes (Helm)

### What you get

The chart at [`deploy/charts/lasagna-app/`](../deploy/charts/lasagna-app/) renders:

- `Deployment` with rolling updates (`maxUnavailable: 0`)
- `Service` (ClusterIP)
- Optional `Ingress` with wildcard support for the subdomain resolver
- Optional `HorizontalPodAutoscaler` (CPU + memory)
- `PodDisruptionBudget` (default: `minAvailable: 1`)
- `Secret` (if not using `app.existingSecret`)

The chart **does not** provision Postgres or Redis — wire those to managed services (RDS, ElastiCache, Cloud SQL, Memorystore, etc.) via values.

### Quick install

```bash
helm install acme deploy/charts/lasagna-app \
  --namespace lasagna --create-namespace \
  -f deploy/charts/lasagna-app/values.production.yaml \
  --set image.tag=v2.0.0 \
  --set app.secrets.APP_KEY="$(openssl rand -hex 32)" \
  --set app.secrets.DB_HOST=pg.acme.internal \
  --set app.secrets.DB_USER=lasagna \
  --set app.secrets.DB_PASSWORD="$DB_PASSWORD" \
  --set app.secrets.DB_DATABASE=lasagna_prod \
  --set app.secrets.REDIS_HOST=redis.acme.internal \
  --set app.secrets.REDIS_PASSWORD="$REDIS_PASSWORD"
```

### Wildcard subdomains (most common multi-tenant case)

When the package's `resolverStrategy` is `subdomain`, you need:

1. **Wildcard DNS:** an `A`/`AAAA` record for `*.app.example.com` pointing at the ingress controller's public IP.
2. **Wildcard cert:** request via `cert-manager` with a DNS-01 issuer. HTTP-01 cannot validate wildcards.
3. **Ingress hosts:** include both apex and wildcard:

   ```yaml
   ingress:
     hosts:
       - host: app.example.com
       - host: "*.app.example.com"
     tls:
       - hosts: [app.example.com, "*.app.example.com"]
         secretName: app-example-com-tls
   ```

### Existing secrets

In production, never inline secret values into Helm. Use [external-secrets-operator](https://external-secrets.io/) or [sealed-secrets](https://github.com/bitnami-labs/sealed-secrets) and reference an existing `Secret`:

```yaml
app:
  existingSecret: lasagna-app-secrets
```

---

## 3. Troubleshooting

### "Cache invalidation drifts between pods"

The package's tenant resolution is cached via BentoCache. Caches default to **per-process** memory unless you wire a Redis store. With multiple pods, you must point BentoCache at Redis (or another shared store) — otherwise pod A invalidates a tenant and pod B keeps serving stale data.

Check `config/multitenancy.ts`: the `cache.redis` block must point at the same Redis instance every pod can reach.

### "Subdomain requests come in with the wrong tenant after deploy"

Likely sticky session mismatch. If you're using sub-domain routing AND your app holds in-memory state per tenant (you shouldn't, but it happens), the load balancer needs to send the same subdomain to the same pod. Configure nginx with `hash $http_host consistent` or add `nginx.ingress.kubernetes.io/upstream-hash-by` annotation.

The right fix is usually to remove the in-memory state — the package is designed to be stateless across pods.

### "Doctor reports `replica_lag_high` after deploy"

Streaming replication takes a few seconds to catch up after WAL writes. If the lag persists for more than 30s under steady traffic:

1. Check `pg_stat_replication` on the primary — is `state = streaming`?
2. Network: replica → primary path may be saturated. The replica needs a low-latency, high-bandwidth connection.
3. The replica may not have enough RAM to apply WAL — check `oom_score` and `top`.

Adjust thresholds in `config/multitenancy.ts`:

```ts
doctor: {
  replicaLagWarnSeconds: 60,
  replicaLagErrorSeconds: 300,
}
```

### "Deploy succeeds but `/readyz` returns 503"

Inspect `node ace tenant:doctor --json` — it runs the same checks `/readyz` aggregates. Common causes:

- DB credentials wrong (read replica check fails)
- Redis unreachable (queue check fails)
- Pending migrations (migration_state check fails)

### "Backups don't run / S3 uploads fail"

The runtime image installs `pg_dump` (`postgresql-client` package) so the `tenant_backup` commands work. Verify with `docker exec <container> which pg_dump`. For S3:

- AWS region + bucket must match
- The pod's IAM role (or `AWS_ACCESS_KEY_ID` env) needs `s3:PutObject` on the bucket
- Network: pods need NAT to `s3.<region>.amazonaws.com`

### "Helm template renders but `kubectl apply` fails"

Run `helm lint` first. If lint passes but the apiserver rejects the manifests, your cluster may be on an older API version. The chart targets:

- `apps/v1` Deployment
- `policy/v1` PodDisruptionBudget (Kubernetes 1.21+)
- `autoscaling/v2` HPA (Kubernetes 1.23+)
- `networking.k8s.io/v1` Ingress (Kubernetes 1.19+)

Cluster older than 1.23? Stay on chart `0.0.x` releases.

---

## Reference: env vars consumed

| Var                    | Source            | Purpose                                |
|------------------------|-------------------|----------------------------------------|
| `APP_KEY`              | secret            | Adonis app secret (signing/encryption) |
| `DB_HOST` / `DB_PORT`  | secret            | Postgres primary                       |
| `DB_USER` / `DB_PASSWORD` / `DB_DATABASE` | secret | Connection credentials       |
| `DB_REPLICA_HOST`      | secret (optional) | Read replica for `tenantReadReplicas`  |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` | secret | Cache + queue + impersonation store |
| `TENANT_HEADER_KEY`    | env               | Header consulted by `header` resolver  |
| `BASE_DOMAIN`          | env               | Apex used by `subdomain` resolver      |
| `RESOLVER_STRATEGY`    | env               | One of `subdomain` / `header` / `path` / `domain-or-subdomain` / `request-data` |
| `LOG_LEVEL`            | env               | Adonis pino level                      |

The exact mapping into your `config/multitenancy.ts` is up to your app — these are conventions used by the deploy artifacts here.
