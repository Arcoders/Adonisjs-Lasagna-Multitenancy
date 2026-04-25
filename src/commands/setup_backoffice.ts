import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import db from '@adonisjs/lucid/services/db'
import app from '@adonisjs/core/services/app'
import { getConfig } from '../config.js'

export default class SetupBackoffice extends BaseCommand {
  static readonly commandName = 'backoffice:setup'
  static readonly description = 'Create backoffice schema and run its migrations'
  static readonly options: CommandOptions = { startApp: true }

  async run() {
    const { backofficeSchemaName, backofficeConnectionName } = getConfig()

    await db.rawQuery(`CREATE SCHEMA IF NOT EXISTS "${backofficeSchemaName}"`)
    this.logger.success(`Schema "${backofficeSchemaName}" is ready.`)

    const { MigrationRunner } = await import('@adonisjs/lucid/migration')
    const migrator = new MigrationRunner(db, app, {
      direction: 'up',
      connectionName: backofficeConnectionName,
    })

    await migrator.run()

    if (migrator.status === 'error') {
      this.logger.error('Backoffice migration failed')
      this.exitCode = 1
      return
    }

    this.logger.success('Backoffice migrations applied.')
  }
}
