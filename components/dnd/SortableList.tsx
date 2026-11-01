"use client";

import type { ReactNode } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { dragAnnouncements } from "@/components/workspace/kanbanDrag";

interface SortableListProps<T> {
  items: T[];
  getId: (item: T) => string;
  getLabel: (item: T) => string;
  onReorder: (items: T[]) => void;
  renderItem: (item: T, dragHandle: ReactNode) => ReactNode;
  disabled?: boolean;
  /** A save is running: dragging pauses, but the handle stays mounted to keep keyboard focus. */
  busy?: boolean;
  className?: string;
  layout?: "vertical" | "grid";
}

function SortableRow({ id, label, children }: { id: string; label: string; children: (dragHandle: ReactNode) => ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const handle = (
    <button
      type="button"
      {...attributes}
      {...listeners}
      aria-label={`Reorder ${label}`}
      title="Drag to reorder; press Space to pick up, use arrow keys, then Space to drop"
      className="touch-none cursor-grab rounded px-1.5 py-1 text-lg leading-none text-[var(--text-light-soft)] hover:text-[var(--ink-green)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ink-green)] active:cursor-grabbing"
    >
      ⠿
    </button>
  );

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.45 : undefined }}>
      {children(handle)}
    </div>
  );
}

export function SortableList<T>({ items, getId, getLabel, onReorder, renderItem, disabled = false, busy = false, className, layout = "vertical" }: SortableListProps<T>) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 7 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    if (!event.over || event.active.id === event.over.id) return;
    const oldIndex = items.findIndex((item) => getId(item) === event.active.id);
    const newIndex = items.findIndex((item) => getId(item) === event.over?.id);
    if (oldIndex >= 0 && newIndex >= 0) onReorder(arrayMove(items, oldIndex, newIndex));
  };

  const ids = items.map(getId);
  const labelFor = (id: UniqueIdentifier) => {
    const item = items.find((candidate) => getId(candidate) === id);
    return item ? getLabel(item) : "this item";
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      accessibility={{ announcements: dragAnnouncements(labelFor) }}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={ids} strategy={layout === "grid" ? rectSortingStrategy : verticalListSortingStrategy} disabled={disabled || busy}>
        <div className={className}>
          {items.map((item) => (
            <SortableRow key={getId(item)} id={getId(item)} label={getLabel(item)}>
              {(handle) => renderItem(item, disabled ? null : handle)}
            </SortableRow>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
