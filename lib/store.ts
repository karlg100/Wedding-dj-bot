// Storage abstraction. In production this is backed by Upstash Redis
// (via the Vercel Marketplace "Redis" integration) so state is shared
// across every guest's phone and the DJ device. For local dev, it falls
// back to an in-memory store so you can run `npm run dev` with zero setup.
//
// To go live on Vercel:
//   1. In your Vercel project, go to Storage -> add a Redis integration
//      -> **Connect to Project** (this is the step that actually injects
//      the env vars; just creating the database does nothing on its own).
//   2. Redeploy so the new env vars take effect.
// This file supports whichever credentials the integration provides:
//   - REST: UPSTASH_REDIS_REST_URL/TOKEN or KV_REST_API_URL/TOKEN (used
//     via @upstash/redis), OR
//   - a connection string: REDIS_URL or KV_URL (used via ioredis).
//   Vercel's native Redis integration provides only REDIS_URL.

import { Redis as UpstashRedis } from "@upstash/redis";
import IORedis from "ioredis";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";

type Store = {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  del(key: string): Promise<void>;
};

// Local-dev fallback when no Redis is configured. Backed by a JSON file
// on disk (NOT just memory) so that data — most importantly the Spotify
// OAuth tokens — survives a dev-server restart / rebuild. A pure
// in-memory store gets wiped on every process restart, which forced a
// fresh Spotify login on every `npm run dev` / `npm run build` cycle.
//
// It keeps an in-memory cache and write-through to the file, so reads are
// cheap and a full restart re-hydrates from disk. If the filesystem isn't
// writable (e.g. a serverless runtime), it degrades to pure in-memory
// rather than throwing — but in that environment Redis should be set
// anyway, so this path is dev-only in practice.
const LOCAL_STORE_FILE =
  process.env.WEDDING_DJ_STORE_FILE || join(process.cwd(), ".local-store.json");

class FileStore implements Store {
  private data = new Map<string, unknown>();
  private fileWritable = true;

  constructor(private readonly file: string) {
    this.load();
  }

  private load() {
    try {
      const raw = readFileSync(this.file, "utf8");
      const obj = JSON.parse(raw) as Record<string, unknown>;
      this.data = new Map(Object.entries(obj));
    } catch {
      // No file yet (or unreadable) — start empty. Not an error.
      this.data = new Map();
    }
  }

  private persist() {
    if (!this.fileWritable) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const obj = Object.fromEntries(this.data.entries());
      writeFileSync(this.file, JSON.stringify(obj, null, 2), "utf8");
    } catch {
      // Read-only FS (e.g. serverless) — keep working from memory for the
      // rest of this process instead of crashing on every write.
      this.fileWritable = false;
    }
  }

  async get<T>(key: string): Promise<T | null> {
    return this.data.has(key) ? (this.data.get(key) as T) : null;
  }
  async set<T>(key: string, value: T): Promise<void> {
    this.data.set(key, value);
    this.persist();
  }
  async del(key: string): Promise<void> {
    this.data.delete(key);
    this.persist();
  }
}

// JSON-serializing store over a standard redis:// connection (ioredis).
// Used when the integration only exposes a REDIS_URL connection string
// (e.g. Vercel's native Redis / Upstash TCP endpoint) rather than the
// REST URL+token pair the @upstash/redis client needs. ioredis values are
// plain strings, so we JSON-encode on write and decode on read to keep the
// same object-in/object-out contract as the other backends.
class RedisUrlStore implements Store {
  constructor(private readonly client: IORedis) {}

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    if (raw == null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      // Value wasn't JSON (shouldn't happen for our own writes) — return raw.
      return raw as unknown as T;
    }
  }
  async set<T>(key: string, value: T): Promise<void> {
    await this.client.set(key, JSON.stringify(value));
  }
  async del(key: string): Promise<void> {
    await this.client.del(key);
  }
}

// Single instances survive across hot-reloads in dev (and warm serverless
// invocations) via globalThis, mirroring the usual Next.js singleton
// pattern — and, for ioredis, avoiding opening a new TCP connection per
// invocation.
const globalForStore = globalThis as unknown as {
  __weddingDjStore?: FileStore;
  __weddingDjRedis?: IORedis;
};

// REST credentials (Upstash REST API). Preferred for serverless when
// available, but Vercel's native Redis integration may not provide them.
function restUrl() {
  return process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || null;
}
function restToken() {
  return process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || null;
}
// Standard redis:// (or rediss://) connection string. This is what the
// Vercel Redis marketplace integration injects as REDIS_URL.
function redisConnUrl() {
  return process.env.REDIS_URL || process.env.KV_URL || null;
}

let upstashClient: UpstashRedis | null = null;
function getUpstashClient(): UpstashRedis {
  if (!upstashClient) {
    upstashClient = new UpstashRedis({ url: restUrl()!, token: restToken()! });
  }
  return upstashClient;
}

function getIORedisClient(): IORedis {
  if (!globalForStore.__weddingDjRedis) {
    // ioredis parses rediss:// (TLS) and redis:// from the URL itself.
    // Cap retries so a bad URL surfaces as an error instead of hanging
    // every request forever.
    const client = new IORedis(redisConnUrl()!, {
      maxRetriesPerRequest: 3,
      lazyConnect: false,
    });
    // Without an 'error' listener, ioredis connection errors bubble up as
    // unhandled EventEmitter errors and can crash the function. Log instead;
    // individual command failures still reject their own promises.
    client.on("error", (err) => {
      console.error("[store] Redis connection error:", err?.message ?? err);
    });
    globalForStore.__weddingDjRedis = client;
  }
  return globalForStore.__weddingDjRedis;
}

export function getStore(): Store {
  // 1. Upstash REST (URL + token) — ideal for serverless if present.
  if (restUrl() && restToken()) {
    const redis = getUpstashClient();
    return {
      get: (key) => redis.get(key),
      set: (key, value) => redis.set(key, value).then(() => undefined),
      del: (key) => redis.del(key).then(() => undefined),
    };
  }
  // 2. Standard redis:// connection string (Vercel native Redis / REDIS_URL).
  if (redisConnUrl()) {
    return new RedisUrlStore(getIORedisClient());
  }
  // 3. Local-dev fallback: file-backed store.
  if (!globalForStore.__weddingDjStore) {
    globalForStore.__weddingDjStore = new FileStore(LOCAL_STORE_FILE);
  }
  return globalForStore.__weddingDjStore;
}

// Which backend is actually live. "redis" = persistent across deploys
// (either REST or a REDIS_URL connection). "file" = local-dev fallback;
// a serverless deploy reporting "file" means no Redis env var is reaching
// the runtime, which alone explains losing the Spotify token on redeploy.
export function getStoreBackend(): "redis" | "file" {
  return (restUrl() && restToken()) || redisConnUrl() ? "redis" : "file";
}
