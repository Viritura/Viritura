import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { MAX_CLICK_PROGRAM_EVENTS } from "../../packages/audio/src/clickEngine/clickProgram";
import { longQualificationClicks, qualificationClicks, type FixtureClick } from "./timingFixture";

/**
 * Recording-click qualification against the real click worklet.
 *
 * The offline gate renders deterministic PCM at 44.1, 48, and 96 kHz and runs on
 * every e2e pass. The 60-minute offline program and the live stall gate are long
 * and opt in with `VIRITURA_CLICK_QUALIFICATION=1`.
 */

const LONG_RUNS = process.env.VIRITURA_CLICK_QUALIFICATION === "1";
const REPO_ROOT = resolve(import.meta.dirname, "..", "..").replaceAll("\\", "/");
const MODULES = {
  reference: `/@fs${REPO_ROOT}/e2e/click-qualification/pcmReference.ts`,
  sound: `/@fs${REPO_ROOT}/packages/audio/src/clickSound/index.ts`,
  program: `/@fs${REPO_ROOT}/packages/audio/src/clickEngine/clickProgram.ts`,
};
const LEVEL_CODES = { accent: 0, beat: 1, subdivision: 2 } as const;
/** Float rounding allowance; a shifted or missing click leaves a residual near the voice peak (≥ 0.25). */
const RESIDUAL_LIMIT = 1e-5;

test.use({ launchOptions: { args: ["--js-flags=--expose-gc", "--autoplay-policy=no-user-gesture-required"] } });

interface OfflineRun {
  readonly rate: number;
  readonly sound: "oscillator" | "tick" | "woodblock";
  readonly clicks: readonly FixtureClick[];
  readonly expectedFrames: readonly number[];
  readonly levels: readonly number[];
  readonly firstAnchor: number;
  /** Output frames at which to pause and later resume; omit for a single run. */
  readonly pause?: { readonly stopAt: number; readonly resumeAt: number; readonly resumeAnchor: number };
  readonly renderFrames: number;
  readonly channels: number;
}

interface OfflineResult {
  readonly clicks: number;
  readonly peak: number;
  readonly peakFrame: number;
  readonly missed: number;
  readonly ended: boolean;
  readonly errors: readonly string[];
  readonly stopProgramFrame: number | null;
  readonly programBytes: number;
}

function offlineRun(
  rate: number,
  sound: OfflineRun["sound"],
  clicks: readonly FixtureClick[],
  options: { pauseSeconds?: number; channels?: number; tailSeconds?: number } = {},
): OfflineRun {
  const firstAnchor = 333;
  const lastTime = clicks.at(-1)!.time;
  const pause =
    options.pauseSeconds === undefined
      ? undefined
      : {
          stopAt: Math.round(options.pauseSeconds * rate),
          resumeAt: Math.round((options.pauseSeconds + 1.5) * rate),
          resumeAnchor: Math.round((options.pauseSeconds + 1.5) * rate) + 777,
        };
  const pauseFrames = pause ? pause.resumeAnchor - pause.stopAt : 0;
  return {
    rate,
    sound,
    clicks,
    expectedFrames: clicks.map(({ time }) => Math.round(time * rate)),
    levels: clicks.map(({ level }) => LEVEL_CODES[level]),
    firstAnchor,
    pause,
    renderFrames: firstAnchor + pauseFrames + Math.ceil((lastTime + (options.tailSeconds ?? 1)) * rate),
    channels: options.channels ?? 2,
  };
}

/** Render a click program offline through the staged worklet and subtract the independent reference. */
async function renderOffline(page: Page, run: OfflineRun): Promise<OfflineResult> {
  return page.evaluate(
    async ({ run, modules }) => {
      const reference = (await import(modules.reference)) as typeof import("./pcmReference");
      const soundModule = (await import(modules.sound)) as typeof import("../../packages/audio/src/clickSound/index");
      const programModule = (await import(
        modules.program
      )) as typeof import("../../packages/audio/src/clickEngine/clickProgram");
      const context = new OfflineAudioContext(run.channels, run.renderFrames, run.rate);
      await context.audioWorklet.addModule("/sounds/viritura-click-processor.js");
      const voices = soundModule.CLICK_SOUNDS.map((sound) => soundModule.synthesizeClickVoices(run.rate, sound));
      const node = new AudioWorkletNode(context, "viritura-click", {
        numberOfInputs: 0,
        outputChannelCount: [2],
        processorOptions: { voices },
      });
      node.connect(context.destination);

      interface Reply {
        type: string;
        requestId?: number;
        code?: string;
        programFrame?: number;
        count?: number;
      }
      const replies: Reply[] = [];
      const waiters = new Map<number, (reply: Reply) => void>();
      node.port.onmessage = (event: MessageEvent<Reply>) => {
        replies.push(event.data);
        if (event.data.requestId !== undefined) waiters.get(event.data.requestId)?.(event.data);
      };
      let nextId = 0;
      const request = (message: Record<string, unknown>) =>
        new Promise<Reply>((resolveReply) => {
          const requestId = ++nextId;
          waiters.set(requestId, resolveReply);
          node.port.postMessage({ ...message, requestId });
        });

      const program = programModule.compileClickProgram(run.clicks, run.rate);
      const programBytes = program.frames.byteLength + program.levels.byteLength;
      const endFrame = Math.round((run.clicks.at(-1)!.time + 0.1) * run.rate);
      await request({ type: "sound", sound: run.sound });
      await request({ type: "load", frames: program.frames, levels: program.levels, endFrame });
      await request({ type: "start", atFrame: run.firstAnchor, offsetFrame: 0 });

      let stopProgramFrame: number | null = null;
      const pauses: Promise<void>[] = [];
      if (run.pause) {
        const { stopAt, resumeAt, resumeAnchor } = run.pause;
        pauses.push(
          context.suspend(stopAt / run.rate).then(async () => {
            stopProgramFrame = (await request({ type: "stop" })).programFrame ?? null;
            await context.resume();
          }),
          context.suspend(resumeAt / run.rate).then(async () => {
            await request({ type: "start", atFrame: resumeAnchor, offsetFrame: stopProgramFrame });
            await context.resume();
          }),
        );
      }
      const buffer = await context.startRendering();
      await Promise.all(pauses);
      const stoppedAt: number = stopProgramFrame ?? Infinity;
      const segments = run.pause
        ? [
            { anchorFrame: run.firstAnchor, offsetFrame: 0, stopProgramFrame: stoppedAt },
            { anchorFrame: run.pause.resumeAnchor, offsetFrame: stoppedAt, stopProgramFrame: Infinity },
          ]
        : [{ anchorFrame: run.firstAnchor, offsetFrame: 0, stopProgramFrame: Infinity }];
      const soundVoices = voices[soundModule.CLICK_SOUNDS.indexOf(run.sound)]!;
      const residuals = Array.from({ length: buffer.numberOfChannels }, (_, channel) =>
        reference.subtractPlannedClicks(
          buffer.getChannelData(channel),
          0,
          run.expectedFrames,
          run.levels,
          segments,
          soundVoices,
          1,
        ),
      );
      const worst = residuals.reduce((a, b) => (b.peak > a.peak ? b : a));
      return {
        clicks: residuals[0]!.clicks,
        peak: worst.peak,
        peakFrame: worst.peakFrame,
        missed: replies.filter(({ type }) => type === "missed").length,
        ended: replies.some(({ type }) => type === "ended"),
        errors: replies.filter(({ type }) => type === "error").map(({ code }) => code ?? "unknown"),
        stopProgramFrame,
        programBytes,
      };
    },
    { run, modules: MODULES },
  );
}

async function openBlankEditor(page: Page): Promise<void> {
  await page.addInitScript(() => window.localStorage.setItem("viritura.startCenter.suppress", "1"));
  await page.goto("/");
}

/** Qualification-only worklet that records the click output with render frames. */
const TAP_URL = `/@fs${REPO_ROOT}/e2e/click-qualification/tapProcessor.js`;

interface TapDump {
  readonly startFrame: number;
  readonly discontinuities: number;
  readonly overflow: boolean;
}

/** Wraps the click worklet node so the test sees its program, anchors, and rendered output. */
function instrumentClickWorklet(tapUrl: string) {
  const NativeNode = window.AudioWorkletNode;
  const addModule = AudioWorklet.prototype.addModule;
  AudioWorklet.prototype.addModule = async function (url, options) {
    await addModule.call(this, url, options);
    if (String(url).includes("viritura-click-processor")) await addModule.call(this, tapUrl);
  };
  const log: Array<Record<string, unknown>> = [];
  const capture: { log: typeof log; tap: AudioWorkletNode | null; sampleRate: number } = {
    log,
    tap: null,
    sampleRate: 0,
  };
  Reflect.set(window, "__clickQualification", capture);
  window.AudioWorkletNode = class extends NativeNode {
    constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
      super(context, name, options);
      if (name !== "viritura-click") return;
      const post = this.port.postMessage.bind(this.port) as (message: unknown, transfer: Transferable[]) => void;
      this.port.postMessage = ((message: Record<string, unknown>, transfer?: Transferable[]) => {
        log.push(
          message.type === "load"
            ? {
                ...message,
                frames: Array.from(message.frames as Float64Array),
                levels: Array.from(message.levels as Uint8Array),
              }
            : { ...message },
        );
        post(message, transfer ?? []);
      }) as MessagePort["postMessage"];
      this.port.addEventListener("message", (event: MessageEvent<Record<string, unknown>>) =>
        log.push({ reply: true, ...event.data }),
      );
      const tap = new NativeNode(context, "click-qualification-tap", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        processorOptions: { capacity: Math.ceil(context.sampleRate * 90) },
      });
      this.connect(tap)
        .connect(new GainNode(context, { gain: 0 }))
        .connect(context.destination);
      capture.tap = tap;
      capture.sampleRate = context.sampleRate;
    }
  } as typeof AudioWorkletNode;
}

test.describe("click live stall qualification", () => {
  test("main-thread stalls, GC, scrolling, and resizing never move a click", async ({ page }) => {
    test.skip(!LONG_RUNS, "Set VIRITURA_CLICK_QUALIFICATION=1 to run long qualification");
    test.setTimeout(5 * 60_000);
    await page.addInitScript(instrumentClickWorklet, TAP_URL);
    await page.addInitScript(() => {
      window.localStorage.setItem("viritura.startCenter.suppress", "1");
      Reflect.deleteProperty(window, "showOpenFilePicker");
    });
    await page.goto("/");
    await expect(page.locator('canvas[tabindex="0"]')).toBeVisible({ timeout: 45_000 });
    const chooser = page.waitForEvent("filechooser");
    await page.keyboard.press("ControlOrMeta+Shift+O");
    await (
      await chooser
    ).setFiles(resolve(REPO_ROOT, "packages", "format", "fixtures", "mnx", "beethoven-symphony-5-movement-1.mnx"));
    await expect(page.getByText("Laying out score")).toHaveCount(0, { timeout: 45_000 });
    await page.getByRole("button", { name: "Click", exact: true }).click();
    const player = page.getByRole("region", { name: "Click player" });
    await expect(player).toHaveAttribute("aria-busy", "false");
    await player.getByRole("button", { name: "Start", exact: true }).click();
    await expect(player.getByRole("button", { name: "Stop", exact: true })).toBeVisible();

    const canvas = page.getByRole("application", { name: "Interactive music score" });
    for (let round = 0; round < 3; round++) {
      await page.evaluate(() => {
        const end = performance.now() + 2000;
        while (performance.now() < end) {
          // Deliberate 2-second main-thread stall.
        }
      });
      await page.evaluate(() => {
        let keep: Float64Array[] = [];
        for (let index = 0; index < 400; index++) {
          keep.push(new Float64Array(1 << 18).fill(index));
          if (keep.length > 16) keep = [];
        }
        (Reflect.get(window, "gc") as (() => void) | undefined)?.();
      });
      await canvas.hover();
      for (let step = 0; step < 10; step++) await page.mouse.wheel(0, step % 2 ? -400 : 400);
      await page.setViewportSize({ width: 900 + round * 150, height: 700 });
      await page.waitForTimeout(500);
      await page.setViewportSize({ width: 1400, height: 900 });
      await page.waitForTimeout(1000);
    }
    await player.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(player.getByRole("button", { name: "Start", exact: true })).toBeVisible();

    const result = await page.evaluate(
      async ({ modules }) => {
        const reference = (await import(modules.reference)) as typeof import("./pcmReference");
        const soundModule = (await import(modules.sound)) as typeof import("../../packages/audio/src/clickSound/index");
        const capture = Reflect.get(window, "__clickQualification") as {
          log: Array<Record<string, unknown>>;
          tap: AudioWorkletNode;
          sampleRate: number;
        };
        const dump = await new Promise<TapDump & { data: Float32Array }>((resolveDump) => {
          capture.tap.port.onmessage = (event: MessageEvent<TapDump & { data: Float32Array }>) =>
            resolveDump(event.data);
          capture.tap.port.postMessage("dump");
        });
        const sent = capture.log.filter((entry) => !entry.reply);
        const replies = capture.log.filter((entry) => entry.reply);
        const load = sent.filter(({ type }) => type === "load").at(-1)!;
        const starts = sent.filter(({ type }) => type === "start");
        const sound = (sent.filter(({ type }) => type === "sound").at(-1)?.sound ??
          "oscillator") as (typeof soundModule.CLICK_SOUNDS)[number];
        const gain = Number(sent.filter(({ type }) => type === "gain").at(-1)?.gain ?? 1);
        const stopped = replies.find(({ type }) => type === "stopped")!;
        const start = starts.at(-1)!;
        const voices = soundModule.synthesizeClickVoices(capture.sampleRate, sound);
        const residual = reference.subtractPlannedClicks(
          dump.data,
          dump.startFrame,
          load.frames as number[],
          load.levels as number[],
          [
            {
              anchorFrame: Number(start.atFrame),
              offsetFrame: Number(start.offsetFrame),
              stopProgramFrame: Number(stopped.programFrame),
            },
          ],
          voices,
          gain,
        );
        return {
          ...residual,
          starts: starts.length,
          discontinuities: dump.discontinuities,
          overflow: dump.overflow,
          missed: replies.filter(({ type }) => type === "missed").length,
          errors: replies.filter(({ type }) => type === "error").length,
          seconds: dump.data.length / capture.sampleRate,
          sampleRate: capture.sampleRate,
        };
      },
      { modules: MODULES },
    );
    test.info().annotations.push({ type: "live-stall", description: JSON.stringify(result) });
    expect(result.starts).toBe(1);
    expect(result.errors).toBe(0);
    expect(result.missed).toBe(0);
    expect(result.overflow).toBe(false);
    expect(result.discontinuities).toBe(0);
    expect(result.clicks).toBeGreaterThan(40);
    expect(result.peak, `residual at frame ${result.peakFrame}`).toBeLessThan(RESIDUAL_LIMIT);
  });
});

test.describe("click recording qualification", () => {
  for (const [rate, sound] of [
    [44_100, "oscillator"],
    [48_000, "tick"],
    [96_000, "woodblock"],
  ] as const) {
    test(`renders every click once, sample-exact, at ${rate / 1000} kHz across pause and resume`, async ({ page }) => {
      await openBlankEditor(page);
      const clicks = qualificationClicks();
      const result = await renderOffline(page, offlineRun(rate, sound, clicks, { pauseSeconds: 9.2 }));
      expect(result.errors).toEqual([]);
      expect(result.missed).toBe(0);
      expect(result.ended).toBe(true);
      expect(result.stopProgramFrame).not.toBeNull();
      expect(result.clicks).toBe(clicks.length);
      expect(result.peak, `residual at frame ${result.peakFrame}`).toBeLessThan(RESIDUAL_LIMIT);
    });
  }

  test("a shifted click fails the residual check", async ({ page }) => {
    await openBlankEditor(page);
    const run = offlineRun(48_000, "oscillator", qualificationClicks());
    const expectedFrames = [...run.expectedFrames];
    expectedFrames[7]! += 1;
    const result = await renderOffline(page, { ...run, expectedFrames });
    expect(result.peak).toBeGreaterThan(0.01);
  });

  test("preloads and renders the 60-minute, 32-clicks-per-second program", async ({ page }) => {
    test.skip(!LONG_RUNS, "Set VIRITURA_CLICK_QUALIFICATION=1 to run long qualification");
    test.setTimeout(20 * 60_000);
    await openBlankEditor(page);
    const clicks = longQualificationClicks(MAX_CLICK_PROGRAM_EVENTS);
    expect(clicks.at(-1)!.time).toBeLessThan(3600);
    // 8 kHz mono keeps the full rendered hour near 115 MB; the worklet itself stores only the program.
    const result = await renderOffline(page, offlineRun(8_000, "oscillator", clicks, { channels: 1 }));
    expect(result.errors).toEqual([]);
    expect(result.missed).toBe(0);
    expect(result.ended).toBe(true);
    expect(result.clicks).toBe(MAX_CLICK_PROGRAM_EVENTS);
    expect(result.programBytes).toBe(MAX_CLICK_PROGRAM_EVENTS * 9);
    expect(result.peak, `residual at frame ${result.peakFrame}`).toBeLessThan(RESIDUAL_LIMIT);
  });
});
