import { getStore } from "./store";
import { GuestSession, VibeRead, VibeSynthesis } from "./types";

const sessionKey = (guestId: string) => `wedding:guest-session:${guestId}`;
const VIBE_LOG_KEY = "wedding:vibe-log";
const VIBE_SYNTH_KEY = "wedding:vibe-synthesis";

export async function getGuestSession(guestId: string): Promise<GuestSession | null> {
  return getStore().get<GuestSession>(sessionKey(guestId));
}

export async function saveGuestSession(session: GuestSession): Promise<void> {
  await getStore().set(sessionKey(session.guestId), session);
}

export async function getOrCreateGuestSession(
  guestId: string,
  name: string
): Promise<GuestSession> {
  const existing = await getGuestSession(guestId);
  if (existing) {
    // Keep the name fresh if they re-enter it differently.
    if (name && existing.name !== name) existing.name = name;
    return existing;
  }
  const fresh: GuestSession = {
    guestId,
    name,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await getStore().set(sessionKey(guestId), fresh);
  return fresh;
}

// Vibe log: a rolling window of recent reads, capped so it can't grow
// unbounded over a long reception.
const VIBE_LOG_CAP = 60;

export async function appendVibeRead(read: VibeRead): Promise<void> {
  const store = getStore();
  const log = (await store.get<VibeRead[]>(VIBE_LOG_KEY)) ?? [];
  log.push(read);
  const trimmed = log.slice(-VIBE_LOG_CAP);
  await store.set(VIBE_LOG_KEY, trimmed);
}

export async function getRecentVibeReads(windowMinutes = 30): Promise<VibeRead[]> {
  const store = getStore();
  const log = (await store.get<VibeRead[]>(VIBE_LOG_KEY)) ?? [];
  const cutoff = Date.now() - windowMinutes * 60_000;
  return log.filter((r) => r.at >= cutoff);
}

export async function saveVibeSynthesis(synthesis: VibeSynthesis): Promise<void> {
  await getStore().set(VIBE_SYNTH_KEY, synthesis);
}

export async function getVibeSynthesis(): Promise<VibeSynthesis | null> {
  return getStore().get<VibeSynthesis>(VIBE_SYNTH_KEY);
}
