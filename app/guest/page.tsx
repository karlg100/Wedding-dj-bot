"use client";

import { useEffect, useRef, useState } from "react";
import { ChatMessage, QueueState } from "@/lib/types";
import { PHASES } from "@/lib/types";

function getOrCreateGuestId(): string {
  const KEY = "wedding-dj-guest-id";
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export default function GuestChatPage() {
  const [guestId, setGuestId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [queue, setQueue] = useState<QueueState | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = getOrCreateGuestId();
    setGuestId(id);
    try {
      const savedName = localStorage.getItem("wedding-dj-guest-name");
      if (savedName) setName(savedName);
    } catch {}
  }, []);

  useEffect(() => {
    if (!guestId || !name) return;
    fetch(`/api/chat?guestId=${guestId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.messages?.length) {
          setMessages(d.messages);
        } else {
          setMessages([
            {
              role: "assistant",
              content: `Hey ${name}! What do you want to hear tonight?`,
              at: Date.now(),
            },
          ]);
        }
      })
      .catch(() => {});
  }, [guestId, name]);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/api/queue", { cache: "no-store" });
        const data = await res.json();
        if (!cancelled) setQueue(data);
      } catch {}
    }
    poll();
    const interval = setInterval(poll, 6000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  function confirmName() {
    if (!nameInput.trim()) return;
    const trimmed = nameInput.trim();
    setName(trimmed);
    try {
      localStorage.setItem("wedding-dj-guest-name", trimmed);
    } catch {}
  }

  async function send() {
    if (!draft.trim() || !guestId || sending) return;
    const text = draft.trim();
    setDraft("");
    setMessages((m) => [...m, { role: "user", content: text, at: Date.now() }]);
    setSending(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestId, name, message: text }),
      });
      const data = await res.json();
      setMessages((m) => [
        ...m,
        { role: "assistant", content: data.reply ?? "…", at: Date.now() },
      ]);
    } catch {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: "Lost the connection for a sec — try again?", at: Date.now() },
      ]);
    } finally {
      setSending(false);
    }
  }

  const phaseLabel = queue ? PHASES.find((p) => p.id === queue.phase)?.label : null;

  if (!name) {
    return (
      <main className="flex-1 flex items-center justify-center px-6">
        <div className="w-full max-w-sm text-center rise-in">
          <p className="eyebrow tracking-[0.2em] text-xs uppercase font-medium mb-3">
            The Reception
          </p>
          <h1 className="font-display text-4xl mb-3">Hey there 👋</h1>
          <p className="text-ink/65 mb-7 leading-relaxed">
            What should the DJ call you?
          </p>
          <input
            autoFocus
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && confirmName()}
            placeholder="Your name"
            className="w-full rounded-2xl border border-ink/15 bg-white px-4 py-3.5 text-base text-center placeholder:text-ink/35 focus:border-ink outline-none transition-colors mb-4"
          />
          <button
            onClick={confirmName}
            disabled={!nameInput.trim()}
            className="w-full rounded-full bg-ink text-paper font-semibold py-3.5 hover:opacity-90 transition-colors disabled:opacity-40"
          >
            Start chatting
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 flex flex-col px-4 sm:px-5 py-5 max-w-md mx-auto w-full">
      <header className="mb-4 text-center flex-shrink-0">
        <p className="eyebrow tracking-[0.2em] text-xs uppercase font-medium mb-1">
          {phaseLabel ?? "The Reception"} · just you & the DJ
        </p>
        <h1 className="font-display text-2xl">Hey, {name.split(" ")[0]}</h1>
      </header>

      {queue?.nowPlaying && (
        <div className="mb-4 rounded-2xl bg-espresso text-paper px-4 py-2.5 flex items-center gap-3 flex-shrink-0">
          {queue.nowPlaying.albumArt ? (
            <img src={queue.nowPlaying.albumArt} alt="" className="w-9 h-9 rounded-lg object-cover flex-shrink-0" />
          ) : (
            <div className="w-9 h-9 rounded-lg bg-paper/10 flex-shrink-0" />
          )}
          <div className="min-w-0">
            <p className="text-[9px] uppercase tracking-wider text-blush font-semibold">Now playing</p>
            <p className="text-sm truncate">
              {queue.nowPlaying.title} <span className="text-paper/50">· {queue.nowPlaying.artist}</span>
            </p>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto space-y-3 mb-3 min-h-0">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed rise-in ${
                m.role === "user"
                  ? "bg-ink text-paper rounded-br-sm"
                  : "bg-white border border-ink/8 rounded-bl-sm"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="bg-white border border-ink/8 rounded-2xl rounded-bl-sm px-4 py-2.5">
              <span className="flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-ink/30 animate-bounce [animation-delay:-0.3s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-ink/30 animate-bounce [animation-delay:-0.15s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-ink/30 animate-bounce" />
              </span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="flex gap-2 flex-shrink-0 sticky bottom-0 bg-paper pt-1">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Ask for a song…"
          className="flex-1 rounded-full border border-ink/15 bg-white px-4 py-3 text-sm placeholder:text-ink/35 focus:border-ink outline-none transition-colors"
        />
        <button
          onClick={send}
          disabled={!draft.trim() || sending}
          className="rounded-full bg-ink text-paper font-semibold px-5 text-sm hover:opacity-90 transition-colors disabled:opacity-40 flex-shrink-0"
        >
          Send
        </button>
      </div>
    </main>
  );
}
