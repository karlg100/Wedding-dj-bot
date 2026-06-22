import { getStore } from "./store";
import { DEFAULT_QUEUE_STATE, Phase, QueuedTrack, QueueState } from "./types";
import { chooseInsertIndex } from "./curation";

const QUEUE_KEY = "wedding:queue-state";

export async function getQueueState(): Promise<QueueState> {
  const state = await getStore().get<QueueState>(QUEUE_KEY);
  // Merge with defaults so fields added after a deployment was already
  // storing state (e.g. speakerDeviceId) don't come back as undefined.
  return state ? { ...DEFAULT_QUEUE_STATE, ...state } : DEFAULT_QUEUE_STATE;
}

export async function saveQueueState(state: QueueState): Promise<void> {
  await getStore().set(QUEUE_KEY, state);
}

export async function setPhase(phase: Phase): Promise<QueueState> {
  const state = await getQueueState();
  state.phase = phase;
  await saveQueueState(state);
  return state;
}

export async function addToQueue(track: QueuedTrack): Promise<QueueState> {
  const state = await getQueueState();
  const index = chooseInsertIndex(state.upNext, track, state.phase);
  state.upNext.splice(index, 0, track);
  await saveQueueState(state);
  return state;
}

export async function addSeedTracks(tracks: QueuedTrack[]): Promise<QueueState> {
  const state = await getQueueState();
  state.upNext.push(...tracks);
  await saveQueueState(state);
  return state;
}

// Advance: move current nowPlaying to history (as played or skipped),
// pop the next track off upNext into nowPlaying.
export async function advanceQueue(
  outcome: "played" | "skipped" | "none"
): Promise<QueueState> {
  const state = await getQueueState();
  if (state.nowPlaying && outcome !== "none") {
    state.nowPlaying.status = outcome;
    state.nowPlaying.playedAt = Date.now();
    state.history.unshift(state.nowPlaying);
    state.history = state.history.slice(0, 100);
  }
  const next = state.upNext.shift() ?? null;
  if (next) next.status = "playing";
  state.nowPlaying = next;
  state.nowPlayingStartedAt = next ? Date.now() : null;
  await saveQueueState(state);
  return state;
}

export async function removeFromQueue(entryId: string): Promise<QueueState> {
  const state = await getQueueState();
  state.upNext = state.upNext.filter((t) => t.id !== entryId);
  await saveQueueState(state);
  return state;
}

export async function reorderQueue(orderedIds: string[]): Promise<QueueState> {
  const state = await getQueueState();
  const byId = new Map(state.upNext.map((t) => [t.id, t]));
  const reordered = orderedIds.map((id) => byId.get(id)).filter(Boolean) as QueuedTrack[];
  // Any tracks not in orderedIds (shouldn't normally happen) stay appended.
  const remaining = state.upNext.filter((t) => !orderedIds.includes(t.id));
  state.upNext = [...reordered, ...remaining];
  await saveQueueState(state);
  return state;
}

export async function setVetoKeywords(keywords: string[]): Promise<QueueState> {
  const state = await getQueueState();
  state.vetoKeywords = keywords;
  await saveQueueState(state);
  return state;
}

export async function setTasteSeed(seed: string[]): Promise<QueueState> {
  const state = await getQueueState();
  state.tasteSeed = seed;
  await saveQueueState(state);
  return state;
}

export async function setSpeakerDevice(
  deviceId: string,
  deviceName: string
): Promise<QueueState> {
  const state = await getQueueState();
  state.speakerDeviceId = deviceId;
  state.speakerDeviceName = deviceName;
  state.speakerAssignedAt = Date.now();
  await saveQueueState(state);
  return state;
}

// Lightweight cooldown so many devices polling at once don't all trigger
// auto-fill (and therefore many parallel Anthropic + Spotify calls) for
// the same empty-queue moment. Not a hard distributed lock — good enough
// for "don't fire this more than once every N seconds," which is all we
// need here.
const AUTOFILL_LOCK_KEY = "wedding:autofill-lock";
const AUTOFILL_COOLDOWN_MS = 25_000;

export async function tryClaimAutoFillSlot(): Promise<boolean> {
  const store = getStore();
  const last = await store.get<number>(AUTOFILL_LOCK_KEY);
  const now = Date.now();
  if (last && now - last < AUTOFILL_COOLDOWN_MS) {
    return false;
  }
  await store.set(AUTOFILL_LOCK_KEY, now);
  return true;
}

// The "taste list" — the couple's reference songs (e.g. their Apple Music
// playlist) used ONLY as inspiration for the auto-fill AI's picks. These
// are deliberately NOT queued to play; they shape what Claude chooses
// when the queue runs low. Stored separately from QueueState so it
// persists independently of queue churn.
const TASTE_LIST_KEY = "wedding:taste-list";

export async function getTasteList(): Promise<string[]> {
  return (await getStore().get<string[]>(TASTE_LIST_KEY)) ?? [];
}

export async function setTasteList(entries: string[]): Promise<string[]> {
  const cleaned = entries.map((e) => e.trim()).filter(Boolean);
  await getStore().set(TASTE_LIST_KEY, cleaned);
  return cleaned;
}
