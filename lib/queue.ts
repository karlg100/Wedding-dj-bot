import { getStore } from "./store";
import { DEFAULT_QUEUE_STATE, Phase, QueuedTrack, QueueState } from "./types";
import { chooseInsertIndex } from "./curation";

const QUEUE_KEY = "wedding:queue-state";

export async function getQueueState(): Promise<QueueState> {
  const state = await getStore().get<QueueState>(QUEUE_KEY);
  return state ?? DEFAULT_QUEUE_STATE;
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
