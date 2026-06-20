import { NextResponse } from "next/server";
import { getValidAccessToken, isSpotifyConnected } from "@/lib/spotify";

export async function GET() {
  const connected = await isSpotifyConnected();
  if (!connected) {
    return NextResponse.json({ connected: false, accessToken: null });
  }
  const accessToken = await getValidAccessToken();
  return NextResponse.json({ connected: true, accessToken });
}
