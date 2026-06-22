# Wedding DJ — Handoff Doc

For: Karl & Micaela's wedding, **July 3, 2026**, Groton, MA.
Written: mid-build, for handoff from claude.ai chat → Claude Cowork (or any fresh agent session).

**Read this first, then ask Karl any open questions before changing code.**

---

## What this is

A web app that runs music at the reception. Guests open a private chat with
an AI DJ on their own phones to request songs and talk about music. One
designated device is the actual speaker (via Spotify Premium + Web
Playback SDK). Karl/Micaela have an admin override page. When nobody's
requesting anything, Claude picks wedding-appropriate songs itself so the
music never stops.

- **Repo**: https://github.com/karlg100/Wedding-dj-bot
- **Live**: https://wedding-dj-bot.vercel.app
- **Stack**: Next.js 16 (App Router) on Vercel, Upstash Redis (shared
  state), Spotify Web Playback SDK (audio), Anthropic API (guest chat +
  auto-fill), Tailwind v4.
- **Status as of this doc**: fully deployed and live. Spotify OAuth,
  Redis, Anthropic chat, and real audio playback have all been tested
  working end-to-end on the production URL.

## How to run it

```
npm install
npm run dev       # local dev — falls back to in-memory store if no Redis env vars set
npm run build     # production build, always run this before considering a change done
```

Local dev works without any Spotify/Anthropic keys configured, but auth
and chat routes will just fail gracefully — to test those for real you
need `.env.local` populated (see `.env.example`) and a deployed instance
(Spotify's OAuth redirect must hit a real public URL, can't be
localhost).

## Required environment variables (set in Vercel, not just locally)

| Var | Where to get it |
|---|---|
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | developer.spotify.com/dashboard — redirect URI must be `https://wedding-dj-bot.vercel.app/api/auth/callback` |
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `ADMIN_PASSCODE` | self-chosen, gates `/admin` |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (or legacy `KV_REST_API_URL`/`KV_REST_API_TOKEN`) | auto-set by Vercel's "Redis" marketplace integration once connected to the project — both naming schemes are supported in code |

All four categories are already configured in the live Vercel project.
This list is for reference if redeploying elsewhere.

## Pages

- `/` — landing page, links to guest/DJ
- `/guest` — guest's private 1:1 chat with the AI DJ. Name entered once,
  identity persisted via a generated `guestId` in `localStorage` (device
  = identity for the night, not a login).
- `/dj` — the DJ booth. Now-playing display, transport controls
  (play/pause/seek/restart/rewind/ff), drag-to-reorder queue, phase
  selector, device/speaker panel. **Every device that opens this page
  gets full controls** — see "Speaker model" below for how audio output
  is actually decided.
- `/dj/setup` — paste in the backbone playlist (couple's taste seed),
  edit the do-not-play keyword list.
- `/admin` — passcode-gated. Direct phase/queue override, force-play,
  view the AI's synthesized "room vibe" read. Not linked from anywhere
  guest-facing.

## Architecture, file by file

**State & storage**
- `lib/store.ts` — Redis abstraction (Upstash client). Falls back to an
  in-memory store for local dev. **Do not reintroduce `@vercel/kv`** —
  it's deprecated; we migrated off it deliberately (see Decision Log).
- `lib/types.ts` — all shared types. `QueueState` is the central shared
  object: phase, nowPlaying, upNext[], history[], vetoKeywords,
  speakerDeviceId/Name/AssignedAt.
- `lib/queue.ts` — CRUD on `QueueState`. Note `getQueueState()` merges
  stored state with `DEFAULT_QUEUE_STATE` — this matters because we've
  added fields to the schema mid-flight (e.g. speaker fields) and old
  Redis data needs to gracefully gain new fields rather than coming back
  `undefined`. **Keep doing this** if you add more fields later.
- `lib/guestSessions.ts` — per-guest chat history, vibe read log +
  synthesis storage.

**Spotify**
- `lib/spotify.ts` — OAuth token exchange/refresh, search, audio
  features, device listing, `transferPlayback`. Server-side only.
- `lib/useSpotifyPlayer.ts` — **the most complex file in the project.**
  Client-side hook wrapping the Web Playback SDK. Handles the speaker
  model, iOS audio unlock, transport controls, resume-on-reload. Read
  its top-of-file comment block before touching it — there's a lot of
  hard-won context baked into the comments specifically because this
  file has been the source of most bugs so far.

**Curation / AI**
- `lib/curation.ts` — `screenTrack()` (explicit/veto content screening,
  intentionally does NOT contain a slur/vulgarity wordlist — that's a
  deliberate safety choice, extend via the couple-editable
  `vetoKeywords` list instead, not by hardcoding more terms).
  `chooseInsertIndex()` — queue pacing logic (energy curve per phase,
  avoid same-artist stacking).
- `lib/djChat.ts` — the guest-facing chat engine. Calls the Anthropic
  API with tool use: `search_songs`, `queue_song`, `log_vibe_read`,
  `get_now_playing_and_history`, `get_backbone_playlist`. **Critical
  constraint**: the AI must never reveal the upcoming queue order. This
  is enforced structurally, not just by prompt — `upNext` is never
  passed into any tool result the guest-facing AI receives. If you add
  new tools here, preserve that boundary.
- `lib/autofill.ts` — when `upNext.length < 3`, asks Claude to pick
  wedding-appropriate songs (using the backbone list as a *taste seed*,
  not a literal playlist — Karl was explicit about this distinction),
  searches Spotify, screens, and queues them. Tagged `source: "autofill"`
  in the queue so it's visually distinguishable from guest requests and
  backbone tracks. Has a 25s cooldown lock (`tryClaimAutoFillSlot`) so
  many devices polling simultaneously don't all trigger it at once.

**UI components**
- `app/components/SortableQueue.tsx` — drag-to-reorder queue list
  (`@dnd-kit`), used on both `/dj` and `/admin`.
- `app/components/DevicePanel.tsx` — speaker assignment UI: shows
  current speaker, lets a device claim the role with a confirmation
  step, lists all Spotify-visible devices.

## The speaker model (important — read before touching playback code)

Karl wanted: multiple people on multiple phones all controlling one
shared queue, but only **one** device actually outputs sound. This isn't
how Spotify Connect works by default — every connected browser tab
fights to be "the active device." We built an explicit model on top:

- Every device that loads `/dj` initializes its own Web Playback SDK
  instance (a candidate speaker) but does **not** auto-claim the active
  Spotify Connect role.
- `QueueState.speakerDeviceId`/`speakerDeviceName` (server-side, in
  Redis) records which one actually is the speaker.
- A device only claims the Connect active-device role for itself if its
  **own stable name** matches the server's recorded speaker name.
- All playback commands (play/pause/seek/skip) from *any* device target
  the **speaker's** Spotify device ID, not the clicking device's own ID
  — that's what makes "skip" on a non-speaker phone actually work.
- Identity is matched by **name, not raw Spotify device_id** — Spotify
  issues a new `device_id` every reconnect (e.g. every page reload) even
  though the browser is the same. The device name is generated once and
  persisted in `localStorage` (`wedding-dj-device-name`) specifically so
  a reloaded speaker tab recognizes itself and re-claims the role
  automatically, instead of needing to be re-selected every time.

## Decision log — bugs hit and why the fix looks the way it does

Worth reading before changing playback code, so you don't reintroduce
something already fixed:

1. **iOS Safari played nothing despite "Connected" + track showing.**
   Root cause: Safari blocks audio not triggered by a direct user
   gesture; our code called play from a `useEffect`, not a click.
   Fix: `playerRef.current.activateElement()` called from inside the
   actual button click handler, plus the "Next track" button calls
   `playUri()` synchronously on click rather than waiting for a
   server round-trip and reacting to state change.

2. **Reconnect loop — `/dj` kept dropping back to the "Connect Spotify"
   gate on reload even though the server-side token was fine.**
   Root cause: a single failed/slow fetch to `/api/auth/refresh` (e.g.
   serverless cold start) was being treated as "definitely
   disconnected," with no retry.
   Fix: retry with backoff (a few attempts) before concluding
   disconnected.

3. **Multiple tabs/devices fighting over Spotify Connect.**
   Root cause: every open tab auto-claimed the active device role.
   Fix: the speaker model described above.

4. **Ghost devices piling up in the Spotify device list.**
   Root cause: device name was randomized on every page load, so every
   reload registered as a brand-new Connect device; old ones lingered
   until Spotify's own server-side timeout.
   Fix: stable, `localStorage`-persisted device name per browser.
   Caveat: Spotify's API has no endpoint to force-delete a stale device
   — already-created ghosts only clear once the tab is actually closed
   and Spotify's timeout elapses. Not fixable from our side beyond not
   creating new ones.

5. **`@vercel/kv` is deprecated.** Migrated to `@upstash/redis`,
   supporting both `UPSTASH_REDIS_REST_URL`/`TOKEN` and the legacy
   `KV_REST_API_URL`/`TOKEN` naming (Vercel's Redis marketplace
   integration may set either depending on provider).

6. **Background auto-fill work was getting killed before completing.**
   Root cause: Vercel serverless functions terminate as soon as a
   response is sent — a bare unawaited promise after `return` doesn't
   reliably finish.
   Fix: wrapped the auto-fill trigger in `after()` from `next/server`
   (Next.js 15.1+), which Vercel guarantees runs to completion.

7. **Reloading the speaker tab mid-track restarted the song from 0:00.**
   Fix: the speaker device persists a small `{trackUri, positionMs,
   isPaused, savedAt}` snapshot to `localStorage` continuously (via the
   SDK's `player_state_changed` event), and on reconnect, if the
   snapshot matches the currently-playing track, resumes there
   (extrapolating elapsed time, capped at 5 minutes of staleness)
   instead of starting over.

## Safety/product constraints — please preserve these

- **Guest chat is strictly private, 1:1.** Never make it a group chat or
  expose one guest's conversation to another.
- **The AI must never reveal the upcoming queue order**, even if asked
  directly or persistently. This is structural (the relevant tools never
  receive `upNext`), not just a prompt instruction — keep it that way if
  you add features.
- **Vibe aggregation must not let one guest dominate.** The
  `log_vibe_read` tool logs a read per-guest; synthesis happens via a
  separate Claude call summarizing the *pattern* across the recent log,
  not any single read.
- **Explicit content**: moderate language is allowed; the "really
  vulgar" bar is intentionally a thin, non-exhaustive keyword check
  (`HARD_PASS_TERMS` in `lib/curation.ts`) plus the couple's own editable
  `vetoKeywords` — by design, this file does not contain a slur/explicit
  wordlist, and it shouldn't gain one. Extend via the admin-editable list
  instead.
- **Admin override (`/admin`) is intentionally unlinked** from any
  guest-facing page and passcode-gated.

## Outstanding / next steps

1. **Seed the real backbone playlist.** Karl has a 76-song Apple Music
   playlist ("M and K" by DJ Catarrhini — country-leaning: Rodney
   Atkins, Tim McGraw, Dierks Bentley, Kenny Chesney, Jake Owen, Nelly,
   etc.) at
   `https://music.apple.com/us/playlist/m-and-k/pl.u-8aPz1sG4127`.
   Apple Music's web player doesn't expose the full tracklist to
   automated fetches — Karl is pasting it in manually from his Mac. Once
   pasted, run it through `/dj/setup`'s "Add to backbone queue" flow,
   which matches each title against Spotify and seeds the queue.
2. **Final live end-to-end test** with multiple real guest phones
   simultaneously hitting `/guest`, to confirm the chat + queue holds up
   under concurrent use.
3. **Decide and test the actual physical speaker device** for the
   wedding day — ideally tested at the real venue beforehand (Wi-Fi
   reliability, audio output routing, screen-lock/sleep settings on that
   device).
4. **Possible future direction, discussed but not built**: a
   multi-tenant version where other couples could sign up and run their
   own event. Spotify's OAuth would work fine for this as-is (one
   registered developer app can authorize any number of end-user
   accounts) — the real work is everywhere else: every Redis key,
   route, and guest/admin link is currently global/singleton and would
   need to become scoped by an event ID.

## Minor known items, not urgent

- `playTrackOnDevice()` in `lib/spotify.ts` is unused dead code (superseded
  by the client-side SDK flow). Harmless, could be removed for cleanliness.
- Git remote is already configured: `origin` →
  `https://github.com/karlg100/Wedding-dj-bot.git`, `main` tracks
  `origin/main`. A plain `git push`/`git pull` from Karl's local clone is
  all that's needed going forward.
