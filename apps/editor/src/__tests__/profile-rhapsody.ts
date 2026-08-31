// profile-rhapsody.ts — standalone Node bench + V8 CPU profile capture.
//
// Loads the wasm-pack `--profiling --no-opt` build, replays the same
// Rhapsody patch workload as ./pagedPatchFrame.perf.test.ts, and writes a
// V8 .cpuprofile we can analyze with scripts/profile/.
//
// V8's inspector API (used here) DOES penetrate WASM frames — Rust
// symbols come out demangled. For per-line / inlined hot-loop work,
// Chrome DevTools is still better (docs/setup/wasm-flame-chart.md).
// This script's value is being fully scriptable + machine-readable.
//
// Workflow (from repo root):
//   pnpm wasm:profile
//   pnpm exec tsx apps/editor/src/__tests__/profile-rhapsody.ts
//   node scripts/profile/summarize-rhapsody.cjs tmp/profiles/rhapsody.cpuprofile
//   node scripts/profile/analyze-cpuprofile.cjs tmp/profiles/rhapsody.cpuprofile 50
//   pnpm wasm   # restore slim shipping build
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Session } from "node:inspector/promises";

import { DeltaSerializer, parseMnx } from "@viritura/format";
import { decodeFrame, PatchReconstructor } from "@viritura/renderer";

import { addNoteWithAutoTie } from "../commands/noteCommands";
import { produce } from "../score/scoreClone";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "../../../..");
const WASM_DIR = resolve(REPO_ROOT, "engine/viritura-wasm/pkg-browser");
const WASM_BYTES_PATH = resolve(WASM_DIR, "viritura_wasm_bg.wasm");
const WASM_GLUE_PATH = resolve(WASM_DIR, "viritura_wasm.js");
const SCORE_DIR = resolve(REPO_ROOT, "packages/format/fixtures/mnx");
const FIXTURE = resolve(SCORE_DIR, "Rhapsody in Blue.mnx");
const PROFILES_DIR = resolve(REPO_ROOT, "tmp/profiles");
const OUT_PROFILE = resolve(PROFILES_DIR, "rhapsody.cpuprofile");

const SP = 8;
const PAGE_WIDTH = 816;

if (!existsSync(PROFILES_DIR)) mkdirSync(PROFILES_DIR, { recursive: true });

interface Engine {
  full_layout(json: string, sp: number, pw: number, ps: string | null, si: number | null): string;
  apply_patch_and_layout_patch_frame_binary(
    patch_json: string,
    sp: number,
    pw: number,
    ps: string | null,
    si: number | null,
  ): Float32Array;
  take_timings_json(): string | undefined;
  free(): void;
}
interface Glue {
  initSync(opts: { module: WebAssembly.Module }): void;
  LayoutEngine: new () => Engine;
  set_wasm_timing(enabled: boolean): void;
}

const bytes = readFileSync(WASM_BYTES_PATH);
const mod = new WebAssembly.Module(bytes);
const glue = (await import(pathToFileURL(WASM_GLUE_PATH).href)) as unknown as Glue;
glue.initSync({ module: mod });

const raw = readFileSync(FIXTURE, "utf-8");
let score = parseMnx(JSON.parse(raw));

function applyEdit(s: typeof score, i: number, measureCount: number, partIndex: number) {
  const steps = ["C", "D", "E", "F", "G", "A", "B"] as const;
  return produce(s, (draft) => {
    addNoteWithAutoTie(draft, {
      pitch: { step: steps[i % steps.length]!, octave: 4 },
      duration: { base: "quarter" },
      measureIndex: i % Math.max(1, measureCount),
      partIndex,
      voice: 0,
      beatPosition: i % 4,
    });
  });
}

function findPagedPatchIndex(): number | null {
  for (let scoreIndex = 0; scoreIndex < 8; scoreIndex++) {
    const ser = new DeltaSerializer();
    const seed = ser.serialize(score);
    const engine = new glue.LayoutEngine();
    try {
      engine.full_layout(seed.json, SP, PAGE_WIDTH, null, scoreIndex);
    } catch {
      engine.free();
      continue;
    }
    try {
      const edited = applyEdit(score, 0, 16, 0);
      const patchResult = ser.serialize(edited);
      if (patchResult.structuralChange) {
        engine.free();
        return null;
      }
      const patchJson = ser.buildPatch(patchResult.changedGlobalMeasures, patchResult.changedPartMeasures);
      const tagged = engine.apply_patch_and_layout_patch_frame_binary(patchJson, SP, PAGE_WIDTH, null, scoreIndex);
      engine.free();
      if (tagged[0] === 1.0) return scoreIndex;
    } catch {
      engine.free();
    }
  }
  return null;
}

const scoreIndex = findPagedPatchIndex();
if (scoreIndex === null) throw new Error("no paged patch-emitting score view");
console.log(`scoreIndex=${scoreIndex}`);

const ser = new DeltaSerializer();
const seed = ser.serialize(score);
const engine = new glue.LayoutEngine();
engine.full_layout(seed.json, SP, PAGE_WIDTH, null, scoreIndex);
const reconstructor = new PatchReconstructor();

// Warmup: 3 edits to populate all caches.
for (let i = 0; i < 3; i++) {
  score = applyEdit(score, i, 16, 0);
  const r = ser.serialize(score);
  if (r.structuralChange) throw new Error("warmup structural change");
  const j = ser.buildPatch(r.changedGlobalMeasures, r.changedPartMeasures);
  const tagged = engine.apply_patch_and_layout_patch_frame_binary(j, SP, PAGE_WIDTH, null, scoreIndex);
  reconstructor.apply(decodeFrame(tagged));
}
console.log("warmup done; starting profiled bench");

glue.set_wasm_timing(true);

const session = new Session();
session.connect();
await session.post("Profiler.enable");
// Tight sampling — 50µs ≈ 20kHz, useful even for short WASM calls.
await session.post("Profiler.setSamplingInterval", { interval: 50 });
await session.post("Profiler.start");

const PATCH_ITERS = 12;
const wall = { patch: [] as number[], wasm: [] as number[], decode: [] as number[], recon: [] as number[] };
let lastTimings: string | undefined;

for (let i = 0; i < PATCH_ITERS; i++) {
  score = applyEdit(score, 100 + i, 16, 0);
  const r = ser.serialize(score);
  if (r.structuralChange) continue;
  const j = ser.buildPatch(r.changedGlobalMeasures, r.changedPartMeasures);

  const t0 = performance.now();
  const tagged = engine.apply_patch_and_layout_patch_frame_binary(j, SP, PAGE_WIDTH, null, scoreIndex);
  const t1 = performance.now();
  const frame = decodeFrame(tagged);
  const t2 = performance.now();
  reconstructor.apply(frame);
  const t3 = performance.now();

  wall.wasm.push(t1 - t0);
  wall.decode.push(t2 - t1);
  wall.recon.push(t3 - t2);
  wall.patch.push(t3 - t0);
  lastTimings = engine.take_timings_json();
}

const result = (await session.post("Profiler.stop")) as { profile: unknown };
glue.set_wasm_timing(false);
engine.free();
session.disconnect();

writeFileSync(OUT_PROFILE, JSON.stringify(result.profile));
console.log(`profile written: ${OUT_PROFILE}`);

const q = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return { p50: s[Math.floor(s.length / 2)] ?? 0, p95: s[Math.floor(s.length * 0.95)] ?? 0 };
};
console.log("");
console.log(`per-iter wall-clock (n=${PATCH_ITERS}):`);
for (const [k, xs] of Object.entries(wall)) {
  const { p50, p95 } = q(xs);
  console.log(`  ${k.padEnd(11)} p50=${p50.toFixed(2)} p95=${p95.toFixed(2)}`);
}
console.log("");
console.log("last engine timing (final iter):");
console.log(`  ${lastTimings ?? "(none)"}`);
