/**
 * Staff-local synchronous meters (`_x.viritura.staffMeters` on a part
 * measure).
 *
 * A staff-local meter lets one staff of a part notate its own time
 * signature while every staff's barlines stay locked to the shared global
 * measure grid — non-aligning/independent polymeter is explicitly out of
 * scope (see `docs/spec/viritura-extensions.md`).
 *
 * Two synchronization modes reconcile a staff-local meter's duration with
 * the global measure it shares a barline with:
 *
 * - `"sharedDuration"`: the staff-local measure duration must equal the
 *   global measure duration exactly (e.g. local 6/8 vs. global 3/4 — both
 *   six quarter-note-equivalent beats). Written note durations need no
 *   scaling.
 * - `"fitMeasure"`: one complete staff-local measure maps onto one complete
 *   global measure by a derived exact ratio (e.g. local 6/8 vs. global
 *   2/4 — two dotted-quarter pulses mapped onto two quarter-note pulses,
 *   ratio 2/3).
 *
 * {@link resolveStaffMeterChange} is the single-step algorithm; declarations
 * inherit until changed or reset, so {@link resolveStaffMeterTimeline} walks
 * an ordered run of part measures carrying that inherited state forward.
 * Mirrors the Rust engine's `model::staff_meter` module.
 */
import { measureBeats, resolveMeter, type TimeSignature } from "./time";

/** A staff-local meter distinct from the global meter. */
export interface StaffMeter {
  count: number;
  unit: number;
  /** Ordered beat-group lengths in units of `unit`. */
  beatStructure?: number[];
}

/**
 * How a staff-local meter's measure duration relates to the global measure
 * it shares a barline with.
 */
export type StaffMeterSynchronization = "sharedDuration" | "fitMeasure";

/** Establishes a staff-local meter from this part measure onward. */
export interface StaffMeterSet {
  staff: number;
  meter: StaffMeter;
  synchronization: StaffMeterSynchronization;
}

/** Resets a staff back to following the global meter. */
export interface StaffMeterReset {
  staff: number;
  useGlobal: true;
}

/**
 * One `_x.viritura.staffMeters[]` entry on a part measure: either sets a
 * staff-local meter and its synchronization mode, or resets the staff back
 * to the global meter. Effective from this measure onward until changed or
 * reset again.
 */
export type StaffMeterChange = StaffMeterSet | StaffMeterReset;

/** Narrows a {@link StaffMeterChange} to its reset variant. */
export function isStaffMeterReset(change: StaffMeterChange): change is StaffMeterReset {
  return "useGlobal" in change;
}

/** An exact rational ratio, kept as integers to avoid float precision loss. */
export interface RationalRatio {
  num: number;
  den: number;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function reduceRatio(num: number, den: number): RationalRatio {
  const divisor = gcd(Math.abs(num), Math.abs(den)) || 1;
  return { num: num / divisor, den: den / divisor };
}

/** Convert a {@link RationalRatio} to a floating-point multiplier. */
export function ratioToNumber(ratio: RationalRatio): number {
  return ratio.num / ratio.den;
}

/**
 * The resolved, currently-active staff-local meter for one staff at a given
 * point in the score (i.e. after applying the most recent `staffMeters`
 * declaration for that staff, inherited across measures until changed or
 * reset).
 */
export interface EffectiveStaffMeter {
  staff: number;
  /** The staff-local meter, expressed as a {@link TimeSignature} so callers
   *  can reuse `resolveMeter()`/`ResolvedMeter` directly. */
  timeSignature: TimeSignature;
  synchronization: StaffMeterSynchronization;
  /** Exact ratio of one global measure duration to one staff-local measure
   *  duration (`global / local`). `1/1` for `sharedDuration` (the two
   *  durations are required to be equal); the derived mapping ratio for
   *  `fitMeasure`. */
  ratioToGlobal: RationalRatio;
}

/** Thrown when a `staffMeters` entry cannot be resolved. */
export class StaffMeterValidationError extends RangeError {
  constructor(message: string) {
    super(message);
    this.name = "StaffMeterValidationError";
  }
}

function durationRatio(global: TimeSignature, local: TimeSignature): RationalRatio {
  // measure_beats() = count * 4 / unit, so the ratio's unit-4 factors
  // cancel: global/local = (global.count * local.unit) / (global.unit * local.count).
  return reduceRatio(global.count * local.unit, global.unit * local.count);
}

/**
 * Resolve one `staffMeters` entry (or inherited absence of one) against the
 * previously-effective state and the measure's effective global meter.
 *
 * An inherited meter (`change` is `undefined`) is not returned unchanged —
 * its authored local meter and synchronization mode are preserved, but the
 * ratio (and, for `sharedDuration`, the equal-duration validity check) are
 * re-derived against *this* measure's effective global meter. A global
 * meter change partway through an inherited `fitMeasure` or
 * `sharedDuration` run therefore updates every following measure's
 * `ratioToGlobal`/validity, not just the measure the declaration was
 * authored on.
 *
 * @throws {StaffMeterValidationError} when a `Set` change's meter is
 * malformed, or its (authored or inherited) `sharedDuration`
 * synchronization does not actually share the global measure's duration.
 * Callers that want lenient, best-effort resolution across many measures
 * should use {@link resolveStaffMeterTimeline}, which keeps the previous
 * effective state on error instead of throwing.
 */
export function resolveStaffMeterChange(
  previous: EffectiveStaffMeter | undefined,
  change: StaffMeterChange | undefined,
  global: TimeSignature,
): EffectiveStaffMeter | undefined {
  if (!change) {
    if (!previous) return undefined;
    return resolveLocalMeter(previous.staff, previous.timeSignature, previous.synchronization, global);
  }
  if (isStaffMeterReset(change)) return undefined;

  const localTs: TimeSignature = {
    count: change.meter.count,
    unit: change.meter.unit,
    ...(change.meter.beatStructure ? { beatStructure: change.meter.beatStructure } : {}),
  };
  return resolveLocalMeter(change.staff, localTs, change.synchronization, global);
}

/**
 * Validate a staff-local meter and derive its ratio against `global`. Shared
 * by a fresh `Set` declaration and by re-resolving an inherited meter each
 * measure — both must apply the exact same rules against whatever global
 * meter is currently in force.
 */
function resolveLocalMeter(
  staff: number,
  localTs: TimeSignature,
  synchronization: StaffMeterSynchronization,
  global: TimeSignature,
): EffectiveStaffMeter {
  try {
    // Validates count/unit and (if authored) that beatStructure sums to count.
    resolveMeter(localTs);
  } catch (error) {
    throw new StaffMeterValidationError(
      `invalid staff-local meter: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const localBeats = measureBeats(localTs);
  const globalBeats = measureBeats(global);
  if (synchronization === "sharedDuration" && Math.abs(localBeats - globalBeats) > 1e-9) {
    throw new StaffMeterValidationError(
      `sharedDuration requires equal measure durations: staff-local meter is ${localBeats} quarter-note beats, global measure is ${globalBeats}`,
    );
  }

  return {
    staff,
    timeSignature: localTs,
    synchronization,
    ratioToGlobal: durationRatio(global, localTs),
  };
}

function refreshRetainedMeter(
  previous: EffectiveStaffMeter | undefined,
  global: TimeSignature,
): EffectiveStaffMeter | undefined {
  if (!previous) return undefined;
  try {
    return resolveStaffMeterChange(previous, undefined, global);
  } catch {
    return previous;
  }
}

/** One measure/staff whose `staffMeters` declaration failed to resolve. */
export interface StaffMeterIssue {
  measureIndex: number;
  staff: number;
  error: StaffMeterValidationError;
}

/**
 * Walk an ordered run of a part's measures, applying `staffMeters`
 * declarations/resets in order and carrying inherited state forward.
 *
 * Returns one `Map<staff, EffectiveStaffMeter>` per measure (only staves
 * currently overridden are present; an absent staff follows the global
 * meter), plus every issue encountered. An invalid declaration is skipped —
 * the previously-effective state for that staff is kept — so a single bad
 * entry cannot corrupt every following measure. Every staff still under an
 * inherited (non-reset) declaration is also re-resolved against each
 * measure's own effective global meter, so a global meter change partway
 * through an inherited run updates `ratioToGlobal` (or surfaces a newly
 * broken `sharedDuration` equality) from that measure onward. Mirrors the
 * Rust engine's `resolve_staff_meter_table`.
 * If a rejected replacement coincides with a global meter change, the
 * retained declaration is re-resolved against that new global meter. When
 * the retained declaration is `sharedDuration` and is no longer valid, its
 * last valid effective value is kept and the authored replacement remains
 * the sole issue for that staff and measure.
 */
export function resolveStaffMeterTimeline(
  staffMetersPerMeasure: readonly (StaffMeterChange[] | undefined)[],
  globalTimeAtMeasure: readonly TimeSignature[],
): { table: Map<number, EffectiveStaffMeter>[]; issues: StaffMeterIssue[] } {
  const state = new Map<number, EffectiveStaffMeter>();
  const table: Map<number, EffectiveStaffMeter>[] = [];
  const issues: StaffMeterIssue[] = [];

  for (let measureIndex = 0; measureIndex < staffMetersPerMeasure.length; measureIndex++) {
    const changes = staffMetersPerMeasure[measureIndex];
    const global = globalTimeAtMeasure[measureIndex] ?? { count: 4, unit: 4 };
    const changedStaves = new Set<number>();

    if (changes) {
      for (const change of changes) {
        changedStaves.add(change.staff);
        const previous = state.get(change.staff);
        try {
          const effective = resolveStaffMeterChange(previous, change, global);
          if (effective) {
            state.set(change.staff, effective);
          } else {
            state.delete(change.staff);
          }
        } catch (error) {
          issues.push({
            measureIndex,
            staff: change.staff,
            error: error instanceof StaffMeterValidationError ? error : new StaffMeterValidationError(String(error)),
          });
          // The authored replacement was rejected, so the retained
          // declaration is still inherited at this measure. Re-resolve it
          // against the current global meter; if that also fails (possible
          // for sharedDuration), retain its last valid state without
          // reporting a second issue for the same staff and measure.
          const retained = refreshRetainedMeter(previous, global);
          if (retained) state.set(change.staff, retained);
        }
      }
    }

    // Re-resolve every other currently-active staff against this measure's
    // effective global meter: an inherited fitMeasure ratio (or
    // sharedDuration validity) depends on the global meter in force at THIS
    // measure, not the one in force when the declaration was authored. On
    // error, keep the previously-effective entry (lenient, matches the
    // fresh-declaration error path above) and surface the issue.
    for (const [staff, previous] of state) {
      if (changedStaves.has(staff)) continue;
      try {
        const effective = resolveStaffMeterChange(previous, undefined, global);
        if (effective) state.set(staff, effective);
      } catch (error) {
        issues.push({
          measureIndex,
          staff,
          error: error instanceof StaffMeterValidationError ? error : new StaffMeterValidationError(String(error)),
        });
      }
    }

    table.push(new Map(state));
  }

  return { table, issues };
}
