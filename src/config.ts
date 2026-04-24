import type { MultitenancyConfig } from './types/config.js'

let _config: MultitenancyConfig | null = null

export function setConfig(config: MultitenancyConfig): void {
  _config = config
}

export function getConfig(): MultitenancyConfig {
  if (!_config) {
    throw new Error(
      '@adonisjs-lasagna/multitenancy not configured. Add MultitenancyProvider to your providers list.'
    )
  }
  return _config
}
