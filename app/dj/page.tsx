"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useSpotifyPlayer } from "@/lib/useSpotifyPlayer";
import { QueueState } from "@/lib/types";
import { PHASES, Phase } from "@/lib/types";

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
  const player = useSpotifyPlayer();

  const refreshQueue = useCallback(async () => {
    try {
      const res = await fetch("/api/queue", { cache: "no-store" });
      const data = await res.json();
      setQueue(data);
    } catch {}
  }, []);

  useEffect(() => {
    fetch("/api/auth/refresh")
      .then((r) => r.json())
      .then((d) => setConnected(d.connected))
      .catch(() => setConnected(false));
    refreshQueue();
    const interval = setInterval(refreshQueue, 4000);
    return () => clearInterval(interval);
  }, [refreshQueue]);

  // When a new track becomes "now playing" and the player is ready, play it.
  useEffect(() => {
    if (player.status === "ready" && queue?.nowPlaying) {
      player.playUri(queue.nowPlaying.spotifyUri);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue?.nowPlaying?.id, player.status]);

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
            <PlayerStatusDot status={player.status} />
            <Link href="/dj/setup" className="text-xs text-ink/40 hover:text-ink/70">
              Setup
            </Link>
          </div>
        </header>

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
            <p className="text-xs text-rust mt-3">{player.errorMessage}</p>
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
          <ul className="space-y-1.5 mb-8">
            {queue.upNext.map((t, i) => (
              <li
                key={t.id}
                className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl bg-white border border-ink/8"
              >
                <span className="text-xs text-ink/35 w-4 flex-shrink-0 text-right">
                  {i + 1}
                </span>
                {t.albumArt ? (
                  <img src={t.albumArt} alt="" className="w-10 h-10 rounded-md object-cover flex-shrink-0" />
                ) : (
                  <div className="w-10 h-10 rounded-md bg-paper-deep flex-shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{t.title}</p>
                  <p className="text-xs text-ink/50 truncate">
                    {t.artist} · {formatDuration(t.durationMs)}
                    {t.requestedBy ? ` · ${t.requestedBy}` : t.source === "seed" ? " · backbone" : ""}
                  </p>
                </div>
                <button
                  onClick={() => removeTrack(t.id)}
                  className="text-ink/30 hover:text-rust text-xs px-2 py-1 flex-shrink-0"
                  aria-label={`Remove ${t.title}`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink/40 mb-8 px-1">
            Queue&rsquo;s empty — seed a playlist or wait on requests.
          </p>
        )}
      </div>
    </main>
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
