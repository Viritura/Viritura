import { ACCIDENTAL_MAP, ARTICULATION_MAP } from "../constants";
import { childElements, childText, findChild, findChildren, notationChild, notationChildren } from "../xmlHelpers";
import type { MnxEvent, MnxEventMarkings, MnxGlissando, MnxNote, MnxSlur, MnxTie } from "../types";
import { IdGenerator } from "./idGenerator";
import { convertPitch, type TransposeInterval } from "./pitchDuration";

export interface SlurState {
  startEventId: string;
  startNoteId?: string;
  number: string;
  targetId: string;
}

export interface GlissandoState {
  startEvent: MnxEvent;
  glissando: Omit<MnxGlissando, "target">;
}

export function processGlissandoBoundaries(
  noteEl: Element,
  event: MnxEvent,
  openGlissandos: Map<string, GlissandoState>,
  vendorExt: boolean,
): void {
  for (const tag of ["glissando", "slide"] as const) {
    for (const element of notationChildren(noteEl, tag)) {
      const key = `${tag}:${element.getAttribute("number") ?? "1"}`;
      const boundary = element.getAttribute("type") ?? "start";
      if (boundary === "start") {
        const glissando: Omit<MnxGlissando, "target"> = {};
        const lineType = element.getAttribute("line-type");
        if (lineType === "straight" || lineType === "wavy") glissando.style = lineType;
        const text = element.textContent?.trim();
        if (text) glissando.text = text;
        openGlissandos.set(key, { startEvent: event, glissando });
      } else if (boundary === "stop") {
        const state = openGlissandos.get(key);
        if (!state) continue;
        openGlissandos.delete(key);
        if (!vendorExt) continue;
        if (!state.startEvent._x) state.startEvent._x = { viritura: {} };
        const glissandos = state.startEvent._x.viritura.glissandos ?? [];
        state.startEvent._x.viritura.glissandos = [...glissandos, { ...state.glissando, target: event.id! }];
      }
    }
  }
}

// Maps a MusicXML <accidental-mark> token (used to qualify an ornament's
// auxiliary note) to the trill extension's integer accidental: flat = -1,
// natural = 0, sharp = 1.
const ACCIDENTAL_MARK_ALTER: Record<string, number> = {
  flat: -1,
  natural: 0,
  sharp: 1,
};

// When a note/grace element closes a slur, the stop event must adopt the
// target ID minted at the slur's start so the start event's `target` resolves.
// Returns that ID, or undefined when the element is not a slur stop.
export function resolveSlurStopId(noteEl: Element, openSlurs: Map<string, SlurState>): string | undefined {
  for (const slurEl of notationChildren(noteEl, "slur")) {
    if (slurEl.getAttribute("type") !== "stop") continue;
    const num = slurEl.getAttribute("number") ?? "1";
    const state = openSlurs.get(num);
    if (state) return state.targetId;
  }
  return undefined;
}

// eslint-disable-next-line complexity, max-statements -- branchy tie-tracking state machine over MusicXML tied/tie grammar (start/stop/lv pairing across measures)
export function buildNote(
  noteEl: Element,
  voiceNum: string,
  tieIds: Map<string, MnxTie>,
  ids: IdGenerator,
  transpose?: TransposeInterval,
): MnxNote {
  const pitchEl = findChild(noteEl, "pitch");
  const unpitchedEl = findChild(noteEl, "unpitched");
  const note: MnxNote = {};

  if (pitchEl) {
    note.pitch = convertPitch(pitchEl, transpose);
  } else if (unpitchedEl) {
    // Percussion: use display-step/display-octave as pitch
    const step = childText(unpitchedEl, "display-step") ?? "C";
    const octave = parseInt(childText(unpitchedEl, "display-octave") ?? "4", 10);
    note.pitch = { step, octave };
  }

  // Staff assignment for multi-staff parts
  const staffEl = findChild(noteEl, "staff");
  if (staffEl) {
    const staffNum = parseInt(staffEl.textContent ?? "1", 10);
    if (staffNum > 1) note.staff = staffNum;
  }

  // Accidental display
  const accidental = findChild(noteEl, "accidental");
  if (accidental) {
    const accText = accidental.textContent ?? "";
    if (accText in ACCIDENTAL_MAP) {
      note.accidentalDisplay = { show: true };
    }
  }

  // Ties
  const tieEls = findChildren(noteEl, "tie");
  const tieStart = tieEls.some((t) => t.getAttribute("type") === "start");
  const tieStop = tieEls.some((t) => t.getAttribute("type") === "stop");

  // <tied> in <notations> carries the engraving placement (`above|below`).
  // Map to MNX `tie.side: "up" | "down"` (matches SlurTieSide enum).
  // `<tied type="let-ring">` (laissez-vibrer) maps to MNX `tie.lv = true` —
  // a ring-out tie with no target.
  let tieSide: "up" | "down" | undefined;
  let tieLv = false;
  for (const tied of notationChildren(noteEl, "tied")) {
    const tType = tied.getAttribute("type");
    if (tType === "let-ring") {
      tieLv = true;
      continue;
    }
    if (tType !== "start") continue;
    const placement = tied.getAttribute("placement");
    if (placement === "above") tieSide = "up";
    else if (placement === "below") tieSide = "down";
  }

  const tieSourceEl = pitchEl ?? unpitchedEl;
  if (tieSourceEl) {
    const step = childText(tieSourceEl, pitchEl ? "step" : "display-step") ?? "";
    const octave = childText(tieSourceEl, pitchEl ? "octave" : "display-octave") ?? "";
    // Include the alteration in the pairing key: a tie connects two identical
    // pitches, so E♭4 and E♮4 in the same chord/voice must not collide (a bare
    // step:octave key would let the second tie-start overwrite the first,
    // orphaning it). Alteration is read raw (pre-transposition), consistent for
    // both the start and stop note.
    const alter = childText(tieSourceEl, pitchEl ? "alter" : "display-alter") ?? "";
    const noteKey = `${voiceNum}:${step}:${alter}:${octave}`;

    if (tieStop && tieIds.has(noteKey)) {
      note.id = tieIds.get(noteKey)!.target!;
      tieIds.delete(noteKey);
    }
    if (tieStart) {
      // If a tie for this pitch is already open, the earlier start never found
      // a stop — it's an orphan. Reinterpret it as laissez-vibrer now, before
      // this new start overwrites the map slot, so it doesn't dangle.
      const stale = tieIds.get(noteKey);
      if (stale) {
        delete stale.target;
        stale.lv = true;
      }
      const targetId = ids.next("n");
      const tie: MnxTie & { side?: "up" | "down" } = { target: targetId };
      if (tieSide) tie.side = tieSide;
      note.ties = [tie];
      tieIds.set(noteKey, tie);
    }
    // `lv` ties have no target — they sit on a single note and indicate the
    // pitch should ring out. They can co-exist with playback `<tie>` markers
    // (which we already consumed above), so emit standalone if no start tie.
    if (tieLv && !tieStart) {
      note.ties = [...(note.ties ?? []), { lv: true } as { lv: true }];
    }
  }

  // Notehead shape (`<notehead>x</notehead>`, etc.). Only meaningful for
  // percussion conversion, which maps it onto the kit-component; carried raw
  // so the mapping lives next to the rest of the kit logic.
  const noteheadEl = findChild(noteEl, "notehead");
  if (noteheadEl) {
    const shape = (noteheadEl.textContent ?? "").trim().toLowerCase();
    if (shape) note.notehead = shape;
  }

  return note;
}

// eslint-disable-next-line max-statements, complexity -- branchy traversal of MusicXML notations grammar (articulations/ornaments/technical/arpeggiate); splitting per child kind would obscure the iteration
export function extractMarkings(noteEl: Element, vendorExt: boolean): MnxEventMarkings | undefined {
  if (findChildren(noteEl, "notations").length === 0) return undefined;

  const markings: MnxEventMarkings = {};
  let hasMarkings = false;

  // Articulations. MusicXML permits multiple sibling <notations> blocks on a
  // single note, each with its own <articulations> (e.g. an accent in one
  // block and a caesura in another — common when a caesura falls mid-measure).
  // Iterate every block so markings split across blocks aren't silently dropped.
  for (const articulationsEl of notationChildren(noteEl, "articulations")) {
    for (const art of childElements(articulationsEl)) {
      const mnxKey = ARTICULATION_MAP[art.tagName];
      if (mnxKey) {
        hasMarkings = true;
        if (mnxKey === "strongAccent") {
          const pointing = art.getAttribute("type") === "down" ? "down" : "up";
          (markings as Record<string, unknown>)[mnxKey] = { pointing };
        } else {
          (markings as Record<string, unknown>)[mnxKey] = {};
        }
      } else if (art.tagName === "caesura") {
        // caesura → vendor extension (only if enabled)
        if (vendorExt) {
          hasMarkings = true;
          if (!markings._x) markings._x = { viritura: {} };
          markings._x.viritura["caesura"] = {};
        }
      }
    }
  }

  // Ornaments
  const ornamentsEl = notationChild(noteEl, "ornaments");
  if (ornamentsEl) {
    for (const orn of childElements(ornamentsEl)) {
      if (orn.tagName === "tremolo") {
        const tremType = orn.getAttribute("type") ?? "single";
        const tremMarks = parseInt(orn.textContent ?? "3", 10);
        if (tremType === "single") {
          hasMarkings = true;
          markings.tremolo = { marks: tremMarks };
        }
        // Multi-note tremolos (type="start"/"stop") are converted structurally
        // into an MNX `tremolo` sequence-content container (see measureNotes),
        // not as per-event markings.
      } else if (orn.tagName === "trill-mark") {
        // Ornaments not in MNX spec → vendor extension (only if enabled)
        if (vendorExt) {
          hasMarkings = true;
          if (!markings._x) markings._x = { viritura: {} };
          markings._x.viritura["trill"] = {};
        }
      } else if (orn.tagName === "accidental-mark") {
        // An <accidental-mark> inside <ornaments> qualifies the preceding
        // ornament's auxiliary note (e.g. a flat trill). MusicXML places it as
        // a sibling after the <trill-mark>; fold it onto the trill we just
        // emitted so the auxiliary accidental renders above the tr symbol.
        if (vendorExt && markings._x?.viritura["trill"]) {
          const accidental = ACCIDENTAL_MARK_ALTER[orn.textContent?.trim() ?? ""];
          if (accidental !== undefined) {
            (markings._x.viritura["trill"] as { accidental?: number }).accidental = accidental;
          }
        }
      } else {
        const ornamentMap: Record<string, string> = {
          mordent: "mordent",
          "inverted-mordent": "invertedMordent",
          turn: "turn",
          "delayed-turn": "delayedTurn",
          "inverted-turn": "invertedTurn",
        };
        const ornament = ornamentMap[orn.tagName];
        if (ornament && vendorExt) {
          hasMarkings = true;
          if (!markings._x) markings._x = { viritura: {} };
          const viritura = markings._x.viritura as Record<string, unknown>;
          const existing = Array.isArray(viritura["ornaments"]) ? (viritura["ornaments"] as string[]) : [];
          viritura["ornaments"] = [...existing, ornament];
        }
      }
    }
  }

  // Fingerings (from <technical><fingering>)
  const technicalEl = notationChild(noteEl, "technical");
  if (technicalEl && vendorExt) {
    const fingeringEl = findChild(technicalEl, "fingering");
    if (fingeringEl) {
      const fingerVal = fingeringEl.textContent?.trim() ?? "";
      const finger = Number.parseInt(fingerVal, 10);
      if (Number.isInteger(finger) && finger >= 0 && finger <= 5) {
        hasMarkings = true;
        if (!markings._x) markings._x = { viritura: {} };
        markings._x.viritura["fingerings"] = [{ finger }];
      }
    }
  }

  // Bow direction (MusicXML <up-bow/> / <down-bow/> in <technical>) →
  // MNX `bowDirection { direction }`. Native MNX v15, not a vendor extension.
  if (technicalEl) {
    if (findChild(technicalEl, "up-bow")) {
      hasMarkings = true;
      (markings as Record<string, unknown>)["bowDirection"] = { direction: "up" };
    } else if (findChild(technicalEl, "down-bow")) {
      hasMarkings = true;
      (markings as Record<string, unknown>)["bowDirection"] = { direction: "down" };
    }
  }

  // Arpeggiate. MusicXML <arpeggiate> on a note's <notations> maps to the
  // event-level `_x.viritura.arpeggio` marking that both the format parser and
  // the engine consume (the field is "arpeggio", not "arpeggiate"). The engine
  // spans the whole chord from the event's notes, so no explicit span is
  // needed here. `direction` ("up"/"down") is carried through when present.
  const arpEl = notationChild(noteEl, "arpeggiate");
  if (arpEl && vendorExt) {
    hasMarkings = true;
    if (!markings._x) markings._x = { viritura: {} };
    const direction = arpEl.getAttribute("direction");
    markings._x.viritura["arpeggio"] = direction ? { direction } : {};
  }

  return hasMarkings ? markings : undefined;
}

/** Extract native MNX fermata (event-level since v15) from a <note>'s <notations>. */
export function extractFermata(noteEl: Element): { orient?: "above" | "below" } | undefined {
  const fermataEl = notationChild(noteEl, "fermata");
  if (!fermataEl) return undefined;
  const fermataType = fermataEl.getAttribute("type") ?? "upright";
  const fermata: { orient?: "above" | "below" } = {};
  if (fermataType === "inverted") fermata.orient = "below";
  return fermata;
}

export function extractSlurs(
  noteEl: Element,
  eventId: string,
  noteId: string | undefined,
  openSlurs: Map<string, SlurState>,
  ids: IdGenerator,
  pendingSlurEndIds: Map<string, string>,
): MnxSlur[] | undefined {
  const slurEls = notationChildren(noteEl, "slur");
  if (slurEls.length === 0) return undefined;

  const slurs: MnxSlur[] = [];

  for (const slurEl of slurEls) {
    const type = slurEl.getAttribute("type");
    const num = slurEl.getAttribute("number") ?? "1";
    const placement = slurEl.getAttribute("placement");

    if (type === "start") {
      // Generate a target ID that the end event will be assigned
      const targetId = ids.next("slur-end");
      openSlurs.set(num, { startEventId: eventId, startNoteId: noteId, number: num, targetId });

      const slur: MnxSlur = { target: targetId };
      if (placement === "above") slur.side = "up";
      else if (placement === "below") slur.side = "down";
      if (noteId) slur.startNote = noteId;

      slurs.push(slur);
    } else if (type === "stop") {
      const state = openSlurs.get(num);
      if (state) {
        openSlurs.delete(num);
        // Store the target ID so the stop event gets this ID assigned
        pendingSlurEndIds.set(num, state.targetId);
      }
    }
  }

  return slurs.length > 0 ? slurs : undefined;
}

export function extractLyrics(noteEl: Element): Record<string, { text: string; type?: string }> | undefined {
  const lyricEls = findChildren(noteEl, "lyric");
  if (lyricEls.length === 0) return undefined;

  const lines: Record<string, { text: string; type?: string }> = {};
  let hasAny = false;

  for (const lyricEl of lyricEls) {
    const number = lyricEl.getAttribute("number") ?? lyricEl.getAttribute("name") ?? "1";
    const lineId = `line-${number}`;
    const textEl = findChild(lyricEl, "text");
    if (!textEl) continue;

    const text = textEl.textContent ?? "";
    const syllabic = childText(lyricEl, "syllabic");

    const entry: { text: string; type?: string } = { text };
    if (syllabic === "begin") entry.type = "start";
    else if (syllabic === "middle") entry.type = "middle";
    else if (syllabic === "end") entry.type = "end";
    else entry.type = "whole";

    // Handle elision (multiple syllables)
    const elisionEl = findChild(lyricEl, "elision");
    if (elisionEl) {
      const elisionText = elisionEl.textContent ?? " ";
      const nextTextEl = findChildren(lyricEl, "text");
      if (nextTextEl.length > 1) {
        entry.text = text + elisionText + (nextTextEl[1]!.textContent ?? "");
      }
    }

    lines[lineId] = entry;
    hasAny = true;
  }

  return hasAny ? lines : undefined;
}
