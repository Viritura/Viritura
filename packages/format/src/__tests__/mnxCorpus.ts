import { readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

interface MnxFixture {
  name: string;
  path: string;
  timeout: number | undefined;
}

export const scoresDir = resolve(__dirname, "..", "..", "fixtures", "mnx");

// Rhapsody's round trip has taken over 10s on shared CI, exceeding Vitest's 5s default.
export function corpusTimeout(size: number): number | undefined {
  return size >= 1_000_000 ? 15_000 : undefined;
}

export function corpusFixture(path: string, name = basename(path)): MnxFixture {
  return { name, path, timeout: corpusTimeout(statSync(path).size) };
}

export function listMnxFixtures(directory: string): MnxFixture[] {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".mnx"))
    .sort()
    .map((name) => corpusFixture(join(directory, name)));
}

export const mnxFixtures = listMnxFixtures(scoresDir);
