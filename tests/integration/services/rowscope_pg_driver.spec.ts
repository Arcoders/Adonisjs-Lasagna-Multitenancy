import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { RowScopePgDriver } from '@adonisjs-lasagna/multitenancy/services'
import { tenancy, withTenantScope, unscoped } from '@adonisjs-lasagna/multitenancy'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import { randomUUID } from 'node:crypto'
import type { TenantModelContract } from '@adonisjs-lasagna/multitenancy/types'

const SHARED_TABLE = 'lasagna_rowscope_test_posts'

function fakeTenant(id: string): TenantModelContract {
  return { id, name: `rs-${id}` } as unknown as TenantModelContract
}

class TestPost extends withTenantScope(BaseModel) {
  static table = SHARED_TABLE
  @column({ isPrimary: true }) declare id: number
  @column() declare title: string
  @column() declare tenant_id: string
}

test.group('RowScopePgDriver + withTenantScope (integration)', (group) => {
  group.setup(async () => {
    // Use the public/central connection since rowscope means "shared db".
    await db.rawQuery(`
      CREATE TABLE IF NOT EXISTS ${SHARED_TABLE} (
        id serial PRIMARY KEY,
        title text NOT NULL,
        tenant_id text NOT NULL
      )
    `)
  })

  group.teardown(async () => {
    await db.rawQuery(`DROP TABLE IF EXISTS ${SHARED_TABLE}`)
  })

  group.each.setup(async () => {
    await db.rawQuery(`TRUNCATE ${SHARED_TABLE}`)
  })

  test('destroy issues DELETE WHERE tenant_id for every configured table', async ({
    assert,
  }) => {
    const driver = new RowScopePgDriver({
      centralConnectionName: 'public',
      scopedTables: [SHARED_TABLE],
    })

    const tenantA = randomUUID()
    const tenantB = randomUUID()

    await db
      .connection('public')
      .table(SHARED_TABLE)
      .multiInsert([
        { title: 'a1', tenant_id: tenantA },
        { title: 'a2', tenant_id: tenantA },
        { title: 'b1', tenant_id: tenantB },
      ])

    await driver.destroy(fakeTenant(tenantA))

    const remaining = await db.connection('public').from(SHARED_TABLE).select('*')
    assert.lengthOf(remaining, 1, 'tenantB rows must survive')
    assert.equal(remaining[0].tenant_id, tenantB)
  })

  test('connect returns the central connection (no per-tenant pool)', async ({ assert }) => {
    const driver = new RowScopePgDriver({ centralConnectionName: 'public' })
    const conn = await driver.connect(fakeTenant(randomUUID()))
    // Just verify it's a valid client by issuing a noop query.
    await conn.rawQuery('SELECT 1')
    assert.isTrue(true)
  })

  test('migrate is a no-op (returns { executed: 0, noop: true })', async ({ assert }) => {
    const driver = new RowScopePgDriver()
    const result = await driver.migrate(fakeTenant(randomUUID()), {} as any)
    assert.deepEqual(result, { executed: 0, noop: true })
  })

  test('rejects unsafe rowScopeTables values at construction time', ({ assert }) => {
    assert.throws(
      () => new RowScopePgDriver({ scopedTables: ['ok_table; DROP TABLE x;--'] }),
      /Refusing to use unsafe/
    )
  })
})

test.group('withTenantScope mixin (integration)', (group) => {
  group.setup(async () => {
    await db.rawQuery(`
      CREATE TABLE IF NOT EXISTS ${SHARED_TABLE} (
        id serial PRIMARY KEY,
        title text NOT NULL,
        tenant_id text NOT NULL
      )
    `)
    TestPost.boot()
  })

  group.teardown(async () => {
    await db.rawQuery(`DROP TABLE IF EXISTS ${SHARED_TABLE}`)
  })

  group.each.setup(async () => {
    await db.rawQuery(`TRUNCATE ${SHARED_TABLE}`)
  })

  test('create auto-fills tenant_id from the active scope', async ({ assert }) => {
    const tenantId = randomUUID()
    await tenancy.run(fakeTenant(tenantId), async () => {
      const post = await TestPost.create({ title: 'hello' })
      assert.equal(post.tenant_id, tenantId)
    })
  })

  test('fetch hook filters by the active tenant', async ({ assert }) => {
    const tenantA = randomUUID()
    const tenantB = randomUUID()

    await tenancy.run(fakeTenant(tenantA), async () => {
      await TestPost.create({ title: 'a' })
    })
    await tenancy.run(fakeTenant(tenantB), async () => {
      await TestPost.create({ title: 'b' })
    })

    await tenancy.run(fakeTenant(tenantA), async () => {
      const posts = await TestPost.all()
      assert.lengthOf(posts, 1)
      assert.equal(posts[0].title, 'a')
    })
  })

  test('unscoped() returns rows from every tenant', async ({ assert }) => {
    const tenantA = randomUUID()
    const tenantB = randomUUID()

    await tenancy.run(fakeTenant(tenantA), async () => {
      await TestPost.create({ title: 'a1' })
    })
    await tenancy.run(fakeTenant(tenantB), async () => {
      await TestPost.create({ title: 'b1' })
    })

    const all = await unscoped(() => TestPost.all())
    assert.lengthOf(all, 2)
  })

  test('strict mode throws when a query runs without tenancy.run() and without unscoped()', async ({
    assert,
  }) => {
    await assert.rejects(() => TestPost.all(), /MissingTenantScopeException|outside both/)
  })

  test('bulk delete via query builder is scoped (Lucid fires before:fetch)', async ({
    assert,
  }) => {
    const tenantA = randomUUID()
    const tenantB = randomUUID()

    await tenancy.run(fakeTenant(tenantA), async () => {
      await TestPost.create({ title: 'a1' })
      await TestPost.create({ title: 'a2' })
    })
    await tenancy.run(fakeTenant(tenantB), async () => {
      await TestPost.create({ title: 'b1' })
    })

    await tenancy.run(fakeTenant(tenantA), async () => {
      await TestPost.query().delete()
    })

    const survivors = await unscoped(() => TestPost.all())
    assert.lengthOf(survivors, 1)
    assert.equal(survivors[0].tenant_id, tenantB)
  })
})
