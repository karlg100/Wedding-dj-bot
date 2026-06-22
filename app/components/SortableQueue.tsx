"use client";

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

function phaseLabel(phase: QueuedTrack["holdUntilPhase"]) {
  return PHASES.find((candidate) => candidate.id === phase)?.label ?? phase;
}

function SortableRow({
  track,
  index,
  onRemove,
  reorderable,
}: {
  track: QueuedTrack;
  index: number;
  onRemove: (id: string) => void;
  reorderable: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: track.id, disabled: !reorderable });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const sourceLabel = track.requestedBy
    ? track.status === "held" && track.holdUntilPhase
      ? `${track.requestedBy} · held for ${phaseLabel(track.holdUntilPhase)}`
      : track.requestedBy
    : track.source === "seed"
    ? "backbone"
    : track.source === "autofill"
    ? "DJ pick"
    : null;
  const secondaryNote =
    track.status === "held"
      ? track.screeningNote || track.requestNote
      : track.requestNote || track.screeningNote;

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-white border border-ink/8"
    >
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
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{track.title}</p>
        <p className="text-xs text-ink/50 truncate">
          {track.artist} · {formatDuration(track.durationMs)}
          {sourceLabel ? ` · ${sourceLabel}` : ""}
        </p>
        {secondaryNote && (
          <p className="text-[11px] text-ink/38 truncate">{secondaryNote}</p>
        )}
      </div>
      <button
        onClick={() => onRemove(track.id)}
        className="text-ink/30 hover:text-rust text-xs px-2 py-1 flex-shrink-0"
        aria-label={`Remove ${track.title}`}
      >
        Remove
      </button>
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
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
