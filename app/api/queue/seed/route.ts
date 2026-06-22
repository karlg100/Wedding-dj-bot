import { NextRequest, NextResponse } from "next/server";
import { searchTracks, getAudioFeatures } from "@/lib/spotify";
import { addSeedTracks } from "@/lib/queue";
import { QueuedTrack } from "@/lib/types";

// Accepts a list of free-text song queries (e.g. "Sweet Caroline Neil Diamond")
// typically pasted from an Apple Music playlist, resolves each against
// Spotify's catalog, and appends matches to the backbone queue.
export async function POST(req: NextRequest) {
  const { queries } = await req.json();
  if (!Array.isArray(queries) || queries.length === 0) {
    return NextResponse.json({ error: "Missing queries" }, { status: 400 });
  }

  const matched: QueuedTrack[] = [];
  const unmatched: string[] = [];

  for (const q of queries as string[]) {
    if (!q || !q.trim()) continue;
    try {
      const results = await searchTracks(q.trim(), 1);
      const top = results[0];
      if (!top) {
        unmatched.push(q);
        continue;
      }
      matched.push({
        id: crypto.randomUUID(),
        spotifyUri: top.spotifyUri,
        spotifyId: top.spotifyId,
        title: top.title,
        artist: top.artist,
        album: top.album,
        albumArt: top.albumArt,
        durationMs: top.durationMs,
        explicit: top.explicit,
        energy: null,
        tempo: null,
        requestedBy: null,
        requestNote: null,
        source: "seed",
        status: "queued",
        holdUntilPhase: null,
        screeningNote: `Matched from: "${q}"`,
        addedAt: Date.now(),
        playedAt: null,
      });
    } catch {
      unmatched.push(q);
    }
  }

  const ids = matched.map((m) => m.spotifyId);
  const features = await getAudioFeatures(ids);
  for (const m of matched) {
    const f = features[m.spotifyId];
    if (f) {
      m.energy = f.energy;
      m.tempo = f.tempo;
    }
  }

  const state = await addSeedTracks(matched);
  return NextResponse.json({ state, matchedCount: matched.length, unmatched });
}
