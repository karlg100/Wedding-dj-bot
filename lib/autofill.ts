import Anthropic from "@anthropic-ai/sdk";
import {
  addToQueue,
  getPendingRequestTracks,
  getPlayableUpNext,
  getQueueState,
  getTasteList,
  tryClaimAutoFillSlot,
} from "./queue";
import { searchTracks, getAudioFeatures } from "./spotify";
import { screenTrack, phaseDescription } from "./curation";
import { QueuedTrack } from "./types";
import { getVibeSynthesis } from "./guestSessions";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = "claude-sonnet-4-6";

const MIN_QUEUE_DEPTH = 3; // top up whenever upNext drops below this
const MAX_PICKS_PER_FILL = 3;

const AUTOFILL_TOOL: Anthropic.Tool = {
  name: "queue_picks",
  description:
    "Add your chosen songs to the live queue. For each pick, give the best Spotify search query you can (title + artist) — you don't have direct catalog access, each query will be searched and the top match queued, so be specific enough to land on the right song.",
  input_schema: {
    type: "object",
    properties: {
      picks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            query: { type: "string", description: "Spotify search query, e.g. 'September Earth Wind Fire'" },
            reason: { type: "string", description: "One short phrase on why this fits right now" },
          },
          required: ["query"],
        },
      },
    },
    required: ["picks"],
  },
};

function buildSystemPrompt(): string {
  return `You are the DJ for a wedding reception — Micaela & Karl's, a casual backyard-barbecue-meets-reception vibe, friends and family. The live request queue has run low and nobody's currently asking for anything, so it's on you to keep the music going with good, wedding-appropriate picks — like a real DJ reading the room between requests.

Pick real, well-known songs (not obscure deep cuts) that fit a wedding reception: a mix of feel-good, danceable, and warmly familiar. Avoid anything sad, breakup-themed, overtly violent, or with very vulgar lyrics — moderate explicit language elsewhere is fine, just use judgment for a mixed-generation crowd. Don't repeat anything already played tonight or already queued. Avoid stacking multiple songs by the same artist back to back.

Pick ${MAX_PICKS_PER_FILL} songs using the queue_picks tool.`;
}

function buildContextMessage(params: {
  phase: string;
  tasteSeed: string[];
  recentlyPlayed: string[];
  queueWindow: string[];
  pendingRequests: string[];
  vibeSummary: string | null;
}): string {
  const { phase, tasteSeed, recentlyPlayed, queueWindow, pendingRequests, vibeSummary } = params;
  const lines: string[] = [];
  lines.push(`Current phase: ${phase}.`);
  if (vibeSummary) lines.push(`Room read from guests: ${vibeSummary}`);
  if (tasteSeed.length) {
    lines.push(
      `The couple's taste, for inspiration (not a literal playlist — use this as a seed for the kind of music they like, then pick freely in that spirit): ${tasteSeed.join(", ")}.`
    );
  }
  if (recentlyPlayed.length) {
    lines.push(`Recently played tonight (don't repeat): ${recentlyPlayed.join(", ")}.`);
  }
  if (queueWindow.length) {
    lines.push(`Next 5 playable songs in the queue window: ${queueWindow.join(", ")}.`);
  }
  if (pendingRequests.length) {
    lines.push(
      `Pending guest requests anywhere in the queue or on hold: ${pendingRequests.join(", ")}.`
    );
  }
  return lines.join("\n");
}

// Checks whether the queue needs topping up and, if so, claims a cooldown
// slot and asks Claude to pick songs. Safe to call frequently (e.g. from
// a poll) — it no-ops quickly if the queue is healthy or another request
// already claimed the slot.
export async function maybeAutoFillQueue(): Promise<{ added: number } | null> {
  const state = await getQueueState();
  const playableUpNext = getPlayableUpNext(state);
  if (playableUpNext.length >= MIN_QUEUE_DEPTH) return null;

  const claimed = await tryClaimAutoFillSlot();
  if (!claimed) return null;

  // Primary taste signal is the couple's dedicated taste list (their
  // reference playlist). Fall back to any seed-source tracks in the
  // queue/history if no taste list has been set. Sample a rotating
  // subset so the AI isn't anchored to the same handful every time.
  const tasteList = await getTasteList();
  let tastePool: string[];
  if (tasteList.length > 0) {
    tastePool = tasteList;
  } else {
    tastePool = Array.from(
      new Set(
        [...state.upNext, ...state.history]
          .filter((t) => t.source === "seed")
          .map((t) => `${t.title} by ${t.artist}`)
      )
    );
  }
  // Shuffle and take up to 30, so across the night the AI sees variety
  // from the full list rather than always the first entries.
  const tasteSeed = [...tastePool].sort(() => Math.random() - 0.5).slice(0, 30);

  const recentlyPlayed = state.history.slice(0, 12).map((t) => `${t.title} by ${t.artist}`);
  const queueWindow = playableUpNext
    .slice(0, 5)
    .map((t) => `${t.title} by ${t.artist}`);
  const pendingRequests = getPendingRequestTracks(state).map((t) => `${t.title} by ${t.artist}`);

  let vibeSummary: string | null = null;
  try {
    const vibe = await getVibeSynthesis();
    vibeSummary = vibe?.summary ?? null;
  } catch {
    // Non-fatal — proceed without it.
  }

  const contextMessage = buildContextMessage({
    phase: phaseDescription(state.phase),
    tasteSeed,
    recentlyPlayed,
    queueWindow,
    pendingRequests,
    vibeSummary,
  });

  let picks: { query: string; reason?: string }[] = [];
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 500,
      system: buildSystemPrompt(),
      tools: [AUTOFILL_TOOL],
      tool_choice: { type: "tool", name: "queue_picks" },
      messages: [{ role: "user", content: contextMessage }],
    });
    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    picks = (toolUse?.input as any)?.picks ?? [];
  } catch (e) {
    console.error("Auto-fill: Claude pick failed", e);
    return null;
  }

  let added = 0;
  const freshState = await getQueueState();
  for (const pick of picks.slice(0, MAX_PICKS_PER_FILL)) {
    try {
      const results = await searchTracks(pick.query, 1);
      const top = results[0];
      if (!top) continue;

      const screening = screenTrack(top, freshState.vetoKeywords);
      if (!screening.accept) continue;

      // Skip if it's literally already queued or just played, in case
      // Claude's pick overlapped with something despite the context.
      const alreadyThere = [...freshState.upNext, ...freshState.history.slice(0, 12)].some(
        (t) => t.spotifyId === top.spotifyId
      );
      if (alreadyThere) continue;

      const features = await getAudioFeatures([top.spotifyId]);
      const f = features[top.spotifyId];

      const entry: QueuedTrack = {
        id: crypto.randomUUID(),
        spotifyUri: top.spotifyUri,
        spotifyId: top.spotifyId,
        title: top.title,
        artist: top.artist,
        album: top.album,
        albumArt: top.albumArt,
        durationMs: top.durationMs,
        explicit: top.explicit,
        energy: f?.energy ?? null,
        tempo: f?.tempo ?? null,
        requestedBy: null,
        requestNote: pick.reason ?? null,
        source: "autofill",
        status: "queued",
        holdUntilPhase: null,
        screeningNote: "Picked by the DJ to keep the music going.",
        addedAt: Date.now(),
        playedAt: null,
      };
      await addToQueue(entry);
      added++;
    } catch (e) {
      console.error("Auto-fill: failed to queue pick", pick.query, e);
    }
  }

  return { added };
}
