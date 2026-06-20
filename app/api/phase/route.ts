import { NextRequest, NextResponse } from "next/server";
import { setPhase } from "@/lib/queue";
import { Phase } from "@/lib/types";

export async function POST(req: NextRequest) {
  const { phase } = await req.json();
  const valid: Phase[] = ["prelude", "cocktail", "dinner", "dancing", "lastcall"];
  if (!valid.includes(phase)) {
    return NextResponse.json({ error: "Invalid phase" }, { status: 400 });
  }
  const state = await setPhase(phase);
  return NextResponse.json(state);
}
