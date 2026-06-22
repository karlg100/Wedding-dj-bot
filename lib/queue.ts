import { getStore } from "./store";
import { DEFAULT_QUEUE_STATE, PHASES, Phase, QueuedTrack, QueueState } from "./types";
import { chooseInsertIndex } from "./curation";

const QUEUE_KEY = "wedding:queue-state";

function normalizeTrack(track: QueuedTrack): QueuedTrack {
  return {
    ...track,
    status: track.status ?? "queued",
    holdUntilPhase: track.holdUntilPhase ?? null,
  };
}

function normalizeQueueState(state?: QueueState | null): QueueState {
  if (!state) {
    return {
      ...DEFAULT_QUEUE_STATE,
      upNext: [],
      history: [],
      vetoKeywords: [],
      tasteSeed: [],
    };
  }

  return {
    ...DEFAULT_QUEUE_STATE,
    ...state,
    nowPlaying: state.nowPlaying ? normalizeTrack(state.nowPlaying) : null,
    upNext: Array.isArray(state.upNext) ? state.upNext.map(normalizeTrack) : [],
    history: Array.isArray(state.history) ? state.history.map(normalizeTrack) : [],
    vetoKeywords: Array.isArray(state.vetoKeywords) ? state.vetoKeywords : [],
    tasteSeed: Array.isArray(state.tasteSeed) ? state.tasteSeed : [],
  };
}

function phaseIndex(phase: Phase | null): number {
  if (!phase) return -1;
  return PHASES.findIndex((candidate) => candidate.id === phase);
}

function isReleasedInPhase(track: QueuedTrack, phase: Phase): boolean {
  return track.status === "held" && track.holdUntilPhase !== null
    ? phaseIndex(phase) >= phaseIndex(track.holdUntilPhase)
    : false;
}

export function getPlayableUpNext(state: QueueState): QueuedTrack[] {
  return state.upNext.filter((track) => track.status !== "held");
}

export function getHeldUpNext(state: QueueState): QueuedTrack[] {
  return state.upNext.filter((track) => track.status === "held");
}

export function getPendingRequestTracks(state: QueueState): QueuedTrack[] {
  return state.upNext.filter((track) => track.source === "request");
}

function splitQueue(state: QueueState) {
  const active: QueuedTrack[] = [];
  const held: QueuedTrack[] = [];

  for (const track of state.upNext) {
    if (track.status === "held") {
      held.push(track);
    } else {
      active.push(track);
    }
  }

  return { active, held };
}

function releaseHeldTracksForCurrentPhase(state: QueueState): boolean {
  const stillHeld: QueuedTrack[] = [];
  const releasable: QueuedTrack[] = [];

  for (const track of state.upNext) {
    if (isReleasedInPhase(track, state.phase)) {
      releasable.push({
        ...track,
        status: "queued",
        holdUntilPhase: null,
      });
    } else if (track.status === "held") {
      stillHeld.push(track);
    }
  }

  if (releasable.length === 0) {
    const { active, held } = splitQueue(state);
    const reordered = [...active, ...held];
    const changed = reordered.some((track, index) => track.id !== state.upNext[index]?.id);
    if (changed) state.upNext = reordered;
    return changed;
  }

  const active = getPlayableUpNext(state);
  for (const track of releasable) {
    const index = chooseInsertIndex(active, track, state.phase);
    active.splice(index, 0, track);
  }

  state.upNext = [...active, ...stillHeld];
  return true;
}

export async function getQueueState(): Promise<QueueState> {
  const state = await getStore().get<QueueState>(QUEUE_KEY);
  // Merge with defaults so fields added after a deployment was already
  // storing state (e.g. speakerDeviceId) don't come back as undefined.
  return normalizeQueueState(state);
}

export async function saveQueueState(state: QueueState): Promise<void> {
  await getStore().set(QUEUE_KEY, normalizeQueueState(state));
}

export async function setPhase(phase: Phase): Promise<QueueState> {
  const state = await getQueueState();
  state.phase = phase;
  releaseHeldTracksForCurrentPhase(state);
  await saveQueueState(state);
  return state;
}

export async function addToQueue(track: QueuedTrack): Promise<QueueState> {
  const state = await getQueueState();
  releaseHeldTracksForCurrentPhase(state);
  const normalizedTrack = normalizeTrack(track);

  if (normalizedTrack.status === "held") {
    state.upNext = [...getPlayableUpNext(state), ...getHeldUpNext(state), normalizedTrack];
  } else {
    const active = getPlayableUpNext(state);
    const held = getHeldUpNext(state);
    const index = chooseInsertIndex(active, normalizedTrack, state.phase);
    active.splice(index, 0, normalizedTrack);
    state.upNext = [...active, ...held];
  }
  await saveQueueState(state);
  return state;
}

export async function addSeedTracks(tracks: QueuedTrack[]): Promise<QueueState> {
  const state = await getQueueState();
  const active = getPlayableUpNext(state);
  const held = getHeldUpNext(state);
  active.push(...tracks.map(normalizeTrack));
  state.upNext = [...active, ...held];
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
  releaseHeldTracksForCurrentPhase(state);
  const nextIndex = state.upNext.findIndex((track) => track.status !== "held");
  const next = nextIndex === -1 ? null : state.upNext.splice(nextIndex, 1)[0];
  if (next) {
    next.status = "playing";
    next.holdUntilPhase = null;
  }
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
  const active = getPlayableUpNext(state);
  const held = getHeldUpNext(state);
  const byId = new Map(active.map((t) => [t.id, t]));
  const reordered = orderedIds.map((id) => byId.get(id)).filter(Boolean) as QueuedTrack[];
  // Any tracks not in orderedIds (shouldn't normally happen) stay appended.
  const remaining = active.filter((t) => !orderedIds.includes(t.id));
  state.upNext = [...reordered, ...remaining, ...held];
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
