"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export default function SetupPage() {
  const [playlistText, setPlaylistText] = useState("");
  const [seeding, setSeeding] = useState(false);
  const [seedResult, setSeedResult] = useState<{ matched: number; unmatched: string[] } | null>(
    null
  );
  const [vetoText, setVetoText] = useState("");
  const [savingVeto, setSavingVeto] = useState(false);
  const [vetoSaved, setVetoSaved] = useState(false);

  useEffect(() => {
    fetch("/api/queue", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setVetoText((d.vetoKeywords ?? []).join("\n")))
      .catch(() => {});
  }, []);

  async function seedPlaylist() {
    const queries = playlistText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (queries.length === 0) return;
    setSeeding(true);
    setSeedResult(null);
    try {
      const res = await fetch("/api/queue/seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queries }),
      });
      const data = await res.json();
      setSeedResult({ matched: data.matchedCount ?? 0, unmatched: data.unmatched ?? [] });
      setPlaylistText("");
    } finally {
      setSeeding(false);
    }
  }

  async function saveVeto() {
    setSavingVeto(true);
    setVetoSaved(false);
    try {
      const keywords = vetoText
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      await fetch("/api/queue/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vetoKeywords: keywords }),
      });
      setVetoSaved(true);
    } finally {
      setSavingVeto(false);
    }
  }

  return (
    <main className="flex-1 px-5 py-8 sm:py-10">
      <div className="max-w-lg mx-auto">
        <Link href="/dj" className="text-sm text-ink/50 hover:text-ink mb-6 inline-block">
          ← Back to booth
        </Link>
        <p className="eyebrow tracking-[0.2em] text-xs uppercase font-medium mb-1">
          Setup
        </p>
        <h1 className="font-display text-4xl mb-8">Before the day</h1>

        {/* Seed playlist */}
        <section className="mb-10">
          <h2 className="font-display text-xl mb-2">Backbone playlist</h2>
          <p className="text-sm text-ink/60 mb-3 leading-relaxed">
            Paste songs from your Apple Music playlist, one per line — title and
            artist works best (e.g. <span className="italic">Sweet Caroline Neil Diamond</span>).
            These play whenever the request queue runs dry.
          </p>
          <textarea
            value={playlistText}
            onChange={(e) => setPlaylistText(e.target.value)}
            rows={8}
            placeholder={"Sweet Caroline - Neil Diamond\nDancing Queen - ABBA\nI Wanna Dance with Somebody - Whitney Houston"}
            className="w-full rounded-2xl border border-ink/15 bg-white px-4 py-3.5 text-sm font-mono leading-relaxed outline-none focus:border-ink transition-colors mb-3"
          />
          <button
            onClick={seedPlaylist}
            disabled={seeding || !playlistText.trim()}
            className="rounded-full bg-ink text-paper font-semibold py-3 px-6 text-sm hover:opacity-90 transition-colors disabled:opacity-40"
          >
            {seeding ? "Matching against Spotify…" : "Add to backbone queue"}
          </button>

          {seedResult && (
            <div className="mt-4 text-sm">
              <p className="mb-1" style={{ color: "var(--greige-deep)" }}>
                Added {seedResult.matched} track{seedResult.matched === 1 ? "" : "s"}.
              </p>
              {seedResult.unmatched.length > 0 && (
                <div className="text-ink/50">
                  <p className="mb-1">Couldn&rsquo;t find a confident match for:</p>
                  <ul className="list-disc list-inside space-y-0.5">
                    {seedResult.unmatched.map((u, i) => (
                      <li key={i}>{u}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Veto keywords */}
        <section>
          <h2 className="font-display text-xl mb-2">Do-not-play list</h2>
          <p className="text-sm text-ink/60 mb-3 leading-relaxed">
            Songs, artists, or words to keep off the queue no matter who requests
            them — one per line. Moderate explicit lyrics are allowed by default;
            this is for anything you specifically want to rule out.
          </p>
          <textarea
            value={vetoText}
            onChange={(e) => setVetoText(e.target.value)}
            rows={5}
            placeholder={"e.g. an artist, a song title, a word"}
            className="w-full rounded-2xl border border-ink/15 bg-white px-4 py-3.5 text-sm font-mono leading-relaxed outline-none focus:border-ink transition-colors mb-3"
          />
          <button
            onClick={saveVeto}
            disabled={savingVeto}
            className="rounded-full border border-ink/20 text-ink font-medium py-3 px-6 text-sm hover:border-ink/40 transition-colors disabled:opacity-40"
          >
            {savingVeto ? "Saving…" : "Save list"}
          </button>
          {vetoSaved && <span className="ml-3 text-sm" style={{ color: "var(--greige-deep)" }}>Saved.</span>}
        </section>
      </div>
    </main>
  );
}
