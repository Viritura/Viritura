import type { Grace, MultiNoteTremolo, NoteEvent, SequenceContent, Tuplet } from "./event";

/**
 * The content-item kinds that nest child events: `tuplet`, `grace`, and
 * `tremolo`. These are siblings of leaf events in a sequence's flat `content`
 * list — the only structural difference is that they carry a child `content`
 * array of their own. Centralizing this set is the single source of truth so
 * that adding a future container type is one edit, not a hunt through every
 * tree-walker.
 */
type EventContainer = Tuplet | Grace | MultiNoteTremolo;
const ROOT_EVENT_PATH: readonly number[] = [];

/** Single source of truth: does this content item nest child events? */
function isEventContainer(item: SequenceContent): item is EventContainer {
  return item.type === "tuplet" || item.type === "grace" || item.type === "tremolo";
}

/** The child content array of an event container, or null for leaf items. */
function eventContainerContent(item: SequenceContent): readonly SequenceContent[] | null {
  return isEventContainer(item) ? item.content : null;
}

/**
 * An event paired with the index path that locates it within a sequence's
 * content tree.
 *
 * `path` is the list of indices from the sequence root down to the event:
 * `[i]` for a top-level event at `content[i]`, `[i, j]` for the event at index
 * `j` inside the container at `content[i]`, and so on for nested tuplets. This
 * is the general location representation — it does not privilege any one
 * container kind, unlike the legacy per-kind index fields.
 */
export interface WalkedEvent {
  event: NoteEvent;
  path: number[];
}

/**
 * Recursively yield every {@link NoteEvent} in a content array together with
 * its index path. This is the canonical event iterator: every place that needs
 * to "visit all events, descending into containers" should delegate here rather
 * than re-implementing the descent (and inevitably forgetting a container kind).
 * An optional filter skips record/path allocation for unmatched leaf events.
 */
export function* walkSequenceEvents(
  content: readonly SequenceContent[],
  prefix: readonly number[] = ROOT_EVENT_PATH,
  include?: (event: NoteEvent) => boolean,
): Generator<WalkedEvent> {
  for (let i = 0; i < content.length; i++) {
    const item = content[i]!;
    if (item.type === "event") {
      if (!include || include(item)) yield { event: item, path: [...prefix, i] };
      continue;
    }
    const inner = eventContainerContent(item);
    if (inner) {
      yield* walkSequenceEvents(inner, [...prefix, i], include);
    }
  }
}

/** Resolve the canonical walker's index path without visiting unrelated events. */
export function resolveSequenceEvent(
  content: readonly SequenceContent[],
  path: readonly number[],
): NoteEvent | undefined {
  let level = content;
  for (let depth = 0; depth < path.length; depth++) {
    const item = level[path[depth]!];
    if (!item) return undefined;
    if (depth === path.length - 1) return item.type === "event" ? item : undefined;
    const inner = eventContainerContent(item);
    if (!inner) return undefined;
    level = inner;
  }
  return undefined;
}
