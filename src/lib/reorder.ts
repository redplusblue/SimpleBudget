/** Pure reorder helper: moves `id` so it ends up directly before/after `targetId`. */
export function moveItem<T extends { id: number }>(
  items: T[],
  id: number,
  targetId: number,
  place: "before" | "after",
): T[] {
  if (id === targetId) return items;
  const moving = items.find((i) => i.id === id);
  if (!moving) return items;
  const rest = items.filter((i) => i.id !== id);
  const at = rest.findIndex((i) => i.id === targetId);
  if (at === -1) return items;
  rest.splice(place === "before" ? at : at + 1, 0, moving);
  return rest;
}
