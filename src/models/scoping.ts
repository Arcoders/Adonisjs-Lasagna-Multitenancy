import { AsyncLocalStorage } from 'node:async_hooks'
import { tenancy } from '../tenancy.js'
import { configuredScopeColumn } from '../services/isolation/rowscope_pg_driver.js'

/**
 * Lucid's `BaseModel` (typed loosely so this file doesn't have to import
 * the full ORM type — keeps the mixin tree-shakeable).
 */
type LucidBaseModelClass = new (...args: any[]) => any
type Bootable = LucidBaseModelClass & {
  boot(): void
  booted: boolean
  before(event: string, handler: (...args: any[]) => any): void
}

const bypassStorage = new AsyncLocalStorage<{ bypass: true }>()

/**
 * Run `fn` with tenant scoping disabled. Inside `fn`, queries against
 * scoped models will not have `where tenant_id = ?` applied automatically.
 *
 * Use this for legitimate cross-tenant operations (admin reports, central
 * migrations, audit log emission). Always prefer scoped queries in user
 * code paths.
 */
export function unscoped<T>(fn: () => T | Promise<T>): Promise<T> {
  return Promise.resolve(bypassStorage.run({ bypass: true }, fn))
}

/**
 * True when the current async scope was opened via `unscoped(fn)`.
 */
export function isScopeBypassed(): boolean {
  return bypassStorage.getStore()?.bypass === true
}

/**
 * Mixin that turns a Lucid model into a tenant-scoped one. Applied
 * queries (`find`, `fetch`, `paginate`) get `where tenant_id = <current>`
 * injected automatically; saves auto-fill the column.
 *
 * @example
 *   import { BaseModel, column } from '@adonisjs/lucid/orm'
 *   import { withTenantScope } from '@adonisjs-lasagna/multitenancy'
 *
 *   export default class Post extends withTenantScope(BaseModel) {
 *     @column({ isPrimary: true }) declare id: number
 *     @column() declare title: string
 *     // tenant_id is added by the mixin and managed automatically
 *   }
 *
 * Use `unscoped(fn)` to escape the scope for cross-tenant operations.
 */
export function withTenantScope<TBase extends LucidBaseModelClass>(Base: TBase): TBase {
  const Bootable = Base as TBase & Bootable

  abstract class TenantScoped extends Bootable {
    static booted: boolean = false

    static boot(): void {
      // Re-implement Lucid's idempotent boot guard at the mixin layer so
      // the parent's $hooks Map is registered before we add ours.
      if ((this as any).booted === true) return
      super.boot?.()

      const column = configuredScopeColumn()

      this.before('find', (query: any) => {
        if (isScopeBypassed()) return
        const id = tenancy.currentId()
        if (!id) return
        query.where(column, id)
      })

      this.before('fetch', (query: any) => {
        if (isScopeBypassed()) return
        const id = tenancy.currentId()
        if (!id) return
        query.where(column, id)
      })

      this.before('paginate', (queries: any) => {
        if (isScopeBypassed()) return
        const id = tenancy.currentId()
        if (!id) return
        const [counter, fetcher] = Array.isArray(queries) ? queries : [queries, queries]
        counter?.where?.(column, id)
        fetcher?.where?.(column, id)
      })

      this.before('create', (model: any) => {
        if (isScopeBypassed()) return
        const id = tenancy.currentId()
        if (!id) return
        if (model[column] === undefined || model[column] === null) {
          model[column] = id
        }
      })

      this.before('update', (model: any) => {
        if (isScopeBypassed()) return
        const id = tenancy.currentId()
        if (!id) return
        // Do not silently rewrite a different tenant's id; surface the bug.
        if (model[column] !== undefined && model[column] !== id) {
          throw new Error(
            `withTenantScope: refusing to update a row owned by tenant "${model[column]}" from tenant "${id}" context. ` +
              `Wrap the operation in unscoped(...) if this is intentional.`
          )
        }
      })

      this.before('delete', (model: any) => {
        if (isScopeBypassed()) return
        const id = tenancy.currentId()
        if (!id) return
        if (model[column] !== undefined && model[column] !== id) {
          throw new Error(
            `withTenantScope: refusing to delete a row owned by tenant "${model[column]}" from tenant "${id}" context. ` +
              `Wrap the operation in unscoped(...) if this is intentional.`
          )
        }
      })
    }
  }

  return TenantScoped as unknown as TBase
}
