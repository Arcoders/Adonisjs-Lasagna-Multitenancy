import env from '../start/env.js'
import type { TenantResolverStrategy } from '@adonisjs-lasagna/multitenancy/types'

export default {
  backofficeSchemaName: 'backoffice',
  backofficeConnectionName: 'backoffice',
  centralSchemaName: 'public',
  centralConnectionName: 'public',
  tenantConnectionNamePrefix: 'tenant_',
  tenantSchemaPrefix: 'tenant_',
  resolverStrategy: 'header' as TenantResolverStrategy,
  tenantHeaderKey: env.get('TENANT_HEADER_KEY'),
  baseDomain: 'localhost',
  schemaCacheTtl: 300,
  ignorePaths: ['/health', '/admin', '/api/webhooks'],
  maintenanceSchedule: { backupHour: 2, migrateAllHour: 3 },
  circuitBreaker: { threshold: 50, resetTimeout: 30000, rollingCountTimeout: 10000, volumeThreshold: 2 },
  queue: {
    tenantQueuePrefix: 'tenant_queue_',
    defaultConcurrency: 1,
    attempts: 3,
    redis: {
      host: env.get('QUEUE_REDIS_HOST'),
      port: env.get('QUEUE_REDIS_PORT'),
      db: env.get('QUEUE_REDIS_DB'),
    },
  },
  backup: {
    storagePath: '/tmp/backups',
    metadataTtl: 86400,
    pgConnection: {
      host: env.get('DB_HOST'),
      port: env.get('DB_PORT'),
      user: env.get('DB_USER'),
      password: env.get('DB_PASSWORD', ''),
      database: env.get('DB_DATABASE'),
    },
    s3: {
      enabled: false,
      bucket: '',
      region: 'us-east-1',
      endpoint: '',
      accessKeyId: '',
      secretAccessKey: '',
    },
  },
}
