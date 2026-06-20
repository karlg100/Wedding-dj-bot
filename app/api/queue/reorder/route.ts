import { NextRequest, NextResponse } from "next/server";
import { reorderQueue } from "@/lib/queue";

export async function POST(req: NextRequest) {
  const { orderedIds } = await req.json();
  if (!Array.isArray(orderedIds)) {
    return NextResponse.json({ error: "Missing orderedIds" }, { status: 400 });
  }
  const state = await reorderQueue(orderedIds);
  return NextResponse.json(state);
}
