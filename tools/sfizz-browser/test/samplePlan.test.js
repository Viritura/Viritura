import assert from "node:assert/strict";
import test from "node:test";
import { buildFileIndex } from "../src/libraryIndex.js";
import { buildSamplePlan, extractKeyswitches, noteNameToMidi, parseSfzOpcodes } from "../src/samplePlan.js";

test("scans multiple opcodes per line, comments, note names, and spaced sample paths", () => {
  const sfzText = [
    "<control>",
    "default_path=Strings\\Violin Section\\susVib\\ // keep local path with spaces",
    "<region> sample=violin C4.wav lokey=C4 hikey=60 lorand=0.0 hirand=0.5",
  ].join("\n");
  const index = buildFileIndex([file("root/Strings/Violin Section/susVib/violin C4.wav", 1024)]);
  const plan = buildSamplePlan({
    filesByPath: index.byLowerPath,
    memoryLimitBytes: 2048,
    sfzPath: "root/ViolinEns-KS.sfz",
    sfzText,
  });

  assert.equal(plan.samples.length, 1);
  assert.equal(plan.expectedRegionCount, 1);
  assert.equal(plan.totalBytes, 1024);
  assert.doesNotMatch(plan.rewrittenSfz, /Strings\\Violin Section/);
  assert.doesNotMatch(plan.rewrittenSfz, /default_path\s*=/);
  assert.equal(plan.samples[0].virtualPath, "/vsco/0000-violin_C4.wav");
  assert.match(plan.rewrittenSfz, /sample=0000-violin_C4\.wav lokey=C4/);
  assert.equal(noteNameToMidi("C4"), 60);
  assert.equal(noteNameToMidi("c#2"), 37);
});

test("deduplicates samples and honors default_path changes", () => {
  const sfzText = [
    "<control> default_path=A\\",
    "<region> sample=one.wav",
    "<region> sample=one.wav",
    "<control> default_path=B\\",
    "<region> sample=two.wav",
  ].join("\n");
  const index = buildFileIndex([file("root/A/one.wav", 10), file("root/B/two.wav", 20)]);

  const plan = buildSamplePlan({
    filesByPath: index.byLowerPath,
    memoryLimitBytes: 64,
    sfzPath: "root/patch.sfz",
    sfzText,
  });

  assert.equal(plan.samples.length, 2);
  assert.equal(plan.totalBytes, 30);
  assert.equal((plan.rewrittenSfz.match(/0000-one\.wav/g) ?? []).length, 2);
});

test("rejects missing files, traversal, unsupported directives, malformed headers, and generators", () => {
  const index = buildFileIndex([file("root/A/one.wav", 10)]);

  assert.throws(
    () =>
      buildSamplePlan({
        filesByPath: index.byLowerPath,
        memoryLimitBytes: 64,
        sfzPath: "root/patch.sfz",
        sfzText: "<region> sample=missing.wav",
      }),
    /Missing sample/,
  );
  assert.throws(
    () =>
      buildSamplePlan({
        filesByPath: index.byLowerPath,
        memoryLimitBytes: 64,
        sfzPath: "root/patch.sfz",
        sfzText: "<region> sample=..\\outside.wav",
      }),
    /Missing sample|escapes/,
  );
  assert.throws(() => parseSfzOpcodes("#include other.sfz"), /Unsupported SFZ directive/);
  assert.throws(() => parseSfzOpcodes("<region\nsample=x.wav"), /Malformed SFZ header/);
  assert.throws(
    () =>
      buildSamplePlan({
        filesByPath: index.byLowerPath,
        memoryLimitBytes: 64,
        sfzPath: "root/patch.sfz",
        sfzText: "<region> sample=*saw",
      }),
    /Unsupported non-WAV sample/,
  );
});

test("extracts and deduplicates keyswitch labels with SFZ C4 equals MIDI 60", () => {
  const tokens = parseSfzOpcodes(
    [
      "<control> sw_default=c2",
      "<group> sw_last=c2 sw_label=C2 Sustain",
      "<group> sw_last=d2 sw_label=D2 Spiccato",
      "<group> sw_last=d2 sw_label=D2 Spiccato duplicate",
    ].join("\n"),
  );

  assert.deepEqual(extractKeyswitches(tokens), [
    { isDefault: true, label: "C2 Sustain", note: 36 },
    { isDefault: false, label: "D2 Spiccato duplicate", note: 38 },
  ]);
});

test("enforces configured memory cap before reading WAV bytes", () => {
  const index = buildFileIndex([file("root/A/one.wav", 65)]);
  assert.throws(
    () =>
      buildSamplePlan({
        filesByPath: index.byLowerPath,
        memoryLimitBytes: 64,
        sfzPath: "root/patch.sfz",
        sfzText: "<control> default_path=A\\\n<region> sample=one.wav",
      }),
    /above the configured/,
  );
});

function file(relativePath, size) {
  return {
    arrayBuffer: async () => new ArrayBuffer(size),
    name: relativePath.split("/").at(-1),
    relativePath,
    size,
    text: async () => "",
  };
}
