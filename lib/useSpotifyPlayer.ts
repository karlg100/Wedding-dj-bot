"use client";

import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    Spotify: any;
    onSpotifyWebPlaybackSDKReady: () => void;
  }
}

type PlayerStatus = "idle" | "loading" | "ready" | "error" | "no-token";

export function useSpotifyPlayer() {
  const [status, setStatus] = useState<PlayerStatus>("idle");
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
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

        player.addListener("ready", ({ device_id }: { device_id: string }) => {
          if (cancelled) return;
          setDeviceId(device_id);
          setStatus("ready");
        });

        player.addListener("not_ready", () => {
          if (cancelled) return;
          setStatus("error");
          setErrorMessage("Player went offline. Check the connection on this device.");
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
    await fetch(
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
  }

  async function pause() {
    playerRef.current?.pause();
  }

  return { status, deviceId, errorMessage, playUri, pause };
}
