import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

type ScoreFile = string | { name: string; mimeType: string; buffer: Buffer };

/** Opens a score through the editor's File menu, then switches to the Click activity. */
async function openClick(
  page: Page,
  file: ScoreFile,
  noteInput = false,
  beforeClick?: () => Promise<void>,
): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem("viritura.startCenter.suppress", "1");
    Reflect.deleteProperty(window, "showOpenFilePicker");
  });
  await page.goto("/");
  await expect(page.locator('canvas[tabindex="0"]')).toBeVisible({ timeout: 45_000 });
  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("ControlOrMeta+Shift+O");
  await (await chooser).setFiles(file);
  await expect(page.getByText("Laying out score")).toHaveCount(0, { timeout: 45_000 });
  if (noteInput) {
    const toggle = page.getByRole("button", { name: "Toggle note input (N)" });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
  }
  await beforeClick?.();
  await page.getByRole("button", { name: "Click", exact: true }).click();
  await expect(page.getByRole("region", { name: "Click player" })).toHaveAttribute("aria-busy", "false");
}

test("note-input keystrokes do not edit the score during a Click take", async ({ page }) => {
  await openClick(
    page,
    resolve(import.meta.dirname, "..", "packages", "format", "fixtures", "mnx", "rehearsal-marks.mnx"),
    true,
  );
  const player = page.getByRole("region", { name: "Click player" });
  await player.getByRole("button", { name: "Start", exact: true }).click();
  await expect(player.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  await page.getByRole("application", { name: "Interactive music score" }).focus();
  await page.keyboard.press("C");
  await page.waitForTimeout(1000);
  await expect(player.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await player.getByRole("button", { name: "Stop", exact: true }).click();
});

test("returning from Click restores a distant Write Horizon position", async ({ page }) => {
  let distant = "";
  const canvas = page.getByRole("application", { name: "Interactive music score" });
  const image = () => canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
  await openClick(
    page,
    resolve(import.meta.dirname, "..", "packages", "format", "fixtures", "mnx", "beethoven-symphony-5-movement-1.mnx"),
    false,
    async () => {
      const original = await image();
      await canvas.hover();
      await page.mouse.wheel(12000, 0);
      await expect.poll(image).not.toBe(original);
      distant = await image();
    },
  );
  await page.getByRole("button", { name: "View mode", exact: true }).click();
  await page.getByRole("option", { name: "Page", exact: true }).click();
  await page.getByRole("button", { name: "Write", exact: true }).click();
  await expect.poll(image, { timeout: 45_000 }).toBe(distant);
});

async function scoreFrame(page: Page) {
  return page.getByRole("application", { name: "Interactive music score" }).evaluate((canvas) => {
    const element = canvas.parentElement!;
    const match = /^inset\(([^)]+)\)$/.exec(element.style.clipPath);
    if (!match) return null;
    const values = match[1]!.split(/\s+/).map(Number.parseFloat);
    const [top, right = top, bottom = top, left = right] = values;
    if (top === undefined || right === undefined || bottom === undefined || left === undefined) return null;
    const box = element.getBoundingClientRect();
    return {
      x: box.x + left,
      y: box.y + top,
      width: box.width - left - right,
      height: box.height - top - bottom,
    };
  });
}

async function playheadBounds(page: Page) {
  return page.getByTestId("playhead-overlay").evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext("2d");
    if (!context || !canvas.width || !canvas.height) return null;
    const { width, height } = canvas;
    const pixels = context.getImageData(0, 0, width, height).data;
    let left = width;
    let right = -1;
    let top = height;
    let bottom = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (pixels[(y * width + x) * 4 + 3] === 0) continue;
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
    if (right < 0) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.x + (left * rect.width) / width,
      y: rect.y + (top * rect.height) / height,
      width: ((right - left + 1) * rect.width) / width,
      height: ((bottom - top + 1) * rect.height) / height,
    };
  });
}

for (const fixture of ["c-major-scale.mnx", "beethoven-symphony-5-movement-1.mnx"]) {
  test(`Click status controls receive mouse clicks and fit the shared score view (${fixture})`, async ({ page }) => {
    await openClick(page, resolve(import.meta.dirname, "..", "packages", "format", "fixtures", "mnx", fixture));
    const canvas = page.getByRole("application", { name: "Interactive music score" });
    const zoom = page.getByRole("button", { name: "Reset zoom" });
    const fit = page.getByRole("button", { name: "Zoom to fit" });
    await page.getByRole("button", { name: "Reset zoom" }).click();
    await expect(zoom).toHaveText("100%");
    await fit.click();
    await expect(zoom).not.toHaveText("100%");
    await expect.poll(async () => Number.parseInt((await zoom.textContent()) ?? "0", 10)).toBeGreaterThan(5);
    const horizonZoom = await zoom.textContent();
    const horizonImage = await canvas.screenshot();
    await fit.click();
    await expect(zoom).toHaveText(horizonZoom!);
    for (const mode of ["Page", "Spread", "Spread (H)"]) {
      await page.getByRole("button", { name: "View mode", exact: true }).click();
      await page.getByRole("option", { name: mode, exact: true }).click();
      await expect(page.getByRole("button", { name: "View mode", exact: true })).toHaveText(mode);
      await expect.poll(async () => (await canvas.screenshot()).equals(horizonImage)).toBe(false);
    }
    await page.getByRole("button", { name: "View mode", exact: true }).click();
    await page.getByRole("option", { name: "Horizon", exact: true }).click();
    await expect(zoom).toHaveText(horizonZoom!);
  });
}

test("Click follows selected bars across page, spread and Horizon views", async ({ page }) => {
  test.setTimeout(120_000);
  await openClick(
    page,
    resolve(import.meta.dirname, "..", "packages", "format", "fixtures", "mnx", "beethoven-symphony-5-movement-1.mnx"),
  );
  const canvas = page.getByRole("application", { name: "Interactive music score" });
  const bars = page.getByRole("listbox", { name: "Start bar" });
  const selector = page.getByRole("button", { name: "View mode", exact: true });
  async function cursorVisible() {
    return page.getByTestId("playhead-overlay").evaluate((element: HTMLCanvasElement) => {
      const context = element.getContext("2d");
      if (!context) return false;
      const { width, height } = element;
      if (!width || !height) return false;
      const data = context.getImageData(0, 0, width, height).data;
      for (let y = 12; y < height - 66; y++) {
        for (let x = 42; x < width - 12; x++) {
          if (data[(y * width + x) * 4 + 3]! > 0) return true;
        }
      }
      return false;
    });
  }
  for (const mode of ["Page", "Spread", "Spread (H)"]) {
    await selector.click();
    await page.getByRole("option", { name: mode, exact: true }).click();
    await bars.press("Home");
    await expect.poll(cursorVisible, { timeout: 45_000 }).toBe(true);
    const firstPage = await canvas.screenshot();
    await bars.press("End");
    await expect.poll(async () => (await canvas.screenshot()).equals(firstPage), { timeout: 45_000 }).toBe(false);
    await expect.poll(cursorVisible, { timeout: 45_000 }).toBe(true);
    const lastPage = await canvas.screenshot();
    await bars.press("Home");
    await expect.poll(async () => (await canvas.screenshot()).equals(lastPage), { timeout: 45_000 }).toBe(false);
    await expect.poll(cursorVisible).toBe(true);
  }
  await selector.click();
  await page.getByRole("option", { name: "Horizon", exact: true }).click();
  await expect
    .poll(async () =>
      Number.parseInt((await page.getByRole("button", { name: "Reset zoom" }).textContent()) ?? "0", 10),
    )
    .toBeGreaterThan(5);
  await expect.poll(cursorVisible).toBe(true);
});

for (const mode of ["Page", "Spread", "Spread (H)"]) {
  test(`${mode} previews the next flow during playback and restores it on Stop`, async ({ page }) => {
    const single = mode === "Page";
    const measures = Array.from({ length: single ? 16 : 20 }, (_, index) => ({
      id: `m${index}`,
      number: index + 1,
      ...(index === 0 ? { time: { count: 1, unit: 4 }, tempos: [{ bpm: 60, value: { base: "quarter" } }] } : {}),
    }));
    const mnx = {
      mnx: { version: 7 },
      global: { measures },
      layouts: [{ id: "reader-layout", content: [{ type: "staff", sources: [{ part: "p1" }] }] }],
      parts: [
        {
          id: "p1",
          measures: measures.map(() => ({
            sequences: [{ content: [{ duration: { base: "quarter" }, notes: [{ pitch: { step: "C", octave: 4 } }] }] }],
          })),
        },
      ],
      scores: [
        {
          name: "Reader turns",
          layout: "reader-layout",
          _x: {
            viritura: {
              pageSetupRole: "score",
              pageSetup: { width: 140, height: single ? 140 : 200, spatiumMm: single ? 1 : 1.5 },
              layoutBreaks: measures
                .filter((_, index) => index > 0 && (single || index % 4 === 0))
                .map((measure, index) => ({
                  measure: measure.id,
                  kind: single && (index + 1) % 8 !== 0 ? "system" : "page",
                })),
            },
          },
        },
      ],
    };
    await openClick(page, {
      name: "reader-turns.mnx",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(mnx)),
    });
    await page.getByRole("button", { name: "View mode" }).click();
    await page.getByRole("option", { name: mode, exact: true }).click();
    const bars = page.getByRole("listbox", { name: "Start bar" });
    await bars.press("Home");
    for (let index = 0; index < (single ? 7 : 10); index++) await bars.press("ArrowRight");
    await expect(page.getByRole("option", { name: single ? "Bar 8" : "Bar 11", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.locator("[data-reader-source-page]")).toHaveCount(0);
    await page.getByRole("button", { name: "Start", exact: true }).click();
    const preview = page.locator(
      single
        ? '[data-reader-source-page="1"][data-reader-target-page="0"]'
        : '[data-reader-source-page="3"][data-reader-target-page="1"]',
    );
    await expect(preview).toBeVisible();
    const target = page.getByRole("application", { name: "Interactive music score" });
    await expect
      .poll(async () => {
        const [pageBox, previewBox] = await Promise.all([target.boundingBox(), preview.boundingBox()]);
        return (
          pageBox !== null &&
          previewBox !== null &&
          previewBox.x >= pageBox.x &&
          previewBox.y >= pageBox.y &&
          previewBox.x + previewBox.width <= pageBox.x + pageBox.width &&
          previewBox.y + previewBox.height <= pageBox.y + pageBox.height
        );
      })
      .toBe(true);
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(preview).toHaveCount(0);
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await expect(preview).toBeVisible();
    await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('canvas[aria-label="Interactive music score"]');
      if (!canvas?.parentElement) throw new Error("Score canvas is not available");
      const oldFrame = canvas.toDataURL();
      const observer = new MutationObserver(() => {
        if (canvas.parentElement?.querySelector("[data-reader-source-page]")) return;
        document.documentElement.dataset.readerTurnStale = String(canvas.toDataURL() === oldFrame);
        observer.disconnect();
      });
      observer.observe(canvas.parentElement, { childList: true });
    });
    await expect(page.getByRole("status", { name: "Playback position" })).toHaveText(single ? "9:1" : "13:1", {
      timeout: 10000,
    });
    await expect(preview).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.readerTurnStale)).toBe("false");
    await page.getByRole("button", { name: "Stop", exact: true }).click();
  });
}

for (const mode of ["Page", "Spread", "Spread (H)"]) {
  test(`${mode} follows the playhead with a whole centered page frame`, async ({ page }) => {
    const measures = Array.from({ length: 16 }, (_, index) => ({
      id: `m${index}`,
      number: index + 1,
      ...(index === 0 ? { time: { count: 1, unit: 4 }, tempos: [{ bpm: 60, value: { base: "quarter" } }] } : {}),
    }));
    await openClick(page, {
      name: "four-pages.mnx",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          mnx: { version: 7 },
          global: { measures },
          layouts: [{ id: "layout", content: [{ type: "staff", sources: [{ part: "p1" }] }] }],
          parts: [
            {
              id: "p1",
              measures: measures.map(() => ({
                sequences: [
                  { content: [{ duration: { base: "quarter" }, notes: [{ pitch: { step: "C", octave: 4 } }] }] },
                ],
              })),
            },
          ],
          scores: [
            {
              name: "Four pages",
              layout: "layout",
              _x: {
                viritura: {
                  pageSetupRole: "score",
                  pageSetup: { width: 140, height: 200, spatiumMm: 1.5 },
                  layoutBreaks: measures
                    .filter((_, index) => index > 0 && index % 4 === 0)
                    .map((measure) => ({ measure: measure.id, kind: "page" })),
                },
              },
            },
          ],
        }),
      ),
    });
    await page.getByRole("button", { name: "View mode" }).click();
    await page.getByRole("option", { name: mode, exact: true }).click();
    const bars = page.getByRole("listbox", { name: "Start bar" });
    const canvas = page.getByRole("application", { name: "Interactive music score" });
    await bars.press("Home");
    await expect.poll(async () => (await scoreFrame(page))?.width ?? 0).toBeGreaterThan(0);
    await expect.poll(async () => (await playheadBounds(page)) !== null).toBe(true);
    const first = (await scoreFrame(page))!;
    const firstImage = await canvas.screenshot();
    await expect
      .poll(async () => {
        const frame = await scoreFrame(page);
        return frame ? frame.width / frame.height : 0;
      })
      .toBeCloseTo(0.7, 1);
    for (let step = 0; step < 4; step++) await bars.press("ArrowRight");
    await expect(page.getByRole("option", { name: "Bar 5", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect.poll(async () => (await canvas.screenshot()).equals(firstImage)).toBe(false);
    await expect
      .poll(async () => {
        const frame = await scoreFrame(page);
        return frame ? frame.width / frame.height : 0;
      })
      .toBeCloseTo(mode === "Page" ? 0.7 : 1.4, 1);
    const paired = (await scoreFrame(page))!;
    expect(paired.x + paired.width / 2).toBeCloseTo(first.x + first.width / 2, 0);
    expect(paired.y + paired.height / 2).toBeCloseTo(first.y + first.height / 2, 0);
    await bars.press("End");
    await expect(page.getByRole("option", { name: "Bar 16", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect
      .poll(async () => {
        const frame = await scoreFrame(page);
        return frame ? frame.width / frame.height : 0;
      })
      .toBeCloseTo(0.7, 1);
    await expect.poll(async () => (await playheadBounds(page)) !== null).toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(async () => {
        const frame = await scoreFrame(page);
        return frame ? frame.width / frame.height : 0;
      })
      .toBeCloseTo(0.7, 1);
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await expect(page.getByRole("group", { name: "Click settings" })).toHaveCount(0);
    await expect.poll(async () => (await playheadBounds(page)) !== null).toBe(true);
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(page.getByRole("group", { name: "Click settings" })).toBeVisible();
  });
}

test("click pages honor MNX page and staff sizes when switching score views", async ({ page }) => {
  const fixture = await readFile(
    resolve(import.meta.dirname, "..", "packages", "format", "fixtures", "mnx", "c-major-scale.mnx"),
    "utf8",
  );
  const mnx = {
    ...(JSON.parse(fixture) as Record<string, unknown>),
    _x: {
      viritura: {
        pageSetupDefaults: {
          score: {
            width: 300,
            height: 200,
            orientation: "landscape",
            spatiumMm: 1,
            margins: { top: 10, right: 12, bottom: 14, left: 16 },
          },
        },
      },
    },
    scores: [
      { name: "Small staff", _x: { viritura: { pageSetupRole: "score" } } },
      { name: "Large staff", _x: { viritura: { pageSetupRole: "score", pageSetup: { spatiumMm: 2 } } } },
      {
        name: "Portrait",
        _x: {
          viritura: {
            pageSetupRole: "score",
            pageSetup: { width: 180, height: 260, orientation: "portrait", spatiumMm: 1.6 },
          },
        },
      },
    ],
  };
  await openClick(page, {
    name: "engraving-sizes.mnx",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(mnx)),
  });
  await page.getByRole("button", { name: "View mode" }).click();
  await page.getByRole("option", { name: "Page", exact: true }).click();
  async function pageAspect() {
    const frame = await scoreFrame(page);
    return frame === null ? 0 : frame.width / frame.height;
  }
  async function staffHeight() {
    const zoom = Number.parseInt((await page.getByRole("button", { name: "Reset zoom" }).textContent()) ?? "0", 10);
    return ((await playheadBounds(page))?.height ?? 0) / zoom;
  }
  await expect.poll(pageAspect).toBeCloseTo(1.5, 2);
  await expect.poll(staffHeight).toBeGreaterThan(0);
  const originalHeight = await staffHeight();
  async function selectScore(name: string) {
    await page.getByRole("button", { name: /^Select score or part:/ }).click();
    await page.getByRole("button", { name, exact: true }).click();
  }
  await selectScore("Large staff");
  await expect.poll(async () => Math.abs((await staffHeight()) / originalHeight - 2)).toBeLessThan(0.1);
  await expect.poll(pageAspect).toBeCloseTo(1.5, 2);
  await selectScore("Portrait");
  await expect.poll(pageAspect).toBeCloseTo(180 / 260, 2);
  await selectScore("Small staff");
  await expect.poll(pageAspect).toBeCloseTo(1.5, 2);
  await expect.poll(async () => (await staffHeight()) / originalHeight).toBeCloseTo(1, 1);
});

test("click score view controls remain usable on a narrow viewport", async ({ page }) => {
  await openClick(
    page,
    resolve(import.meta.dirname, "..", "packages", "format", "fixtures", "mnx", "beethoven-symphony-5-movement-1.mnx"),
  );
  const selector = page.getByRole("button", { name: "View mode" });
  await page.setViewportSize({ width: 390, height: 844 });
  for (const control of [
    selector,
    page.getByRole("button", { name: /^Select score or part:/ }),
    page.getByRole("slider", { name: "Zoom slider", exact: true }),
    page.getByRole("button", { name: "Reset zoom", exact: true }),
    page.getByRole("button", { name: "Zoom to fit", exact: true }),
  ]) {
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    if (!box) throw new Error("Score view control is not visible");
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  const picker = await page.getByRole("button", { name: /^Select score or part:/ }).boundingBox();
  const menu = await page.getByRole("menubar", { name: "Menu bar" }).boundingBox();
  const status = await page.getByRole("status", { name: "Click score view" }).boundingBox();
  const transport = await page.getByRole("region", { name: "Click player" }).boundingBox();
  if (!picker || !menu || !status || !transport) throw new Error("Click chrome is not visible");
  expect(picker.x).toBeGreaterThanOrEqual(menu.x + menu.width);
  expect(transport.y + transport.height).toBeLessThanOrEqual(status.y);
});

test("bar numbers stay centered with and without repeat details", async ({ page }) => {
  const fixture = await readFile(
    resolve(import.meta.dirname, "..", "packages", "format", "fixtures", "mnx", "rehearsal-marks.mnx"),
    "utf8",
  );
  const score = JSON.parse(fixture) as {
    global: { measures: { repeatStart?: object; repeatEnd?: object }[] };
  };
  score.global.measures[0]!.repeatStart = {};
  score.global.measures[1]!.repeatEnd = {};
  await openClick(page, {
    name: "repeated.mnx",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(score)),
  });

  const dial = page.getByRole("listbox", { name: "Start bar" });
  for (const [name, expectedDetail] of [
    ["Bar 1, visit 1 of 2, rehearsal A", "1/2"],
    ["Bar 3, rehearsal B", ""],
  ]) {
    const geometry = await dial.getByRole("option", { name }).evaluate((option) => {
      const viewport = option.closest('[role="listbox"]');
      const [label, detail] = option.querySelectorAll("span");
      if (!viewport || !label || !detail) throw new Error("Bar dial content is missing");
      const dialBox = viewport.getBoundingClientRect();
      const labelBox = label.getBoundingClientRect();
      const detailBox = detail.getBoundingClientRect();
      return {
        offset: labelBox.y + labelBox.height / 2 - (dialBox.y + dialBox.height / 2),
        gap: detailBox.top - labelBox.bottom,
        detail: detail.textContent,
      };
    });
    expect(Math.abs(geometry.offset)).toBeLessThan(0.5);
    expect(geometry.detail).toBe(expectedDetail);
    if (expectedDetail) expect(geometry.gap).toBeGreaterThanOrEqual(0);
  }
});

test("shows negative countoff clicks before live bar and beat", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openClick(
    page,
    resolve(import.meta.dirname, "..", "packages", "format", "fixtures", "mnx", "rehearsal-marks.mnx"),
  );
  await page.getByRole("slider", { name: "Session tempo %" }).fill("50");
  const panel = page.getByRole("region", { name: "Click player" });
  await panel.getByRole("button", { name: "Start", exact: true }).click();
  const stop = panel.getByRole("button", { name: "Stop", exact: true });
  await expect(stop).toBeEnabled();
  const initial = await stop.boundingBox();
  if (!initial) throw new Error("Stop button is not visible");
  for (const text of ["-4", "-3", "-2", "-1", "1:1", "1:2", "1:3", "1:4", "2:1"]) {
    await expect(panel.getByRole("status", { name: "Playback position" })).toHaveText(text);
    const button = await stop.boundingBox();
    if (!button) throw new Error("Stop button is not visible");
    expect(Math.abs(button.x - initial.x)).toBeLessThan(1);
    expect(Math.abs(button.y - initial.y)).toBeLessThan(1);
  }
  await stop.click();
});

test("flashes on beats, honors reduced motion, and saves the flash setting", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openClick(
    page,
    resolve(import.meta.dirname, "..", "packages", "format", "fixtures", "mnx", "rehearsal-marks.mnx"),
  );
  const panel = page.getByRole("region", { name: "Click player" });
  const pulse = panel.locator("[data-click-flash]");
  const start = () => panel.getByRole("button", { name: "Start", exact: true }).click();
  const stop = () => panel.getByRole("button", { name: "Stop", exact: true }).click();
  const openPlaybackSettings = async () => {
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("tab", { name: "Playback", exact: true }).click();
    return page.getByRole("radiogroup", { name: "Click player flash" });
  };
  const sampleFlashes = async () => {
    await pulse.waitFor({ state: "attached" });
    return pulse.evaluate(
      (element) =>
        new Promise<{
          peaks: { strength: number; shadow: string; background: string }[];
          restShadow: string;
          restBackground: string;
        }>((resolve) => {
          const host = element.parentElement!;
          const peaks: { strength: number; shadow: string; background: string }[] = [];
          let previous = 0;
          let restShadow = "";
          let restBackground = "";
          const started = performance.now();
          const sample = () => {
            const strength = Number.parseFloat(host.style.getPropertyValue("--click-pulse")) || 0;
            const { boxShadow: shadow, backgroundColor: background } = getComputedStyle(host);
            if (strength > 0 && previous === 0) peaks.push({ strength, shadow, background });
            if (strength === 0) {
              restShadow = shadow;
              restBackground = background;
            }
            previous = strength;
            if (performance.now() - started < 1500) requestAnimationFrame(sample);
            else resolve({ peaks, restShadow, restBackground });
          };
          requestAnimationFrame(sample);
        }),
    );
  };

  const settings = await openPlaybackSettings();
  await expect(settings.getByRole("radio", { name: "Every beat" })).toBeChecked();
  await page.keyboard.press("Escape");
  const everyBeatSample = sampleFlashes();
  await start();
  const everyBeat = await everyBeatSample;
  expect(everyBeat.peaks.length).toBeGreaterThanOrEqual(3);
  expect(everyBeat.peaks[0]!.strength).toBeGreaterThan(everyBeat.peaks[1]!.strength);
  expect(everyBeat.peaks[0]!.shadow).not.toBe(everyBeat.restShadow);
  expect(everyBeat.peaks[0]!.shadow).not.toBe(everyBeat.peaks[1]!.shadow);
  expect(everyBeat.peaks[0]!.background).toBe(everyBeat.restBackground);
  await stop();

  await page.emulateMedia({ reducedMotion: "reduce" });
  await start();
  await expect(pulse).toHaveCount(1);
  await page.waitForTimeout(700);
  await expect(panel).toHaveCSS("box-shadow", everyBeat.restShadow);
  await expect(panel).toHaveCSS("background-color", everyBeat.restBackground);
  expect(await panel.evaluate((element) => element.style.getPropertyValue("--click-pulse"))).toBe("0%");
  await stop();
  await page.emulateMedia({ reducedMotion: "no-preference" });

  await (await openPlaybackSettings()).getByRole("radio", { name: "Measure only" }).click();
  await page.keyboard.press("Escape");
  const measureSample = sampleFlashes();
  await start();
  const measureOnly = await measureSample;
  expect(measureOnly.peaks).toHaveLength(1);
  await stop();

  await (await openPlaybackSettings()).getByRole("radio", { name: "Off", exact: true }).click();
  await page.keyboard.press("Escape");
  await start();
  await expect(pulse).toHaveCount(0);
  await stop();
  await page.reload();
  await expect((await openPlaybackSettings()).getByRole("radio", { name: "Off", exact: true })).toBeChecked();
});

test("shows a theme-colored outline and an unclipped glow outside the compact panel", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openClick(
    page,
    resolve(import.meta.dirname, "..", "packages", "format", "fixtures", "mnx", "rehearsal-marks.mnx"),
  );
  const panel = page.getByRole("region", { name: "Click player" });
  await panel.getByRole("button", { name: "Start", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  await page.evaluate(() => {
    window.requestAnimationFrame = () => 0;
  });
  await page.waitForTimeout(100);
  const bounds = await panel.boundingBox();
  if (!bounds || bounds.x < 8 || bounds.height <= 32) throw new Error("Click panel cannot be sampled");
  const clip = { x: Math.floor(bounds.x) - 8, y: Math.ceil(bounds.y) + 16, width: 6, height: bounds.height - 32 };
  const activeShadows: string[] = [];

  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => document.documentElement.setAttribute("data-theme", value), theme);
    await panel.evaluate((element) => element.style.setProperty("--click-pulse", "0%"));
    await page.waitForTimeout(100);
    const restBackground = await panel.evaluate((element) => getComputedStyle(element).backgroundColor);
    const restOutside = await page.screenshot({ clip });
    await panel.evaluate((element) => element.style.setProperty("--click-pulse", "100%"));
    const active = await panel.evaluate((element) => ({
      background: getComputedStyle(element).backgroundColor,
      shadow: getComputedStyle(element).boxShadow,
    }));
    const activeOutside = await page.screenshot({ clip });
    expect(active.background).toBe(restBackground);
    expect(activeOutside.equals(restOutside)).toBe(false);
    activeShadows.push(active.shadow);
  }
  expect(activeShadows[0]).not.toBe(activeShadows[1]);
});

test("keeps the detached flash running on the picture window's frame clock", async ({ page }) => {
  await openClick(
    page,
    resolve(import.meta.dirname, "..", "packages", "format", "fixtures", "mnx", "rehearsal-marks.mnx"),
    false,
    async () => {
      await page.evaluate(() => {
        let picture: Window | null = null;
        Object.defineProperty(globalThis, "documentPictureInPicture", {
          configurable: true,
          value: {
            get window() {
              return picture;
            },
            requestWindow: async () => {
              const opened = window.open("", "_blank", "popup,width=400,height=400");
              if (!opened) throw new Error("Could not open the test picture window");
              picture = opened;
              opened.addEventListener("pagehide", () => (picture = null), { once: true });
              return opened;
            },
          },
        });
      });
    },
  );
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Keep above other apps" }).click();
  const popup = await popupPromise;
  const player = popup.getByRole("region", { name: "Click player" });
  await player.getByRole("button", { name: "Start", exact: true }).click();
  await expect(player.getByRole("button", { name: "Stop", exact: true })).toBeEnabled();
  await page.evaluate(() => {
    window.requestAnimationFrame = () => 0;
  });
  const flash = await player.locator("[data-click-flash]").evaluate(
    (element) =>
      new Promise<{
        count: number;
        activeShadow: string;
        restShadow: string;
        activeBackground: string;
        restBackground: string;
      }>((resolve) => {
        const host = element.parentElement!;
        let count = 0;
        let previous = 0;
        let activeShadow = "";
        let restShadow = "";
        let activeBackground = "";
        let restBackground = "";
        const started = performance.now();
        const sample = () => {
          const value = Number.parseFloat(host.style.getPropertyValue("--click-pulse")) || 0;
          const { boxShadow: shadow, backgroundColor: background } = getComputedStyle(host);
          if (value > 0 && previous === 0) count++;
          if (value > 0) {
            activeShadow = shadow;
            activeBackground = background;
          } else {
            restShadow = shadow;
            restBackground = background;
          }
          previous = value;
          if (performance.now() - started < 1500) requestAnimationFrame(sample);
          else resolve({ count, activeShadow, restShadow, activeBackground, restBackground });
        };
        requestAnimationFrame(sample);
      }),
  );
  expect(flash.count).toBeGreaterThanOrEqual(2);
  expect(flash.activeShadow).toContain("inset");
  expect(flash.activeShadow).not.toBe(flash.restShadow);
  expect(flash.activeBackground).toBe(flash.restBackground);
  await player.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(player.locator("[data-click-flash]")).toHaveCount(0);
  await popup.close();
});

test("the picture window shrinks to the compact controls on Start and restores on Stop", async ({ page }) => {
  await openClick(
    page,
    resolve(import.meta.dirname, "..", "packages", "format", "fixtures", "mnx", "rehearsal-marks.mnx"),
    false,
    async () => {
      await page.evaluate(() => {
        let picture: Window | null = null;
        Object.defineProperty(globalThis, "documentPictureInPicture", {
          configurable: true,
          value: {
            get window() {
              return picture;
            },
            requestWindow: async () => {
              const opened = window.open("", "_blank", "popup,width=400,height=400");
              if (!opened) throw new Error("Could not open the test picture window");
              picture = opened;
              opened.addEventListener("pagehide", () => (picture = null), { once: true });
              return opened;
            },
          },
        });
      });
    },
  );
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Keep above other apps" }).click();
  const popup = await popupPromise;
  await popup.setViewportSize({ width: 400, height: 400 });
  const player = popup.getByRole("region", { name: "Click player" });
  await expect(player.getByRole("button", { name: "Start", exact: true })).toBeVisible();
  await popup.evaluate(() => {
    const calls: number[][] = [];
    Reflect.set(window, "resizeCalls", calls);
    window.resizeBy = (x: number, y: number) => void calls.push([x, y]);
  });
  const resizeCalls = () => popup.evaluate(() => Reflect.get(window, "resizeCalls") as number[][]);

  await player.getByRole("button", { name: "Start", exact: true }).click();
  await expect(player.getByRole("button", { name: "Stop", exact: true })).toBeEnabled();
  await expect.poll(async () => (await resizeCalls()).length).toBe(1);
  const [[dx, dy]] = await resizeCalls();
  expect(dx).toBeLessThan(0);
  expect(dy).toBeLessThan(0);
  const stop = await player.getByRole("button", { name: "Stop", exact: true }).boundingBox();
  expect(stop?.width).toBeLessThan(200);

  await player.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(player.getByRole("button", { name: "Start", exact: true })).toBeVisible();
  // The spy does not move the viewport, so restoring is a zero delta back to the saved size.
  expect((await resizeCalls()).length).toBe(1);
  await popup.close();
});

test("real Document PiP opens at the panel size and requests a compact resize on Start", async ({ page }) => {
  await openClick(
    page,
    resolve(import.meta.dirname, "..", "packages", "format", "fixtures", "mnx", "rehearsal-marks.mnx"),
  );
  test.skip(!(await page.evaluate(() => "documentPictureInPicture" in window)), "Document PiP is unavailable");
  const panel = await page.getByRole("region", { name: "Click player" }).boundingBox();
  if (!panel) throw new Error("Click controls are not visible");
  await page.evaluate(() => {
    const api = Reflect.get(window, "documentPictureInPicture") as {
      requestWindow: (options: { width: number; height: number }) => Promise<Window>;
    };
    const request = api.requestWindow.bind(api);
    api.requestWindow = async (options) => {
      document.documentElement.dataset.pictureRequest = JSON.stringify(options);
      const win = await request(options);
      const calls: number[][] = [];
      Reflect.set(window, "pictureResizes", calls);
      const resizeBy = win.resizeBy.bind(win);
      win.resizeBy = (x: number, y: number) => {
        calls.push([x, y]);
        resizeBy(x, y);
      };
      return win;
    };
  });
  await page.getByRole("button", { name: "Keep above other apps" }).click();
  expect(await page.evaluate(() => JSON.parse(document.documentElement.dataset.pictureRequest!))).toEqual({
    width: Math.ceil(panel.width),
    height: Math.ceil(panel.height),
  });
  const pictureButton = (label: string) =>
    page.evaluate((name) => {
      const api = Reflect.get(window, "documentPictureInPicture") as { window: Window | null };
      const button = Array.from(api.window?.document.querySelectorAll("button") ?? []).find(
        (candidate) => candidate.textContent?.trim() === name,
      );
      button?.click();
      return Boolean(button);
    }, label);
  await expect.poll(() => page.evaluate(() => Reflect.has(window, "pictureResizes"))).toBe(true);
  await expect.poll(() => pictureButton("Start")).toBe(true);
  await expect
    .poll(async () => (await page.evaluate(() => Reflect.get(window, "pictureResizes") as number[][])).length)
    .toBe(1);
  const [[dx, dy]] = await page.evaluate(() => Reflect.get(window, "pictureResizes") as number[][]);
  expect(dx).toBeLessThan(0);
  expect(dy).toBeLessThan(0);
  await expect.poll(() => pictureButton("Stop")).toBe(true);
  await page.evaluate(() => (Reflect.get(window, "documentPictureInPicture") as { window: Window }).window.close());
});

test("dragging the click transport does not select its text", async ({ page }) => {
  await openClick(
    page,
    resolve(import.meta.dirname, "..", "packages", "format", "fixtures", "mnx", "rehearsal-marks.mnx"),
  );

  const panel = page.getByRole("region", { name: "Click player" });
  const details = panel.getByRole("group", { name: "Selected start" });
  await expect(panel.getByRole("option", { name: "Bar 1, rehearsal A" })).toHaveAttribute("aria-selected", "true");
  const initial = await panel.boundingBox();
  const area = await details.boundingBox();
  if (!initial || !area) throw new Error("Click transport is not visible");

  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  const y = area.y + area.height / 2;
  await page.mouse.move(area.x + 2, y);
  await page.mouse.down();
  await page.mouse.move(area.x + Math.min(area.width - 2, 200), y, { steps: 10 });
  await page.mouse.up();

  await expect.poll(async () => (await panel.boundingBox())?.x ?? 0).toBeGreaterThan(initial.x + 40);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("");

  await panel.getByRole("radio", { name: "2 bars" }).click();
  await expect(panel.getByText("8 clicks free")).toBeVisible();
  await panel.getByRole("option", { name: "Bar 3, rehearsal B" }).click();
  await expect(panel.getByRole("option", { name: "Bar 3, rehearsal B" })).toHaveAttribute("aria-selected", "true");
});

test("dragging a navigation dial horizontally selects a later bar", async ({ page }) => {
  await openClick(
    page,
    resolve(import.meta.dirname, "..", "packages", "format", "fixtures", "mnx", "rehearsal-marks.mnx"),
  );

  const panel = page.getByRole("region", { name: "Click player" });
  await expect(panel.getByRole("option", { name: "Bar 1, rehearsal A" })).toHaveAttribute("aria-selected", "true");
  const box = await panel.getByRole("listbox", { name: "Start bar" }).boundingBox();
  if (!box) throw new Error("Start bar dial is not visible");

  const y = box.y + box.height / 2;
  const x = box.x + box.width / 2;
  await page.mouse.move(x + 80, y);
  await page.mouse.down();
  await page.mouse.move(x - 80, y, { steps: 8 });
  await page.waitForTimeout(150);
  await page.mouse.up();

  await expect(panel.getByRole("option", { name: "Bar 3, rehearsal B" })).toHaveAttribute("aria-selected", "true");
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("");
  await expect(panel.getByRole("button", { name: "Start", exact: true })).toBeEnabled();
});

for (const viewport of [
  { width: 1400, height: 900, barNumber: 3 },
  { width: 390, height: 844, barNumber: 137 },
]) {
  test(`playback fills the workspace with compact Click controls at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const fixture = await readFile(
      resolve(import.meta.dirname, "..", "packages", "format", "fixtures", "mnx", "rehearsal-marks.mnx"),
      "utf8",
    );
    const score = JSON.parse(fixture) as { global: { measures: { number?: number }[] } };
    score.global.measures[2]!.number = viewport.barNumber;
    await openClick(page, {
      name: "rehearsal-marks.mnx",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(score)),
    });

    const panel = page.getByRole("region", { name: "Click player" });
    const barName = `Bar ${viewport.barNumber}, rehearsal B`;
    await panel.getByRole("option", { name: barName }).click();
    await panel.getByRole("radio", { name: "2 bars" }).click();
    const tempo = page.getByRole("slider", { name: "Session tempo %" });
    await tempo.press("Home");
    for (let step = 0; step < 10; step++) await tempo.press("ArrowRight");
    const zoom = page.getByRole("button", { name: "Reset zoom" });
    await expect.poll(async () => Number.parseInt((await zoom.textContent()) ?? "0", 10)).toBeGreaterThan(0);
    await zoom.click();
    await expect(zoom).toHaveText("100%");
    const initialZoom = Number.parseInt((await zoom.textContent()) ?? "0", 10);
    await expect.poll(async () => (await playheadBounds(page))?.height ?? 0).toBeGreaterThan(0);
    const initialInkHeight = (await playheadBounds(page))!.height;
    const scoreView = page.getByRole("application", { name: "Interactive music score" });
    const initialScore = await scoreView.boundingBox();
    if (!initialScore) throw new Error("Score view is not visible");
    const expanded = await panel.boundingBox();
    if (!expanded) throw new Error("Click transport is not visible");
    const expandedButton = await panel.getByRole("button", { name: "Start", exact: true }).boundingBox();
    if (!expandedButton) throw new Error("Start button is not visible");
    const pictureButton = await panel.getByRole("button", { name: "Keep above other apps" }).boundingBox();
    if (!pictureButton) throw new Error("Picture-in-picture button is not visible");
    expect(pictureButton.x + pictureButton.width).toBeLessThanOrEqual(expandedButton.x);
    await panel.getByRole("button", { name: "Start", exact: true }).focus();
    await page.keyboard.press("Enter");

    const stop = panel.getByRole("button", { name: "Stop", exact: true });
    const bar = panel.getByRole("status", { name: "Playback position" });
    await expect(stop).toBeEnabled();
    await expect(page.getByRole("group", { name: "Click settings" })).toHaveCount(0);
    await expect(page.locator(".app-chrome--top")).toBeHidden();
    await expect(page.locator(".app-chrome--side")).toBeHidden();
    await expect
      .poll(async () => {
        const playingScore = await scoreView.boundingBox();
        return (
          playingScore !== null &&
          playingScore.height > initialScore.height + 40 &&
          playingScore.width > initialScore.width + 40
        );
      })
      .toBe(true);
    await expect(bar).toHaveText("-8");
    await expect.poll(async () => (await playheadBounds(page))?.height ?? 0).toBeGreaterThan(initialInkHeight * 1.03);
    await expect(panel).toHaveAttribute("data-compact", "true");
    await expect(panel.getByRole("listbox", { name: "Start bar" })).toHaveCount(0);
    await expect(panel.getByRole("listbox", { name: "Rehearsal" })).toHaveCount(0);
    await expect(panel.getByRole("radiogroup", { name: "Countoff" })).toHaveCount(0);
    const compact = await panel.boundingBox();
    if (!compact) throw new Error("Compact click transport is not visible");
    expect(compact.width).toBeLessThan(expanded.width);
    expect(compact.height).toBeLessThan(expanded.height);
    const stopButton = await stop.boundingBox();
    if (!stopButton) throw new Error("Stop button is not visible");
    expect(Math.abs(stopButton.x - expandedButton.x)).toBeLessThan(2);

    const barBox = await bar.boundingBox();
    if (!barBox) throw new Error("Current bar is not visible");
    const textWidth = await bar.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return range.getBoundingClientRect().width;
    });
    expect(barBox.width).toBeLessThanOrEqual(textWidth + 1);
    await page.mouse.move(barBox.x + barBox.width / 2, barBox.y + barBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(viewport.width - 10, viewport.height - 10, { steps: 5 });
    await page.mouse.up();
    const movedButton = await stop.boundingBox();
    if (!movedButton) throw new Error("Moved Stop button is not visible");
    await stop.click();

    const start = panel.getByRole("button", { name: "Start", exact: true });
    await expect(start).toBeEnabled();
    await expect(page.locator(".app-chrome--top")).toBeVisible();
    await expect(page.locator(".app-chrome--side")).toBeVisible();
    await expect(page.getByRole("group", { name: "Click settings" })).toBeVisible();
    await expect
      .poll(async () => {
        const restoredScore = await scoreView.boundingBox();
        return restoredScore === null ? Infinity : Math.abs(restoredScore.height - initialScore.height);
      })
      .toBeLessThan(1);
    await expect.poll(async () => Number.parseInt((await zoom.textContent()) ?? "0", 10)).toBe(initialZoom);
    await expect(panel.getByRole("listbox", { name: "Rehearsal" })).toBeVisible();
    await expect(panel.getByRole("listbox", { name: "Start bar" })).toBeVisible();
    await expect(panel.getByRole("radio", { name: "2 bars" })).toBeChecked();
    await expect(panel.getByRole("option", { name: barName })).toHaveAttribute("aria-selected", "true");
    await expect(panel).not.toHaveAttribute("data-compact");
    await expect(bar).toHaveCount(0);
    await expect
      .poll(async () => {
        const restored = await panel.boundingBox();
        return (
          restored !== null &&
          Math.abs(restored.width - expanded.width) < 1 &&
          Math.abs(restored.height - expanded.height) < 1 &&
          restored.x >= 0 &&
          restored.y >= 0 &&
          restored.x + restored.width <= viewport.width &&
          restored.y + restored.height <= viewport.height
        );
      })
      .toBe(true);
    const restoredButton = await start.boundingBox();
    if (!restoredButton) throw new Error("Restored Start button is not visible");
    await start.click();
    await expect(stop).toBeEnabled();
    const restartedButton = await stop.boundingBox();
    if (!restartedButton) throw new Error("Restarted Stop button is not visible");
    await stop.click();
  });
}

test.describe("compact transport touch movement", () => {
  test.use({ hasTouch: true });

  test("the narrower bar display still supports vertical dragging", async ({ page, context }) => {
    await openClick(
      page,
      resolve(import.meta.dirname, "..", "packages", "format", "fixtures", "mnx", "rehearsal-marks.mnx"),
    );
    const panel = page.getByRole("region", { name: "Click player" });
    await panel.getByRole("button", { name: "Start", exact: true }).focus();
    await page.keyboard.press("Enter");
    const handle = panel.getByRole("status", { name: "Playback position" });
    await expect(handle).toBeVisible();
    const before = await panel.boundingBox();
    const area = await handle.boundingBox();
    if (!before || !area) throw new Error("Transport drag surface is not visible");
    const x = area.x + area.width / 2;
    const y = area.y + area.height / 2;
    const touch = await context.newCDPSession(page);
    try {
      await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      for (let step = 1; step <= 6; step++) {
        await touch.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x, y: y - step * 20 }],
        });
        await page.waitForTimeout(20);
      }
      await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await expect.poll(async () => (await panel.boundingBox())?.y ?? Infinity).toBeLessThan(before.y - 100);
      await panel.getByRole("button", { name: "Stop", exact: true }).click();
    } finally {
      await touch.detach();
    }
  });
});

test.describe("score browsing", () => {
  test.use({ hasTouch: true });

  test("pans without selecting, then selects a score bar by mouse and touch while preserving its repeat visit", async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const fixture = await readFile(
      resolve(import.meta.dirname, "..", "packages", "format", "fixtures", "mnx", "rehearsal-marks.mnx"),
      "utf8",
    );
    const score = JSON.parse(fixture) as {
      global: { measures: { repeatStart?: object; repeatEnd?: object }[] };
    };
    score.global.measures[0]!.repeatStart = {};
    score.global.measures[1]!.repeatEnd = {};
    await openClick(page, {
      name: "repeated.mnx",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(score)),
    });
    const panel = page.getByRole("region", { name: "Click player" });
    const first = panel.getByRole("option", { name: "Bar 3, rehearsal B" });
    const target = panel.getByRole("option", { name: "Bar 1, visit 2 of 2, rehearsal A" });
    await expect
      .poll(async () =>
        Number.parseInt((await page.getByRole("button", { name: "Reset zoom" }).textContent()) ?? "0", 10),
      )
      .toBeGreaterThan(100);
    const dial = panel.getByRole("listbox", { name: "Start bar" });
    async function selectTarget() {
      await dial.press("Home");
      await dial.press("ArrowRight");
      await dial.press("ArrowRight");
      await expect(target).toHaveAttribute("aria-selected", "true");
    }
    await selectTarget();
    await page.getByRole("button", { name: "View mode" }).click();
    await page.getByRole("option", { name: "Page", exact: true }).click();
    await expect.poll(async () => (await playheadBounds(page)) !== null).toBe(true);
    const targetHead = (await playheadBounds(page))!;
    const targetPoint = { x: targetHead.x + targetHead.width + 3, y: targetHead.y + targetHead.height / 2 };
    const canvas = page.getByRole("application", { name: "Interactive music score" });
    const touch = await context.newCDPSession(page);

    async function drag(useTouch: boolean, point: { x: number; y: number }) {
      if (useTouch) {
        await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
        for (let step = 1; step <= 6; step++) {
          await touch.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [{ x: point.x + step * 20, y: point.y }],
          });
        }
        await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      } else {
        await page.mouse.move(point.x, point.y);
        await page.mouse.down();
        await page.mouse.move(point.x + 120, point.y, { steps: 8 });
        await page.mouse.up();
      }
    }

    try {
      for (const useTouch of [false, true]) {
        await first.click();
        await expect(first).toHaveAttribute("aria-selected", "true");
        await expect
          .poll(async () => Math.abs(((await playheadBounds(page))?.x ?? targetHead.x) - targetHead.x))
          .toBeGreaterThan(2);
        if (useTouch) {
          await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [targetPoint] });
          await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        } else {
          await page.mouse.click(targetPoint.x, targetPoint.y);
        }
        await expect(target).toHaveAttribute("aria-selected", "true");
      }

      await page.getByRole("button", { name: "View mode" }).click();
      await page.getByRole("option", { name: "Horizon", exact: true }).click();
      const box = await canvas.boundingBox();
      if (!box) throw new Error("Score canvas is not visible");
      const dragPoint = { x: box.x + box.width / 2, y: box.y + 120 };
      for (const useTouch of [false, true]) {
        await first.click();
        await expect(first).toHaveAttribute("aria-selected", "true");
        const before = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
        await drag(useTouch, dragPoint);
        await expect
          .poll(async () => (await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL())) !== before)
          .toBe(true);
        await expect(first).toHaveAttribute("aria-selected", "true");
        await selectTarget();
      }

      await panel.getByRole("radio", { name: "2 bars" }).click();
      const tempo = page.getByRole("slider", { name: "Session tempo %" });
      await tempo.press("Home");
      for (let step = 0; step < 10; step++) await tempo.press("ArrowRight");
      await panel.getByRole("button", { name: "Start", exact: true }).focus();
      await page.keyboard.press("Enter");
      await expect(panel.getByRole("status", { name: "Playback position" })).toHaveText("-8");
      const before = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
      await drag(false, dragPoint);
      await drag(true, dragPoint);
      expect(await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL())).toBe(before);
      await page.mouse.click(targetPoint.x, targetPoint.y);
      await panel.getByRole("button", { name: "Stop", exact: true }).click();
      await expect(target).toHaveAttribute("aria-selected", "true");
    } finally {
      await touch.detach();
    }
  });
});
