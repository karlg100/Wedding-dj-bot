"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { QueueState, PHASES, Phase, VibeSynthesis } from "@/lib/types";
import { SortableQueue } from "@/app/components/SortableQueue";

export default function AdminPage() {
  const [passcode, setPasscode] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [queue, setQueue] = useState<QueueState | null>(null);
  const [vibe, setVibe] = useState<VibeSynthesis | null>(null);
  const [forceQuery, setForceQuery] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("wedding-dj-admin-passcode");
      if (saved) {
        setPasscode(saved);
        setUnlocked(true);
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (!unlocked) return;
    const poll = () => {
      fetch("/api/queue", { cache: "no-store" })
        .then((r) => r.json())
        .then(setQueue)
        .catch(() => {});
      fetch("/api/vibe")
        .then((r) => r.json())
        .then((d) => setVibe(d.synthesis))
        .catch(() => {});
    };
    poll();
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, [unlocked]);

  async function call(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, passcode, ...extra }),
      });
      if (res.status === 401) {
        setUnlocked(false);
        try {
          sessionStorage.removeItem("wedding-dj-admin-passcode");
        } catch {}
        return;
      }
      const data = await res.json();
      if (data.state) setQueue(data.state);
    } finally {
      setBusy(false);
    }
  }

  function tryUnlock() {
    setUnlocked(true);
    try {
      sessionStorage.setItem("wedding-dj-admin-passcode", passcode);
    } catch {}
  }

  if (!unlocked) {
    return (
      <main className="flex-1 flex items-center justify-center px-6">
        <div className="w-full max-w-xs text-center">
          <h1 className="font-display text-3xl mb-5">Admin</h1>
          <input
            type="password"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && tryUnlock()}
            placeholder="Passcode"
            className="w-full rounded-2xl border border-ink/15 bg-white px-4 py-3 text-center mb-3 outline-none focus:border-ink"
          />
          <button
            onClick={tryUnlock}
            className="w-full rounded-full bg-ink text-paper font-semibold py-3 hover:opacity-90 transition-opacity"
          >
            Enter
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 px-5 py-8">
      <div className="max-w-lg mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="font-display text-3xl">Admin override</h1>
          <Link href="/dj" className="text-sm text-ink/50 hover:text-ink">
            DJ booth →
          </Link>
        </div>

        {/* Vibe synthesis */}
        <section className="mb-7 rounded-2xl bg-white border border-ink/10 p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs uppercase tracking-wider text-ink/45 font-semibold">
              Room read (from guest chats)
            </h2>
            <button
              onClick={() => fetch("/api/vibe", { method: "POST" }).then((r) => r.json()).then((d) => setVibe(d.synthesis))}
              className="text-xs text-espresso hover:underline"
            >
              Refresh
            </button>
          </div>
          {vibe ? (
            <div>
              <p className="text-sm mb-1">{vibe.summary}</p>
              <p className="text-xs text-ink/40">
                Energy lean: {vibe.energyLean} · from {vibe.sampleSize} recent read{vibe.sampleSize === 1 ? "" : "s"}
              </p>
            </div>
          ) : (
            <p className="text-sm text-ink/40">No reads yet tonight.</p>
          )}
        </section>

        {/* Phase override */}
        <section className="mb-7">
          <h2 className="text-xs uppercase tracking-wider text-ink/45 font-semibold mb-2 px-1">
            Phase
          </h2>
          <div className="flex flex-wrap gap-2">
            {PHASES.map((p) => (
              <button
                key={p.id}
                onClick={() => call("set_phase", { phase: p.id })}
                disabled={busy}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors disabled:opacity-50 ${
                  queue?.phase === p.id
                    ? "bg-ink text-paper"
                    : "bg-white text-ink/55 border border-ink/10"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </section>

        {/* Force play */}
        <section className="mb-7">
          <h2 className="text-xs uppercase tracking-wider text-ink/45 font-semibold mb-2 px-1">
            Force play now
          </h2>
          <div className="flex gap-2">
            <input
              type="text"
              value={forceQuery}
              onChange={(e) => setForceQuery(e.target.value)}
              placeholder="Song title and artist"
              className="flex-1 rounded-full border border-ink/15 bg-white px-4 py-2.5 text-sm outline-none focus:border-ink"
            />
            <button
              onClick={() => {
                call("force_play_now", { query: forceQuery });
                setForceQuery("");
              }}
              disabled={busy || !forceQuery.trim()}
              className="rounded-full bg-ink text-paper font-semibold px-5 text-sm disabled:opacity-40"
            >
              Play
            </button>
          </div>
        </section>

        {/* Now playing + skip */}
        {queue?.nowPlaying && (
          <section className="mb-7 rounded-2xl bg-espresso text-paper p-4 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-wider text-blush font-semibold mb-0.5">
                Now playing
              </p>
              <p className="text-sm truncate">{queue.nowPlaying.title} · {queue.nowPlaying.artist}</p>
            </div>
            <button
              onClick={() => call("advance", { outcome: "skipped" })}
              disabled={busy}
              className="rounded-full bg-paper/10 px-4 py-2 text-sm hover:bg-paper/15 transition-colors flex-shrink-0"
            >
              Skip
            </button>
          </section>
        )}

        {/* Queue with remove */}
        <h2 className="text-xs uppercase tracking-wider text-ink/45 font-semibold mb-2 px-1">
          Queue · {queue?.upNext.length ?? 0}
        </h2>
        {queue && queue.upNext.length > 0 && (
          <SortableQueue
            tracks={queue.upNext}
            onRemove={(entryId) => call("remove", { entryId })}
            onReorder={(orderedIds) => call("reorder", { orderedIds })}
          />
        )}
      </div>
    </main>
  );
}
