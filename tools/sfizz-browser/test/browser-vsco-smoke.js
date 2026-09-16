import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const playwrightModule = process.env.PLAYWRIGHT_MODULE_PATH ?? "@playwright/test";
const { chromium } = require(playwrightModule);

const url = process.env.SFIZZ_BROWSER_URL ?? "http://127.0.0.1:4399/";
const vscoDirectory = process.env.VSCO_DIR ?? "F:\\Sounds\\VSCO-2-CE-1.1.0";
const channel = process.env.PW_CHANNEL ?? "msedge";

const browser = await launchBrowser();
const page = await browser.newPage();
const consoleErrors = [];
const networkWrites = [];

page.on("console", (message) => {
  if (message.type() === "error") {
    consoleErrors.push(message.text());
  }
});
page.on("pageerror", (error) => consoleErrors.push(error.message));
page.on("request", (request) => {
  if (request.method() !== "GET" || !request.url().startsWith(url)) {
    networkWrites.push(`${request.method()} ${request.url()}`);
  }
});

try {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.setInputFiles("#folderInput", vscoDirectory);
  await page.waitForFunction(() => window.sfizzBrowserState?.lastIndex?.sfzCount > 0);

  const glockenspiel = await runPatchProof({
    expectedSamples: 6,
    note: "72",
    patchSuffix: "Glockenspiel.sfz",
  });
  const glockenspielCoverage = await provePatchCoverage({
    label: "Glockenspiel",
    notes: midiRange(67, 96),
  });
  const xylophone = await runPatchProof({
    expectedSamples: 8,
    note: "72",
    patchSuffix: "Xylophone.sfz",
  });
  if (!xylophone.load.sampleFormats.some((entry) => entry.format.includes("24-bit"))) {
    throw new Error("Xylophone proof did not exercise 24-bit WAV decoding.");
  }
  const xylophoneCoverage = await provePatchCoverage({
    label: "Xylophone",
    notes: midiRange(55, 96),
  });
  const marimba = await runPatchProof({
    expectedSamples: 10,
    note: "79",
    patchSuffix: "Marimba.sfz",
  });
  if (!marimba.load.sampleFormats.some((entry) => entry.format.includes("24-bit"))) {
    throw new Error("Marimba proof did not exercise a second 24-bit WAV patch.");
  }
  const marimbaCoverage = await provePatchCoverage({
    label: "Marimba",
    notes: midiRange(41, 96),
  });
  const violinSustain = await runPatchProof({
    articulationText: "C2 Sustain",
    expectedSamples: 131,
    note: "60",
    patchSuffix: "ViolinEns-KS.sfz",
  });
  const sameSynthReload = await proveSameSynthReload();
  const violinSpiccato = await playCurrentPatch({
    articulationText: "D2 Spiccato",
    note: "60",
  });
  const violinCoverage = {
    pizzicato: await provePatchCoverage({
      articulationText: "D#2 Pizzicato",
      label: "Violin pizzicato",
      notes: violinSourceNotes(),
      repetitions: 2,
      velocities: [40, 100],
    }),
    spiccato: await provePatchCoverage({
      articulationText: "D2 Spiccato",
      label: "Violin spiccato",
      notes: violinSourceNotes(),
      repetitions: 2,
      velocities: [40, 100],
    }),
    sustain: await provePatchCoverage({
      articulationText: "C2 Sustain",
      label: "Violin sustain",
      notes: violinSourceNotes(),
      velocities: [40, 100],
    }),
    tremolo: await provePatchCoverage({
      articulationText: "C#2 Tremolo",
      label: "Violin tremolo",
      notes: violinSourceNotes(),
      velocities: [40, 100],
    }),
  };
  const expression = await proveLiveExpressionCc();
  const panic = await provePanicClearsDelayedPhrase();

  const state = await page.evaluate(() => window.sfizzBrowserState);
  if (consoleErrors.length > 0 || state.errors.length > 0 || networkWrites.length > 0) {
    throw new Error(
      `Browser errors:\n${[
        ...consoleErrors,
        ...state.errors,
        ...networkWrites.map((entry) => `Network write: ${entry}`),
      ].join("\n")}`,
    );
  }
  assertDifferentEnvelopes(violinSustain.metrics, violinSpiccato.metrics);
  console.log(
    JSON.stringify(
      {
        expression,
        glockenspiel,
        glockenspielCoverage,
        marimba,
        marimbaCoverage,
        panic,
        sameSynthReload,
        violinCoverage,
        violinSpiccato,
        violinSustain,
        xylophone,
        xylophoneCoverage,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}

async function proveSameSynthReload() {
  const reload = await page.evaluate(() => window.sfizzBrowserTest.reloadCurrentPatch(3));
  const playback = await playCurrentPatch({ articulationText: "C2 Sustain", note: "60" });
  if (reload.regions !== playback.load.expectedRegions || reload.activeVoices !== 0) {
    throw new Error(`Same-synth reload returned unexpected state: ${JSON.stringify({ playback, reload })}`);
  }
  return { playbackPeak: playback.metrics.peak, reloads: 3, regions: reload.regions };
}

async function launchBrowser() {
  const channels = [channel, "chrome", "msedge"].filter((value, index, values) => values.indexOf(value) === index);
  let lastError = null;
  for (const candidate of channels) {
    try {
      return await chromium.launch({ channel: candidate, headless: true });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function runPatchProof({ articulationText, expectedSamples, note, patchSuffix }) {
  await selectPatch(patchSuffix);
  await page.click("#loadPatchButton");
  await page.waitForFunction(
    ({ expected, suffix }) =>
      window.sfizzBrowserState?.lastLoad?.patch?.endsWith(suffix) &&
      window.sfizzBrowserState.lastLoad.sampleCount === expected &&
      window.sfizzBrowserState.lastLoad.regions === window.sfizzBrowserState.lastLoad.expectedRegions,
    { expected: expectedSamples, suffix: patchSuffix },
    { timeout: 120_000 },
  );
  return await playCurrentPatch({ articulationText, note });
}

async function playCurrentPatch({ articulationText, note }) {
  await page.fill("#noteInput", note);
  await page.fill("#durationInput", "1.2");
  await page.fill("#velocityInput", "100");
  await setInputValue("#cc11Input", "112");
  if (articulationText) {
    await selectArticulation(articulationText);
  }

  const previousRequest = await page.evaluate(() => window.sfizzBrowserState.currentRequestId ?? 0);
  await page.click("#playNoteButton");
  const firstMetrics = await awaitFreshMetrics(previousRequest, 0.0001);
  const metrics = await awaitRequestFrames(firstMetrics.requestId, 65000);
  return await page.evaluate(
    ({ articulation, metrics }) => ({
      articulation: articulation ?? "Patch default",
      load: window.sfizzBrowserState.lastLoad,
      metrics,
      requestId: metrics.requestId,
    }),
    { articulation: articulationText, metrics },
  );
}

async function provePatchCoverage({ articulationText, label, notes, repetitions = 1, velocities = [100] }) {
  if (articulationText) {
    await selectArticulation(articulationText);
  }
  await page.fill("#durationInput", "0.05");
  const peaks = [];
  for (const velocity of velocities) {
    await page.fill("#velocityInput", String(velocity));
    for (const note of notes) {
      for (let repetition = 0; repetition < repetitions; repetition += 1) {
        await page.fill("#noteInput", String(note));
        const previousRequest = await page.evaluate(() => window.sfizzBrowserState.currentRequestId ?? 0);
        await page.click("#playNoteButton");
        const requestHandle = await page.waitForFunction(
          (previous) => {
            const request = window.sfizzBrowserState.currentRequestId ?? 0;
            return request > previous ? request : null;
          },
          previousRequest,
          { timeout: 10000 },
        );
        const requestId = await requestHandle.jsonValue();
        const metrics = await awaitRequestFrames(requestId, 8192);
        if (metrics.peak <= 0.0001) {
          throw new Error(`${label} produced silence at MIDI ${note}, velocity ${velocity}, pass ${repetition + 1}.`);
        }
        peaks.push(metrics.peak);
      }
    }
  }
  return {
    cases: peaks.length,
    minimumPeak: Math.min(...peaks),
  };
}

async function proveLiveExpressionCc() {
  await selectArticulation("C2 Sustain");
  await page.fill("#noteInput", "60");
  await page.fill("#durationInput", "3.0");
  await page.fill("#velocityInput", "110");
  await setInputValue("#cc11Input", "127");
  const previousRequest = await page.evaluate(() => window.sfizzBrowserState.currentRequestId ?? 0);
  await page.click("#playNoteButton");
  const before = await awaitFreshMetrics(previousRequest, 0.0001);
  await setInputValue("#cc11Input", "18");
  const after = await page.waitForFunction(
    ({ beforeRms, requestId }) => {
      const history = window.sfizzBrowserState.metricsHistory ?? [];
      return history.find((entry) => entry.requestId === requestId && entry.frames > beforeRms.frames + 4096);
    },
    { beforeRms: before, requestId: before.requestId },
    { timeout: 15000 },
  );
  const afterMetrics = await after.jsonValue();
  if (!(afterMetrics.windowRms < before.windowRms * 0.85 || afterMetrics.windowPeak < before.windowPeak * 0.85)) {
    throw new Error(
      `CC11 did not lower the live sustain signal enough: before ${before.windowRms}, after ${afterMetrics.windowRms}`,
    );
  }
  return { after: afterMetrics, before };
}

async function provePanicClearsDelayedPhrase() {
  await page.fill("#durationInput", "1.0");
  const previousRequest = await page.evaluate(() => window.sfizzBrowserState.currentRequestId ?? 0);
  await page.click("#playPhraseButton");
  await awaitFreshMetrics(previousRequest, 0.0001);
  await page.click("#panicButton");
  await page.waitForFunction(() => window.sfizzBrowserState.lastPanic?.pendingEvents === 0, null, { timeout: 10000 });
  await page.waitForTimeout(700);
  const state = await page.evaluate(() => ({
    lastPanic: window.sfizzBrowserState.lastPanic,
    livePeak: window.sfizzBrowserState.livePeak,
    recent: window.sfizzBrowserState.metricsHistory.at(-1),
  }));
  if (state.livePeak > 0.001 || state.recent?.pendingEvents > 0) {
    throw new Error(`Panic did not reach silence: ${JSON.stringify(state)}`);
  }
  return state;
}

async function awaitFreshMetrics(previousRequest, minimumRms) {
  const handle = await page.waitForFunction(
    ({ minimum, previous }) => {
      const metrics = window.sfizzBrowserState.lastRender;
      return metrics?.requestId > previous && metrics.rms > minimum ? metrics : null;
    },
    { minimum: minimumRms, previous: previousRequest },
    { timeout: 60000 },
  );
  return await handle.jsonValue();
}

async function awaitRequestFrames(requestId, minimumFrames) {
  const handle = await page.waitForFunction(
    ({ frames, request }) => {
      const metrics = window.sfizzBrowserState.lastRender;
      return metrics?.requestId === request && metrics.frames >= frames ? metrics : null;
    },
    { frames: minimumFrames, request: requestId },
    { timeout: 60000 },
  );
  return await handle.jsonValue();
}

function assertDifferentEnvelopes(sustain, spiccato) {
  const activeDelta = Math.abs(sustain.activeMs - spiccato.activeMs);
  const rmsRatio = Math.max(sustain.rms, spiccato.rms) / Math.max(0.000001, Math.min(sustain.rms, spiccato.rms));
  if (activeDelta < 20 && rmsRatio < 1.08) {
    throw new Error(`Sustain/spiccato metrics were too similar: ${JSON.stringify({ spiccato, sustain })}`);
  }
}

async function selectPatch(suffix) {
  const value = await page.evaluate((patchSuffix) => {
    const select = document.querySelector("#patchSelect");
    return [...select.options].find((option) => option.value.endsWith(patchSuffix))?.value;
  }, suffix);
  if (!value) {
    throw new Error(`Patch not found in selected VSCO folder: ${suffix}`);
  }
  await page.selectOption("#patchSelect", value);
}

async function selectArticulation(text) {
  const value = await page.evaluate((labelText) => {
    const select = document.querySelector("#articulationSelect");
    return [...select.options].find((option) => option.textContent.includes(labelText))?.value;
  }, text);
  if (!value) {
    throw new Error(`Articulation not found: ${text}`);
  }
  await page.selectOption("#articulationSelect", value);
}

async function setInputValue(selector, value) {
  await page.evaluate(
    ({ inputSelector, nextValue }) => {
      const input = document.querySelector(inputSelector);
      input.value = nextValue;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    },
    { inputSelector: selector, nextValue: value },
  );
}

function midiRange(start, end) {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function violinSourceNotes() {
  return [55, 56, 58, 61, 64, 68, 71, 74, 78, 81, 85];
}
