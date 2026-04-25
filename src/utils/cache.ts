import { BentoCache, bentostore } from 'bentocache'
import { memoryDriver } from 'bentocache/drivers/memory'
import { redisDriver, redisBusDriver } from 'bentocache/drivers/redis'
import { getConfig } from '../config.js'

function buildCache() {
  const { host, port, username, password, db } = getConfig().cache.redis
  const connection = {
    host,
    port,
    username: username ?? undefined,
    password: password ?? undefined,
    db: db ?? 0,
  }
  return new BentoCache({
    default: 'cache',
    stores: {
      cache: bentostore()
        .useL1Layer(memoryDriver({ maxSize: 5 * 1024 * 1024 }))
        .useL2Layer(redisDriver({ connection }))
        .useBus(redisBusDriver({ connection })),
    },
  })
}

type CacheInstance = ReturnType<typeof buildCache>
let _cache: CacheInstance | null = null

export function getCache(): CacheInstance {
  if (!_cache) _cache = buildCache()
  return _cache
}
