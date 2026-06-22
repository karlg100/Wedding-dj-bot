"use client";

import { useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { PHASES, QueuedTrack } from "@/lib/types";

function formatDuration(ms: number) {
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

function PancakeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <rect x="3" y="5" width="18" height="2.2" rx="1.1" />
      <rect x="3" y="11" width="18" height="2.2" rx="1.1" />
      <rect x="3" y="17" width="18" height="2.2" rx="1.1" />
    </svg>
  );
}

function RequestIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 7.75C6 6.23122 7.23122 5 8.75 5H15.25C16.7688 5 18 6.23122 18 7.75V12.25C18 13.7688 16.7688 15 15.25 15H11.75L8.4 18.05C7.91755 18.4893 7.14691 18.1469 7.14691 17.4944V15C6.51192 14.3308 6 13.4269 6 12.25V7.75Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={`transition-transform ${expanded ? "rotate-180" : ""}`}
    >
      <path
        d="M6 9L12 15L18 9"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function phaseLabel(phase: QueuedTrack["holdUntilPhase"]) {
  return PHASES.find((candidate) => candidate.id === phase)?.label ?? phase;
}

function sourceLabel(track: QueuedTrack): string {
  if (track.source === "request") return "Guest request";
  if (track.source === "seed") return "Backbone";
  if (track.source === "autofill") return "DJ pick";
  return track.source;
}

function SortableRow({
  track,
  index,
  onRemove,
  reorderable,
  expanded,
  onToggle,
}: {
  track: QueuedTrack;
  index: number;
  onRemove: (id: string) => void;
  reorderable: boolean;
  expanded: boolean;
  onToggle: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: track.id, disabled: !reorderable });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const requestLabel = track.requestedBy?.trim() || "Guest request";
  const secondaryNote =
    track.status === "held"
      ? track.screeningNote || track.requestNote
      : track.requestNote || track.screeningNote;
  const detailRows = [
    { label: "Album", value: track.album || null },
    { label: "Source", value: sourceLabel(track) },
    { label: "Requested by", value: track.source === "request" ? requestLabel : null },
    { label: "Status", value: track.status === "held" && track.holdUntilPhase ? `Held for ${phaseLabel(track.holdUntilPhase)}` : track.status },
    { label: "Explicit", value: track.explicit ? "Yes" : "No" },
    { label: "Tempo", value: track.tempo ? `${Math.round(track.tempo)} BPM` : null },
    { label: "Energy", value: track.energy !== null ? `${Math.round(track.energy * 100)}%` : null },
    { label: "Request note", value: track.requestNote },
    { label: "DJ note", value: track.screeningNote },
  ].filter((row) => row.value);

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="rounded-xl bg-white border border-ink/8 overflow-hidden"
    >
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        {reorderable ? (
          <button
            {...attributes}
            {...listeners}
            className="text-ink/25 hover:text-ink/50 p-1.5 -ml-1 flex-shrink-0 cursor-grab active:cursor-grabbing touch-none"
            aria-label={`Reorder ${track.title}`}
          >
            <PancakeIcon />
          </button>
        ) : (
          <span className="w-6 flex-shrink-0 text-[10px] uppercase tracking-wide font-semibold text-ink/30 text-center">
            Hold
          </span>
        )}
        <span className="text-xs text-ink/35 w-4 flex-shrink-0 text-right">{index + 1}</span>
        {track.albumArt ? (
          <img src={track.albumArt} alt="" className="w-10 h-10 rounded-md object-cover flex-shrink-0" />
        ) : (
          <div className="w-10 h-10 rounded-md bg-paper-deep flex-shrink-0" />
        )}
        <button
          type="button"
          onClick={() => onToggle(track.id)}
          aria-expanded={expanded}
          aria-label={`${expanded ? "Hide" : "Show"} details for ${track.title}`}
          className="min-w-0 flex-1 text-left rounded-lg px-1 py-1 -mx-1 hover:bg-paper-deep/70 transition-colors"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium truncate">{track.title}</p>
            <span className="text-ink/30 flex-shrink-0 mt-0.5">
              <ChevronIcon expanded={expanded} />
            </span>
          </div>
          <p className="text-xs text-ink/50 truncate">
            {track.artist} · {formatDuration(track.durationMs)}
          </p>
          {track.source === "request" && (
            <p className="mt-1 inline-flex max-w-full items-center gap-1.5 rounded-full bg-blush/35 px-2 py-0.5 text-[11px] font-medium text-espresso">
              <RequestIcon />
              <span className="truncate">{requestLabel}</span>
            </p>
          )}
          {!expanded && secondaryNote && (
            <p className="text-[11px] text-ink/38 truncate mt-1">{secondaryNote}</p>
          )}
        </button>
        <button
          onClick={() => onRemove(track.id)}
          className="text-ink/30 hover:text-rust text-xs px-2 py-1 flex-shrink-0"
          aria-label={`Remove ${track.title}`}
        >
          Remove
        </button>
      </div>
      {expanded && (
        <div className="px-4 pb-3 pt-0">
          <div className="border-t border-ink/8 pt-3 text-[11px] text-ink/55">
            <div className="grid gap-2 sm:grid-cols-2">
              {detailRows.map((row) => (
                <div key={row.label} className="min-w-0">
                  <p className="uppercase tracking-wide text-[10px] text-ink/35">{row.label}</p>
                  <p className="text-ink/70 break-words">{row.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </li>
  );
}

export function SortableQueue({
  tracks,
  onRemove,
  onReorder,
  reorderable = true,
}: {
  tracks: QueuedTrack[];
  onRemove: (id: string) => void;
  onReorder: (orderedIds: string[]) => void;
  reorderable?: boolean;
}) {
  const [expandedTrackId, setExpandedTrackId] = useState<string | null>(null);

  // PointerSensor covers mouse/trackpad; TouchSensor with a small delay
  // lets a tap-and-hold start a drag on phones without hijacking normal
  // scrolling — a plain tap/scroll won't trigger it.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 6 } })
  );

  function handleDragEnd(event: DragEndEvent) {
    if (!reorderable) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = tracks.findIndex((t) => t.id === active.id);
    const newIndex = tracks.findIndex((t) => t.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(tracks, oldIndex, newIndex);
    onReorder(reordered.map((t) => t.id));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={tracks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <ul className="space-y-1.5 mb-8">
          {tracks.map((t, i) => (
            <SortableRow
              key={t.id}
              track={t}
              index={i}
              onRemove={onRemove}
              reorderable={reorderable}
              expanded={expandedTrackId === t.id}
              onToggle={(id) =>
                setExpandedTrackId((current) => (current === id ? null : id))
              }
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
