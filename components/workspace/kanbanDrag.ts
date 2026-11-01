import { closestCorners, pointerWithin, type Active, type CollisionDetection, type Over } from "@dnd-kit/core";

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
