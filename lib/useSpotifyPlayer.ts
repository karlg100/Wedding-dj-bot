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

// `speakerDeviceId` is the server-designated speaker (from queue state).
// Every device initializes its own Web Playback SDK instance — that's what
// makes it eligible to ever become the speaker — but only issues real
// playback commands against the SPEAKER's Spotify Connect device id, and
// only auto-claims the Connect "active device" role for itself if it IS
// the designated speaker. Non-speaker devices stay connected but passive:
// they can see playback state (Spotify broadcasts state to all Connect
// devices watching the same account) without fighting over which one
// actually outputs audio.
export function useSpotifyPlayer(speakerDeviceId: string | null) {
  const [status, setStatus] = useState<PlayerStatus>("idle");
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [deviceName] = useState<string>(() =>
    typeof navigator !== "undefined"
      ? `Wedding DJ — ${navigator.platform || "device"} ${Math.floor(Math.random() * 900 + 100)}`
      : "Wedding DJ"
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [playback, setPlayback] = useState<PlaybackState | null>(null);
  const playerRef = useRef<any>(null);
  const tokenRef = useRef<string | null>(null);
  const isSpeakerRef = useRef(false);

  const isSpeaker = Boolean(deviceId && speakerDeviceId && deviceId === speakerDeviceId);
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
          setPlayback({
            isPaused: state.paused,
            positionMs: state.position,
            durationMs: state.duration,
            trackUri: state.track_window?.current_track?.uri ?? null,
          });
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

  // If THIS device just became the designated speaker (e.g. someone tapped
  // "Make this the speaker" on it, or it reloaded while already assigned),
  // claim the Spotify Connect active-device role. play:false so it doesn't
  // yank audio into starting unexpectedly.
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

  async function playUri(uri: string) {
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
    const res = await spotifyCommand(`/me/player/play?device_id=${speakerDeviceId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uris: [uri] }),
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
  };
}
