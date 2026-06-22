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

// A single instance survives across hot-reloads in dev via globalThis,
// mirroring the usual Next.js pattern for singletons.
const globalForStore = globalThis as unknown as { __weddingDjStore?: FileStore };

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
    globalForStore.__weddingDjStore = new FileStore(LOCAL_STORE_FILE);
  }
  return globalForStore.__weddingDjStore;
}

// Which backend is actually live. "redis" = persistent across deploys.
// "file" = local-dev fallback (a serverless deploy reporting "file" means
// the Redis env vars aren't reaching the runtime — that alone explains
// losing the Spotify token on every redeploy).
export function getStoreBackend(): "redis" | "file" {
  return redisUrl() && redisToken() ? "redis" : "file";
}
