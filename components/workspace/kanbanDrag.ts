import { closestCorners, pointerWithin, type Active, type Announcements, type CollisionDetection, type KeyboardCoordinateGetter, type Over, type UniqueIdentifier } from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";

/** Column droppable ids carry a prefix (`column:`, `workflow:`); card ids are UUIDs. */
const isColumnId = (id: string | number) => String(id).includes(":");

/**
 * Target what is under the pointer: a card if there is one, otherwise its column, so a
 * tall neighbouring column cannot win. The keyboard has no pointer and uses closestCorners.
 */
export const kanbanCollisionDetection: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  if (hits.length === 0) return closestCorners(args);
  const cards = hits.filter((hit) => !isColumnId(hit.id));
  return cards.length > 0 ? cards : hits;
};

/** Whether the dragged card's centre is past the middle of the card it is over. */
export function dropsAfter(active: Active, over: Over) {
  const rect = active.rect.current.translated ?? active.rect.current.initial;
  return Boolean(rect && rect.top + rect.height / 2 > over.rect.top + over.rect.height / 2);
}

/**
 * Left and right must leave the current column. A column starts left of its own cards, so
 * the stock getter otherwise picks that same column for ArrowLeft and the card never moves.
 */
export const kanbanKeyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  const { collisionRect, droppableContainers, droppableRects } = args.context;
  if (!collisionRect || (event.code !== "ArrowLeft" && event.code !== "ArrowRight")) return sortableKeyboardCoordinates(event, args);
  const centre = collisionRect.left + collisionRect.width / 2;
  const otherColumns = droppableContainers.getEnabled().filter((container) => {
    const rect = droppableRects.get(container.id);
    return rect && (centre < rect.left || centre > rect.right);
  });
  const scoped = { getEnabled: () => otherColumns, get: (id: UniqueIdentifier) => droppableContainers.get(id) } as unknown as typeof droppableContainers;
  return sortableKeyboardCoordinates(event, { ...args, context: { ...args.context, droppableContainers: scoped } });
};

/** Screen reader messages that name things; the library default reads out raw ids. */
export function dragAnnouncements(label: (id: UniqueIdentifier) => string): Announcements {
  return {
    onDragStart: ({ active }) => `Picked up ${label(active.id)}.`,
    onDragOver: ({ active, over }) => over ? `${label(active.id)} is over ${label(over.id)}.` : `${label(active.id)} is not over a drop area.`,
    onDragEnd: ({ active, over }) => over ? `${label(active.id)} was dropped on ${label(over.id)}.` : `${label(active.id)} was dropped.`,
    onDragCancel: ({ active }) => `Moving ${label(active.id)} was cancelled.`,
  };
}
