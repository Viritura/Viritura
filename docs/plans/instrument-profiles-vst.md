# Instrument Profiles and VST Follow-ups

> **Status:** The desktop instrument-profile model, persistence, Settings UI, VST3 host, edit-and-listen state capture, sandboxed Lua mapper, playback routing, and explicit SoundFont fallback are shipped. This plan tracks mixer completion and the remaining cross-device/audio-routing decisions.

The sound-source ownership model is specified in [sound-profiles.md](../spec/sound-profiles.md). This feature is desktop-only by design; web builds may display profiles but report native sources as unavailable.

## Shipped baseline

### Profiles and persistence

- Catalog-linked and custom instrument slots are represented by `@viritura/instrument-profiles` and the shared sound-profile model.
- The desktop shell stores profiles atomically on the local filesystem.
- Settings can create, edit, group, and assign slots.
- Plugin state is immutable, content-addressed, and checked against plugin identity before restore.

### Native host

- The Tauri shell scans and loads VST3 plugins through the in-process host.
- Edit-and-listen sessions capture plugin state without replacing a known-good state blob on failure.
- The native scheduler supports transport generation changes, panic/flush, and direct device output.
- Missing, incompatible, or failed plugins produce an explicit unavailable state rather than silent substitution.

### Articulation mapping

- Lua mappings run through a sandboxed `mlua` runtime.
- Mappers translate notation-level performance events into MIDI/keyswitch/controller output.
- Script failures are isolated to the slot and surface diagnostics.

### Playback fallback

Every native-routed part retains a SoundFont timeline. When a plugin, state, or script is unavailable, playback switches to that fallback at the current transport position and reports the substitution in the UI.

An all-VST score uses the native device clock; an all-SoundFont score uses Web Audio. Mixed scores currently use both clocks and can drift or flam because they are not sample-locked.

## Remaining work

### 1. Mixer availability states

For every slot, show a stable state with actionable detail:

- ready;
- scanning/loading;
- plugin missing;
- incompatible saved state;
- mapper compile/runtime failure;
- native host unavailable;
- using SoundFont fallback.

Availability must not resize mixer rows or disappear when playback stops. Diagnostics should identify the failing profile/slot and recovery action without exposing arbitrary plugin or filesystem data.

### 2. Per-slot output gain

Apply mixer fader, mute, and solo as continuous native output-bus gain per VST slot. Do not emulate faders solely through note velocity, because that cannot change sustained notes. Stop/seek still uses scheduler generation flush and all-notes-off rather than routine gain changes.

Add focused host tests for gain ramps, mute during sustain, solo recomputation, panic, and fallback transitions.

### 3. Per-slot diagnostics

Expose bounded recent host and mapper diagnostics from the Mixer. Keep diagnostic ownership per slot, avoid an unbounded log, and distinguish recoverable fallback from an unrecoverable in-process plugin crash.

## Open decisions

### Multi-timbral instances

Version 1 uses one plugin instance per slot. Shared instances could serve several parts on separate MIDI channels, but they complicate state ownership, gain, diagnostics, and failure isolation. Add them only when real libraries require the memory savings; the reserved base-channel field must not be treated as a shipped sharing contract.

### Unified audio routing

Mixed native/Web Audio playback has two unsynchronized clocks. The long-term option is to stream native plugin audio into the `AudioContext` graph so VST and SoundFont parts share one clock, concert-hall processing, spatialization, meters, and master bus.

Before committing to that path, measure round-trip latency, buffer stability, CPU cost, and platform behavior. The scheduler and profile model should remain output-sink agnostic.

### Custom-instrument score binding

A custom slot without a catalog instrument can be assigned manually in the Mixer. Decide whether a document should carry a portable binding hint or whether local profile assignment remains intentionally machine-specific. Any persisted hint must identify intent without embedding local paths, plugin binaries, or opaque machine IDs.

### Profile portability

A future explicit export bundle may package profile metadata, Lua scripts, compatible state, and plugin identity. It must never imply that a commercial plugin or non-portable state blob is distributable. This is not required for mixer completion.

## Constraints

1. Native plugins execute only in the desktop host.
2. Failure and fallback are always visible to the user.
3. Known-good plugin state is never overwritten in place by a failed capture.
4. Lua execution remains sandboxed and resource-bounded.
5. Mixer level changes operate on audio output, not only future note velocity.
6. Profiles and documents never persist local filesystem paths as portable identity.
7. Web behavior remains a functional SoundFont fallback, not a simulated VST host.

## Completion criteria

- Mixer rows show stable per-slot availability and bounded diagnostics.
- VST fader, mute, and solo changes affect sustained audio through native bus gain.
- Fallback transitions are audible, recoverable, and clearly labeled.
- Host and mapper failures remain isolated to the affected slot where technically possible.
- The mixed-clock limitation is either retained as a documented boundary or replaced by a measured, sample-locked routing design.
- Custom binding and portability decisions are recorded before their data shapes become persistent contracts.
