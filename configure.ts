import type Configure from '@adonisjs/core/commands/configure'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const stubsRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'stubs')

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
  const { readFile } = await import('node:fs/promises')
  const modelExists = await readFile(modelPath)
    .then(() => true)
    .catch(() => false)

  if (!modelExists) {
    await codemods.makeUsingStub(stubsRoot, 'models/tenant.stub', {})
  } else {
    command.logger.info('skipping app/models/backoffice/tenant.ts — already exists')
  }
}
