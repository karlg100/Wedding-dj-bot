"use client";

import { useEffect, useRef, useState, useCallback } from "react";

declare global {
  interface Window {
    Spotify: any;
    onSpotifyWebPlaybackSDKReady: () => void;
  }
}

type PlayerStatus = "idle" | "loading" | "ready" | "error" | "no-token";

type PlaybackState = {
  isPaused: boolean;
  positionMs: number;
  durationMs: number;
  trackUri: string | null;
};

// `speakerDeviceId`/`speakerDeviceName` describe the server-designated
// speaker (from queue state). Every device initializes its own Web
// Playback SDK instance — that's what makes it eligible to ever become
// the speaker — but only issues real playback commands against the
// SPEAKER's Spotify Connect device id, and only auto-claims the Connect
// "active device" role for itself if it IS the designated speaker.
// Non-speaker devices stay connected but passive: they can see playback
// state (Spotify broadcasts state to all Connect devices watching the
// same account) without fighting over which one actually outputs audio.
//
// Identity is matched by NAME, not raw device id. Spotify issues a new
// device_id every time the Web Playback SDK reconnects (e.g. on a page
// reload), even though this browser's stable name doesn't change — so
// matching on id alone would mean every reload "loses" the speaker role
// and needs re-selecting. Matching by name means a reloaded tab
// recognizes "I was already the speaker" and re-claims automatically
// with its fresh id.
// A short, human-friendly suffix so multiple devices are distinguishable
// in the device picker (e.g. "Wedding DJ — Karl's iPhone — 4f2a"),
// generated ONCE per browser and persisted, not regenerated on every page
// load — otherwise every reload registers as a brand-new Spotify Connect
// device and old ones linger as ghosts until Spotify times them out.
const DEVICE_NAME_KEY = "wedding-dj-device-name";

function getOrCreateStableDeviceName(): string {
  if (typeof window === "undefined") return "Wedding DJ";
  try {
    const existing = localStorage.getItem(DEVICE_NAME_KEY);
    if (existing) return existing;
    const platform =
      typeof navigator !== "undefined" && navigator.platform ? navigator.platform : "device";
    const suffix = Math.random().toString(36).slice(2, 6);
    const name = `Wedding DJ — ${platform} — ${suffix}`;
    localStorage.setItem(DEVICE_NAME_KEY, name);
    return name;
  } catch {
    // localStorage unavailable (private mode, etc) — fall back to a
    // session-only name rather than crashing.
    return `Wedding DJ — ${Math.random().toString(36).slice(2, 6)}`;
  }
}

// Persisted only on the SPEAKER device, so a reload (or an accidental tab
// close/reopen) can resume the current track from roughly where it left
// off instead of restarting from 0:00. savedAt lets us extrapolate how
// much time has actually elapsed since the last snapshot, since playback
// keeps progressing in the moments between snapshots and the reload.
const RESUME_KEY = "wedding-dj-resume-snapshot";

type ResumeSnapshot = {
  trackUri: string;
  positionMs: number;
  isPaused: boolean;
  savedAt: number;
};

function saveResumeSnapshot(snapshot: ResumeSnapshot) {
  try {
    localStorage.setItem(RESUME_KEY, JSON.stringify(snapshot));
  } catch {
    // Storage unavailable — resuming just won't work this session, not fatal.
  }
}

function readResumeSnapshot(): ResumeSnapshot | null {
  try {
    const raw = localStorage.getItem(RESUME_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function clearResumeSnapshot() {
  try {
    localStorage.removeItem(RESUME_KEY);
  } catch {
    // No-op.
  }
}

export function useSpotifyPlayer(speaker: { id: string | null; name: string | null }) {
  const speakerDeviceId = speaker.id;
  const speakerDeviceName = speaker.name;
  const [status, setStatus] = useState<PlayerStatus>("idle");
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [deviceName] = useState<string>(getOrCreateStableDeviceName);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [playback, setPlayback] = useState<PlaybackState | null>(null);
  const playerRef = useRef<any>(null);
  const tokenRef = useRef<string | null>(null);
  const isSpeakerRef = useRef(false);

  // Name-based, not id-based — see the comment block above the hook for why.
  const isSpeaker = Boolean(deviceName && speakerDeviceName && deviceName === speakerDeviceName);
  isSpeakerRef.current = isSpeaker;

  useEffect(() => {
    let cancelled = false;

    async function init() {
      setStatus("loading");

      let data: { connected: boolean; accessToken: string | null } | null = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const res = await fetch("/api/auth/refresh", { cache: "no-store" });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          data = await res.json();
          break;
        } catch {
          if (attempt < 3) {
            await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
          }
        }
      }
      if (cancelled) return;
      if (!data || !data.connected || !data.accessToken) {
        setStatus("no-token");
        return;
      }
      tokenRef.current = data.accessToken;

      if (!document.getElementById("spotify-sdk-script")) {
        const script = document.createElement("script");
        script.id = "spotify-sdk-script";
        script.src = "https://sdk.scdn.co/spotify-player.js";
        script.async = true;
        document.body.appendChild(script);
      }

      window.onSpotifyWebPlaybackSDKReady = () => {
        const player = new window.Spotify.Player({
          name: deviceName,
          getOAuthToken: async (cb: (token: string) => void) => {
            const r = await fetch("/api/auth/refresh");
            const d = await r.json();
            tokenRef.current = d.accessToken;
            cb(d.accessToken);
          },
          volume: 0.8,
        });

        player.addListener("ready", ({ device_id }: { device_id: string }) => {
          if (cancelled) return;
          setDeviceId(device_id);
          setStatus("ready");
          // Deliberately NOT auto-claiming the active Connect device here.
          // Claiming only happens when this device is explicitly assigned
          // as the speaker (see the effect below) — otherwise every open
          // tab would fight over the speaker role, which is exactly the
          // multi-device confusion this whole design avoids.
        });

        player.addListener("not_ready", () => {
          if (cancelled) return;
          setStatus("error");
          setErrorMessage("Player went offline. Check the connection on this device.");
        });

        player.addListener("player_state_changed", (state: any) => {
          if (cancelled || !state) return;
          const trackUri = state.track_window?.current_track?.uri ?? null;
          setPlayback({
            isPaused: state.paused,
            positionMs: state.position,
            durationMs: state.duration,
            trackUri,
          });
          if (isSpeakerRef.current && trackUri) {
            saveResumeSnapshot({
              trackUri,
              positionMs: state.position,
              isPaused: state.paused,
              savedAt: Date.now(),
            });
          }
        });

        player.addListener("initialization_error", ({ message }: { message: string }) => {
          if (!cancelled) {
            setStatus("error");
            setErrorMessage(message);
          }
        });
        player.addListener("authentication_error", () => {
          if (!cancelled) {
            setStatus("error");
            setErrorMessage("Spotify session expired. Reconnect on this device.");
          }
        });
        player.addListener("account_error", () => {
          if (!cancelled) {
            setStatus("error");
            setErrorMessage("This needs Spotify Premium to control playback.");
          }
        });

        player.connect();
        playerRef.current = player;
      };

      if (window.Spotify && window.onSpotifyWebPlaybackSDKReady) {
        window.onSpotifyWebPlaybackSDKReady();
      }
    }

    init();
    return () => {
      cancelled = true;
      playerRef.current?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If THIS device is (by name) the designated speaker — whether it was
  // just explicitly assigned, or it reloaded and recognizes its own name
  // matches the existing assignment — claim the Spotify Connect
  // active-device role with its current id, AND tell the server about
  // this fresh id if it's drifted from what's stored (always true after
  // a reload, since Spotify hands out a new id per connection).
  // play:false so this doesn't yank audio into starting unexpectedly.
  useEffect(() => {
    if (!isSpeaker || !deviceId || !tokenRef.current) return;

    fetch("https://api.spotify.com/v1/me/player", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${tokenRef.current}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ device_ids: [deviceId], play: false }),
    }).catch(() => {
      // Non-fatal — explicit device_id on each command is the fallback.
    });

    if (speakerDeviceId !== deviceId) {
      fetch("/api/speaker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId, deviceName }),
      }).catch(() => {
        // Non-fatal — this device still works as the speaker locally even
        // if the server-side record doesn't update; it'll retry on the
        // next render where this effect's dependencies change.
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSpeaker, deviceId]);

  // All transport commands target the SPEAKER's device id, whether or not
  // this particular browser tab is the speaker — that's what makes "skip"
  // on a non-speaker phone actually control the shared output.
  async function spotifyCommand(path: string, init?: RequestInit) {
    if (!speakerDeviceId || !tokenRef.current) return null;
    const res = await fetch(`https://api.spotify.com/v1${path}`, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        Authorization: `Bearer ${tokenRef.current}`,
      },
    });
    return res;
  }

  async function playUri(uri: string, startPositionMs?: number) {
    if (!speakerDeviceId) return;
    // iOS Safari (and other mobile browsers) block audio that isn't
    // triggered by a direct user gesture. activateElement() unlocks the
    // SDK's underlying <audio> element for THIS page session — it only
    // matters/works on the speaker device, but it's harmless to call
    // elsewhere too.
    if (isSpeakerRef.current) {
      try {
        await playerRef.current?.activateElement?.();
      } catch {
        // No-op — some SDK versions lack this method, or it's unlocked.
      }
    }
    const body: Record<string, unknown> = { uris: [uri] };
    if (startPositionMs && startPositionMs > 0) {
      body.position_ms = Math.round(startPositionMs);
    }
    const res = await spotifyCommand(`/me/player/play?device_id=${speakerDeviceId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res && !res.ok && res.status !== 204) {
      const body = await res.text().catch(() => "");
      setStatus("error");
      setErrorMessage(
        res.status === 404
          ? "The speaker device dropped off Spotify Connect."
          : `Couldn't start playback (${res.status}).`
      );
      console.error("Spotify play failed:", res.status, body);
    } else if (res?.ok && status === "error") {
      setStatus("ready");
      setErrorMessage(null);
    }
  }

  async function pause() {
    if (isSpeakerRef.current) {
      await playerRef.current?.pause();
    } else {
      await spotifyCommand(`/me/player/pause?device_id=${speakerDeviceId}`, { method: "PUT" });
    }
  }

  async function resume() {
    if (isSpeakerRef.current) {
      await playerRef.current?.resume();
    } else {
      await spotifyCommand(`/me/player/play?device_id=${speakerDeviceId}`, { method: "PUT" });
    }
  }

  async function togglePlay() {
    if (isSpeakerRef.current) {
      await playerRef.current?.togglePlay();
    } else if (playback) {
      if (playback.isPaused) await resume();
      else await pause();
    }
  }

  async function seek(positionMs: number) {
    const clamped = Math.max(0, Math.round(positionMs));
    if (isSpeakerRef.current) {
      await playerRef.current?.seek(clamped);
    } else {
      await spotifyCommand(
        `/me/player/seek?position_ms=${clamped}&device_id=${speakerDeviceId}`,
        { method: "PUT" }
      );
    }
  }

  async function seekRelative(deltaMs: number) {
    if (!playback) return;
    const target = Math.max(0, Math.min(playback.durationMs, playback.positionMs + deltaMs));
    await seek(target);
  }

  async function restartTrack() {
    await seek(0);
  }

  const [audioUnlocked, setAudioUnlocked] = useState(false);

  async function unlockAudio() {
    try {
      await playerRef.current?.activateElement?.();
    } finally {
      setAudioUnlocked(true);
    }
  }

  // Returns the position (ms) to resume `trackUri` at, based on a
  // snapshot saved before a reload — or null if there's nothing usable
  // (different track, no snapshot, or it was already cleared). If
  // playback wasn't paused when saved, extrapolates forward by however
  // long has passed since, so a quick reload doesn't leave you noticeably
  // behind where the track actually would have been.
  function getResumePosition(trackUri: string): number | null {
    const snapshot = readResumeSnapshot();
    if (!snapshot || snapshot.trackUri !== trackUri) return null;
    if (snapshot.isPaused) return snapshot.positionMs;
    const elapsed = Date.now() - snapshot.savedAt;
    // Don't trust a snapshot that's suspiciously old (e.g. the page sat
    // closed for a while) — the track may well have already finished.
    if (elapsed > 5 * 60_000) return null;
    return snapshot.positionMs + elapsed;
  }

  const becomeSpeaker = useCallback(async () => {
    if (!deviceId) return false;
    const res = await fetch("/api/speaker", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId, deviceName }),
    });
    const data = await res.json();
    return !data.error;
  }, [deviceId, deviceName]);

  return {
    status,
    deviceId,
    deviceName,
    isSpeaker,
    errorMessage,
    audioUnlocked,
    playback,
    playUri,
    pause,
    resume,
    togglePlay,
    seek,
    seekRelative,
    restartTrack,
    unlockAudio,
    becomeSpeaker,
    getResumePosition,
    clearResumeSnapshot,
  };
}
