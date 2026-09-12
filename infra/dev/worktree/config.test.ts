import assert from "node:assert/strict";
import test from "node:test";
import { deriveSlug, getProfiles, getStateRoot, needsWasm } from "./config.ts";

test("uses native per-user state directories", () => {
  assert.equal(
    getStateRoot("win32", { LOCALAPPDATA: "C:\\Users\\dev\\AppData\\Local" }, "C:\\Users\\dev"),
    "C:\\Users\\dev\\AppData\\Local\\Viritura\\dev",
  );
  assert.equal(getStateRoot("darwin", {}, "/Users/dev"), "/Users/dev/Library/Application Support/Viritura/dev");
  assert.equal(getStateRoot("linux", { XDG_STATE_HOME: "/var/state/dev" }, "/home/dev"), "/var/state/dev/viritura/dev");
  assert.equal(getStateRoot("linux", {}, "/home/dev"), "/home/dev/.local/state/viritura/dev");
});

test("derives a stable DNS-safe worktree slug", () => {
  const slug = deriveSlug("/work/Viritura", "Feature/Add MIDI Widgets");
  assert.match(slug, /^feature-add-midi-widgets-[a-f0-9]{4}$/);
  assert.equal(slug, deriveSlug("/work/Viritura", "Feature/Add MIDI Widgets"));
  assert.match(deriveSlug("/work/My Checkout", "HEAD"), /^my-checkout-[a-f0-9]{4}$/);
});

test("normalizes and deduplicates stack profile aliases", () => {
  assert.deepEqual(getProfiles([]), ["app"]);
  assert.deepEqual(getProfiles(["core", "app", "web", "stories"]), ["app", "website", "storybook"]);
  assert.throws(() => getProfiles(["unknown"]), /Unknown stack target/);
});

test("builds WASM unless every target is backend-only", () => {
  assert.equal(needsWasm([]), true);
  assert.equal(needsWasm(["backend", "api"]), false);
  assert.equal(needsWasm(["backend", "editor"]), true);
});
