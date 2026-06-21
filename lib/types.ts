export type Phase = "prelude" | "cocktail" | "dinner" | "dancing" | "lastcall";

export const PHASES: { id: Phase; label: string; vibe: string }[] = [
  { id: "prelude", label: "Prelude", vibe: "Guests arriving, getting seated. Warm, unobtrusive." },
  { id: "cocktail", label: "Cocktail Hour", vibe: "Easy, social, background-friendly but with character." },
  { id: "dinner", label: "Dinner", vibe: "Conversational volume, warm, can build gently." },
  { id: "dancing", label: "Dancing", vibe: "High energy, danceable, the main event." },
  { id: "lastcall", label: "Last Call", vibe: "Winding down, nostalgic, a final singalong or slow one." },
];

export type RequestStatus = "pending" | "queued" | "playing" | "played" | "skipped" | "rejected";

export type QueuedTrack = {
  id: string; // unique id for this queue entry
  spotifyUri: string;
  spotifyId: string;
  title: string;
  artist: string;
  album: string;
  albumArt: string;
  durationMs: number;
  explicit: boolean;
  energy: number | null; // 0-1 from Spotify audio features, null if unknown
  tempo: number | null; // BPM
  requestedBy: string | null; // guest display name, null = backbone/seed track
  requestNote: string | null; // optional message from guest
  source: "seed" | "request" | "autofill";
  status: RequestStatus;
  screeningNote: string | null; // why it was placed/flagged, shown in DJ view
  addedAt: number;
  playedAt: number | null;
};

export type QueueState = {
  phase: Phase;
  nowPlaying: QueuedTrack | null;
  nowPlayingStartedAt: number | null;
  upNext: QueuedTrack[];
  history: QueuedTrack[];
  vetoKeywords: string[]; // couple-controlled banned terms/artists
  speakerDeviceId: string | null; // the Spotify Connect device designated as THE speaker
  speakerDeviceName: string | null; // display name, so other devices can show "Speaker: <name>"
  speakerAssignedAt: number | null;
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  at: number;
};

export type GuestSession = {
  guestId: string; // device-generated id
  name: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
};

export type VibeRead = {
  guestId: string;
  guestName: string;
  energy: "low" | "medium" | "high";
  note: string | null;
  at: number;
};

export type VibeSynthesis = {
  summary: string;
  energyLean: "low" | "medium" | "high";
  sampleSize: number;
  generatedAt: number;
};

export const DEFAULT_QUEUE_STATE: QueueState = {
  phase: "prelude",
  nowPlaying: null,
  nowPlayingStartedAt: null,
  upNext: [],
  history: [],
  vetoKeywords: [],
  speakerDeviceId: null,
  speakerDeviceName: null,
  speakerAssignedAt: null,
};
