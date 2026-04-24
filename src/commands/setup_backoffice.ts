import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import db from '@adonisjs/lucid/services/db'
import { getConfig } from '../config.js'

export default class SetupBackoffice extends BaseCommand {
  static readonly commandName = 'backoffice:setup'
  static readonly description = 'Create backoffice schema in database'
  static readonly options: CommandOptions = { startApp: true }

  async run() {
    const { backofficeSchemaName } = getConfig()
    await db.rawQuery(`CREATE SCHEMA IF NOT EXISTS "${backofficeSchemaName}"`)
    this.logger.success(`Schema "${backofficeSchemaName}" is ready.`)
  }
}
