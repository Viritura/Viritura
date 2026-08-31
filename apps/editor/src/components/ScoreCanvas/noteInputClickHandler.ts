// Note-input click handler extracted from ScoreCanvas. Takes a click event
// (from the InputCursor) plus all the context it needs and mutates the score
// via the supplied actions. Kept as a plain function (no hook) — the
// component wraps it in a useCallback for stable identity.

import { toast } from "sonner";
import type { Clef, KeySignature, Pitch, Score } from "@viritura/core";
import { pitchToMidi } from "@viritura/core";
import type { DisplayList, SpatialIndex } from "@viritura/renderer";
import type { PlaybackActions } from "@viritura/playback";
import type { NoteInputClickInfo } from "../InputCursor";
import { partLocalStaffIndex } from "./hitTesting";
import type { CursorPosition, NoteInputState } from "../../store/noteInputStore";
import { computeSnappedBeat } from "../inputCursorHelpers";
import { pitchFromPosition, staffPositionFromY } from "../../input/pitchFromPosition";
import {
  isPercussionPart,
  kitComponentFromStaffPosition,
  kitComponentsAtStaffPosition,
  mnxStaffPositionFromPosFromTop,
  midiNumberForKitComponent,
} from "../../score/kitInput";
import {
  addNoteWithAutoTie,
  addSlur,
  addRest,
  addPitchToChord,
  addGraceNote,
  findLastNoteEvent,
  durationToBeats,
} from "../../commands/noteCommands";
import { resolveEntryPitch } from "../../commands/transposeCommands";
import { prevailingAlterationAtPosition } from "../../commands/accidentalCommands";
import { advanceCursorByNotatedDuration } from "../../commands/cursorCommands";
import {
  findCondensingStaff,
  getActiveLayoutId,
  resolveEditTargets,
  detectCondensingMode,
} from "../../score/condensingRouter";
import { cloneScore, produce } from "../../score/scoreClone";

export interface AddNoteAtClickArgs {
  info: NoteInputClickInfo;
  score: Score;
  noteInputState: NoteInputState;
  spatialIndex: SpatialIndex | null;
  displayList: DisplayList | null;
  selectedScoreIndex: number;
  updateScore: (score: Score) => void;
  setCursor: (cursor: CursorPosition) => void;
  setLastPitch: (pitch: Pitch) => void;
  setAccidental: (accidental: import("@viritura/core").AccidentalType | null) => void;
  setSlurStart: (eventId: string) => void;
  clearSlurStart: () => void;
  toggleSlur: () => void;
  playbackActions: PlaybackActions;
}

/**
 * Handle a click on the score surface while note input is active.
 * Determines the target staff/voice/measure/beat, resolves clef + key,
 * computes the pitch from the click Y, then mutates the score via the
 * appropriate add* command (note / rest / grace / chord pitch).
 *
 * Also routes through condensing-staff broadcast targets and previews the
 * note via the playback engine.
 */
// eslint-disable-next-line max-lines-per-function, max-statements, complexity -- click-to-edit pipeline: hit-test → staff/voice resolve → clef+key lookup → Y-to-pitch conversion → grace/chord/rest/note branch → condensed-staff broadcast targets → command dispatch → playback preview. Every step reads state produced by the previous one, so splitting forces a large args bundle to flow through each helper.
export function addNoteAtClick(args: AddNoteAtClickArgs): void {
  const {
    info,
    score,
    noteInputState,
    spatialIndex: si,
    displayList: dl,
    selectedScoreIndex,
    updateScore,
    setCursor,
    setLastPitch,
    setAccidental,
    setSlurStart,
    clearSlurStart,
    toggleSlur,
    playbackActions,
  } = args;

  if (!noteInputState.active) return;

  const clearExplicitAccidental = (): void => {
    if (!noteInputState.isRest && noteInputState.currentAccidental !== null) {
      setAccidental(null);
    }
  };

  const voice = noteInputState.currentVoice - 1; // 0-based voice within the staff

  // Determine partIndex from the clicked staff's Y position.
  // Match the staff Y against measure bounds to find which part it belongs to.
  let partIndex = 0;
  let clickedMbIsExpansion = false;
  // Global (system-wide) staff index of the matched measure-bounds row. Used to
  // recover the part-local staff number below — needed because both
  // `info.staff.index` and `MeasureBounds.staffIndex` count staves across the
  // whole system, while sequence `staff` properties are part-local.
  let clickedStaffIndexGlobal = info.staff.index ?? 0;
  if (dl?.measureBounds) {
    const staffY = info.staff.y;
    let bestDist = Infinity;
    for (const mb of dl.measureBounds) {
      const dist = Math.abs(mb.y - staffY);
      if (dist < bestDist) {
        bestDist = dist;
        partIndex = mb.partIndex;
        clickedStaffIndexGlobal = mb.staffIndex ?? clickedStaffIndexGlobal;
        clickedMbIsExpansion = !!mb.isExpansion;
      }
    }
    // Simpler fallback: use visual staff index as part index (works for non-grand-staff scores)
    if (bestDist === Infinity && info.staff.index !== undefined) {
      // In a full score, each visual staff typically maps to one part
      if (info.staff.index < score.parts.length) {
        partIndex = info.staff.index;
      }
    }
  } else if (info.staff.index !== undefined && info.staff.index < score.parts.length) {
    partIndex = info.staff.index;
  }
  const part = score.parts[partIndex];

  // Resolve the PART-LOCAL staff number (1-based) of the clicked staff.
  // `clickedStaffIndexGlobal` is a system-wide visual staff counter; rank it
  // among only this part's own staves (from measureBounds) to get the local
  // number. A single-staff part therefore always resolves to staff 1 no matter
  // where it sits in the system — without this, the grand-staff sequence lookup
  // below filtered on the wrong (global) number, found nothing, and wrote the
  // note to a phantom new voice instead of replacing the measure's rest.
  let clickedStaffNumber = 1;
  if (dl?.measureBounds) {
    clickedStaffNumber = partLocalStaffIndex(dl.measureBounds, partIndex, clickedStaffIndexGlobal) + 1;
  }

  // Determine the correct sequence index for this click.
  // For single-staff instruments: voice directly = sequence index.
  // For grand staff: each staff has its own set of sequences.
  //   Voice 1 on staff 1 = first sequence with staff=1
  //   Voice 2 on staff 1 = second sequence with staff=1 (or needs creating)
  //   Voice 1 on staff 2 = first sequence with staff=2
  let seqIndex = voice;

  if (part) {
    const firstMeasure = part.measures[0];
    if (firstMeasure) {
      const hasStaffProp = firstMeasure.sequences.some((s) => s.staff != null);
      if (hasStaffProp) {
        // Grand staff: find sequences belonging to this staff, pick the voice-th one
        const staffSeqs = firstMeasure.sequences
          .map((s, i) => ({ seq: s, idx: i }))
          .filter((s) => s.seq.staff === clickedStaffNumber);
        if (voice < staffSeqs.length) {
          seqIndex = staffSeqs[voice]!.idx;
        } else {
          // Voice doesn't exist yet — will be created at this index
          seqIndex = firstMeasure.sequences.length + (voice - staffSeqs.length);
        }
      }
      // else: single-staff, voice = sequence index (already set)
    }
  }

  // Build duration from note input state
  const duration = {
    base: noteInputState.currentDuration,
    ...(noteInputState.dotCount > 0 ? { dots: noteInputState.dotCount } : {}),
  };
  const noteBeats = durationToBeats(duration);

  // Use shared snapping logic to determine measure and beat position
  let measureIndex = 0;
  let beatPosition = 0;

  if (si) {
    // Alt key overrides snap resolution to 16th notes
    const effectiveDuration = info.altKey
      ? ("16th" as typeof noteInputState.currentDuration)
      : noteInputState.currentDuration;
    const effectiveDots = info.altKey ? (0 as typeof noteInputState.dotCount) : noteInputState.dotCount;
    const snapped = computeSnappedBeat(
      info.scoreX,
      info.scoreY,
      score,
      si,
      voice,
      effectiveDuration,
      effectiveDots,
      dl,
      partIndex,
    );
    if (snapped) {
      measureIndex = snapped.measureIndex;
      beatPosition = snapped.beat;
    } else {
      // Fallback: find measure from spatial index
      const nearestId = si.hitTest(info.scoreX, info.scoreY) ?? si.findNearest(info.scoreX, info.scoreY, 50);
      if (nearestId) {
        const mMatch = nearestId.match(/m(\d+)/);
        if (mMatch) measureIndex = parseInt(mMatch[1]!, 10);
      }
    }
  }

  // Resolve active clef for this measure and staff (walk backwards)
  let activeClef: Clef =
    clickedStaffNumber === 2
      ? { sign: "F", staffPosition: 2 } // default bass clef
      : { sign: "G", staffPosition: -2 }; // default treble clef
  if (part) {
    for (let m = measureIndex; m >= 0; m--) {
      const meas = part.measures[m];
      if (meas?.clefs && meas.clefs.length > 0) {
        // Find the clef for this specific staff number
        const staffClef = meas.clefs.find((c) => c.staff === clickedStaffNumber || c.staff == null);
        if (staffClef) {
          activeClef = staffClef.clef;
          break;
        }
      }
    }
  }

  // Resolve active key signature (walk backwards)
  let activeKey: KeySignature = { fifths: 0 };
  for (let m = measureIndex; m >= 0; m--) {
    const gm = score.global.measures[m];
    if (gm?.key) {
      activeKey = gm.key;
      break;
    }
  }

  // Convert accidental toolbar state to numeric override
  let accidentalOverride: number | undefined;
  if (noteInputState.currentAccidental === "sharp") accidentalOverride = 1;
  else if (noteInputState.currentAccidental === "flat") accidentalOverride = -1;
  else if (noteInputState.currentAccidental === "natural") accidentalOverride = 0;
  else if (noteInputState.currentAccidental === "double-sharp") accidentalOverride = 2;
  else if (noteInputState.currentAccidental === "double-flat") accidentalOverride = -2;

  // Compute pitch from click position
  const pitch = pitchFromPosition(
    info.scoreY,
    info.staff.y,
    info.staff.spatium,
    activeClef,
    activeKey,
    accidentalOverride,
  );

  // Percussion-input branch: if this part is an unpitched kit, the
  // clicked Y maps to a kit-component (not a pitch). We don't transpose,
  // and the playback preview uses the GM percussion key for that drum.
  const percussionPart = part && isPercussionPart(part) ? part : null;
  let kitComponentId: string | null = null;
  let clickedMnxPos: number | null = null;
  if (percussionPart) {
    const posFromTop = staffPositionFromY(info.scoreY, info.staff.y, info.staff.spatium);
    clickedMnxPos = mnxStaffPositionFromPosFromTop(posFromTop);
    kitComponentId = kitComponentFromStaffPosition(percussionPart, clickedMnxPos);
  }

  // The click gave us the WRITTEN pitch (visual position on the transposed
  // staff). `resolveEntryPitch` is the single source of truth (shared with the
  // keyboard entry path) for splitting that into the written pitch — used for
  // audio preview + octave memory — and the sounding pitch MNX stores. Skip
  // entirely for percussion parts (no pitch concept); they keep written ===
  // sounding so the kit-component placeholder pitch is preserved.
  let writtenPitch: Pitch = { ...pitch };
  if (!percussionPart) {
    let sounding = resolveEntryPitch(writtenPitch, score, partIndex, activeKey.fifths).sounding;
    if (noteInputState.currentAccidental === null) {
      const inheritedAlter = prevailingAlterationAtPosition(score, partIndex, measureIndex, beatPosition, sounding);
      const soundingDelta = inheritedAlter - (sounding.alter ?? 0);
      if (soundingDelta !== 0) {
        const adjustedWrittenAlter = (writtenPitch.alter ?? 0) + soundingDelta;
        writtenPitch = { ...writtenPitch };
        if (adjustedWrittenAlter === 0) delete writtenPitch.alter;
        else writtenPitch.alter = adjustedWrittenAlter;
        sounding = resolveEntryPitch(writtenPitch, score, partIndex, activeKey.fifths).sounding;
      }
    }
    pitch.step = sounding.step;
    pitch.octave = sounding.octave;
    if (sounding.alter !== undefined) pitch.alter = sounding.alter;
    else delete pitch.alter;
  }

  // Deep clone and mutate
  const newScore = cloneScore(score);

  // Play auditory feedback for the entered note. Percussion parts preview
  // the actual GM drum-key on channel 9 (via the part's kit + global.sounds
  // map) instead of the clicked pitch. For transposing instruments we preview
  // the WRITTEN pitch (what the user clicked on the transposed staff), matching
  // the keyboard entry path — so click and keyboard sound identical and the
  // feedback follows the instrument's transposition. (`writtenPitch` equals
  // `pitch` for concert-pitch/percussion parts, so this is a no-op there.)
  if (!noteInputState.isRest) {
    let previewMidi = pitchToMidi(writtenPitch);
    if (percussionPart && kitComponentId) {
      const drumMidi = midiNumberForKitComponent(percussionPart, score.global.sounds, kitComponentId);
      if (drumMidi !== null) previewMidi = drumMidi;
    }
    playbackActions.previewNote(previewMidi, partIndex, 80, 400);
  }

  // Check if this partIndex is on a condensing staff.
  // When the click landed on an expansion (ghost) staff, the user intends
  // to edit that single source — bypass the broadcast routing entirely.
  const layoutId = getActiveLayoutId(score, selectedScoreIndex);
  const condensingStaff = clickedMbIsExpansion ? null : findCondensingStaff(score, layoutId, partIndex);

  try {
    let insertedChordPitch = false;
    if (condensingStaff) {
      // Condensing staff: resolve edit targets based on routing mode.
      // Priority: explicit user routing > detected from current measure content.
      const effectiveMode =
        noteInputState.condensingRouting ?? detectCondensingMode(score, condensingStaff, measureIndex) ?? undefined;
      const targets = resolveEditTargets(effectiveMode, condensingStaff, voice);

      if (info.shiftKey) {
        // Chord entry on condensing staff: broadcast to all targets
        for (const target of targets) {
          const loc = findLastNoteEvent(newScore, target.partIndex, target.voice);
          if (loc) {
            addPitchToChord(newScore, {
              pitch,
              measureIndex: loc.measureIndex,
              partIndex: target.partIndex,
              voice: target.voice,
              eventIndex: loc.eventIndex,
              kitComponent: kitComponentId ?? undefined,
            });
            insertedChordPitch = true;
          }
        }
      } else if (noteInputState.isRest) {
        for (const target of targets) {
          addRest(newScore, {
            duration,
            measureIndex,
            partIndex: target.partIndex,
            voice: target.voice,
            beatPosition,
            staffNumber: clickedStaffNumber,
          });
        }
      } else if (noteInputState.currentGraceType) {
        for (const target of targets) {
          addGraceNote(newScore, {
            pitch,
            duration,
            measureIndex,
            partIndex: target.partIndex,
            voice: target.voice,
            beatPosition,
            slash: noteInputState.currentGraceType === "grace",
            kitComponent: kitComponentId ?? undefined,
          });
        }
        updateScore(newScore);
        setLastPitch(writtenPitch);
        clearExplicitAccidental();
        return;
      } else {
        let resultScore = newScore;
        for (const target of targets) {
          resultScore = addNoteWithAutoTie(resultScore, {
            pitch,
            duration,
            measureIndex,
            partIndex: target.partIndex,
            voice: target.voice,
            beatPosition,
            staffNumber: clickedStaffNumber,
            kitComponent: kitComponentId ?? undefined,
          });
        }
        updateScore(resultScore);
        setCursor(
          advanceCursorByNotatedDuration(
            resultScore,
            { measureIndex, beatPosition, partIndex, staffIndex: clickedStaffNumber - 1 },
            noteBeats,
            voice,
            1,
          ),
        );
        setLastPitch(writtenPitch);
        clearExplicitAccidental();
        return;
      }
      updateScore(newScore);
      if (insertedChordPitch) clearExplicitAccidental();
      setCursor(
        advanceCursorByNotatedDuration(
          newScore,
          { measureIndex, beatPosition, partIndex, staffIndex: clickedStaffNumber - 1 },
          noteBeats,
          voice,
          1,
        ),
      );
      return;
    }

    // Click on an existing event at this beat (non-condensed): add the new pitch
    // to that event's chord instead of overwriting it — provided the event's
    // duration matches the current note-input duration. If duration mismatches,
    // no-op (conservative behavior; user can change duration and click again).
    // Shift+Click and rest/grace modes keep their existing behavior.
    if (!info.shiftKey && !noteInputState.isRest && !noteInputState.currentGraceType) {
      const seq = newScore.parts[partIndex]?.measures[measureIndex]?.sequences[seqIndex];
      if (seq) {
        const ONSET_TOL = 0.005;
        let bp = 0;
        for (let i = 0; i < seq.content.length; i++) {
          const item = seq.content[i];
          if (!item) continue;
          if (item.type !== "event") {
            // Skip tuplets/tremolos for now (top-level events only).
            if (item.type === "tuplet" || item.type === "tremolo") {
              bp += durationToBeats(item.outer.duration) * item.outer.multiple;
            }
            continue;
          }
          const evBeats = durationToBeats(item.duration);
          if (Math.abs(bp - beatPosition) < ONSET_TOL) {
            // Percussion same-line cycling: when the clicked line hosts more
            // than one instrument (distinguished only by notehead) and a
            // kit-note already sits here, advance to the next instrument on
            // that line — so a side-stick sharing the snare line is reachable
            // by re-clicking, with no mode or pre-selection. Its notehead
            // follows automatically (notehead is a kit-component property).
            if (percussionPart && clickedMnxPos !== null && item.kitNotes && item.kitNotes.length === 1) {
              const sharing = kitComponentsAtStaffPosition(percussionPart, clickedMnxPos);
              const cur = item.kitNotes[0]!.kitComponent;
              if (sharing.length > 1 && sharing.includes(cur)) {
                const next = sharing[(sharing.indexOf(cur) + 1) % sharing.length]!;
                item.kitNotes[0]!.kitComponent = next;
                updateScore(newScore);
                if (!noteInputState.isRest) {
                  const drumMidi = midiNumberForKitComponent(percussionPart, score.global.sounds, next);
                  if (drumMidi !== null) playbackActions.previewNote(drumMidi, partIndex, 80, 400);
                }
                return;
              }
            }
            // Found an event at this exact beat.
            const isNote = !!(item.notes && item.notes.length > 0);
            if (!isNote) break; // rest at this beat → fall through to default add flow
            const sameDur = item.duration.base === duration.base && (item.duration.dots ?? 0) === (duration.dots ?? 0);
            if (!sameDur) {
              // Duration mismatch — no-op rather than overwrite.
              return;
            }
            // Duration matches → add pitch to this chord (addPitchToChord
            // skips duplicates internally).
            addPitchToChord(newScore, {
              pitch,
              measureIndex,
              partIndex,
              voice: seqIndex,
              eventIndex: i,
              kitComponent: kitComponentId ?? undefined,
            });
            updateScore(newScore);
            setLastPitch(writtenPitch);
            clearExplicitAccidental();
            return;
          }
          if (bp > beatPosition + ONSET_TOL) break;
          bp += evBeats;
        }
      }
    }

    if (info.shiftKey) {
      // Shift+Click: add pitch to last entered event (chord entry)
      const loc = findLastNoteEvent(newScore, partIndex, seqIndex);
      if (loc) {
        addPitchToChord(newScore, {
          pitch,
          measureIndex: loc.measureIndex,
          partIndex,
          voice: seqIndex,
          eventIndex: loc.eventIndex,
          kitComponent: kitComponentId ?? undefined,
        });
        insertedChordPitch = true;
      }
    } else if (noteInputState.isRest) {
      addRest(newScore, {
        duration,
        measureIndex,
        partIndex,
        voice: seqIndex,
        beatPosition,
        staffNumber: clickedStaffNumber,
      });
    } else if (noteInputState.currentGraceType) {
      addGraceNote(newScore, {
        pitch,
        duration,
        measureIndex,
        partIndex,
        voice: seqIndex,
        beatPosition,
        slash: noteInputState.currentGraceType === "grace",
        kitComponent: kitComponentId ?? undefined,
      });
      updateScore(newScore);
      setLastPitch(writtenPitch);
      clearExplicitAccidental();
      return;
    } else {
      let resultScore = addNoteWithAutoTie(newScore, {
        pitch,
        duration,
        measureIndex,
        partIndex,
        voice: seqIndex,
        beatPosition,
        staffNumber: clickedStaffNumber,
        kitComponent: kitComponentId ?? undefined,
      });

      // If tie mode is active, add a tie to the just-added note
      if (noteInputState.tieActive) {
        const seq = resultScore.parts[partIndex]?.measures[measureIndex]?.sequences[seqIndex];
        if (seq) {
          // Find the last note event (the one we just added) — search inside tuplets too
          outer: for (let i = seq.content.length - 1; i >= 0; i--) {
            const item = seq.content[i];
            if (item && item.type === "tuplet") {
              for (let j = item.content.length - 1; j >= 0; j--) {
                const ev = item.content[j];
                if (ev && ev.type === "event" && ev.notes && ev.notes.length > 0) {
                  for (const note of ev.notes) {
                    note.ties = [{}];
                  }
                  break outer;
                }
              }
            } else if (item && item.type === "event" && item.notes && item.notes.length > 0) {
              for (const note of item.notes) {
                note.ties = [{}];
              }
              break;
            }
          }
        }
      }

      // Slur entry: two-step process (start → end)
      if (noteInputState.slurActive) {
        // Find the just-added event's ID — search inside tuplets too
        const seq = resultScore.parts[partIndex]?.measures[measureIndex]?.sequences[seqIndex];
        let newEventId: string | undefined;
        if (seq) {
          outer: for (let i = seq.content.length - 1; i >= 0; i--) {
            const item = seq.content[i];
            if (item && item.type === "tuplet") {
              for (let j = item.content.length - 1; j >= 0; j--) {
                const ev = item.content[j];
                if (ev && ev.type === "event" && ev.notes && ev.notes.length > 0 && ev.id) {
                  newEventId = ev.id;
                  break outer;
                }
              }
            } else if (item && item.type === "event" && item.notes && item.notes.length > 0 && item.id) {
              newEventId = item.id;
              break;
            }
          }
        }

        if (newEventId) {
          if (noteInputState.slurStartEventId) {
            // Second note: complete the slur
            resultScore = produce(resultScore, (draft) => {
              addSlur(draft, {
                sourceEventId: noteInputState.slurStartEventId!,
                targetEventId: newEventId,
              });
            });
            clearSlurStart();
            toggleSlur(); // auto-deactivate slur mode
          } else {
            // First note: remember as slur start
            setSlurStart(newEventId);
          }
        }
      }

      updateScore(resultScore);
      setCursor(
        advanceCursorByNotatedDuration(
          resultScore,
          { measureIndex, beatPosition, partIndex, staffIndex: clickedStaffNumber - 1 },
          noteBeats,
          voice,
          1,
        ),
      );
      setLastPitch(writtenPitch);
      clearExplicitAccidental();
      return;
    }
    updateScore(newScore);
    if (insertedChordPitch) clearExplicitAccidental();
    setCursor(
      advanceCursorByNotatedDuration(
        newScore,
        { measureIndex, beatPosition, partIndex, staffIndex: clickedStaffNumber - 1 },
        noteBeats,
        voice,
        1,
      ),
    );
  } catch (err) {
    console.error("Failed to add note:", err);
    toast.error("Failed to add note");
  }
}
