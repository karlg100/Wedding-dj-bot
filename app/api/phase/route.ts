import { NextRequest, NextResponse, after } from "next/server";
import { setPhase } from "@/lib/queue";
import { Phase } from "@/lib/types";
import { maybeAutoFillQueue } from "@/lib/autofill";

export async function POST(req: NextRequest) {
  const { phase } = await req.json();
  const valid: Phase[] = ["prelude", "cocktail", "dinner", "dancing", "lastcall"];
  if (!valid.includes(phase)) {
    return NextResponse.json({ error: "Invalid phase" }, { status: 400 });
  }
  const state = await setPhase(phase);
  // Phase switch clears autofill/seed tracks, so the queue may be well below
  // the minimum depth. Trigger a fill immediately (cooldown was reset in
  // setPhase) rather than waiting for the next GET /api/queue poll.
  after(() => maybeAutoFillQueue().catch((e) => console.error("Auto-fill after phase switch failed", e)));
  return NextResponse.json(state);
}
