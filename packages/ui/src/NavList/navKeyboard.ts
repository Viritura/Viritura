import type { NavListGroup, NavListItem } from "./types";

/** Flattens groups to the selectable rows, in visual order. */
export function flattenNavItems(groups: readonly NavListGroup[]): NavListItem[] {
  return groups.flatMap((group) => group.items);
}

/**
 * Resolves the next selectable item id for an arrow-key press.
 *
 * Navigation wraps at both ends and skips disabled rows. Wrapping matters
 * here because the rail is a short, closed set — stopping dead at the last
 * row makes the keyboard feel broken when the list is only a screen tall.
 *
 * Returns `undefined` when nothing is selectable (all rows disabled), so the
 * caller can leave focus where it is.
 */
export function nextNavItemId(
  groups: readonly NavListGroup[],
  currentId: string,
  direction: "next" | "previous" | "first" | "last",
): string | undefined {
  const selectable = flattenNavItems(groups).filter((item) => item.disabled !== true);
  if (selectable.length === 0) return undefined;

  if (direction === "first") return selectable[0]?.id;
  if (direction === "last") return selectable[selectable.length - 1]?.id;

  const index = selectable.findIndex((item) => item.id === currentId);
  // An unknown or disabled current id has no meaningful neighbour, so treat
  // the press as an entry into the list from the corresponding end.
  if (index === -1) return direction === "next" ? selectable[0]?.id : selectable[selectable.length - 1]?.id;

  const offset = direction === "next" ? 1 : -1;
  const wrapped = (index + offset + selectable.length) % selectable.length;
  return selectable[wrapped]?.id;
}
