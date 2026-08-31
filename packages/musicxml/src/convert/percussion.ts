import type {
  MnxDocument,
  MnxEvent,
  MnxKitComponent,
  MnxKitNote,
  MnxPart,
  MnxPitch,
  MnxSequenceContent,
  MnxSound,
  PartInfo,
} from "../types";
import type { PercussionImportReview } from "./convertMusicXmlToMnx";

// The glyph the converter stamps on an MNX clef when the MusicXML clef sign is
// `percussion` (see `clefFromElement` in pitchDuration.ts). A part is treated
// as an unpitched-percussion (drum-kit) part when any of its clefs use it.
const PERCUSSION_CLEF_GLYPH = "unpitchedPercussionClef1";

// Diatonic position of G4 (the reference the converter's percussion clef
// inherits — it is emitted as `{ sign: "G", staffPosition: 0 }`). The engine
// places a pitched note at `4 - (diatonic - 32)` half-spaces from the top line
// on that clef, and a kit-component at `4 - staffPosition`. Matching the two
// gives `staffPosition = diatonic - 32`, preserving the rendered position.
const G4_DIATONIC = 32;

const STEP_INDEX: Record<string, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

// MusicXML `<notehead>` token → Viritura notehead shape (vendor extension enum:
// normal | x | circleX | diamond | slash | triangleUp | triangleDown). Tokens
// not listed (square, cluster, none, …) have no Viritura equivalent and fall
// back to the default `normal` notehead.
const NOTEHEAD_MAP: Record<string, string> = {
  x: "x",
  cross: "x",
  "circle-x": "circleX",
  diamond: "diamond",
  slash: "slash",
  slashed: "slash",
  triangle: "triangleUp",
  "inverted triangle": "triangleDown",
};

/** Map a raw MusicXML notehead token to a Viritura notehead shape, or undefined
 *  for the default (normal) head. */
function noteheadShape(token: string | undefined): string | undefined {
  if (!token) return undefined;
  const shape = NOTEHEAD_MAP[token];
  return shape && shape !== "normal" ? shape : undefined;
}

/** General MIDI percussion note → human-readable name (channel 10 key map). */
const GM_PERCUSSION_NAMES: Record<number, string> = {
  35: "Acoustic Bass Drum",
  36: "Bass Drum 1",
  37: "Side Stick",
  38: "Acoustic Snare",
  40: "Electric Snare",
  41: "Low Floor Tom",
  42: "Closed Hi-Hat",
  45: "Low Tom",
  46: "Open Hi-Hat",
  47: "Low-Mid Tom",
  49: "Crash Cymbal 1",
  51: "Ride Cymbal 1",
  52: "Chinese Cymbal",
  54: "Tambourine",
  55: "Splash Cymbal",
  56: "Cowbell",
  75: "Claves",
  76: "Hi Wood Block",
  77: "Low Wood Block",
  81: "Open Triangle",
};

// MusicXML `<instrument-sound>` standard-sound id → GM percussion note. Ordered
// longest-prefix-first; the first matching prefix wins. `drum.timpani` is
// deliberately absent: timpani is pitched percussion (bass clef, definite
// pitch) and must stay a melodic instrument, not route to channel 10.
const SOUND_TO_GM: Array<[string, number]> = [
  ["drum.bass-drum", 36],
  ["drum.snare-drum", 38],
  ["drum.tom-tom", 47],
  ["drum.tenor-drum", 47],
  ["drum.tambourine", 54],
  ["drum.tabla", 47],
  ["metal.cymbal.crash", 49],
  ["metal.cymbal.ride", 51],
  ["metal.cymbal.china", 52],
  ["metal.cymbal.splash", 55],
  ["metal.cymbal.suspended", 49],
  ["metal.cymbal", 49],
  ["metal.hi-hat", 42],
  ["metal.triangle", 81],
  ["metal.cowbell", 56],
  ["metal.bells.cowbell", 56],
  ["metal.tambourine", 54],
  ["wood.wood-block", 76],
  ["wood.temple-block", 76],
  ["wood.castanets", 75],
  ["wood.claves", 75],
];

// Part-name keyword → GM percussion note, used when `<instrument-sound>` is
// absent or generic (e.g. a single-line "Snare Drum" staff).
const NAME_TO_GM: Array<[RegExp, number]> = [
  [/bass\s*drum/i, 36],
  [/snare/i, 38],
  [/tom/i, 47],
  [/tambourine/i, 54],
  [/crash/i, 49],
  [/ride/i, 51],
  [/hi-?hat/i, 42],
  [/cymbal/i, 49],
  [/triangle/i, 81],
  [/cowbell/i, 56],
  [/wood\s*block/i, 76],
  [/clave/i, 75],
];

function diatonic(pitch: MnxPitch): number {
  return (STEP_INDEX[pitch.step] ?? 0) + pitch.octave * 7;
}

/** Map a kit-component staff position to a sensible GM percussion note for a
 *  generic (unidentified) drum staff: higher = cymbals, middle = snare,
 *  lower = toms/bass drum. Coarse, but far better than a piano voice. */
function gmForStaffPosition(staffPosition: number): number {
  if (staffPosition >= 7) return 49; // crash, above the staff
  if (staffPosition >= 4) return 42; // hi-hat / upper region
  if (staffPosition >= -1) return 38; // snare, around the middle
  if (staffPosition >= -4) return 45; // low tom
  return 36; // bass drum, below the staff
}

/** Resolve a fixed GM note for the whole part from its instrument-sound or
 *  name, or undefined to fall back to per-position mapping. */
function fixedGmForPart(info: PartInfo | undefined): number | undefined {
  const sound = info?.instrumentSound?.toLowerCase();
  if (sound) {
    for (const [prefix, note] of SOUND_TO_GM) {
      if (sound === prefix || sound.startsWith(`${prefix}.`)) return note;
    }
  }
  const name = info?.name;
  if (name) {
    for (const [re, note] of NAME_TO_GM) {
      if (re.test(name)) return note;
    }
  }
  return undefined;
}

function isPercussionPart(part: MnxPart): boolean {
  return part.measures.some((m) => m.clefs?.some((c) => c.clef.glyph === PERCUSSION_CLEF_GLYPH));
}

/** Walk every `MnxEvent` (recursing into grace, tuplet and tremolo content). */
function forEachEvent(content: MnxSequenceContent[], visit: (event: MnxEvent) => void): void {
  for (const item of content) {
    if (item.type === undefined) {
      visit(item);
    } else if (item.type === "grace" || item.type === "tuplet" || item.type === "tremolo") {
      forEachEvent(item.content, visit);
    }
    // "space" has no events
  }
}

interface KitBuilder {
  /** kit-component id keyed by `staffPosition:noteheadShape`. A single staff
   *  line may host distinct instruments distinguished by notehead (e.g. a
   *  normal-head snare and an x-head cross-stick), so the head is part of the
   *  identity. */
  components: Map<string, string>;
  kit: Record<string, MnxKitComponent>;
}

function componentForPosition(
  builder: KitBuilder,
  partId: string,
  staffPosition: number,
  notehead: string | undefined,
  fixedGm: number | undefined,
  sounds: Record<string, MnxSound>,
): string {
  const key = `${staffPosition}:${notehead ?? ""}`;
  const existing = builder.components.get(key);
  if (existing) return existing;

  const gmNote = fixedGm ?? gmForStaffPosition(staffPosition);
  const soundId = `snd-perc-${gmNote}`;
  if (!sounds[soundId]) {
    const sound: MnxSound = { midiNumber: gmNote };
    const name = GM_PERCUSSION_NAMES[gmNote];
    if (name) sound.name = name;
    sounds[soundId] = sound;
  }

  const componentId = `${partId}-kit-${builder.components.size}`;
  const component: MnxKitComponent = { staffPosition, sound: soundId };
  const compName = GM_PERCUSSION_NAMES[gmNote];
  if (compName) component.name = compName;
  if (notehead) component._x = { viritura: { notehead } };
  builder.kit[componentId] = component;
  builder.components.set(key, componentId);
  return componentId;
}

/** Convert one percussion part's pitched events to drum-kit events in place,
 *  building the part's `kit` and registering sounds. Returns true if the part
 *  was converted (i.e. it is an unpitched-percussion part). */
function convertPart(part: MnxPart, info: PartInfo | undefined, sounds: Record<string, MnxSound>): boolean {
  if (!isPercussionPart(part)) return false;

  const fixedGm = fixedGmForPart(info);
  const builder: KitBuilder = { components: new Map(), kit: {} };

  // Percussion staves carry no real pitch, yet some exporters (Sibelius) attach
  // an octave `<transpose>` to make MIDI playback land in the right register.
  // The converter applied that transpose to the stored (sounding) pitch, so the
  // written display row must be recovered by undoing it — otherwise noteheads
  // render octaves off their authored lines. `transposition.interval` is the
  // sounding→written interval, so its staff distance is exactly that correction.
  const writtenCorrection = part.transposition?.interval.staffDistance ?? 0;

  for (const measure of part.measures) {
    for (const seq of measure.sequences ?? []) {
      forEachEvent(seq.content, (event) => {
        if (!event.notes || event.notes.length === 0) return;
        const kitNotes: MnxKitNote[] = [];
        for (const note of event.notes) {
          if (!note.pitch) continue;
          const staffPosition = diatonic(note.pitch) + writtenCorrection - G4_DIATONIC;
          const notehead = noteheadShape(note.notehead);
          const componentId = componentForPosition(builder, part.id, staffPosition, notehead, fixedGm, sounds);
          const kitNote: MnxKitNote = { kitComponent: componentId };
          if (note.staff !== undefined) kitNote.staff = note.staff;
          if (note.ties) kitNote.ties = note.ties;
          kitNotes.push(kitNote);
        }
        if (kitNotes.length > 0) {
          delete event.notes;
          event.kitNotes = kitNotes;
        }
      });
    }
  }

  if (Object.keys(builder.kit).length === 0) return false;
  part.kit = builder.kit;
  // A drum kit has no pitches, so the playback-oriented octave transposition is
  // meaningless on the converted part (and would mislabel it as transposing).
  delete part.transposition;
  return true;
}

/**
 * Detect unpitched-percussion parts (those drawn on a percussion clef) and
 * convert their pitched notes into MNX drum-kit notes so playback routes them
 * to the General MIDI drum channel instead of voicing them as piano.
 *
 * Each distinct staff position on a percussion part becomes a kit-component;
 * the component's GM sound is chosen from the part's `<instrument-sound>` or
 * name when recognizable, otherwise from a coarse staff-position heuristic.
 * Staff positions are derived to exactly match the engine's pitch-to-position
 * math, so noteheads stay where they rendered before.
 */
export function applyPercussionKits(doc: MnxDocument, partsInfo: PartInfo[]): PercussionImportReview[] {
  const infoById = new Map(partsInfo.map((p) => [p.id, p]));
  const sounds: Record<string, MnxSound> = {};
  const reviews: PercussionImportReview[] = [];

  for (const part of doc.parts) {
    const info = infoById.get(part.id);
    const usedHeuristic = fixedGmForPart(info) === undefined;
    if (convertPart(part, info, sounds) && usedHeuristic) {
      reviews.push({
        partId: part.id,
        partName: part.name ?? info?.name ?? "Percussion",
        confidence: "low",
        reason:
          "Sounds were inferred from staff position because MusicXML supplied no recognized instrument sound or name.",
      });
    }
  }

  if (Object.keys(sounds).length > 0) {
    doc.global.sounds = { ...(doc.global.sounds ?? {}), ...sounds };
  }
  return reviews;
}
