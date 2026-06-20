// Storage abstraction. In production this should be backed by Vercel KV
// (or any Redis-compatible store) so state is shared across every guest's
// phone and the DJ device. For local dev, it falls back to an in-memory
// store so you can run `npm run dev` with zero setup.
//
// To go live on Vercel:
//   1. Add the Vercel KV (or Upstash Redis) integration to your project.
//   2. It will set KV_REST_API_URL and KV_REST_API_TOKEN automatically.
//   3. This file picks that up with no code changes.

import { kv as vercelKv } from "@vercel/kv";

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

function hasKvEnv() {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

export function getStore(): Store {
  if (hasKvEnv()) {
    return {
      get: (key) => vercelKv.get(key),
      set: (key, value) => vercelKv.set(key, value).then(() => undefined),
      del: (key) => vercelKv.del(key).then(() => undefined),
    };
  }
  if (!globalForStore.__weddingDjStore) {
    globalForStore.__weddingDjStore = new MemoryStore();
  }
  return globalForStore.__weddingDjStore;
}
