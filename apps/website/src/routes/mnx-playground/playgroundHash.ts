import { findPlaygroundCatalogItem, playgroundCatalog } from "./playgroundCatalog";

const defaultExampleId = playgroundCatalog[0]!.id;

export function exampleIdFromHash(hash: string): string {
  const encoded = hash.replace(/^#/, "");
  if (!encoded) return defaultExampleId;
  try {
    const id = decodeURIComponent(encoded);
    return findPlaygroundCatalogItem(id).id;
  } catch {
    return defaultExampleId;
  }
}

export function hashForExampleId(id: string): string {
  return id === defaultExampleId ? "" : `#${encodeURIComponent(id)}`;
}
