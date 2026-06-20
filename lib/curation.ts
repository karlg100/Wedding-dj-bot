import { Phase, QueuedTrack } from "./types";
import { SpotifyTrack } from "./spotify";

// Words that, if present in title/artist/album, mean "hard pass" regardless
// of Spotify's explicit flag — this is the "avoid the really vulgar tracks"
// rule. This is intentionally a blunt keyword check on metadata (not lyrics,
// which Claude/the app can't read in full) — it catches the obvious cases by
// title/artist, and the couple's own vetoKeywords list extends it.
const HARD_PASS_TERMS = [
  "porn",
  "rape",
  // Slur-adjacent / explicit sexual-violence terms are intentionally not
  // enumerated here in full; this list is meant to be extended privately
  // via vetoKeywords in the DJ settings rather than hardcoded exhaustively.
];

export type ScreeningResult = {
  accept: boolean;
  reason: string;
};

export function screenTrack(
  track: SpotifyTrack,
  vetoKeywords: string[]
): ScreeningResult {
  const haystack = `${track.title} ${track.artist} ${track.album}`.toLowerCase();

  for (const term of HARD_PASS_TERMS) {
    if (haystack.includes(term)) {
      return { accept: false, reason: "Flagged content, not a fit for the reception." };
    }
  }
  for (const term of vetoKeywords) {
    const t = term.trim().toLowerCase();
    if (t && haystack.includes(t)) {
      return { accept: false, reason: `Matches the couple's do-not-play list ("${term}").` };
    }
  }
  // Moderate explicit lyrics are fine per the couple's preference — Spotify's
  // explicit flag alone does not disqualify a track.
  return { accept: true, reason: track.explicit ? "Explicit tag present, but allowed." : "Looks good." };
}

// Target energy band per phase, used to decide where in the queue a track
// should land. Energy is Spotify's 0-1 audio feature when available.
const PHASE_ENERGY_TARGET: Record<Phase, [number, number]> = {
  prelude: [0.1, 0.45],
  cocktail: [0.25, 0.6],
  dinner: [0.15, 0.5],
  dancing: [0.55, 1.0],
  lastcall: [0.1, 0.5],
};

function energyFit(phase: Phase, energy: number | null): number {
  if (energy === null) return 0.5; // unknown -> neutral, don't penalize
  const [lo, hi] = PHASE_ENERGY_TARGET[phase];
  if (energy >= lo && energy <= hi) return 1;
  const dist = energy < lo ? lo - energy : energy - hi;
  return Math.max(0, 1 - dist * 2);
}

// Decide where to insert a newly-accepted request into the upcoming queue.
// Rules of thumb, in priority order:
//  1. Never stack two requests from the exact same artist back to back.
//  2. Avoid placing two low-energy tracks consecutively during "dancing".
//  3. Otherwise, mostly respect arrival order (it still feels like a queue,
//     not a black box) — slot within a small window near the back rather
//     than anywhere in the list.
export function chooseInsertIndex(
  queue: QueuedTrack[],
  incoming: QueuedTrack,
  phase: Phase
): number {
  if (queue.length === 0) return 0;

  const windowStart = Math.max(0, queue.length - 4);
  let bestIndex = queue.length;
  let bestScore = -Infinity;

  for (let i = windowStart; i <= queue.length; i++) {
    const prev = queue[i - 1];
    const next = queue[i];
    let score = 0;

    // Prefer positions further back slightly less (keep near-FIFO feel),
    // but let energy fit and artist-adjacency dominate.
    score += (i - windowStart) * 0.05;

    if (prev && prev.artist === incoming.artist) score -= 3;
    if (next && next.artist === incoming.artist) score -= 3;

    if (phase === "dancing" && incoming.energy !== null) {
      if (prev && prev.energy !== null && prev.energy < 0.4 && incoming.energy < 0.4) {
        score -= 1.5;
      }
    }

    score += energyFit(phase, incoming.energy) * 0.5;

    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  return bestIndex;
}

export function phaseDescription(phase: Phase): string {
  switch (phase) {
    case "prelude":
      return "guests are arriving — keep it warm and unobtrusive";
    case "cocktail":
      return "cocktail hour — easy and social";
    case "dinner":
      return "dinner — conversational, can build gently";
    case "dancing":
      return "dancing — this is the main event, high energy";
    case "lastcall":
      return "last call — winding down, nostalgic";
  }
}
