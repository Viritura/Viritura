# Sound Profiles

> **Status: Partially implemented.** VirituraSounds source assignments persist in MNX and route through the SF2 runtime. Stable part IDs are used for persisted assignments, while existing runtime mixer maps still use temporary part-index adapters. Generic VST hosting and named VST profiles remain future work.
>
> **See also:** [Instrument Profiles & VST Playback](../plans/instrument-profiles-vst.md) — the in-flight design that builds VST-backed profiles, a Lua articulation-mapper contract, and playback on top of this model.

## Purpose

A score part says what the musician plays. A sound profile says how Viritura plays that part.

For example:

```text
Score part:        Clarinet in Bb 1
Instrument ID:     bflat-clarinet
Sound profile:     VirituraSounds
Resolved sound:    GM/SF2 program 71
Routing:           woodwinds bus, current clarinet stage default
```

The score's instrument identity and its chosen sound must remain separate. Changing from the built-in SoundFont to a VST must not turn a clarinet into a different notation instrument, change transposition, or change the part name.

## Goals

- Preserve current playback exactly through the built-in `VirituraSounds` profile.
- Let each part use a MIDI/SF2 source or a VST source in the same score.
- Let future named profiles describe VST-specific setups without making core playback code depend on a particular plugin.
- Preserve standard MNX musical content when Viritura extensions are removed.
- Keep machine-local plugin binaries, licenses, and sample-library paths out of score files.
- Make profile resolution deterministic and testable.

## Non-goals

- This specification does not define a VST host, plugin scanner, or plugin UI.
- This specification does not make mixer levels, mute, solo, or master effects document settings. Those remain runtime controls unless a later specification explicitly makes them score-scoped.
- This specification does not replace the instrument catalog. The catalog remains the source of notation identity, transposition, family, and display naming.

## Terms

| Term                    | Meaning                                                                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Instrument identity** | The canonical catalog ID on a score part, such as `bflat-clarinet`.                                                                 |
| **Sound profile**       | A named collection of rules that maps instrument identities to playable sources and default routing.                                |
| **Resolved part sound** | The concrete source and routing selected after a profile resolves one part.                                                         |
| **Sound source**        | A playable implementation: initially MIDI/SF2, later VST.                                                                           |
| **Profile assignment**  | A score-level selected profile plus optional per-part source choices.                                                               |
| **Routing defaults**    | Profile-defined section, stage position, projection, layers, and other defaults that preserve current orchestral playback behavior. |

## Core rule

The profile resolves an instrument ID. It does not resolve a part name.

```text
Part.instrumentId + profile assignment -> resolved part sound
```

Part display labels such as "Clarinet in Bb 1" are for people. They are not stable routing keys. Array indexes are also not stable routing keys. Persisted per-part choices must use the MNX part ID.

## Profile model

A profile has a stable ID, a version, a user-facing name, and instrument rules.

```ts
interface SoundProfile {
  id: string;
  version: number;
  displayName: string;
  resolve(input: ProfileResolveInput): ResolvedPartSound | null;
}

interface ProfileResolveInput {
  instrumentId: string;
  partId: string;
  selectedSourceId?: string;
}

interface ResolvedPartSound {
  profileId: string;
  instrumentId: string; // notation identity
  selectedSourceId: string; // profile-defined playable identity
  sources: readonly SoundSourceDefinition[];
  routing: PartRoutingDefaults;
  capabilities: PlaybackCapabilities;
}
```

`resolve` is pure. It must not access an audio device, inspect installed plugins, or mutate application state. Runtime availability is checked later by the playback layer.

Profiles may define more than one source for a part. This supports the current string ensemble layers and future intentional layered sounds. Sources are played together only when the resolved profile says so; the mixer must never accidentally duplicate a source.

## Sound sources

Sound sources are a discriminated union. The runtime switches on `kind`; it must not contain names for individual plugin products.

```ts
interface MidiSoundSourceDefinition {
  kind: "midi";
  program: number;
  bankMsb?: number;
  bankLsb?: number;
  drumKitProgram?: number;
  fixedMidiNote?: number;
}

interface VstSoundSourceDefinition {
  kind: "vst";
  hostProfileId: string;
  instrumentSlot: string;
  midiChannel: number;
  articulationMapId?: string;
}

type SoundSourceDefinition = MidiSoundSourceDefinition | VstSoundSourceDefinition;
```

`hostProfileId`, `instrumentSlot`, and `articulationMapId` are logical names. They do not contain an absolute plugin path, a license token, or opaque plugin state. A desktop VST host resolves those names using local profile installation data.

The first runtime implementation is a MIDI/SF2 source adapter around the existing sampler path. A VST source adapter is added separately and implements the same runtime interface.

## VirituraSounds

`VirituraSounds` is the built-in default profile. It is a compatibility contract: selecting it must reproduce current playback behavior.

It maps each supported catalog instrument ID to the existing:

- GM/SF2 program and bank selection;
- percussion kit and fixed-note behavior;
- string ensemble layers;
- orchestra section;
- default stage position and projection;
- MIDI technique and lane-routing behavior.

For example, `bflat-clarinet` resolves to GM program 71 and the current woodwind routing and clarinet spatial defaults.

The profile is authored as data plus small pure resolution helpers. Current name- and regex-based fallback behavior remains only for importing old scores or catalog gaps. New profile definitions must use canonical instrument IDs.

## Profile assignments and overrides

The score selects one base profile. A part may select another compatible source within that profile.

```ts
interface SoundProfileAssignment {
  profileId: string;
  profileVersion: number;
  parts: Record<string, PartSoundOverride>;
}

interface PartSoundOverride {
  sourceId?: string;
}
```

The base profile supplies the default for every part. An absent part override
means "use the profile default." Overrides identify a profile-defined source;
they do not duplicate program numbers, spatial coordinates, layers, or VST
state into the score. A selected source is resolved independently from the
part's notation `instrumentId`, so a clarinet may intentionally play the tuba
source while remaining a clarinet in notation.

When a profile cannot resolve an instrument, playback must surface a clear unavailable-sound state. It must not silently select a different VST sound. `VirituraSounds` may use its documented legacy MIDI fallback for old or unknown catalog data.

## Persistence

Sound profile assignment is Viritura playback metadata. It belongs under the score root's MNX-standard vendor extension:

```json
{
  "_x": {
    "viritura": {
      "soundProfile": {
        "profileId": "viritura-sounds",
        "profileVersion": 1,
        "parts": {
          "clarinet-1-part-id": { "sourceId": "tuba-primary" }
        }
      }
    }
  }
}
```

The exact JSON Schema, parser, serializer, and extension-reference entry must ship together. Removing `_x.viritura.soundProfile` leaves an ordinary MNX score; Viritura then selects `VirituraSounds` by default.

VirituraSounds canonical source IDs are stable profile identities such as
`bflat-clarinet-primary` and `tuba-primary`; they are not MIDI program
overrides. Legacy part `_x.viritura.midiProgram` remains honored only when no
explicit `soundProfile.parts[partId].sourceId` exists.

Profiles themselves are application resources, not embedded opaque document payloads. A score can therefore be read without installed VSTs, and a missing local VST setup cannot corrupt its notation data.

## Spatial and mixer rules

Profiles own **defaults**. The score and mixer own user choices.

Precedence for a part's stage position is:

1. User-authored part spatial override, when present.
2. Resolved profile routing default.
3. Legacy compatibility fallback.

The Mixer does not decide MIDI programs, VST slots, channels, or default spatial position. It consumes the resolved routing plan and controls runtime level, mute, solo, pan, groups, and master effects.

Mixer and runtime maps must be keyed by stable part ID. Temporary index-based adapters are acceptable during migration, but no new persisted state may use a part index.

## Runtime boundary

The profile domain remains independent of Web Audio, React, Tauri, and any plugin SDK. Playback receives a resolved routing plan and creates a source adapter for each definition.

```ts
interface RuntimeSoundSource {
  noteOn(note: number, velocity: number, time?: number): void;
  noteOff(note: number, time?: number): void;
  allNotesOff(): void;
  dispose(): void;
}
```

Adapters may expose optional capabilities such as program change, controller messages, articulation selection, or live mixer control. Callers must check a capability instead of assuming all sources support MIDI controls.

This boundary permits a score to use MIDI and VST sources together. It also prevents a global "VST on" switch from mirroring notes into a source that is already driven by its resolved per-part adapter.

## Package boundaries

The target package and folder structure is:

```text
packages/sound-profiles/src/
  index.ts
  types.ts
  registry.ts
  virituraSounds/
    index.ts
    instrumentRules.ts
    routingDefaults.ts

packages/audio/src/soundSources/
  index.ts
  types.ts
  midiSf2/
    index.ts
    source.ts

packages/playback/src/soundProfileRuntime/
  index.ts
  resolvePartSounds.ts
  createRuntimeSources.ts
  routingPlan.ts
```

Future VST source code lives in its own feature folder and exports only through its barrel. It must use generic `vst` terminology; a specific plugin name belongs only in that plugin's profile data.

## Migration plan

1. [x] Define profile types, registry, and `VirituraSounds`.
2. [x] Add characterization tests proving that `VirituraSounds` resolves the same MIDI programs, layers, section buses, and spatial defaults as current playback.
3. [x] Route current SF2 sampler creation through resolved profile output without changing audible behavior.
4. [ ] Move mixer and runtime routing keys from part indexes to stable part IDs, using short-lived adapters where needed.
5. [x] Add the score-root extension schema, parsing, serialization, and migration behavior.
6. [ ] Add generic VST source adapters and availability reporting.
7. [ ] Add named VST profiles with logical instrument slots, channels, and articulation maps.

No step may remove the current SF2 path until `VirituraSounds` has replaced it as its behavior-preserving definition.

## Current test coverage

The implementation includes unit coverage in `packages/sound-profiles/src/virituraSounds/virituraSounds.test.ts`, `packages/playback/src/soundProfileRuntime/resolvePartSounds.test.ts`, `packages/playback/src/soundProfileRuntime/soundProfilePickerView.test.ts`, `packages/playback/src/playbackSamplerHelpers.test.ts`, `apps/editor/src/__tests__/MixerPanel.test.tsx`, and the format parser, serializer, and validator tests. These cover canonical source resolution, legacy compatibility, profile-version rejection, profile-defined drum-kit selection, layering, persistence, picker interaction, and schema validation.

## Required tests

- `VirituraSounds` maps each covered catalog instrument to its current MIDI program, bank, and percussion behavior.
- Clarinet in Bb resolves to program 71 and the current woodwind routing.
- Existing string ensemble layers resolve once, not twice.
- User spatial overrides take priority over profile defaults.
- A score without profile metadata resolves to `VirituraSounds`.
- A missing profile produces a visible unavailable-sound state.
- MIDI and VST sources can coexist in one resolved routing plan.
- Serialization round-trips profile assignments by stable part ID.
- Removing the Viritura extension preserves valid MNX musical content.
