import Anthropic from "@anthropic-ai/sdk";
import { ChatMessage, QueuedTrack, VibeSynthesis } from "./types";
import { searchTracks, getAudioFeatures } from "./spotify";
import { screenTrack, phaseDescription } from "./curation";
import { addToQueue, getQueueState } from "./queue";
import { appendVibeRead, getRecentVibeReads, saveVibeSynthesis } from "./guestSessions";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL = "claude-sonnet-4-6";

const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_songs",
    description:
      "Search Spotify's catalog for a song. Use this whenever a guest names or describes a song or artist they want to hear, even loosely (e.g. 'that one wedding song', 'something by Stevie Wonder'). Always confirm the right match with the guest before queuing it, unless they're clearly specific (exact title + artist).",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search text, e.g. 'Mr Brightside The Killers'" },
      },
      required: ["query"],
    },
  },
  {
    name: "queue_song",
    description:
      "Add a specific song to the live request queue. Only call this after you and the guest both know exactly which track (use search_songs first, and confirm with the guest if there was any ambiguity). Pass the exact spotifyId from a prior search_songs result.",
    input_schema: {
      type: "object",
      properties: {
        spotifyId: { type: "string" },
        note: {
          type: "string",
          description: "Optional short note about why, e.g. 'this was their first dance song'",
        },
      },
      required: ["spotifyId"],
    },
  },
  {
    name: "log_vibe_read",
    description:
      "Log your honest read of how this guest says the party / room is feeling right now, IF they've shared something that indicates it (you can ask once in a while, naturally, not every message). This contributes to a room-wide read combined with everyone else's — it does not change the queue on its own. Don't call this unless you actually have signal from the conversation.",
    input_schema: {
      type: "object",
      properties: {
        energy: { type: "string", enum: ["low", "medium", "high"] },
        note: { type: "string", description: "One short phrase capturing it, e.g. 'dance floor is packed'" },
      },
      required: ["energy"],
    },
  },
  {
    name: "get_now_playing_and_history",
    description:
      "Look up what's currently playing and the recent play history (most recently played first). Use this whenever a guest asks what's playing now, what a song a few minutes ago was, what's been played tonight, etc. This deliberately does NOT include anything about what's coming up next — you don't have access to that and should never imply otherwise.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_backbone_playlist",
    description:
      "Get the couple's pre-set backbone playlist for the night — the songs they picked in advance as a fallback. Use this if a guest asks something like 'what's on the wedding playlist' or 'what kind of music did they pick'. This is a general overview of the song pool, NOT the live play order or what's queued next — never present it as the upcoming sequence.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
];

const NEVER_REVEAL_NOTE =
  "Important: you have no access to the upcoming queue or play order, by design — never guess at it, hint at it, or promise a guest their song is 'coming up soon'. If asked what's next, say it's a surprise / you don't reveal that, warmly.";

function systemPrompt(phase: string, guestName: string) {
  return `You are the DJ for a wedding reception — Micaela & Karl's, a casual backyard-barbecue-meets-reception vibe, friends and family. You are chatting privately and one-on-one with a single guest named ${guestName}. This is not a group chat; nothing here is visible to other guests.

Current phase of the night: ${phase}.

Your job:
- Be warm, brief, casual — text-message length replies, not essays. No announcing, no MC duties, just a friendly DJ taking requests.
- Help guests find and queue songs they want to hear, using search_songs then queue_song.
- Moderate explicit lyrics are fine. You'll screen automatically for anything truly vulgar — don't worry about pre-judging that yourself, just take the request.
- Answer questions about what's currently playing or what's already been played using get_now_playing_and_history — guests will ask things like "what was that song a bit ago" or "what's playing right now".
- If asked about the overall playlist or the kind of music picked for the night, use get_backbone_playlist to give a general sense — this is a pool of songs, not a running order.
- You genuinely know a lot about music — happily chat about trivia, background on an artist or song, fun facts, recommendations, or anything else music-related a guest brings up, wedding-related or not. This is one of the fun parts of being the DJ.
- ${NEVER_REVEAL_NOTE}
- Occasionally and naturally, you can ask how the party's feeling, what the room's energy is like, etc. — genuine curiosity, not a survey. If they tell you something useful, log it with log_vibe_read. Don't push for this; let it come up.
- You are not the only input on the queue — many guests are talking to you in parallel, and the room's overall vibe is synthesized across all of them, so don't overcorrect the whole night based on one conversation.
- If a guest asks you to play something repeatedly or seems to be trying to dominate the queue, gently keep it friendly but don't feel obligated to queue every single ask back-to-back.
- Keep responses short — a sentence or two, like a text from a friend who happens to be DJing.`;
}

export async function synthesizeVibe(): Promise<VibeSynthesis | null> {
  const reads = await getRecentVibeReads(30);
  if (reads.length === 0) return null;

  const lines = reads
    .map((r) => `- ${r.guestName || "guest"}: energy=${r.energy}${r.note ? `, "${r.note}"` : ""}`)
    .join("\n");

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 300,
    system:
      "You synthesize how a wedding reception room is feeling right now, based on short reads from multiple guests' private chats. No single guest should dominate the read — weigh the overall pattern, not any one strong opinion. Respond with ONLY a JSON object, no markdown, no preamble: {\"summary\": string (one short sentence), \"energyLean\": \"low\"|\"medium\"|\"high\"}",
    messages: [
      {
        role: "user",
        content: `Recent reads from the last 30 minutes (${reads.length} total):\n${lines}\n\nSynthesize the overall room read.`,
      },
    ],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  try {
    const cleaned = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    const synthesis: VibeSynthesis = {
      summary: parsed.summary,
      energyLean: parsed.energyLean,
      sampleSize: reads.length,
      generatedAt: Date.now(),
    };
    await saveVibeSynthesis(synthesis);
    return synthesis;
  } catch {
    return null;
  }
}
export async function handleGuestMessage(
  guestId: string,
  guestName: string,
  history: ChatMessage[],
  newMessage: string
): Promise<{ reply: string; queuedTrack: QueuedTrack | null; rejectedReason: string | null }> {
  const state = await getQueueState();
  const messages: Anthropic.MessageParam[] = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  messages.push({ role: "user", content: newMessage });

  let queuedTrack: QueuedTrack | null = null;
  let rejectedReason: string | null = null;
  // Cache of search results within this turn so queue_song can resolve spotifyId.
  let lastSearchResults: Awaited<ReturnType<typeof searchTracks>> = [];

  let loopGuard = 0;
  while (loopGuard < 6) {
    loopGuard++;
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 600,
      system: systemPrompt(phaseDescription(state.phase), guestName),
      tools: TOOLS,
      messages,
    });

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );

    if (toolUses.length === 0) {
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return { reply: text || "…", queuedTrack, rejectedReason };
    }

    // Append assistant turn (with tool_use blocks) then run each tool.
    messages.push({ role: "assistant", content: response.content });
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const use of toolUses) {
      if (use.name === "search_songs") {
        const query = (use.input as any).query as string;
        try {
          const results = await searchTracks(query, 5);
          lastSearchResults = results;
          toolResults.push({
            type: "tool_result",
            tool_use_id: use.id,
            content: JSON.stringify(
              results.map((r) => ({
                spotifyId: r.spotifyId,
                title: r.title,
                artist: r.artist,
                album: r.album,
                explicit: r.explicit,
                durationMs: r.durationMs,
              }))
            ),
          });
        } catch (e: any) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: use.id,
            content: `Search failed: ${e.message}`,
            is_error: true,
          });
        }
      } else if (use.name === "queue_song") {
        const { spotifyId, note } = use.input as { spotifyId: string; note?: string };
        const track = lastSearchResults.find((r) => r.spotifyId === spotifyId);
        if (!track) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: use.id,
            content: "That spotifyId wasn't in the most recent search results. Search again first.",
            is_error: true,
          });
          continue;
        }
        const fresh = await getQueueState();
        const screening = screenTrack(track, fresh.vetoKeywords);
        if (!screening.accept) {
          rejectedReason = screening.reason;
          toolResults.push({
            type: "tool_result",
            tool_use_id: use.id,
            content: `Rejected: ${screening.reason}. Let the guest know kindly and suggest they try something else.`,
          });
          continue;
        }
        const features = await getAudioFeatures([track.spotifyId]);
        const f = features[track.spotifyId];
        const entry: QueuedTrack = {
          id: crypto.randomUUID(),
          spotifyUri: track.spotifyUri,
          spotifyId: track.spotifyId,
          title: track.title,
          artist: track.artist,
          album: track.album,
          albumArt: track.albumArt,
          durationMs: track.durationMs,
          explicit: track.explicit,
          energy: f?.energy ?? null,
          tempo: f?.tempo ?? null,
          requestedBy: guestName || null,
          requestNote: note?.trim() || null,
          source: "request",
          status: "queued",
          screeningNote: screening.reason,
          addedAt: Date.now(),
          playedAt: null,
        };
        await addToQueue(entry);
        queuedTrack = entry;
        toolResults.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: `Queued "${track.title}" by ${track.artist}.`,
        });
      } else if (use.name === "log_vibe_read") {
        const { energy, note } = use.input as { energy: "low" | "medium" | "high"; note?: string };
        await appendVibeRead({
          guestId,
          guestName,
          energy,
          note: note?.trim() || null,
          at: Date.now(),
        });
        toolResults.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: "Logged.",
        });
      } else if (use.name === "get_now_playing_and_history") {
        const fresh = await getQueueState();
        // Deliberately only nowPlaying + history — never upNext.
        const payload = {
          nowPlaying: fresh.nowPlaying
            ? {
                title: fresh.nowPlaying.title,
                artist: fresh.nowPlaying.artist,
                album: fresh.nowPlaying.album,
                requestedBy: fresh.nowPlaying.requestedBy,
              }
            : null,
          recentlyPlayed: fresh.history.slice(0, 15).map((t) => ({
            title: t.title,
            artist: t.artist,
            requestedBy: t.requestedBy,
            outcome: t.status,
          })),
        };
        toolResults.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: JSON.stringify(payload),
        });
      } else if (use.name === "get_backbone_playlist") {
        const fresh = await getQueueState();
        // Only ever expose seed-source tracks, as an unordered pool —
        // never the live upNext order, and never request-sourced tracks
        // (those are guests' private picks, not "the playlist").
        const seedTitles = [
          ...fresh.upNext.filter((t) => t.source === "seed"),
          ...fresh.history.filter((t) => t.source === "seed"),
        ].map((t) => `${t.title} — ${t.artist}`);
        const unique = Array.from(new Set(seedTitles));
        toolResults.push({
          type: "tool_result",
          tool_use_id: use.id,
          content:
            unique.length > 0
              ? JSON.stringify({ playlist: unique })
              : "No backbone playlist has been set up yet — just guest requests so far.",
        });
      }
    }

    messages.push({ role: "user", content: toolResults });
  }

  return {
    reply: "Sorry, got a little tangled up there — mind trying that again?",
    queuedTrack,
    rejectedReason,
  };
}
