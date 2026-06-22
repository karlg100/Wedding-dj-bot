import { NextRequest } from "next/server";
import { getQueueState } from "@/lib/queue";

export const dynamic = "force-dynamic";

// How long to keep each SSE connection open before closing gracefully.
// EventSource retries automatically, so clients always reconnect.
// Keep well under Vercel's function max-duration (10s hobby / 300s pro).
const CONNECTION_TTL_MS = 25_000;
// How often to poll Redis for state changes inside a live connection.
const POLL_INTERVAL_MS = 1_500;

// A cheap fingerprint of the parts of QueueState that DJ clients care about.
// If this string is unchanged, skip sending — avoids streaming identical payloads.
function fingerprint(state: Awaited<ReturnType<typeof getQueueState>>): string {
  return [
    state.phase,
    state.nowPlaying?.id ?? "none",
    state.upNext.map((t) => `${t.id}:${t.status}`).join(","),
    state.speakerDeviceName ?? "none",
  ].join("|");
}

export async function GET(_req: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;

      function send(data: object) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      }

      // Push current state immediately so the client doesn't wait for the
      // first poll tick.
      let lastFingerprint: string | null = null;
      try {
        const initial = await getQueueState();
        lastFingerprint = fingerprint(initial);
        send(initial);
      } catch (e) {
        console.error("[events] initial state fetch failed", e);
      }

      // Poll Redis for changes and stream diffs to this client.
      const poll = setInterval(async () => {
        if (closed) {
          clearInterval(poll);
          return;
        }
        try {
          const state = await getQueueState();
          const fp = fingerprint(state);
          if (fp !== lastFingerprint) {
            lastFingerprint = fp;
            send(state);
          }
        } catch {
          // Non-fatal — client will get the state on next successful poll.
        }
      }, POLL_INTERVAL_MS);

      // Send a keep-alive comment every 10s so proxies / load balancers don't
      // close the connection thinking it's idle.
      const keepAlive = setInterval(() => {
        if (closed) { clearInterval(keepAlive); return; }
        try { controller.enqueue(encoder.encode(": ping\n\n")); } catch { closed = true; }
      }, 10_000);

      // Close cleanly after TTL — EventSource will reconnect automatically.
      setTimeout(() => {
        clearInterval(poll);
        clearInterval(keepAlive);
        closed = true;
        try { controller.close(); } catch {}
      }, CONNECTION_TTL_MS);
    },

    cancel() {
      // Client disconnected — nothing extra to clean up since the stream's
      // internal closed flag + interval cleanup happen via the timeout above.
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      // Tells Nginx / Vercel's edge not to buffer the stream.
      "X-Accel-Buffering": "no",
    },
  });
}
