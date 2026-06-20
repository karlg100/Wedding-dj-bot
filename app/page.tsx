import Link from "next/link";

export default function Home() {
  return (
    <main className="flex-1 flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-md text-center rise-in">
        <p className="eyebrow mb-5">Micaela &amp; Karl · July 3, 2026</p>

        <div className="mb-2">
          <span className="font-display text-2xl tracking-wide">M&amp;K</span>
        </div>
        <div className="w-10 h-px bg-greige mx-auto mb-7" />

        <h1 className="font-display text-4xl sm:text-5xl leading-[1.15] mb-4 text-ink">
          What should we<br />play next?
        </h1>
        <p className="text-ink-soft/70 mb-10 leading-relaxed" style={{ color: "var(--ink-soft)" }}>
          Send a song up to the DJ table, or pull up the booth to see what&rsquo;s queued.
        </p>

        <div className="flex flex-col gap-3">
          <Link
            href="/guest"
            className="rounded-full bg-ink text-paper font-semibold py-4 px-6 text-lg hover:opacity-90 transition-opacity"
          >
            Request a song
          </Link>
          <Link
            href="/dj"
            className="rounded-full border border-ink/15 text-ink/60 font-medium py-3.5 px-6 hover:border-ink/30 hover:text-ink transition-colors"
          >
            DJ booth
          </Link>
        </div>
      </div>
    </main>
  );
}
