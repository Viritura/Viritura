import { byName, readManifest, recordTests, workingTree } from "./recording";
import { writeReport } from "./report";

const tests = process.argv.slice(2);
if (tests.length === 0) throw new Error("Usage: pnpm render:draw <test>...");

const sections = readManifest(recordTests(tests))
  .sort(byName)
  .map(({ name, mnx, pages }) => ({
    name,
    mnx,
    images: pages.map((svg, i) => ({ label: pages.length > 1 ? `Page ${i + 1}` : "", svg })),
  }));
console.log(`${sections.length} drawings`);
const name = `draw-${tests.join("+").replace(/[^\w.+-]/g, "_")}-${workingTree().slice(0, 8)}`;
console.log(writeReport(name, tests.join(", "), sections));
