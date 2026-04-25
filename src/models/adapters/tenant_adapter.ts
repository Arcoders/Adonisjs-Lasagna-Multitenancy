import { getConfig } from '../../config.js'
import MissingTenantHeaderException from '../../exceptions/missing_tenant_header_exception.js'
import { resolveTenantId } from '../../extensions/request.js'
import DefaultLucidAdapter from './default_lucid_adapter.js'
import { HttpContext } from '@adonisjs/core/http'
import type { LucidModel, ModelAdapterOptions } from '@adonisjs/lucid/types/model'
import assert from 'node:assert'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export default class TenantAdapter extends DefaultLucidAdapter {
  override modelConstructorClient(modelConstructor: LucidModel, options?: ModelAdapterOptions) {
    if (options?.client) {
      return options.client
    }

    let tenantConnectionName: string | undefined

    const context = HttpContext.get()

    if (context) {
      const tenantId = resolveTenantId(context.request)
      assert(tenantId && UUID_V4.test(tenantId), new MissingTenantHeaderException())
      tenantConnectionName = getConfig().tenantConnectionNamePrefix + tenantId
    }

    const connection = options?.connection || modelConstructor?.connection || tenantConnectionName
    return this.db.connection(connection)
  }
}
