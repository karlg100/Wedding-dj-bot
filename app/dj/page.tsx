"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useSpotifyPlayer } from "@/lib/useSpotifyPlayer";
import { QueueState } from "@/lib/types";
import { PHASES, Phase } from "@/lib/types";
import { SortableQueue } from "@/app/components/SortableQueue";
import { DevicePanel } from "@/app/components/DevicePanel";

function formatDuration(ms: number) {
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

export default function DjPage() {
  const [queue, setQueue] = useState<QueueState | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [advancing, setAdvancing] = useState(false);
  const [showDevices, setShowDevices] = useState(false);
  const player = useSpotifyPlayer({
    id: queue?.speakerDeviceId ?? null,
    name: queue?.speakerDeviceName ?? null,
  });

  const refreshQueue = useCallback(async () => {
    try {
      const res = await fetch("/api/queue", { cache: "no-store" });
      const data = await res.json();
      setQueue(data);
    } catch {}
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function checkConnection(attempt = 0) {
      try {
        const res = await fetch("/api/auth/refresh", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = await res.json();
        if (cancelled) return;
        setConnected(Boolean(d.connected));
      } catch {
        if (cancelled) return;
        // A failed/slow request (e.g. cold serverless start) doesn't mean
        // Spotify isn't connected — retry a few times before showing the
        // reconnect screen, rather than collapsing any hiccup into "false".
        if (attempt < 3) {
          setTimeout(() => checkConnection(attempt + 1), 800 * (attempt + 1));
        } else {
          setConnected(false);
        }
      }
    }

    checkConnection();
    refreshQueue();
    const interval = setInterval(refreshQueue, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [refreshQueue]);

  // When a new track becomes "now playing" — e.g. picked up via the 4s
  // poll because another device (admin override, another tab) advanced
  // the queue — try to play it. This won't reliably produce sound on iOS
  // Safari since it's not a direct click, but it's the best available
  // fallback for state changes that don't originate from this device's UI.
  // lastClickPlayedId avoids re-issuing the same play call this device
  // already triggered synchronously from the Next track button.
  const lastClickPlayedId = useRef<string | null>(null);
  useEffect(() => {
    if (
      player.isSpeaker &&
      player.status === "ready" &&
      queue?.nowPlaying &&
      queue.nowPlaying.id !== lastClickPlayedId.current
    ) {
      player.playUri(queue.nowPlaying.spotifyUri);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue?.nowPlaying?.id, player.status, player.isSpeaker]);

  async function setPhase(phase: Phase) {
    const res = await fetch("/api/phase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phase }),
    });
    const data = await res.json();
    setQueue(data);
  }

  async function advance(outcome: "played" | "skipped") {
    setAdvancing(true);
    // Play directly inside this click handler (not via a useEffect after
    // state settles) — iOS Safari requires audio to start from a real,
    // synchronous user gesture or it silently blocks sound while still
    // reporting success everywhere else.
    const upcoming = queue?.upNext[0];
    if (upcoming) {
      lastClickPlayedId.current = upcoming.id;
      player.playUri(upcoming.spotifyUri);
    }
    try {
      const res = await fetch("/api/queue/advance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome }),
      });
      const data = await res.json();
      setQueue(data);
    } finally {
      setAdvancing(false);
    }
  }

  async function removeTrack(entryId: string) {
    const res = await fetch("/api/queue/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entryId }),
    });
    const data = await res.json();
    setQueue(data);
  }

  async function reorderTracks(orderedIds: string[]) {
    // Optimistic update so the drag feels instant; the 4s poll will
    // reconcile with the server either way, and the response below
    // corrects it immediately if anything mismatches.
    setQueue((prev) => {
      if (!prev) return prev;
      const byId = new Map(prev.upNext.map((t) => [t.id, t]));
      const reordered = orderedIds.map((id) => byId.get(id)).filter(Boolean) as typeof prev.upNext;
      return { ...prev, upNext: reordered };
    });
    const res = await fetch("/api/queue/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds }),
    });
    const data = await res.json();
    setQueue(data);
  }

  if (connected === false) {
    return (
      <main className="flex-1 flex items-center justify-center px-6">
        <div className="max-w-sm text-center rise-in">
          <p className="eyebrow tracking-[0.2em] text-xs uppercase font-medium mb-3">
            DJ Booth
          </p>
          <h1 className="font-display text-4xl mb-4">Connect Spotify</h1>
          <p className="text-ink/65 mb-8 leading-relaxed">
            This device will be the speaker for the night. Needs Spotify Premium,
            signed into the account you want playing.
          </p>
          <a
            href="/api/auth/login"
            className="inline-block rounded-full bg-ink text-paper font-semibold py-3.5 px-8 hover:opacity-90 transition-colors"
          >
            Connect Spotify
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 px-5 py-8 sm:py-10">
      <div className="max-w-lg mx-auto">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <p className="eyebrow tracking-[0.2em] text-xs uppercase font-medium mb-1">
              DJ Booth
            </p>
            <h1 className="font-display text-3xl">Now spinning</h1>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowDevices((s) => !s)}
              className="flex items-center gap-1.5"
            >
              {player.isSpeaker && (
                <span className="text-[10px] uppercase tracking-wide font-semibold text-espresso bg-blush/40 rounded-full px-2 py-0.5">
                  Speaker
                </span>
              )}
              <PlayerStatusDot status={player.status} />
            </button>
            <Link href="/dj/setup" className="text-xs text-ink/40 hover:text-ink/70">
              Setup
            </Link>
          </div>
        </header>

        {showDevices && (
          <DevicePanel player={player} queue={queue} onSpeakerChanged={refreshQueue} />
        )}

        {!queue?.speakerDeviceId && player.status === "ready" && !showDevices && (
          <button
            onClick={() => setShowDevices(true)}
            className="w-full mb-6 rounded-2xl bg-ink text-paper font-semibold py-3.5 px-4 text-sm rise-in"
          >
            No speaker set yet — tap to choose one
          </button>
        )}

        {player.status === "ready" && !player.audioUnlocked && (
          <button
            onClick={() => player.unlockAudio()}
            className="w-full mb-6 rounded-2xl bg-blush text-ink font-semibold py-3.5 px-4 text-sm rise-in"
          >
            🔊 Tap once to enable sound on this device
          </button>
        )}

        {/* Phase selector */}
        <div className="mb-7 -mx-5 px-5 overflow-x-auto">
          <div className="flex gap-2 w-max">
            {PHASES.map((p) => (
              <button
                key={p.id}
                onClick={() => setPhase(p.id)}
                className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                  queue?.phase === p.id
                    ? "bg-ink text-paper"
                    : "bg-white text-ink/55 border border-ink/10"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Now playing record */}
        <div className="rounded-3xl bg-espresso text-paper p-6 mb-7">
          {queue?.nowPlaying ? (
            <div className="flex items-center gap-5">
              <div className="relative w-24 h-24 flex-shrink-0">
                <div
                  className={`w-24 h-24 rounded-full overflow-hidden border-4 border-paper/10 ${
                    player.status === "ready" ? "record-spin" : ""
                  }`}
                >
                  {queue.nowPlaying.albumArt ? (
                    <img
                      src={queue.nowPlaying.albumArt}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-paper/10" />
                  )}
                </div>
                <div className="absolute inset-0 m-auto w-3 h-3 rounded-full bg-paper" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-wider text-blush font-semibold mb-1">
                  Now playing
                </p>
                <p className="font-display text-xl leading-tight mb-0.5 truncate">
                  {queue.nowPlaying.title}
                </p>
                <p className="text-sm text-paper/60 truncate">{queue.nowPlaying.artist}</p>
                {queue.nowPlaying.requestedBy && (
                  <p className="text-xs text-paper/40 mt-1">
                    requested by {queue.nowPlaying.requestedBy}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="text-center py-6">
              <p className="text-paper/50 mb-1">Nothing playing</p>
              <p className="text-xs text-paper/30">Tap a track below to start the set.</p>
            </div>
          )}

          {queue?.nowPlaying && player.status === "ready" && (
            <PlaybackTransport player={player} />
          )}

          <div className="flex gap-2 mt-5">
            <button
              onClick={() => advance("skipped")}
              disabled={advancing || !queue?.nowPlaying}
              className="flex-1 rounded-full bg-paper/10 text-paper py-2.5 text-sm font-medium hover:bg-paper/15 transition-colors disabled:opacity-40"
            >
              Skip
            </button>
            <button
              onClick={() => advance("played")}
              disabled={advancing || !queue?.upNext.length}
              className="flex-1 rounded-full bg-blush text-ink py-2.5 text-sm font-semibold hover:brightness-95 transition-all disabled:opacity-40"
            >
              Next track →
            </button>
          </div>

          {player.status === "error" && (
            <div className="mt-3 rounded-xl bg-rust/15 px-3 py-2.5">
              <p className="text-xs text-paper mb-1.5">{player.errorMessage}</p>
              <button
                onClick={() => window.location.reload()}
                className="text-xs font-semibold text-paper underline"
              >
                Reload this page
              </button>
            </div>
          )}
          {player.status === "loading" && (
            <p className="text-xs text-paper/40 mt-3">Connecting player…</p>
          )}
        </div>

        {/* Queue */}
        <h2 className="text-xs uppercase tracking-[0.15em] text-ink/45 font-semibold mb-3 px-1">
          Up next · {queue?.upNext.length ?? 0}
        </h2>
        {queue && queue.upNext.length > 0 ? (
          <SortableQueue
            tracks={queue.upNext}
            onRemove={removeTrack}
            onReorder={reorderTracks}
          />
        ) : (
          <p className="text-sm text-ink/40 mb-8 px-1">
            Queue&rsquo;s empty — seed a playlist or wait on requests.
          </p>
        )}
      </div>
    </main>
  );
}

function formatMs(ms: number) {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

function PlaybackTransport({ player }: { player: ReturnType<typeof useSpotifyPlayer> }) {
  const { playback } = player;
  const [tickPosition, setTickPosition] = useState(playback?.positionMs ?? 0);
  const [seeking, setSeeking] = useState(false);
  const [seekValue, setSeekValue] = useState(0);

  // Sync the local ticking clock whenever real SDK state arrives.
  useEffect(() => {
    if (playback) setTickPosition(playback.positionMs);
  }, [playback?.positionMs, playback?.trackUri]);

  // Smoothly advance the displayed position between SDK state updates,
  // which only fire on actual changes (play/pause/seek/track change) —
  // without this the bar would jump in chunks instead of flowing.
  useEffect(() => {
    if (!playback || playback.isPaused || seeking) return;
    const interval = setInterval(() => {
      setTickPosition((p) => Math.min(playback.durationMs, p + 250));
    }, 250);
    return () => clearInterval(interval);
  }, [playback, seeking]);

  if (!playback) {
    return <p className="text-xs text-paper/40 mt-3">Loading playback…</p>;
  }

  const displayPosition = seeking ? seekValue : tickPosition;
  const pct = playback.durationMs
    ? Math.min(100, (displayPosition / playback.durationMs) * 100)
    : 0;

  return (
    <div className="mt-5">
      {/* Progress bar */}
      <input
        type="range"
        min={0}
        max={playback.durationMs || 0}
        value={displayPosition}
        onChange={(e) => {
          setSeeking(true);
          setSeekValue(Number(e.target.value));
        }}
        onMouseUp={(e) => {
          setSeeking(false);
          player.seek(Number((e.target as HTMLInputElement).value));
        }}
        onTouchEnd={(e) => {
          setSeeking(false);
          player.seek(Number((e.target as HTMLInputElement).value));
        }}
        className="w-full accent-blush h-1.5"
        style={{
          background: `linear-gradient(to right, var(--blush) ${pct}%, rgba(255,255,255,0.15) ${pct}%)`,
        }}
        aria-label="Seek"
      />
      <div className="flex justify-between text-[10px] text-paper/40 mt-1 mb-3">
        <span>{formatMs(displayPosition)}</span>
        <span>{formatMs(playback.durationMs)}</span>
      </div>

      {/* Transport buttons */}
      <div className="flex items-center justify-center gap-5">
        <button
          onClick={() => player.restartTrack()}
          aria-label="Restart track"
          className="text-paper/70 hover:text-paper p-2"
        >
          <RestartIcon />
        </button>
        <button
          onClick={() => player.seekRelative(-10000)}
          aria-label="Rewind 10 seconds"
          className="text-paper/70 hover:text-paper p-2"
        >
          <SeekIcon direction="back" />
        </button>
        <button
          onClick={() => player.togglePlay()}
          aria-label={playback.isPaused ? "Play" : "Pause"}
          className="bg-paper text-ink rounded-full p-3.5 hover:opacity-90 transition-opacity"
        >
          {playback.isPaused ? <PlayIcon /> : <PauseIcon />}
        </button>
        <button
          onClick={() => player.seekRelative(10000)}
          aria-label="Forward 10 seconds"
          className="text-paper/70 hover:text-paper p-2"
        >
          <SeekIcon direction="forward" />
        </button>
        <div className="w-9" aria-hidden="true" />
      </div>
    </div>
  );
}

function PlayIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}
function PauseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
    </svg>
  );
}
function RestartIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </svg>
  );
}
function SeekIcon({ direction }: { direction: "back" | "forward" }) {
  const flip = direction === "back" ? "scale(-1,1)" : undefined;
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style={{ transform: flip }}>
      <path d="M11 5V1L5 7l6 6V9c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H3c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
    </svg>
  );
}

function PlayerStatusDot({ status }: { status: string }) {
  const color =
    status === "ready"
      ? "bg-greige"
      : status === "loading"
      ? "bg-blush animate-pulse"
      : status === "error"
      ? "bg-rust"
      : "bg-ink/20";
  const label =
    status === "ready"
      ? "Connected"
      : status === "loading"
      ? "Connecting"
      : status === "error"
      ? "Issue"
      : "Idle";
  return (
    <div className="flex items-center gap-1.5 text-xs text-ink/50">
      <span className={`w-2 h-2 rounded-full ${color}`} />
      {label}
    </div>
  );
}
