import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForTokens } from "@/lib/spotify";

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");
  const storedState = req.cookies.get("spotify_auth_state")?.value;

  if (error) {
    return NextResponse.redirect(`${origin}/dj?spotify_error=${encodeURIComponent(error)}`);
  }
  if (!code || !state || state !== storedState) {
    return NextResponse.redirect(`${origin}/dj?spotify_error=state_mismatch`);
  }

  try {
    await exchangeCodeForTokens(code, origin);
  } catch (e) {
    return NextResponse.redirect(`${origin}/dj?spotify_error=token_exchange_failed`);
  }

  const res = NextResponse.redirect(`${origin}/dj?spotify_connected=1`);
  res.cookies.delete("spotify_auth_state");
  return res;
}
