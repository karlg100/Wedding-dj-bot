import { NextRequest, NextResponse } from "next/server";
import { removeFromQueue } from "@/lib/queue";

export async function POST(req: NextRequest) {
  const { entryId } = await req.json();
  if (!entryId) return NextResponse.json({ error: "Missing entryId" }, { status: 400 });
  const state = await removeFromQueue(entryId);
  return NextResponse.json(state);
}
