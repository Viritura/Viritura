import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { applyContentSecurityPolicy } from "./storybookContentSecurityPolicy";

const outputDirectory = resolve(process.argv[2] ?? "storybook-mnx-static");
const publicTitle = "MNX Examples and Engraving Library | Viritura";

for (const [fileName, title] of [
  ["index.html", publicTitle],
  ["iframe.html", undefined],
] as const) {
  const filePath = resolve(outputDirectory, fileName);
  const html = await readFile(filePath, "utf8");
  await writeFile(filePath, applyContentSecurityPolicy(html, title), "utf8");
}
