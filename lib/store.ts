// Storage abstraction. In production this is backed by Upstash Redis
// (via the Vercel Marketplace "Redis" integration) so state is shared
// across every guest's phone and the DJ device. For local dev, it falls
// back to an in-memory store so you can run `npm run dev` with zero setup.
//
// To go live on Vercel:
//   1. In your Vercel project, go to Storage -> install a Redis
//      integration (Upstash is the common choice) -> connect it to
//      this project.
//   2. It sets UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN (or the
//      older KV_REST_API_URL / KV_REST_API_TOKEN names) automatically.
//   3. This file picks either naming up with no code changes — redeploy
//      after connecting so the new env vars take effect.

import { Redis } from "@upstash/redis";

type Store = {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  del(key: string): Promise<void>;
};

class MemoryStore implements Store {
  private data = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | null> {
    return (this.data.has(key) ? (this.data.get(key) as T) : null);
  }
  async set<T>(key: string, value: T): Promise<void> {
    this.data.set(key, value);
  }
  async del(key: string): Promise<void> {
    this.data.delete(key);
  }
}

// A single in-memory instance survives across hot-reloads in dev via
// globalThis, mirroring the usual Next.js pattern for singletons.
const globalForStore = globalThis as unknown as { __weddingDjStore?: MemoryStore };

function redisUrl() {
  return process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || null;
}
function redisToken() {
  return process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || null;
}

let redisClient: Redis | null = null;
function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis({ url: redisUrl()!, token: redisToken()! });
  }
  return redisClient;
}

export function getStore(): Store {
  if (redisUrl() && redisToken()) {
    const redis = getRedisClient();
    return {
      get: (key) => redis.get(key),
      set: (key, value) => redis.set(key, value).then(() => undefined),
      del: (key) => redis.del(key).then(() => undefined),
    };
  }
  if (!globalForStore.__weddingDjStore) {
    globalForStore.__weddingDjStore = new MemoryStore();
  }
  return globalForStore.__weddingDjStore;
}
