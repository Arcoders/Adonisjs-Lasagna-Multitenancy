import { spawn } from 'node:child_process'
import { mkdir, unlink, stat } from 'node:fs/promises'
import { join } from 'node:path'
import redis from '@adonisjs/redis/services/main'
import logger from '@adonisjs/core/services/logger'
import { getConfig } from '../config.js'
import type { TenantModelContract } from '../types/contracts.js'

export interface BackupMetadata {
  file: string
  size: number
  timestamp: string
  tenantId: string
  schema: string
}

const FILE_PATTERN = /^[a-z0-9_-]+\.dump$/

export default class BackupService {
  private getBackupDir(tenantId: string): string {
    return join(getConfig().backup.storagePath, tenantId)
  }

  private metaKey(tenantId: string): string {
    return `backup:meta:${tenantId}`
  }

  private buildConnectionArgs(): string[] {
    const { host, port, user, database } = getConfig().backup.pgConnection
    return ['-h', host, '-p', String(port), '-U', user, '-d', database]
  }

  async backup(tenant: TenantModelContract): Promise<BackupMetadata> {
    const schema = tenant.schemaName
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const fileName = `tenant_${tenant.id}_${timestamp}.dump`
    const dir = this.getBackupDir(tenant.id)

    await mkdir(dir, { recursive: true })

    const filePath = join(dir, fileName)
    const args = [
      ...this.buildConnectionArgs(),
      '--format=custom',
      `--schema=${schema}`,
      '--compress=9',
      '--file',
      filePath,
    ]

    await this.#runProcess('pg_dump', args, {
      PGPASSWORD: getConfig().backup.pgConnection.password,
    })

    const { size } = await stat(filePath)

    const meta: BackupMetadata = {
      file: fileName,
      size,
      timestamp: new Date().toISOString(),
      tenantId: tenant.id,
      schema,
    }

    await this.#saveMetadata(tenant.id, meta)
    logger.info({ tenantId: tenant.id, file: fileName, size }, 'Backup completed')
    return meta
  }

  async restore(tenant: TenantModelContract, fileName: string): Promise<void> {
    if (!FILE_PATTERN.test(fileName)) {
      throw new Error(`Invalid backup file name: ${fileName}`)
    }

    const schema = tenant.schemaName
    const filePath = join(this.getBackupDir(tenant.id), fileName)

    const args = [
      ...this.buildConnectionArgs(),
      '--format=custom',
      `--schema=${schema}`,
      '--clean',
      '--if-exists',
      filePath,
    ]

    await this.#runProcess('pg_restore', args, {
      PGPASSWORD: getConfig().backup.pgConnection.password,
    })
    logger.info({ tenantId: tenant.id, file: fileName }, 'Restore completed')
  }

  async listBackups(tenantId: string): Promise<BackupMetadata[]> {
    return this.#loadMetadata(tenantId)
  }

  async deleteBackup(tenantId: string, fileName: string): Promise<void> {
    if (!FILE_PATTERN.test(fileName)) {
      throw new Error(`Invalid backup file name: ${fileName}`)
    }

    const filePath = join(this.getBackupDir(tenantId), fileName)
    await unlink(filePath).catch(() => {})

    const list = await this.#loadMetadata(tenantId)
    const updated = list.filter((m) => m.file !== fileName)
    await redis.set(this.metaKey(tenantId), JSON.stringify(updated))
  }

  async #saveMetadata(tenantId: string, meta: BackupMetadata): Promise<void> {
    const list = await this.#loadMetadata(tenantId)
    list.unshift(meta)
    const capped = list.slice(0, 30)
    await redis.setex(
      this.metaKey(tenantId),
      getConfig().backup.metadataTtl,
      JSON.stringify(capped)
    )
  }

  async #loadMetadata(tenantId: string): Promise<BackupMetadata[]> {
    try {
      const raw = await redis.get(this.metaKey(tenantId))
      return raw ? (JSON.parse(raw) as BackupMetadata[]) : []
    } catch {
      return []
    }
  }

  #runProcess(command: string, args: string[], processEnv: Record<string, string>): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, {
        env: { ...process.env, ...processEnv },
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      const stderr: string[] = []
      proc.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk.toString()))

      proc.on('close', (code) => {
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`${command} exited with code ${code}: ${stderr.join('')}`))
        }
      })

      proc.on('error', reject)
    })
  }
}
