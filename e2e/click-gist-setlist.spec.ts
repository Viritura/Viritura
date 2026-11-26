import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const GIST_ID = "0123456789abcdef0123456789abcdef";
const REVISION = "0123456789abcdef0123456789abcdef01234567";
const READ_ONLY = "Shared setlists are read-only. Save a copy, then open it to edit.";
const fixture = (name: string) => resolve(import.meta.dirname, "..", "packages", "format", "fixtures", "mnx", name);

test("shared Gist setlists play and switch tracks but reject score edits", async ({ page }) => {
  const files = {
    "01 - rehearsal.mnx": await readFile(fixture("rehearsal-marks.mnx"), "utf8"),
    "02 - tempo.mnx": await readFile(fixture("tempo-markings.mnx"), "utf8"),
  };
  await page.route(`https://api.github.com/gists/${GIST_ID}`, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        id: GIST_ID,
        html_url: `https://gist.github.com/example/${GIST_ID}`,
        history: [{ version: REVISION }],
        files: Object.fromEntries(
          Object.entries(files).map(([filename, content]) => [
            filename,
            { filename, content, truncated: false, raw_url: `https://gist.githubusercontent.com/raw/${filename}` },
          ]),
        ),
      }),
    }),
  );
  await page.addInitScript(() => window.localStorage.setItem("viritura.startCenter.suppress", "1"));
  await page.goto(`/?open=gist-setlist#id=${GIST_ID}`);

  const player = page.getByRole("region", { name: "Click player" });
  await expect(player).toHaveAttribute("aria-busy", "false", { timeout: 45_000 });
  await expect(page.getByText("Laying out score")).toHaveCount(0, { timeout: 45_000 });
  await expect(page.getByText(READ_ONLY)).toHaveCount(0);
  await player.getByRole("button", { name: "Start", exact: true }).click();
  await player.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByText(READ_ONLY)).toHaveCount(0);

  await page.getByRole("button", { name: "Write", exact: true }).click();
  const canvas = page.getByRole("application", { name: "Interactive music score" });
  await canvas.focus();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Delete");
  await expect(page.getByText(READ_ONLY)).toBeVisible();

  await page.getByRole("button", { name: "Select setlist file: 01 - rehearsal" }).click();
  await page.getByRole("option", { name: "02 - tempo" }).click();
  await expect(page.getByRole("button", { name: "Select setlist file: 02 - tempo" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
