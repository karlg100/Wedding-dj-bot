import { NextRequest, NextResponse } from "next/server";
import { advanceQueue } from "@/lib/queue";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const outcome = (body.outcome as "played" | "skipped" | "none") ?? "played";
  const state = await advanceQueue(outcome);
  return NextResponse.json(state);
}
