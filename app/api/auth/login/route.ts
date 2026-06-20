import { NextRequest, NextResponse } from "next/server";
import { buildAuthUrl } from "@/lib/spotify";

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const state = crypto.randomUUID();
  const url = buildAuthUrl(origin, state);
  const res = NextResponse.redirect(url);
  res.cookies.set("spotify_auth_state", state, {
    httpOnly: true,
    maxAge: 600,
    sameSite: "lax",
  });
  return res;
}
