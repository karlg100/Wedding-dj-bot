import { NextRequest, NextResponse } from "next/server";
import { setPhase, advanceQueue, removeFromQueue, getQueueState, saveQueueState, reorderQueue } from "@/lib/queue";
import { searchTracks, getAudioFeatures } from "@/lib/spotify";
import { QueuedTrack } from "@/lib/types";

function checkAuth(req: NextRequest, body: any) {
  const passcode = process.env.ADMIN_PASSCODE;
  // If no passcode is configured, allow (dev convenience) — but warn via header.
  if (!passcode) return true;
  return body?.passcode === passcode;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!checkAuth(req, body)) {
    return NextResponse.json({ error: "Invalid passcode" }, { status: 401 });
  }

  const { action } = body;

  switch (action) {
    case "set_phase": {
      const state = await setPhase(body.phase);
      return NextResponse.json({ state });
    }
    case "advance": {
      const state = await advanceQueue(body.outcome ?? "played");
      return NextResponse.json({ state });
    }
    case "remove": {
      const state = await removeFromQueue(body.entryId);
      return NextResponse.json({ state });
    }
    case "reorder": {
      const state = await reorderQueue(body.orderedIds ?? []);
      return NextResponse.json({ state });
    }
    case "force_play_now": {
      // Insert at the very front of the queue, then immediately advance to it.
      const results = await searchTracks(body.query, 1);
      const top = results[0];
      if (!top) return NextResponse.json({ error: "No match found" }, { status: 404 });
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
        requestedBy: "Admin",
        requestNote: null,
        source: "request",
        status: "queued",
        screeningNote: "Admin override.",
        addedAt: Date.now(),
        playedAt: null,
      };
      const state = await getQueueState();
      state.upNext.unshift(entry);
      await saveQueueState(state);
      const advanced = await advanceQueue(state.nowPlaying ? "skipped" : "none");
      return NextResponse.json({ state: advanced });
    }
    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
}
