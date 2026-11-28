import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { byName, readManifest, recordingOf, type Rendering, treeOf, workingTree } from "./recording";
import { type ReportImage, type ReportSection, writeReport } from "./report";

const [before, after] = process.argv.slice(2);
if (!before) throw new Error("Usage: pnpm render:diff <before> [after]");
const afterName = after ?? "working tree";

const beforeTree = treeOf(before);
const afterTree = after ? treeOf(after) : workingTree();
const befores = recorded(before, beforeTree);
const afters = recorded(afterName, afterTree);
const changed = changes(befores, afters);
console.log(`${changed.length} of ${afters.size} drawings differ`);
const name = `diff-${beforeTree.slice(0, 8)}-${afterTree.slice(0, 8)}`;
console.log(writeReport(name, `${before} → ${afterName}`, changed));

function recorded(name: string, tree: string): Map<string, Rendering> {
  const recording = recordingOf(tree);
  if (!existsSync(recording)) {
    throw new Error(`${name} isn't recorded. Check it out and run pnpm render:record`);
  }
  return new Map(readManifest(recording).map((rendering) => [rendering.name, rendering]));
}

function changes(befores: Map<string, Rendering>, afters: Map<string, Rendering>): ReportSection[] {
  const removed = [...befores.values()].filter(({ name }) => !afters.has(name));
  return [...afters.values(), ...removed]
    .map(({ name, mnx }) => {
      const images = changedImages(befores.get(name)?.pages ?? [], afters.get(name)?.pages ?? []);
      return { name, mnx, images };
    })
    .filter(({ images }) => images.length > 0)
    .sort(byName);
}

function changedImages(before: string[], after: string[]): ReportImage[] {
  const count = Math.max(before.length, after.length);
  return Array.from({ length: count }, (_, i) => i)
    .filter((i) => !sameDrawing(before[i], after[i]))
    .flatMap((i) => {
      const page = count > 1 ? ` (page ${i + 1})` : "";
      return [
        { label: `Before${page}`, svg: before[i] },
        { label: `After${page}`, svg: after[i] },
      ];
    });
}

function sameDrawing(before: string | undefined, after: string | undefined): boolean {
  if (!before || !after) return false;
  return basename(before) === basename(after) || drawing(before) === drawing(after);
}

// The engine draws some elements in an order that varies between runs.
function drawing(svg: string): string {
  return readFileSync(svg, "utf8").split("\n").sort().join("\n");
}
