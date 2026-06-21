import { NextRequest, NextResponse } from "next/server";
import { setSpeakerDevice } from "@/lib/queue";
import { transferPlayback } from "@/lib/spotify";

export async function POST(req: NextRequest) {
  const { deviceId, deviceName } = await req.json();
  if (!deviceId) {
    return NextResponse.json({ error: "Missing deviceId" }, { status: 400 });
  }
  try {
    await transferPlayback(deviceId, false);
  } catch (e: any) {
    return NextResponse.json(
      { error: `Couldn't transfer playback to that device: ${e.message}` },
      { status: 200 }
    );
  }
  const state = await setSpeakerDevice(deviceId, deviceName ?? "Unnamed device");
  return NextResponse.json({ state });
}
