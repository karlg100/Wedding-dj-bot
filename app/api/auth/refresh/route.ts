import { NextResponse } from "next/server";
import { getValidAccessToken, isSpotifyConnected } from "@/lib/spotify";
import { getStoreBackend } from "@/lib/store";

export async function GET() {
  const store = getStoreBackend();
  const connected = await isSpotifyConnected();
  if (!connected) {
    return NextResponse.json({ connected: false, accessToken: null, store });
  }
  const accessToken = await getValidAccessToken();
  return NextResponse.json({ connected: true, accessToken, store });
}
