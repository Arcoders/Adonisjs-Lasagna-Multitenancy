import type Configure from '@adonisjs/core/commands/configure'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { access } from 'node:fs/promises'

const stubsRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'stubs')

const SATELLITE_MIGRATIONS = [
  'create_tenant_audit_logs_table',
  'create_tenant_feature_flags_table',
  'create_tenant_webhooks_table',
  'create_tenant_webhook_deliveries_table',
  'create_tenant_brandings_table',
  'create_tenant_sso_configs_table',
  'create_tenant_metrics_table',
]

export default async function configure(command: Configure) {
  const codemods = await command.createCodemods()

  // Register provider and commands in adonisrc.ts
  await codemods.updateRcFile((rcFile: any) => {
    rcFile.addProvider('@adonisjs-lasagna/multitenancy/providers/multitenancy_provider')
    rcFile.addCommand('@adonisjs-lasagna/multitenancy/commands')
  })

  // Publish config file
  await codemods.makeUsingStub(stubsRoot, 'config/multitenancy.stub', {})

  // Publish tenant model stub only if it doesn't already exist
  const modelPath = command.app.makePath('app/models/backoffice/tenant.ts')
  const modelExists = await access(modelPath)
    .then(() => true)
    .catch(() => false)

  if (!modelExists) {
    await codemods.makeUsingStub(stubsRoot, 'models/tenant.stub', {})
  } else {
    command.logger.info('skipping app/models/backoffice/tenant.ts — already exists')
  }

  // Publish satellite migrations
  for (const name of SATELLITE_MIGRATIONS) {
    await codemods.makeUsingStub(stubsRoot, `migrations/${name}.stub`, {})
  }
}
