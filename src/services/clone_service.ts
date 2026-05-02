import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import type {
  QueryClientContract,
  TransactionClientContract,
} from '@adonisjs/lucid/types/database'
import { getConfig } from '../config.js'
import type { TenantModelContract } from '../types/contracts.js'

export interface CloneOptions {
  schemaOnly: boolean
  clearSessions: boolean
}

export interface CloneResult {
  source: TenantModelContract
  destination: TenantModelContract
  tablesCopied: number
  rowsCopied: number
}

const MIGRATION_TABLES = new Set(['adonis_schema', 'adonis_schema_versions'])

export default class CloneService {
  async clone(
    source: TenantModelContract,
    destination: TenantModelContract,
    options: CloneOptions
  ): Promise<CloneResult> {
    logger.info({ sourceId: source.id, destId: destination.id, options }, 'Starting tenant clone')

    try {
      await destination.install()

      // `install()` creates the schema and the connection but doesn't run
      // tenant migrations. Run them now so the destination has the same DDL
      // as the source before we copy rows into it.
      await destination.migrate({ direction: 'up' })

      let tablesCopied = 0
      let rowsCopied = 0

      if (!options.schemaOnly) {
        const result = await this.#copyData(source, destination, options)
        tablesCopied = result.tablesCopied
        rowsCopied = result.rowsCopied
      }

      logger.info(
        { sourceId: source.id, destId: destination.id, tablesCopied, rowsCopied },
        'Tenant clone completed'
      )

      return { source, destination, tablesCopied, rowsCopied }
    } catch (error) {
      destination.status = 'failed'
      await destination.save()
      await destination.invalidateCache()

      await destination.dropSchemaIfExists().catch((dropErr) => {
        logger.error(
          { destId: destination.id, err: dropErr.message },
          'Failed to drop orphaned schema'
        )
      })

      logger.error(
        { sourceId: source.id, destId: destination.id, error: error.message },
        'Clone failed'
      )
      throw error
    }
  }

  async #copyData(
    source: TenantModelContract,
    dest: TenantModelContract,
    options: Pick<CloneOptions, 'clearSessions'>
  ): Promise<{ tablesCopied: number; rowsCopied: number }> {
    const srcSchema = source.schemaName
    const dstSchema = dest.schemaName

    // Run cross-schema operations on the central connection rather than the
    // default. The default connection is the per-tenant template that gets
    // cloned by the package at runtime; using it for one-off queries was
    // flaky on Linux runners where the connection state resets between
    // statements. The central connection is a stable, app-owned pool with
    // full database access.
    const conn = db.connection(getConfig().centralConnectionName)

    const tables = await this.#getTableNames(srcSchema, conn)
    const copyable = tables.filter((t) => !MIGRATION_TABLES.has(t))

    let rowsCopied = 0

    await conn.transaction(async (trx) => {
      await trx.rawQuery(`SET LOCAL session_replication_role = replica`)

      for (const table of copyable) {
        const result = await trx.rawQuery(
          `INSERT INTO "${dstSchema}"."${table}" SELECT * FROM "${srcSchema}"."${table}"`
        )
        rowsCopied += (result as any).rowCount ?? 0
      }

      await trx.rawQuery(`SET LOCAL session_replication_role = DEFAULT`)

      if (options.clearSessions) {
        await this.#clearAccessTokens(trx, dstSchema)
      }

      await this.#resetIntegerSequences(trx, dstSchema, copyable)
    })

    return { tablesCopied: copyable.length, rowsCopied }
  }

  async #getTableNames(schema: string, conn?: QueryClientContract): Promise<string[]> {
    const runner = conn ?? db
    const result = await runner.rawQuery(
      `SELECT tablename FROM pg_tables WHERE schemaname = ? ORDER BY tablename`,
      [schema]
    )
    return result.rows.map((r: { tablename: string }) => r.tablename)
  }

  async #resetIntegerSequences(
    trx: TransactionClientContract,
    schema: string,
    tables: string[]
  ): Promise<void> {
    for (const table of tables) {
      try {
        await trx.rawQuery(
          `DO $$
           DECLARE
             seq text;
           BEGIN
             seq := pg_get_serial_sequence(format('%I.%I', $1::text, $2::text), 'id');
             IF seq IS NOT NULL THEN
               EXECUTE format(
                 'SELECT setval(%L, COALESCE((SELECT MAX(id) FROM %I.%I), 1))',
                 seq, $1::text, $2::text
               );
             END IF;
           END $$`,
          [schema, table]
        )
      } catch {
        /* table has no integer id column */
      }
    }
  }

  async #clearAccessTokens(trx: TransactionClientContract, schema: string): Promise<void> {
    try {
      await trx.rawQuery(`TRUNCATE TABLE "${schema}"."auth_access_tokens"`)
    } catch {
      /* table may not exist */
    }
  }
}
