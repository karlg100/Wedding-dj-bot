import { getStore } from "./store";

const SPOTIFY_AUTH = "https://accounts.spotify.com/authorize";
const SPOTIFY_TOKEN = "https://accounts.spotify.com/api/token";
const SPOTIFY_API = "https://api.spotify.com/v1";

export const SPOTIFY_SCOPES = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "user-read-playback-state",
  "user-modify-playback-state",
].join(" ");

type TokenSet = {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
};

const TOKEN_KEY = "spotify:dj-tokens";

export function getRedirectUri(origin: string) {
  return `${origin}/api/auth/callback`;
}

export function buildAuthUrl(origin: string, state: string) {
  const params = new URLSearchParams({
    client_id: process.env.SPOTIFY_CLIENT_ID!,
    response_type: "code",
    redirect_uri: getRedirectUri(origin),
    scope: SPOTIFY_SCOPES,
    state,
  });
  return `${SPOTIFY_AUTH}?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string, origin: string) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: getRedirectUri(origin),
  });
  const res = await fetch(SPOTIFY_TOKEN, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization:
        "Basic " +
        Buffer.from(
          `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
        ).toString("base64"),
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`Spotify token exchange failed: ${await res.text()}`);
  }
  const json = await res.json();
  const tokens: TokenSet = {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at: Date.now() + json.expires_in * 1000,
  };
  await getStore().set(TOKEN_KEY, tokens);
  return tokens;
}

async function refreshTokens(refreshToken: string): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const res = await fetch(SPOTIFY_TOKEN, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization:
        "Basic " +
        Buffer.from(
          `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
        ).toString("base64"),
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`Spotify token refresh failed: ${await res.text()}`);
  }
  const json = await res.json();
  const tokens: TokenSet = {
    access_token: json.access_token,
    // Spotify sometimes omits refresh_token on refresh; keep the old one.
    refresh_token: json.refresh_token ?? refreshToken,
    expires_at: Date.now() + json.expires_in * 1000,
  };
  await getStore().set(TOKEN_KEY, tokens);
  return tokens;
}

export async function getValidAccessToken(): Promise<string | null> {
  const tokens = await getStore().get<TokenSet>(TOKEN_KEY);
  if (!tokens) return null;
  if (Date.now() < tokens.expires_at - 60_000) {
    return tokens.access_token;
  }
  const refreshed = await refreshTokens(tokens.refresh_token);
  return refreshed.access_token;
}

export async function isSpotifyConnected(): Promise<boolean> {
  const tokens = await getStore().get<TokenSet>(TOKEN_KEY);
  return Boolean(tokens);
}

async function spotifyFetch(path: string, init?: RequestInit) {
  const token = await getValidAccessToken();
  if (!token) throw new Error("Spotify not connected");
  const res = await fetch(`${SPOTIFY_API}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
  });
  return res;
}

export type SpotifyTrack = {
  spotifyId: string;
  spotifyUri: string;
  title: string;
  artist: string;
  album: string;
  albumArt: string;
  durationMs: number;
  explicit: boolean;
};

function mapTrack(t: any): SpotifyTrack {
  return {
    spotifyId: t.id,
    spotifyUri: t.uri,
    title: t.name,
    artist: t.artists.map((a: any) => a.name).join(", "),
    album: t.album?.name ?? "",
    albumArt: t.album?.images?.[1]?.url ?? t.album?.images?.[0]?.url ?? "",
    durationMs: t.duration_ms,
    explicit: Boolean(t.explicit),
  };
}

export async function searchTracks(query: string, limit = 8): Promise<SpotifyTrack[]> {
  const res = await spotifyFetch(
    `/search?q=${encodeURIComponent(query)}&type=track&limit=${limit}`
  );
  if (!res.ok) throw new Error(`Spotify search failed: ${await res.text()}`);
  const json = await res.json();
  return (json.tracks?.items ?? []).map(mapTrack);
}

export async function getAudioFeatures(
  spotifyIds: string[]
): Promise<Record<string, { energy: number; tempo: number } | null>> {
  if (spotifyIds.length === 0) return {};
  try {
    const res = await spotifyFetch(`/audio-features?ids=${spotifyIds.join(",")}`);
    if (!res.ok) {
      // Some app registrations / markets restrict this endpoint; degrade gracefully.
      return Object.fromEntries(spotifyIds.map((id) => [id, null]));
    }
    const json = await res.json();
    const out: Record<string, { energy: number; tempo: number } | null> = {};
    for (const f of json.audio_features ?? []) {
      if (f) out[f.id] = { energy: f.energy, tempo: f.tempo };
    }
    for (const id of spotifyIds) if (!(id in out)) out[id] = null;
    return out;
  } catch {
    return Object.fromEntries(spotifyIds.map((id) => [id, null]));
  }
}

export type SpotifyDevice = {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
};

export async function listDevices(): Promise<SpotifyDevice[]> {
  const res = await spotifyFetch(`/me/player/devices`);
  if (!res.ok) return [];
  const json = await res.json();
  return (json.devices ?? []).map((d: any) => ({
    id: d.id,
    name: d.name,
    type: d.type,
    isActive: Boolean(d.is_active),
  }));
}

export async function getActiveDeviceId(): Promise<string | null> {
  const devices = await listDevices();
  const active = devices.find((d) => d.isActive) ?? devices[0];
  return active?.id ?? null;
}

export async function transferPlayback(deviceId: string, play = false) {
  const res = await spotifyFetch(`/me/player`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_ids: [deviceId], play }),
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Spotify transfer failed: ${await res.text()}`);
  }
}

export async function playTrackOnDevice(deviceId: string, uri: string) {
  const res = await spotifyFetch(`/me/player/play?device_id=${deviceId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uris: [uri] }),
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Spotify play failed: ${await res.text()}`);
  }
}
