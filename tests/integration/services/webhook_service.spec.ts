import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'
import { createHmac } from 'node:crypto'
import { WebhookService } from '@adonisjs-lasagna/multitenancy/services'
import { encrypt } from '@adonisjs-lasagna/multitenancy'

process.env.APP_KEY = process.env.APP_KEY ?? 'test-app-key-for-webhooks-tests!'

type FakeFetch = (url: unknown, init?: RequestInit) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>

function makeFetch(status: number, body = '{}'): FakeFetch {
  return async (_url, _init) => ({ ok: status >= 200 && status < 300, status, text: async () => body })
}

function makeDelivery(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    event: 'user.created',
    payload: { userId: '123' },
    status: 'pending' as const,
    attempt: 1,
    statusCode: null as number | null,
    responseBody: null as string | null,
    nextRetryAt: null as unknown,
    save: async () => {},
    ...overrides,
  }
}

function makeHook(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    tenantId: randomUUID(),
    url: 'https://example.com/webhook',
    events: ['user.created'],
    secret: null as string | null,
    enabled: true,
    ...overrides,
  }
}

test.group('WebhookService.send() — delivery state machine', (group) => {
  let originalFetch: typeof globalThis.fetch
  const svc = new WebhookService()

  group.each.setup(() => {
    originalFetch = globalThis.fetch
  })

  group.each.teardown(() => {
    globalThis.fetch = originalFetch
  })

  test('sets status to success on 2xx response', async ({ assert }) => {
    globalThis.fetch = makeFetch(200) as unknown as typeof fetch
    const hook = makeHook()
    const delivery = makeDelivery()

    await svc.send(hook as any, delivery as any)

    assert.equal(delivery.status, 'success')
    assert.equal(delivery.statusCode, 200)
  })

  test('sets status to retrying on non-2xx response when attempts remain', async ({ assert }) => {
    globalThis.fetch = makeFetch(500) as unknown as typeof fetch
    const hook = makeHook()
    const delivery = makeDelivery({ attempt: 1 })

    await svc.send(hook as any, delivery as any)

    assert.equal(delivery.status, 'retrying')
    assert.equal(delivery.statusCode, 500)
    assert.equal(delivery.attempt, 2)
    assert.isNotNull(delivery.nextRetryAt)
  })

  test('sets status to failed on non-2xx response when max attempts reached', async ({
    assert,
  }) => {
    globalThis.fetch = makeFetch(500) as unknown as typeof fetch
    const hook = makeHook()
    const delivery = makeDelivery({ attempt: 5 })

    await svc.send(hook as any, delivery as any)

    assert.equal(delivery.status, 'failed')
    assert.equal(delivery.statusCode, 500)
  })

  test('sets status to retrying on network error when attempts remain', async ({ assert }) => {
    globalThis.fetch = (async () => {
      throw new Error('Connection refused')
    }) as unknown as typeof fetch

    const hook = makeHook()
    const delivery = makeDelivery({ attempt: 2 })

    await svc.send(hook as any, delivery as any)

    assert.equal(delivery.status, 'retrying')
    assert.isNull(delivery.statusCode)
    assert.include(String(delivery.responseBody), 'Connection refused')
    assert.equal(delivery.attempt, 3)
  })

  test('sets status to failed on network error when max attempts reached', async ({ assert }) => {
    globalThis.fetch = (async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown as typeof fetch

    const hook = makeHook()
    const delivery = makeDelivery({ attempt: 5 })

    await svc.send(hook as any, delivery as any)

    assert.equal(delivery.status, 'failed')
    assert.isNull(delivery.statusCode)
  })

  test('adds HMAC signature header when hook has a secret', async ({ assert }) => {
    const secret = 'webhook-signing-secret'
    const encryptedSecret = encrypt(secret)
    const capturedHeaders: Record<string, string> = {}

    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      Object.assign(capturedHeaders, init?.headers as Record<string, string>)
      return { ok: true, status: 200, text: async () => '{}' }
    }) as unknown as typeof fetch

    const hook = makeHook({ secret: encryptedSecret })
    const delivery = makeDelivery()

    await svc.send(hook as any, delivery as any)

    assert.property(capturedHeaders, 'x-webhook-signature')

    const body = JSON.stringify(delivery.payload)
    const expectedSig = createHmac('sha256', secret).update(body).digest('hex')
    assert.equal(capturedHeaders['x-webhook-signature'], expectedSig)
  })

  test('does not add signature header when hook has no secret', async ({ assert }) => {
    const capturedHeaders: Record<string, string> = {}

    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      Object.assign(capturedHeaders, init?.headers as Record<string, string>)
      return { ok: true, status: 200, text: async () => '{}' }
    }) as unknown as typeof fetch

    const hook = makeHook({ secret: null })
    const delivery = makeDelivery()

    await svc.send(hook as any, delivery as any)

    assert.notProperty(capturedHeaders, 'x-webhook-signature')
  })

  test('always sends content-type, x-webhook-event and x-delivery-id headers', async ({
    assert,
  }) => {
    const capturedHeaders: Record<string, string> = {}

    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      Object.assign(capturedHeaders, init?.headers as Record<string, string>)
      return { ok: true, status: 200, text: async () => '{}' }
    }) as unknown as typeof fetch

    const hook = makeHook()
    const delivery = makeDelivery({ event: 'order.placed' })

    await svc.send(hook as any, delivery as any)

    assert.equal(capturedHeaders['content-type'], 'application/json')
    assert.equal(capturedHeaders['x-webhook-event'], 'order.placed')
    assert.equal(capturedHeaders['x-delivery-id'], delivery.id)
  })

  test('stores response body from successful request', async ({ assert }) => {
    const responsePayload = JSON.stringify({ received: true })
    globalThis.fetch = makeFetch(200, responsePayload) as unknown as typeof fetch

    const hook = makeHook()
    const delivery = makeDelivery()

    await svc.send(hook as any, delivery as any)

    assert.equal(delivery.responseBody, responsePayload)
  })
})

test.group('WebhookService — encryption', () => {
  test('encrypt utility produces an enc_v1: prefixed value', ({ assert }) => {
    const secret = 'my-webhook-secret'
    const encrypted = encrypt(secret)
    assert.isTrue(encrypted.startsWith('enc_v1:'))
    assert.notEqual(encrypted, secret)
  })
})
