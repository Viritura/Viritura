import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

const EDITOR_URL = process.env.PLAYWRIGHT_BASE_URL;

test.skip(!EDITOR_URL, "PLAYWRIGHT_BASE_URL is required for the editor Pages checks");

test("missing editor assets return revalidated 404s", async ({ request }) => {
  for (const path of [`assets/missing-${randomUUID()}.js`, `wasm/missing-${randomUUID()}.wasm`]) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await request.get(`${EDITOR_URL}/${path}`);
      expect(response.status(), path).toBe(404);
      expect(response.headers()["cache-control"], path).toMatch(/\b(?:no-cache|no-store)\b/i);
      expect(response.headers()["cache-control"], path).not.toMatch(/\bimmutable\b/i);
    }
  }
});

test("shared-score links still load the editor", async ({ page }) => {
  for (const path of ["/s/gist", "/s/gist/"]) {
    const response = await page.goto(`${EDITOR_URL}${path}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByText("Shared score unavailable")).toBeVisible();
  }
});
