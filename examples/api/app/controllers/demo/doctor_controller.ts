import type { HttpContext } from '@adonisjs/core/http'
import app from '@adonisjs/core/services/app'
import { DoctorService } from '@adonisjs-lasagna/multitenancy/services'

/**
 * Same diagnostic the `node ace tenant:doctor --json` command emits, exposed
 * over HTTP. Useful for plugging the report into an external dashboard or
 * deploy gate. In production, mount this behind admin auth.
 */
export default class DoctorController {
  async run({ request, response }: HttpContext) {
    const svc = await app.container.make(DoctorService)
    const checks = request.input('check') as string | string[] | undefined
    const tenants = request.input('tenant') as string | string[] | undefined

    const result = await svc.run({
      checks: checks ? (Array.isArray(checks) ? checks : [checks]) : undefined,
      tenants: tenants ? (Array.isArray(tenants) ? tenants : [tenants]) : undefined,
      fix: request.input('fix') === 'true',
    })

    return response.ok(result)
  }
}
