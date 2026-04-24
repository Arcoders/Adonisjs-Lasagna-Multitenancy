import TenantAuditLog, { type AuditActorType } from '../models/satellites/tenant_audit_log.js'

export interface LogActionOptions {
  tenantId?: string | null
  actorType?: AuditActorType
  actorId?: string | null
  action: string
  metadata?: Record<string, unknown>
  ipAddress?: string | null
}

export default class AuditLogService {
  async log(options: LogActionOptions): Promise<TenantAuditLog> {
    return TenantAuditLog.create({
      tenantId: options.tenantId ?? null,
      actorType: options.actorType ?? 'system',
      actorId: options.actorId ?? null,
      action: options.action,
      metadata: options.metadata ?? null,
      ipAddress: options.ipAddress ?? null,
    })
  }

  async listForTenant(tenantId: string, page = 1, limit = 50) {
    const paginator = await TenantAuditLog.query()
      .where('tenant_id', tenantId)
      .orderBy('created_at', 'desc')
      .paginate(page, Math.min(limit, 200))
    return paginator.serialize()
  }
}
