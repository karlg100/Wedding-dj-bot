import { NextRequest, NextResponse } from "next/server";
import { setVetoKeywords } from "@/lib/queue";

export async function POST(req: NextRequest) {
  const { vetoKeywords } = await req.json();
  if (!Array.isArray(vetoKeywords)) {
    return NextResponse.json({ error: "Missing vetoKeywords" }, { status: 400 });
  }
  const state = await setVetoKeywords(vetoKeywords);
  return NextResponse.json(state);
}
