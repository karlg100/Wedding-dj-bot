import { NextRequest, NextResponse } from "next/server";
import { getOrCreateGuestSession, saveGuestSession } from "@/lib/guestSessions";
import { handleGuestMessage } from "@/lib/djChat";
import { ChatMessage } from "@/lib/types";

export async function GET(req: NextRequest) {
  const guestId = req.nextUrl.searchParams.get("guestId");
  if (!guestId) return NextResponse.json({ error: "Missing guestId" }, { status: 400 });
  const { getGuestSession } = await import("@/lib/guestSessions");
  const session = await getGuestSession(guestId);
  return NextResponse.json({ messages: session?.messages ?? [], name: session?.name ?? "" });
}

export async function POST(req: NextRequest) {
  const { guestId, name, message } = await req.json();
  if (!guestId || !message?.trim()) {
    return NextResponse.json({ error: "Missing guestId or message" }, { status: 400 });
  }

  const session = await getOrCreateGuestSession(guestId, name ?? "");

  const userMsg: ChatMessage = { role: "user", content: message.trim(), at: Date.now() };

  let result;
  try {
    result = await handleGuestMessage(
      guestId,
      session.name || name || "a guest",
      session.messages,
      message.trim()
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: e.message ?? "Chat failed", reply: "Having trouble reaching the booth — try again in a sec." },
      { status: 200 }
    );
  }

  const assistantMsg: ChatMessage = {
    role: "assistant",
    content: result.reply,
    at: Date.now(),
  };

  session.messages.push(userMsg, assistantMsg);
  // Cap history so a long night doesn't grow context unbounded.
  session.messages = session.messages.slice(-40);
  session.updatedAt = Date.now();
  await saveGuestSession(session);

  return NextResponse.json({
    reply: result.reply,
    queuedTrack: result.queuedTrack,
  });
}
