import { readFile, access } from 'node:fs/promises'
import logger from '@adonisjs/core/services/logger'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { TenantModelContract } from '../types/contracts.js'
import { splitSqlStatementsTagged } from '../utils/sql_splitter.js'

export interface SqlImportOptions {
  sourceSchema: string
  dryRun: boolean
}

export interface SqlImportResult {
  statementsTotal: number
  statementsExecuted: number
  statementsSkipped: number
  copyBlocksExecuted: number
  copyRowsImported: number
  errors: Array<{ statement: string; message: string }>
}

const SKIP_PATTERNS = [
  /^SET\s+search_path/i,
  /^SELECT\s+pg_catalog\.set_config\s*\(\s*'search_path'/i,
  /^\\[a-z]/i,
]

class CopyStreamUnavailableError extends Error {
  constructor() {
    super(
      'This dump uses `COPY … FROM stdin`, which requires the `pg-copy-streams` package. ' +
        'Install it with `npm i pg-copy-streams`, or re-export the dump with `pg_dump --inserts` ' +
        'so rows are emitted as INSERT statements.'
    )
    this.name = 'CopyStreamUnavailableError'
  }
}

export default class SqlImportService {
  async import(
    tenant: TenantModelContract,
    filePath: string,
    options: SqlImportOptions
  ): Promise<SqlImportResult> {
    await access(filePath)

    const raw = await readFile(filePath, 'utf-8')
    const transformed = this.#rewriteSchema(raw, options.sourceSchema, tenant.schemaName)
    const tokens = splitSqlStatementsTagged(transformed)

    const result: SqlImportResult = {
      statementsTotal: tokens.length,
      statementsExecuted: 0,
      statementsSkipped: 0,
      copyBlocksExecuted: 0,
      copyRowsImported: 0,
      errors: [],
    }

    if (options.dryRun) {
      for (const token of tokens) {
        if (token.kind === 'copy') {
          result.copyBlocksExecuted++
          result.copyRowsImported += token.rows.length
        } else if (this.#shouldSkip(token.text)) {
          result.statementsSkipped++
        } else {
          result.statementsExecuted++
        }
      }
      return result
    }

    const hasCopyBlocks = tokens.some((t) => t.kind === 'copy')
    let copyFromFn: ((q: string) => any) | null = null
    if (hasCopyBlocks) {
      copyFromFn = await this.#loadCopyFrom()
      if (!copyFromFn) {
        throw new CopyStreamUnavailableError()
      }
    }

    const connection = tenant.getConnection()

    logger.info(
      { tenantId: tenant.id, schema: tenant.schemaName, filePath, total: tokens.length },
      'Starting SQL import'
    )

    await connection.transaction(async (trx: TransactionClientContract) => {
      await trx.rawQuery(`SET LOCAL session_replication_role = replica`)

      let spIndex = 0

      for (const token of tokens) {
        if (token.kind === 'copy') {
          const sp = `_import_sp_${spIndex++}`
          await trx.rawQuery(`SAVEPOINT ${sp}`)
          try {
            await this.#runCopyBlock(trx, token.header, token.rows, copyFromFn!)
            await trx.rawQuery(`RELEASE SAVEPOINT ${sp}`)
            result.copyBlocksExecuted++
            result.copyRowsImported += token.rows.length
          } catch (err: any) {
            await trx.rawQuery(`ROLLBACK TO SAVEPOINT ${sp}`)
            await trx.rawQuery(`RELEASE SAVEPOINT ${sp}`)
            result.errors.push({
              statement: token.header.slice(0, 200),
              message: err.message ?? String(err),
            })
            logger.warn({ header: token.header.slice(0, 120), err: err.message }, 'COPY block failed')
          }
          continue
        }

        const stmt = token.text
        if (this.#shouldSkip(stmt)) {
          result.statementsSkipped++
          continue
        }

        const sp = `_import_sp_${spIndex++}`
        await trx.rawQuery(`SAVEPOINT ${sp}`)

        try {
          await trx.rawQuery(stmt)
          await trx.rawQuery(`RELEASE SAVEPOINT ${sp}`)
          result.statementsExecuted++
        } catch (err: any) {
          await trx.rawQuery(`ROLLBACK TO SAVEPOINT ${sp}`)
          await trx.rawQuery(`RELEASE SAVEPOINT ${sp}`)
          result.errors.push({
            statement: stmt.slice(0, 200),
            message: err.message ?? String(err),
          })
          logger.warn({ stmt: stmt.slice(0, 120), err: err.message }, 'Statement failed')
        }
      }

      await trx.rawQuery(`SET LOCAL session_replication_role = DEFAULT`)
    })

    logger.info(
      {
        tenantId: tenant.id,
        executed: result.statementsExecuted,
        skipped: result.statementsSkipped,
        copyBlocks: result.copyBlocksExecuted,
        copyRows: result.copyRowsImported,
        errors: result.errors.length,
      },
      'SQL import complete'
    )

    return result
  }

  async #loadCopyFrom(): Promise<((q: string) => any) | null> {
    try {
      // @ts-ignore — pg-copy-streams is an optional peer dependency
      const mod: any = await import('pg-copy-streams')
      return mod.from ?? mod.default?.from ?? null
    } catch {
      return null
    }
  }

  async #runCopyBlock(
    trx: TransactionClientContract,
    header: string,
    rows: string[],
    copyFromFn: (q: string) => any
  ): Promise<void> {
    const pgClient = (trx as any).knexClient?.client ?? (trx as any).client?.client
    if (!pgClient) {
      throw new Error('Could not access raw pg client from Lucid transaction for COPY streaming')
    }
    const stream = pgClient.query(copyFromFn(header))
    await new Promise<void>((resolve, reject) => {
      stream.on('error', reject)
      stream.on('finish', resolve)
      for (const row of rows) {
        stream.write(`${row}\n`)
      }
      stream.end()
    })
  }

  #rewriteSchema(sql: string, source: string, target: string): string {
    const escapedSource = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const quotedTarget = `"${target}".`

    sql = sql.replace(new RegExp(`"${escapedSource}"\\.`, 'g'), quotedTarget)
    sql = sql.replace(new RegExp(`\\b${escapedSource}\\.`, 'g'), quotedTarget)

    return sql
  }

  #shouldSkip(stmt: string): boolean {
    return SKIP_PATTERNS.some((p) => p.test(stmt.trimStart()))
  }
}
