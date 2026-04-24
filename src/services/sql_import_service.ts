import { readFile, access } from 'node:fs/promises'
import logger from '@adonisjs/core/services/logger'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { TenantModelContract } from '../types/contracts.js'
import { splitSqlStatements } from '../utils/sql_splitter.js'

export interface SqlImportOptions {
  sourceSchema: string
  dryRun: boolean
}

export interface SqlImportResult {
  statementsTotal: number
  statementsExecuted: number
  statementsSkipped: number
  errors: Array<{ statement: string; message: string }>
}

const SKIP_PATTERNS = [
  /^SET\s+search_path/i,
  /^SELECT\s+pg_catalog\.set_config\s*\(\s*'search_path'/i,
  /^\\[a-z]/i,
]

export default class SqlImportService {
  async import(
    tenant: TenantModelContract,
    filePath: string,
    options: SqlImportOptions
  ): Promise<SqlImportResult> {
    await access(filePath)

    const raw = await readFile(filePath, 'utf-8')
    const transformed = this.#rewriteSchema(raw, options.sourceSchema, tenant.schemaName)
    const statements = splitSqlStatements(transformed)

    const result: SqlImportResult = {
      statementsTotal: statements.length,
      statementsExecuted: 0,
      statementsSkipped: 0,
      errors: [],
    }

    if (options.dryRun) {
      for (const stmt of statements) {
        if (this.#shouldSkip(stmt)) {
          result.statementsSkipped++
        } else {
          result.statementsExecuted++
        }
      }
      return result
    }

    const connection = tenant.getConnection()

    logger.info(
      { tenantId: tenant.id, schema: tenant.schemaName, filePath, total: statements.length },
      'Starting SQL import'
    )

    await connection.transaction(async (trx: TransactionClientContract) => {
      await trx.rawQuery(`SET LOCAL session_replication_role = replica`)

      let spIndex = 0

      for (const stmt of statements) {
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
        errors: result.errors.length,
      },
      'SQL import complete'
    )

    return result
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
