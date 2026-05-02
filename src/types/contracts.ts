import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { MigratorOptions } from '@adonisjs/lucid/types/migrator'
import type { DateTime } from 'luxon'

export const TENANT_REPOSITORY = Symbol('TENANT_REPOSITORY')

export type TenantStatus = 'provisioning' | 'active' | 'suspended' | 'failed' | 'deleted'

/**
 * Default shape of the optional `metadata` field on a tenant model. Apps
 * can pass a stricter type via the `TMeta` generic to get end-to-end
 * type safety, e.g. `TenantModelContract<{ plan: 'free' | 'pro' }>`.
 */
export type TenantMetadata = Record<string, unknown>

export interface TenantModelContract<TMeta extends object = TenantMetadata> {
  readonly id: string
  name: string
  email: string
  status: TenantStatus
  customDomain: string | null
  createdAt: DateTime
  deletedAt: DateTime | null
  /** Optional structured metadata. Type via the `TMeta` generic. */
  metadata?: TMeta
  readonly schemaName: string
  readonly isActive: boolean
  readonly isSuspended: boolean
  readonly isProvisioning: boolean
  readonly isFailed: boolean
  readonly isDeleted: boolean
  getConnection(): QueryClientContract
  /**
   * Optional: when implemented, returns a Lucid client routed to a read
   * replica. Apps typically wire this up via `ReadReplicaService.resolve(this)`.
   * Without read replicas configured, callers should fall back to
   * `getConnection()`.
   */
  getReadConnection?(): QueryClientContract | Promise<QueryClientContract>
  closeConnection(): Promise<void>
  migrate(options: Omit<MigratorOptions, 'connectionName'>): Promise<any>
  install(): Promise<void>
  uninstall(): Promise<void>
  suspend(): Promise<void>
  activate(): Promise<void>
  invalidateCache(): Promise<void>
  dropSchemaIfExists(): Promise<void>
  save(): Promise<TenantModelContract<TMeta>>
}

export interface TenantRepositoryContract<TMeta extends object = TenantMetadata> {
  findById(id: string, includeDeleted?: boolean): Promise<TenantModelContract<TMeta> | null>
  findByIdOrFail(id: string, includeDeleted?: boolean): Promise<TenantModelContract<TMeta>>
  findByDomain(domain: string): Promise<TenantModelContract<TMeta> | null>
  all(options?: {
    includeDeleted?: boolean
    statuses?: TenantStatus[]
  }): Promise<TenantModelContract<TMeta>[]>
  whereIn(ids: string[], includeDeleted?: boolean): Promise<TenantModelContract<TMeta>[]>
  create(data: {
    name: string
    email: string
    status: TenantStatus
  }): Promise<TenantModelContract<TMeta>>
}

declare module '@adonisjs/core/types' {
  interface ContainerBindings {
    [TENANT_REPOSITORY]: TenantRepositoryContract
  }
}
