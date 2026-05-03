import { test } from '@japa/runner'
import {
  withTenantScope,
  unscoped,
  isScopeBypassed,
} from '../../../src/models/scoping.js'
import { tenancy, __configureTenancyForTests } from '../../../src/tenancy.js'
import BootstrapperRegistry from '../../../src/services/bootstrapper_registry.js'
import TenantLogContext from '../../../src/services/tenant_log_context.js'
import { setupTestConfig } from '../../helpers/config.js'
import type { TenantModelContract } from '../../../src/types/contracts.js'

const fakeTenant = (id = 'tenant-1') =>
  ({ id, name: `tenant-${id}` }) as unknown as TenantModelContract

/**
 * Minimal Lucid-compatible BaseModel stub. Records hook registrations so
 * tests can replay them without booting the real ORM.
 */
class FakeQuery {
  predicates: Array<[string, any]> = []
  where(column: string, value: any) {
    this.predicates.push([column, value])
    return this
  }
}

function makeFakeBase() {
  const hooks: Record<string, Array<(...a: any[]) => any>> = {}
  class FakeBaseModel {
    static booted = false
    static boot() {
      this.booted = true
    }
    static before(event: string, handler: (...a: any[]) => any) {
      ;(hooks[event] ??= []).push(handler)
    }
  }
  return { FakeBaseModel, hooks }
}

function setupTenancy(): void {
  __configureTenancyForTests({
    logCtx: new TenantLogContext(),
    registry: new BootstrapperRegistry(),
  })
}

test.group('unscoped() / isScopeBypassed()', (group) => {
  group.each.setup(() => setupTestConfig())
  group.each.teardown(() => __configureTenancyForTests({}))

  test('isScopeBypassed is false outside unscoped()', ({ assert }) => {
    assert.isFalse(isScopeBypassed())
  })

  test('isScopeBypassed is true inside unscoped() and clears after', async ({
    assert,
  }) => {
    let inside = false
    await unscoped(async () => {
      inside = isScopeBypassed()
    })
    assert.isTrue(inside)
    assert.isFalse(isScopeBypassed())
  })

  test('parallel unscoped() calls do not leak the flag', async ({ assert }) => {
    const observed: boolean[] = []
    await Promise.all([
      unscoped(async () => {
        await new Promise((r) => setTimeout(r, 5))
        observed.push(isScopeBypassed())
      }),
      (async () => {
        observed.push(isScopeBypassed())
      })(),
    ])
    assert.deepEqual(observed.sort(), [false, true])
  })
})

test.group('withTenantScope — query hooks', (group) => {
  group.each.setup(() => setupTestConfig())
  group.each.teardown(() => __configureTenancyForTests({}))

  test('boot() registers find/fetch/paginate/create/update/delete hooks', ({
    assert,
  }) => {
    const { FakeBaseModel, hooks } = makeFakeBase()
    const Scoped = withTenantScope(FakeBaseModel as any) as any
    Scoped.boot()
    for (const event of ['find', 'fetch', 'paginate', 'create', 'update', 'delete']) {
      assert.exists(hooks[event], `missing hook for ${event}`)
    }
  })

  test('find/fetch hooks inject where tenant_id = current id', async ({ assert }) => {
    setupTenancy()
    const { FakeBaseModel, hooks } = makeFakeBase()
    const Scoped = withTenantScope(FakeBaseModel as any) as any
    Scoped.boot()

    await tenancy.run(fakeTenant('xyz'), async () => {
      const q1 = new FakeQuery()
      const q2 = new FakeQuery()
      hooks.find[0](q1)
      hooks.fetch[0](q2)
      assert.deepEqual(q1.predicates, [['tenant_id', 'xyz']])
      assert.deepEqual(q2.predicates, [['tenant_id', 'xyz']])
    })
  })

  test('hooks become no-ops when called inside unscoped()', async ({ assert }) => {
    setupTenancy()
    const { FakeBaseModel, hooks } = makeFakeBase()
    const Scoped = withTenantScope(FakeBaseModel as any) as any
    Scoped.boot()

    await tenancy.run(fakeTenant('abc'), async () => {
      await unscoped(async () => {
        const q = new FakeQuery()
        hooks.find[0](q)
        assert.deepEqual(q.predicates, [])
      })
    })
  })

  test('create hook fills tenant_id when not set', async ({ assert }) => {
    setupTenancy()
    const { FakeBaseModel, hooks } = makeFakeBase()
    const Scoped = withTenantScope(FakeBaseModel as any) as any
    Scoped.boot()

    await tenancy.run(fakeTenant('1'), async () => {
      const model: any = {}
      hooks.create[0](model)
      assert.equal(model.tenant_id, '1')
    })
  })

  test('create hook leaves an explicit tenant_id alone', async ({ assert }) => {
    setupTenancy()
    const { FakeBaseModel, hooks } = makeFakeBase()
    const Scoped = withTenantScope(FakeBaseModel as any) as any
    Scoped.boot()

    await tenancy.run(fakeTenant('current'), async () => {
      const model: any = { tenant_id: 'preset' }
      hooks.create[0](model)
      assert.equal(model.tenant_id, 'preset')
    })
  })

  test('update hook throws when row belongs to a different tenant', async ({
    assert,
  }) => {
    setupTenancy()
    const { FakeBaseModel, hooks } = makeFakeBase()
    const Scoped = withTenantScope(FakeBaseModel as any) as any
    Scoped.boot()

    await tenancy.run(fakeTenant('current'), async () => {
      const model: any = { tenant_id: 'other' }
      assert.throws(() => hooks.update[0](model), /refusing to update/)
    })
  })

  test('hooks no-op when no tenant scope is active', ({ assert }) => {
    const { FakeBaseModel, hooks } = makeFakeBase()
    const Scoped = withTenantScope(FakeBaseModel as any) as any
    Scoped.boot()

    const q = new FakeQuery()
    hooks.find[0](q)
    assert.deepEqual(q.predicates, [])
  })

  test('boot() is idempotent — does not register duplicate hooks', async ({
    assert,
  }) => {
    setupTenancy()
    const { FakeBaseModel, hooks } = makeFakeBase()
    const Scoped = withTenantScope(FakeBaseModel as any) as any
    Scoped.boot()
    Scoped.boot()
    Scoped.boot()
    assert.lengthOf(hooks.find, 1)
  })
})
