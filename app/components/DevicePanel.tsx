"use client";

import { useEffect, useState } from "react";
import { useSpotifyPlayer } from "@/lib/useSpotifyPlayer";
import { QueueState } from "@/lib/types";

type SpotifyDeviceInfo = {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
};

export function DevicePanel({
  player,
  queue,
  onSpeakerChanged,
}: {
  player: ReturnType<typeof useSpotifyPlayer>;
  queue: QueueState | null;
  onSpeakerChanged: () => void;
}) {
  const [devices, setDevices] = useState<SpotifyDeviceInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirmingThis, setConfirmingThis] = useState(false);
  const [switching, setSwitching] = useState(false);

  async function loadDevices() {
    setLoading(true);
    try {
      const res = await fetch("/api/devices", { cache: "no-store" });
      const data = await res.json();
      setDevices(data.devices ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDevices();
  }, []);

  async function confirmBecomeSpeaker() {
    setSwitching(true);
    try {
      const ok = await player.becomeSpeaker();
      if (ok) onSpeakerChanged();
    } finally {
      setSwitching(false);
      setConfirmingThis(false);
    }
  }

  const speakerIsThisDevice = queue?.speakerDeviceId && queue.speakerDeviceId === player.deviceId;

  return (
    <div className="mb-6 rounded-2xl bg-white border border-ink/10 p-4 rise-in">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs uppercase tracking-wider text-ink/45 font-semibold">
          Speaker
        </h3>
        <button onClick={loadDevices} className="text-xs text-espresso hover:underline">
          {loading ? "Checking…" : "Refresh"}
        </button>
      </div>

      {queue?.speakerDeviceName ? (
        <div className="mb-3">
          <p className="text-sm">
            <span className="text-ink/50">Current speaker: </span>
            <span className="font-medium">{queue.speakerDeviceName}</span>
          </p>
          {speakerIsThisDevice && (
            <p className="text-xs text-sage mt-0.5" style={{ color: "var(--greige-deep)" }}>
              That&rsquo;s this device.
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-ink/50 mb-3">No speaker assigned yet.</p>
      )}

      {!speakerIsThisDevice && player.status === "ready" && (
        <>
          {!confirmingThis ? (
            <button
              onClick={() => setConfirmingThis(true)}
              className="text-xs font-semibold text-paper bg-ink rounded-full px-4 py-2 hover:opacity-90 transition-opacity"
            >
              Make this device the speaker
            </button>
          ) : (
            <div className="rounded-xl bg-paper-deep px-3 py-3">
              <p className="text-xs text-ink/70 mb-2.5">
                This will switch audio output to this device{queue?.speakerDeviceName ? ` and stop ${queue.speakerDeviceName} from playing sound` : ""}. Continue?
              </p>
              <div className="flex gap-2">
                <button
                  onClick={confirmBecomeSpeaker}
                  disabled={switching}
                  className="text-xs font-semibold text-paper bg-rust rounded-full px-4 py-2 disabled:opacity-50"
                >
                  {switching ? "Switching…" : "Yes, switch"}
                </button>
                <button
                  onClick={() => setConfirmingThis(false)}
                  disabled={switching}
                  className="text-xs font-medium text-ink/60 px-4 py-2"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {devices.length > 0 && (
        <div className="mt-4 pt-3 border-t border-ink/8">
          <p className="text-xs text-ink/40 mb-2">
            All devices Spotify currently sees (closed tabs may linger briefly before clearing themselves):
          </p>
          <ul className="space-y-1.5 max-h-40 overflow-y-auto">
            {devices.map((d) => (
              <li key={d.id} className="flex items-center justify-between text-xs">
                <span className="text-ink/70">
                  {d.name}
                  {d.id === player.deviceId && (
                    <span className="text-ink/35"> (this device)</span>
                  )}
                </span>
                {d.id === queue?.speakerDeviceId && (
                  <span className="text-espresso font-medium">Speaker</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
