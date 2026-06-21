import { NextRequest, NextResponse } from "next/server";
import { listDevices, transferPlayback } from "@/lib/spotify";

export async function GET() {
  try {
    const devices = await listDevices();
    return NextResponse.json({ devices });
  } catch (e: any) {
    return NextResponse.json({ devices: [], error: e.message }, { status: 200 });
  }
}

export async function POST(req: NextRequest) {
  const { deviceId } = await req.json();
  if (!deviceId) {
    return NextResponse.json({ error: "Missing deviceId" }, { status: 400 });
  }
  try {
    await transferPlayback(deviceId, false);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 200 });
  }
}
