import { NextRequest, NextResponse } from "next/server";
import { searchTracks } from "@/lib/spotify";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q");
  if (!q || q.trim().length < 2) {
    return NextResponse.json({ tracks: [] });
  }
  try {
    const tracks = await searchTracks(q.trim());
    return NextResponse.json({ tracks });
  } catch (e: any) {
    return NextResponse.json(
      { tracks: [], error: e.message ?? "Search failed" },
      { status: 200 }
    );
  }
}
