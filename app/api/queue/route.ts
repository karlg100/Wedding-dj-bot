import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { getQueueState, addToQueue } from "@/lib/queue";
import { getAudioFeatures } from "@/lib/spotify";
import { screenTrack } from "@/lib/curation";
import { QueuedTrack } from "@/lib/types";
import { maybeAutoFillQueue } from "@/lib/autofill";

export async function GET() {
  const state = await getQueueState();

  // Vercel serverless functions terminate as soon as the response is
  // sent — a bare unawaited promise here would get killed mid-flight.
  // after() keeps this function alive until the auto-fill check (and any
  // Claude/Spotify calls it makes) finishes, without delaying the
  // response itself. maybeAutoFillQueue() internally no-ops fast on the
  // common path (queue healthy, or another request already claimed the
  // cooldown slot), so this stays cheap most of the time.
  after(() => maybeAutoFillQueue().catch((e) => console.error("Auto-fill trigger failed", e)));

  return NextResponse.json(state);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { track, requestedBy, requestNote } = body as {
    track: {
      spotifyId: string;
      spotifyUri: string;
      title: string;
      artist: string;
      album: string;
      albumArt: string;
      durationMs: number;
      explicit: boolean;
    };
    requestedBy?: string;
    requestNote?: string;
  };

  if (!track?.spotifyId || !track?.spotifyUri) {
    return NextResponse.json({ error: "Missing track" }, { status: 400 });
  }

  const state = await getQueueState();
  const screening = screenTrack(track, state.vetoKeywords);

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
    requestedBy: requestedBy?.trim() || null,
    requestNote: requestNote?.trim() || null,
    source: "request",
    status: screening.accept ? "queued" : "rejected",
    holdUntilPhase: null,
    screeningNote: screening.reason,
    addedAt: Date.now(),
    playedAt: null,
  };

  if (!screening.accept) {
    return NextResponse.json(
      { accepted: false, reason: screening.reason },
      { status: 200 }
    );
  }

  const updated = await addToQueue(entry);
  return NextResponse.json({ accepted: true, state: updated });
}
