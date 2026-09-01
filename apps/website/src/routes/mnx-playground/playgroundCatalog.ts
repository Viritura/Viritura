import type { NavListGroup } from "@viritura/ui";
import { publishedExamples } from "./publishedExamples";
import { playgroundDocuments } from "./playgroundDocuments";

export interface PlaygroundCatalogItem {
  readonly id: string;
  readonly title: string;
  readonly group: string;
  readonly source?: string;
  readonly assetUrl?: string;
}

const featured: PlaygroundCatalogItem = {
  id: playgroundDocuments[0]!.id,
  title: playgroundDocuments[0]!.title,
  group: "Featured",
  source: playgroundDocuments[0]!.source,
};

export const playgroundCatalog: readonly PlaygroundCatalogItem[] = [
  featured,
  ...publishedExamples.map((example) => ({
    id: example.id,
    title: example.title,
    group: example.group,
    assetUrl: `/mnx-samples/${example.filename}`,
  })),
];

const groupedCatalog = playgroundCatalog.reduce<Map<string, PlaygroundCatalogItem[]>>((groups, item) => {
  const items = groups.get(item.group) ?? [];
  items.push(item);
  groups.set(item.group, items);
  return groups;
}, new Map());

export const playgroundCatalogGroups: readonly NavListGroup[] = Array.from(groupedCatalog, ([group, items]) => ({
  id: group.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  label: group,
  items: items.map((item) => ({ id: item.id, label: item.title })),
}));

export function findPlaygroundCatalogItem(id: string): PlaygroundCatalogItem {
  return playgroundCatalog.find((item) => item.id === id) ?? featured;
}

export async function loadPlaygroundCatalogItem(item: PlaygroundCatalogItem, signal?: AbortSignal): Promise<string> {
  if (item.source !== undefined) return item.source;
  const response = await fetch(item.assetUrl!, { signal });
  if (!response.ok) throw new Error(`Unable to load ${item.title} (${response.status})`);
  return response.text();
}
