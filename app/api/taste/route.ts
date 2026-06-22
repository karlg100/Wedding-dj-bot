import { NextRequest, NextResponse } from "next/server";
import { getTasteList, setTasteList } from "@/lib/queue";

export async function GET() {
  const taste = await getTasteList();
  return NextResponse.json({ taste });
}

export async function POST(req: NextRequest) {
  const { entries } = await req.json();
  if (!Array.isArray(entries)) {
    return NextResponse.json({ error: "Missing entries" }, { status: 400 });
  }
  const taste = await setTasteList(entries);
  return NextResponse.json({ taste, count: taste.length });
}
