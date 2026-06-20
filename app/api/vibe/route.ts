import { NextResponse } from "next/server";
import { synthesizeVibe } from "@/lib/djChat";
import { getVibeSynthesis } from "@/lib/guestSessions";

// GET returns the last cached synthesis (cheap, for frequent polling).
export async function GET() {
  const synthesis = await getVibeSynthesis();
  return NextResponse.json({ synthesis });
}

// POST recomputes it (call this occasionally, e.g. every few minutes from
// the DJ page, not on every poll — it's an LLM call).
export async function POST() {
  const synthesis = await synthesizeVibe();
  return NextResponse.json({ synthesis });
}
