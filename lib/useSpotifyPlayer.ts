"use client";

import { useEffect, useRef, useState } from "react";

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

export function useSpotifyPlayer() {
  const [status, setStatus] = useState<PlayerStatus>("idle");
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [playback, setPlayback] = useState<PlaybackState | null>(null);
  const playerRef = useRef<any>(null);
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      setStatus("loading");
      const res = await fetch("/api/auth/refresh");
      const data = await res.json();
      if (!data.connected || !data.accessToken) {
        if (!cancelled) setStatus("no-token");
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
          name: "Wedding DJ",
          getOAuthToken: async (cb: (token: string) => void) => {
            // Refresh on each request to stay valid through a long event.
            const r = await fetch("/api/auth/refresh");
            const d = await r.json();
            tokenRef.current = d.accessToken;
            cb(d.accessToken);
          },
          volume: 0.8,
        });

        player.addListener("ready", async ({ device_id }: { device_id: string }) => {
          if (cancelled) return;
          setDeviceId(device_id);
          setStatus("ready");
          // Actively claim this browser tab as the active Spotify Connect
          // device, so playback doesn't stay routed to whatever device
          // (e.g. the native app) was last active. Don't auto-start
          // playback (play: false) — just take over the speaker role.
          try {
            await fetch("https://api.spotify.com/v1/me/player", {
              method: "PUT",
              headers: {
                Authorization: `Bearer ${tokenRef.current}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ device_ids: [device_id], play: false }),
            });
          } catch {
            // Non-fatal — the explicit device_id on each play call below
            // is the real fallback if this transfer call fails.
          }
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
        player.addListener("authentication_error", ({ message }: { message: string }) => {
          if (!cancelled) {
            setStatus("error");
            setErrorMessage("Spotify session expired. Reconnect on this device.");
          }
        });
        player.addListener("account_error", ({ message }: { message: string }) => {
          if (!cancelled) {
            setStatus("error");
            setErrorMessage("This needs Spotify Premium to control playback.");
          }
        });

        player.connect();
        playerRef.current = player;
      };

      // If the script already loaded before this effect ran, fire manually.
      if (window.Spotify && window.onSpotifyWebPlaybackSDKReady) {
        window.onSpotifyWebPlaybackSDKReady();
      }
    }

    init();
    return () => {
      cancelled = true;
      playerRef.current?.disconnect();
    };
  }, []);

  async function playUri(uri: string) {
    if (!deviceId) return;
    // iOS Safari (and other mobile browsers) block audio that isn't
    // triggered by a direct user gesture. activateElement() unlocks the
    // SDK's underlying <audio> element for this page session — it only
    // works when called synchronously-ish from inside a real click
    // handler, which is why this whole function should only ever be
    // invoked from one (see the DJ page's button onClick).
    try {
      await playerRef.current?.activateElement?.();
    } catch {
      // Some SDK versions don't have this method, or it's already
      // unlocked — either way, don't block playback on it.
    }
    const res = await fetch(
      `https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${tokenRef.current}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ uris: [uri] }),
      }
    );
    if (!res.ok && res.status !== 204) {
      const body = await res.text().catch(() => "");
      setStatus("error");
      setErrorMessage(
        res.status === 404
          ? "This device dropped off Spotify Connect — tap Reconnect below."
          : `Couldn't start playback (${res.status}). If Spotify is open elsewhere, close it there and try again.`
      );
      console.error("Spotify play failed:", res.status, body);
    } else if (status === "error") {
      // Recovered.
      setStatus("ready");
      setErrorMessage(null);
    }
  }

  async function pause() {
    await playerRef.current?.pause();
  }

  async function resume() {
    await playerRef.current?.resume();
  }

  async function togglePlay() {
    await playerRef.current?.togglePlay();
  }

  async function seek(positionMs: number) {
    const clamped = Math.max(0, positionMs);
    await playerRef.current?.seek(clamped);
  }

  async function seekRelative(deltaMs: number) {
    const state = await playerRef.current?.getCurrentState();
    if (!state) return;
    const target = Math.max(
      0,
      Math.min(state.duration, state.position + deltaMs)
    );
    await playerRef.current?.seek(target);
  }

  async function restartTrack() {
    await seek(0);
  }

  const [audioUnlocked, setAudioUnlocked] = useState(false);

  async function unlockAudio() {
    try {
      await playerRef.current?.activateElement?.();
      setAudioUnlocked(true);
    } catch {
      // Even if this throws, mark it attempted — pressing it again won't
      // help if the SDK genuinely lacks the method.
      setAudioUnlocked(true);
    }
  }

  return {
    status,
    deviceId,
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
  };
}
