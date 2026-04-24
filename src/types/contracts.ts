import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { MigratorOptions } from '@adonisjs/lucid/types/migrator'
import type { DateTime } from 'luxon'

export const TENANT_REPOSITORY = Symbol('TENANT_REPOSITORY')

export type TenantStatus = 'provisioning' | 'active' | 'suspended' | 'failed'

export interface TenantModelContract {
  readonly id: string
  name: string
  email: string
  status: TenantStatus
  customDomain: string | null
  createdAt: DateTime
  deletedAt: DateTime | null
  readonly schemaName: string
  readonly isActive: boolean
  readonly isSuspended: boolean
  readonly isProvisioning: boolean
  readonly isFailed: boolean
  readonly isDeleted: boolean
  getConnection(): QueryClientContract
  closeConnection(): Promise<void>
  migrate(options: Omit<MigratorOptions, 'connectionName'>): Promise<any>
  install(): Promise<void>
  uninstall(): Promise<void>
  suspend(): Promise<void>
  activate(): Promise<void>
  invalidateCache(): Promise<void>
  dropSchemaIfExists(): Promise<void>
  save(): Promise<TenantModelContract>
}

export interface TenantRepositoryContract {
  findById(id: string, includeDeleted?: boolean): Promise<TenantModelContract | null>
  findByIdOrFail(id: string, includeDeleted?: boolean): Promise<TenantModelContract>
  findByDomain(domain: string): Promise<TenantModelContract | null>
  all(options?: { includeDeleted?: boolean; statuses?: TenantStatus[] }): Promise<TenantModelContract[]>
  whereIn(ids: string[], includeDeleted?: boolean): Promise<TenantModelContract[]>
  create(data: { name: string; email: string; status: TenantStatus }): Promise<TenantModelContract>
}
