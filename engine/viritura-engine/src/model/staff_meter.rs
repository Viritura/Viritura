//! Staff-local synchronous meters (`_x.viritura.staffMeters` on a part
//! measure).
//!
//! A staff-local meter lets one staff of a part notate its own time
//! signature while every staff's barlines stay locked to the shared global
//! measure grid — non-aligning/independent polymeter is explicitly out of
//! scope (see `docs/spec/viritura-extensions.md`).
//!
//! Two synchronization modes reconcile a staff-local meter's duration with
//! the global measure it shares a barline with:
//!
//! - [`StaffMeterSynchronization::SharedDuration`]: the staff-local measure
//!   duration must equal the global measure duration exactly (e.g. local
//!   6/8 vs. global 3/4 — both six quarter-note-equivalent beats). Written
//!   note durations need no scaling.
//! - [`StaffMeterSynchronization::FitMeasure`]: one complete staff-local
//!   measure maps onto one complete global measure by a derived exact
//!   ratio (e.g. local 6/8 vs. global 2/4 — two dotted-quarter pulses mapped
//!   onto two quarter-note pulses, ratio 2/3).
//!
//! [`resolve_staff_meter_change`] is the single-step algorithm; declarations
//! inherit until changed or reset, so [`resolve_staff_meter_table`] walks an
//! ordered run of part measures carrying that inherited state forward.

use std::collections::{HashMap, HashSet};
use std::fmt;

use super::measure::PartMeasure;
use super::time::{BeatStructureError, TimeSignature};
use serde::{Deserialize, Serialize};

/// A staff-local meter distinct from the global meter. Structurally
/// identical to a time signature but never itself engraved as the global
/// meter and never establishing another staff's duration.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StaffMeter {
    pub count: u32,
    pub unit: u32,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        rename = "beatStructure"
    )]
    pub beat_structure: Option<Vec<u32>>,
}

impl StaffMeter {
    /// View this staff-local meter as an ordinary [`TimeSignature`] so it can
    /// reuse `resolve_meter()`/`ResolvedMeter` machinery unchanged.
    #[must_use]
    pub fn as_time_signature(&self) -> TimeSignature {
        TimeSignature {
            count: self.count,
            unit: self.unit,
            display: None,
            beat_structure: self.beat_structure.clone(),
            grouping_display: None,
        }
    }
}

/// How a staff-local meter's measure duration relates to the global measure
/// it shares a barline with.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum StaffMeterSynchronization {
    #[serde(rename = "sharedDuration")]
    SharedDuration,
    #[serde(rename = "fitMeasure")]
    FitMeasure,
}

/// One `_x.viritura.staffMeters[]` entry on a part measure: either
/// establishes a staff-local meter, or resets the staff back to following
/// the global meter. Effective from this measure onward until changed or
/// reset again.
///
/// This model-layer representation is an idiomatic Rust enum for internal
/// engine use (reconcile/layout/beaming), distinct from the wire-shaped
/// `raw_viritura::StaffMeterChange` union promoted from `_x.viritura`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum StaffMeterChange {
    Set {
        staff: u32,
        meter: StaffMeter,
        synchronization: StaffMeterSynchronization,
    },
    Reset {
        staff: u32,
    },
}

impl StaffMeterChange {
    #[must_use]
    pub fn staff(&self) -> u32 {
        match self {
            Self::Set { staff, .. } | Self::Reset { staff } => *staff,
        }
    }
}

/// An exact rational number, kept unreduced-safe via `u64` arithmetic so
/// duration ratios never lose precision to floating point.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Fraction {
    pub num: u64,
    pub den: u64,
}

impl Fraction {
    #[must_use]
    pub fn new(num: u64, den: u64) -> Self {
        let g = gcd(num, den).max(1);
        Self {
            num: num / g,
            den: den / g,
        }
    }

    #[must_use]
    pub fn as_f64(&self) -> f64 {
        self.num as f64 / self.den as f64
    }
}

fn gcd(a: u64, b: u64) -> u64 {
    if b == 0 {
        a
    } else {
        gcd(b, a % b)
    }
}

/// The resolved, currently-active staff-local meter for one staff at a given
/// point in the score (i.e. after applying the most recent `staffMeters`
/// declaration for that staff, inherited across measures until changed or
/// reset).
#[derive(Debug, Clone, PartialEq)]
pub struct EffectiveStaffMeter {
    pub staff: u32,
    /// The staff-local meter, expressed as an ordinary [`TimeSignature`] so
    /// callers can reuse `resolve_meter()`/`ResolvedMeter` directly.
    pub time_signature: TimeSignature,
    pub synchronization: StaffMeterSynchronization,
    /// Exact ratio of one global measure duration to one staff-local measure
    /// duration (`global / local`). `1/1` for `SharedDuration` (the two
    /// durations are required to be equal); the derived mapping ratio for
    /// `FitMeasure`.
    pub ratio_to_global: Fraction,
}

/// Failure resolving a single `staffMeters` entry.
#[derive(Debug, Clone, PartialEq)]
pub enum StaffMeterError {
    /// The staff-local meter itself is invalid (bad count/unit or
    /// beatStructure that doesn't sum to count).
    InvalidMeter(BeatStructureError),
    /// `sharedDuration` was declared but the staff-local measure duration
    /// does not equal the global measure duration.
    SharedDurationMismatch { local_beats: f64, global_beats: f64 },
}

impl fmt::Display for StaffMeterError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidMeter(e) => write!(f, "invalid staff-local meter: {e}"),
            Self::SharedDurationMismatch {
                local_beats,
                global_beats,
            } => write!(
                f,
                "sharedDuration requires equal measure durations: staff-local meter is {local_beats} quarter-note beats, global measure is {global_beats}"
            ),
        }
    }
}

impl std::error::Error for StaffMeterError {}

/// Compute the exact global/local measure-duration ratio from each meter's
/// count/unit, reduced to lowest terms.
fn duration_ratio(global: &TimeSignature, local: &TimeSignature) -> Fraction {
    // measure_beats() = count * 4 / unit, so the ratio's unit-4 factors
    // cancel: global/local = (global.count * local.unit) / (global.unit * local.count).
    Fraction::new(
        u64::from(global.count) * u64::from(local.unit),
        u64::from(global.unit) * u64::from(local.count),
    )
}

/// Resolve one `staffMeters` entry (or inherited absence of one) against the
/// previously-effective state and the measure's effective global meter.
///
/// An inherited meter (`change` is `None`) is not returned unchanged — its
/// authored local meter and synchronization mode are preserved, but the
/// ratio (and, for `SharedDuration`, the equal-duration validity check) are
/// re-derived against *this* measure's effective global meter. A global
/// meter change partway through an inherited `FitMeasure` or
/// `SharedDuration` run therefore updates every following measure's
/// `ratio_to_global`/validity, not just the measure the declaration was
/// authored on.
///
/// # Errors
///
/// Returns [`StaffMeterError`] when a `Set` change's meter is malformed, or
/// its (authored or inherited) `SharedDuration` synchronization does not
/// actually share the global measure's duration. On error, callers should
/// keep the previous effective state (see [`resolve_staff_meter_table`]).
pub fn resolve_staff_meter_change(
    previous: Option<&EffectiveStaffMeter>,
    change: Option<&StaffMeterChange>,
    global: &TimeSignature,
) -> Result<Option<EffectiveStaffMeter>, StaffMeterError> {
    match change {
        None => match previous {
            None => Ok(None),
            Some(effective) => resolve_local_meter(
                effective.staff,
                effective.time_signature.clone(),
                effective.synchronization,
                global,
            )
            .map(Some),
        },
        Some(StaffMeterChange::Reset { .. }) => Ok(None),
        Some(StaffMeterChange::Set {
            staff,
            meter,
            synchronization,
        }) => resolve_local_meter(*staff, meter.as_time_signature(), *synchronization, global)
            .map(Some),
    }
}

/// Validate a staff-local meter and derive its ratio against `global`.
/// Shared by a fresh `Set` declaration and by re-resolving an inherited
/// meter each measure — both must apply the exact same rules against
/// whatever global meter is currently in force.
fn resolve_local_meter(
    staff: u32,
    local_ts: TimeSignature,
    synchronization: StaffMeterSynchronization,
    global: &TimeSignature,
) -> Result<EffectiveStaffMeter, StaffMeterError> {
    local_ts
        .resolve_meter()
        .map_err(StaffMeterError::InvalidMeter)?;
    let local_beats = local_ts.measure_beats();
    let global_beats = global.measure_beats();
    if synchronization == StaffMeterSynchronization::SharedDuration
        && (local_beats - global_beats).abs() > 1e-9
    {
        return Err(StaffMeterError::SharedDurationMismatch {
            local_beats,
            global_beats,
        });
    }
    Ok(EffectiveStaffMeter {
        staff,
        ratio_to_global: duration_ratio(global, &local_ts),
        time_signature: local_ts,
        synchronization,
    })
}

/// One measure/staff whose `staffMeters` declaration failed to resolve.
/// Reported by [`resolve_staff_meter_table`] for surfacing to callers that
/// want strict diagnostics (the table itself stays lenient and keeps the
/// previously-effective state so layout never panics on invalid input).
#[derive(Debug, Clone, PartialEq)]
pub struct StaffMeterIssue {
    pub measure_index: usize,
    pub staff: u32,
    pub error: StaffMeterError,
}

/// Walk an ordered run of a part's measures, applying `staffMeters`
/// declarations/resets in order and carrying inherited state forward.
///
/// Returns one `HashMap<staff, EffectiveStaffMeter>` per measure (only
/// staves currently overridden are present; an absent staff follows the
/// global meter), plus every issue encountered. An invalid declaration is
/// skipped — the previously-effective state for that staff is kept — so a
/// single bad entry cannot corrupt every following measure. Every staff
/// still under an inherited (non-reset) declaration is also re-resolved
/// against each measure's own effective global meter, so a global meter
/// change partway through an inherited run updates `ratio_to_global` (or
/// surfaces a newly broken `SharedDuration` equality) from that measure
/// onward. When a rejected replacement coincides with a global meter change,
/// the retained declaration is re-resolved too. If that retained
/// `SharedDuration` declaration is no longer valid, its last valid effective
/// value is kept and the authored replacement remains the sole issue for that
/// staff and measure.
#[must_use]
pub fn resolve_staff_meter_table(
    part_measures: &[PartMeasure],
    global_time_at: &[TimeSignature],
) -> (Vec<HashMap<u32, EffectiveStaffMeter>>, Vec<StaffMeterIssue>) {
    let mut state: HashMap<u32, EffectiveStaffMeter> = HashMap::new();
    let mut table = Vec::with_capacity(part_measures.len());
    let mut issues = Vec::new();

    for (measure_index, pm) in part_measures.iter().enumerate() {
        let global = global_time_at
            .get(measure_index)
            .cloned()
            .unwrap_or_default();
        let mut changed_staves: HashSet<u32> = HashSet::new();

        if let Some(changes) = pm.staff_meters.as_ref() {
            for change in changes {
                let staff = change.staff();
                changed_staves.insert(staff);
                let previous = state.get(&staff).cloned();
                match resolve_staff_meter_change(previous.as_ref(), Some(change), &global) {
                    Ok(Some(effective)) => {
                        state.insert(staff, effective);
                    }
                    Ok(None) => {
                        state.remove(&staff);
                    }
                    Err(error) => {
                        issues.push(StaffMeterIssue {
                            measure_index,
                            staff,
                            error,
                        });
                        // A rejected replacement leaves the previous
                        // declaration inherited at this measure. Refresh it
                        // against the current global meter. If that inherited
                        // sharedDuration state is also invalid, retain its last
                        // valid value without emitting a duplicate issue.
                        if let Ok(Some(effective)) =
                            resolve_staff_meter_change(previous.as_ref(), None, &global)
                        {
                            state.insert(staff, effective);
                        }
                    }
                }
            }
        }

        // Re-resolve every other currently-active staff against this
        // measure's effective global meter: an inherited fitMeasure ratio
        // (or sharedDuration validity) depends on the global meter in force
        // at THIS measure, not the one in force when the declaration was
        // authored. On error, keep the previously-effective entry (lenient,
        // matches the fresh-declaration error path above) and surface the
        // issue.
        let staves_to_refresh: Vec<u32> = state
            .keys()
            .copied()
            .filter(|staff| !changed_staves.contains(staff))
            .collect();
        for staff in staves_to_refresh {
            let previous = state.get(&staff).cloned();
            match resolve_staff_meter_change(previous.as_ref(), None, &global) {
                Ok(Some(effective)) => {
                    state.insert(staff, effective);
                }
                Ok(None) => {
                    // Unreachable: `previous` is `Some`, so `None` change
                    // always resolves to `Some`. Keep state untouched.
                }
                Err(error) => issues.push(StaffMeterIssue {
                    measure_index,
                    staff,
                    error,
                }),
            }
        }

        table.push(state.clone());
    }

    (table, issues)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ts(count: u32, unit: u32) -> TimeSignature {
        TimeSignature {
            count,
            unit,
            display: None,
            beat_structure: None,
            grouping_display: None,
        }
    }

    fn staff_meter(count: u32, unit: u32) -> StaffMeter {
        StaffMeter {
            count,
            unit,
            beat_structure: None,
        }
    }

    #[test]
    fn shared_duration_accepts_equal_measure_durations() {
        let global = ts(3, 4);
        let change = StaffMeterChange::Set {
            staff: 1,
            meter: staff_meter(6, 8),
            synchronization: StaffMeterSynchronization::SharedDuration,
        };
        let resolved = resolve_staff_meter_change(None, Some(&change), &global)
            .expect("6/8 and 3/4 share a duration");
        let effective = resolved.expect("Set produces an effective meter");
        assert_eq!(effective.ratio_to_global, Fraction::new(1, 1));
    }

    #[test]
    fn shared_duration_rejects_unequal_measure_durations() {
        let global = ts(4, 4);
        let change = StaffMeterChange::Set {
            staff: 1,
            meter: staff_meter(6, 8),
            synchronization: StaffMeterSynchronization::SharedDuration,
        };
        let error = resolve_staff_meter_change(None, Some(&change), &global)
            .expect_err("6/8 (3 beats) vs 4/4 (4 beats) must not share a duration");
        assert!(matches!(
            error,
            StaffMeterError::SharedDurationMismatch { .. }
        ));
    }

    #[test]
    fn fit_measure_derives_exact_ratio() {
        // Local 6/8 (2 dotted-quarter pulses = 3 quarter-note beats) onto
        // global 2/4 (2 quarter-note beats): ratio 2/3.
        let global = ts(2, 4);
        let change = StaffMeterChange::Set {
            staff: 2,
            meter: staff_meter(6, 8),
            synchronization: StaffMeterSynchronization::FitMeasure,
        };
        let effective = resolve_staff_meter_change(None, Some(&change), &global)
            .unwrap()
            .unwrap();
        assert_eq!(effective.ratio_to_global, Fraction::new(2, 3));
    }

    #[test]
    fn fit_measure_12_8_over_4_4_is_two_thirds() {
        let global = ts(4, 4);
        let change = StaffMeterChange::Set {
            staff: 1,
            meter: staff_meter(12, 8),
            synchronization: StaffMeterSynchronization::FitMeasure,
        };
        let effective = resolve_staff_meter_change(None, Some(&change), &global)
            .unwrap()
            .unwrap();
        assert_eq!(effective.ratio_to_global, Fraction::new(2, 3));
    }

    #[test]
    fn reset_clears_inherited_state() {
        let global = ts(4, 4);
        let previous = resolve_staff_meter_change(
            None,
            Some(&StaffMeterChange::Set {
                staff: 1,
                meter: staff_meter(6, 8),
                synchronization: StaffMeterSynchronization::FitMeasure,
            }),
            &global,
        )
        .unwrap();
        let reset = resolve_staff_meter_change(
            previous.as_ref(),
            Some(&StaffMeterChange::Reset { staff: 1 }),
            &global,
        )
        .unwrap();
        assert!(reset.is_none());
    }

    #[test]
    fn absence_inherits_previous_state() {
        let global = ts(4, 4);
        let previous = resolve_staff_meter_change(
            None,
            Some(&StaffMeterChange::Set {
                staff: 1,
                meter: staff_meter(6, 8),
                synchronization: StaffMeterSynchronization::FitMeasure,
            }),
            &global,
        )
        .unwrap();
        let inherited = resolve_staff_meter_change(previous.as_ref(), None, &global).unwrap();
        assert_eq!(inherited, previous);
    }

    #[test]
    fn re_derives_the_fit_measure_ratio_against_a_changed_global_meter_on_inheritance() {
        // Declared against global 2/4 (ratio 2/3): local 6/8 (3 beats) vs
        // global 2/4 (2 beats).
        let previous = resolve_staff_meter_change(
            None,
            Some(&StaffMeterChange::Set {
                staff: 1,
                meter: staff_meter(6, 8),
                synchronization: StaffMeterSynchronization::FitMeasure,
            }),
            &ts(2, 4),
        )
        .unwrap();
        assert_eq!(
            previous.as_ref().unwrap().ratio_to_global,
            Fraction::new(2, 3)
        );

        // The global meter changes to 4/4 with no new staffMeters entry for
        // staff 1 -> the SAME authored local meter (6/8, fitMeasure) must
        // now derive the ratio against 4/4 (4 beats): 4/3, not the stale 2/3.
        let re_resolved = resolve_staff_meter_change(previous.as_ref(), None, &ts(4, 4))
            .unwrap()
            .unwrap();
        assert_eq!(re_resolved.time_signature.count, 6);
        assert_eq!(re_resolved.time_signature.unit, 8);
        assert_eq!(
            re_resolved.synchronization,
            StaffMeterSynchronization::FitMeasure
        );
        assert_eq!(re_resolved.ratio_to_global, Fraction::new(4, 3));
    }

    #[test]
    fn surfaces_a_shared_duration_mismatch_when_a_global_meter_change_breaks_an_inherited_declaration(
    ) {
        // Declared against global 3/4 (equal durations: 6/8 vs 3/4, both 3 beats).
        let previous = resolve_staff_meter_change(
            None,
            Some(&StaffMeterChange::Set {
                staff: 1,
                meter: staff_meter(6, 8),
                synchronization: StaffMeterSynchronization::SharedDuration,
            }),
            &ts(3, 4),
        )
        .unwrap();
        assert!(previous.is_some());

        // The global meter changes to 4/4 (4 beats): the inherited 6/8 (3
        // beats) no longer shares the global measure's duration.
        let error = resolve_staff_meter_change(previous.as_ref(), None, &ts(4, 4)).unwrap_err();
        assert!(matches!(
            error,
            StaffMeterError::SharedDurationMismatch { .. }
        ));
    }

    #[test]
    fn invalid_beat_structure_is_rejected() {
        let global = ts(4, 4);
        let mut meter = staff_meter(6, 8);
        meter.beat_structure = Some(vec![2, 2]); // sums to 4, not 6
        let change = StaffMeterChange::Set {
            staff: 1,
            meter,
            synchronization: StaffMeterSynchronization::FitMeasure,
        };
        let error = resolve_staff_meter_change(None, Some(&change), &global).unwrap_err();
        assert!(matches!(error, StaffMeterError::InvalidMeter(_)));
    }

    #[test]
    fn table_walks_inheritance_across_measures_and_keeps_state_on_error() {
        let global_time_at = vec![ts(4, 4), ts(4, 4), ts(4, 4), ts(4, 4)];
        let measures = vec![
            PartMeasure {
                staff_meters: Some(vec![StaffMeterChange::Set {
                    staff: 1,
                    meter: staff_meter(6, 8),
                    synchronization: StaffMeterSynchronization::FitMeasure,
                }]),
                ..Default::default()
            },
            PartMeasure::default(), // inherits
            PartMeasure {
                // Invalid: sharedDuration but durations differ -> kept previous state.
                staff_meters: Some(vec![StaffMeterChange::Set {
                    staff: 1,
                    meter: staff_meter(5, 8),
                    synchronization: StaffMeterSynchronization::SharedDuration,
                }]),
                ..Default::default()
            },
            PartMeasure {
                staff_meters: Some(vec![StaffMeterChange::Reset { staff: 1 }]),
                ..Default::default()
            },
        ];
        let (table, issues) = resolve_staff_meter_table(&measures, &global_time_at);
        assert_eq!(table.len(), 4);
        assert!(table[0].contains_key(&1));
        assert!(table[1].contains_key(&1)); // inherited
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].measure_index, 2);
        // State kept from before the invalid entry.
        assert_eq!(table[2][&1], table[1][&1]);
        assert!(!table[3].contains_key(&1)); // reset
    }

    #[test]
    fn table_recomputes_an_inherited_fit_measure_ratio_from_the_measure_where_the_global_meter_changes(
    ) {
        // Staff 1 declares fitMeasure 6/8 while global is 2/4 (ratio 2/3),
        // then the global meter changes to 4/4 with no new staffMeters entry
        // for staff 1 — the inherited 6/8 declaration must be re-derived
        // against 4/4 (ratio 4/3) from that measure onward.
        let global_time_at = vec![ts(2, 4), ts(4, 4), ts(4, 4)];
        let measures = vec![
            PartMeasure {
                staff_meters: Some(vec![StaffMeterChange::Set {
                    staff: 1,
                    meter: staff_meter(6, 8),
                    synchronization: StaffMeterSynchronization::FitMeasure,
                }]),
                ..Default::default()
            },
            PartMeasure::default(),
            PartMeasure::default(),
        ];
        let (table, issues) = resolve_staff_meter_table(&measures, &global_time_at);
        assert!(issues.is_empty());
        assert_eq!(table[0][&1].ratio_to_global, Fraction::new(2, 3));
        assert_eq!(table[1][&1].ratio_to_global, Fraction::new(4, 3));
        assert_eq!(table[2][&1].ratio_to_global, Fraction::new(4, 3));
        // The authored local meter/synchronization are unchanged throughout.
        assert_eq!(table[1][&1].time_signature.count, 6);
        assert_eq!(table[1][&1].time_signature.unit, 8);
        assert_eq!(
            table[1][&1].synchronization,
            StaffMeterSynchronization::FitMeasure
        );
    }

    #[test]
    fn table_recomputes_a_retained_fit_measure_ratio_after_an_invalid_replacement_and_global_change(
    ) {
        let global_time_at = vec![ts(2, 4), ts(4, 4)];
        let measures = vec![
            PartMeasure {
                staff_meters: Some(vec![StaffMeterChange::Set {
                    staff: 1,
                    meter: staff_meter(6, 8),
                    synchronization: StaffMeterSynchronization::FitMeasure,
                }]),
                ..Default::default()
            },
            PartMeasure {
                staff_meters: Some(vec![StaffMeterChange::Set {
                    staff: 1,
                    meter: staff_meter(0, 8),
                    synchronization: StaffMeterSynchronization::FitMeasure,
                }]),
                ..Default::default()
            },
        ];

        let (table, issues) = resolve_staff_meter_table(&measures, &global_time_at);
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].measure_index, 1);
        assert_eq!(table[0][&1].ratio_to_global, Fraction::new(2, 3));
        assert_eq!(table[1][&1].time_signature, ts(6, 8));
        assert_eq!(table[1][&1].ratio_to_global, Fraction::new(4, 3));
    }

    #[test]
    fn table_reports_one_issue_and_retains_shared_duration_when_replacement_and_inheritance_fail() {
        let global_time_at = vec![ts(3, 4), ts(4, 4)];
        let measures = vec![
            PartMeasure {
                staff_meters: Some(vec![StaffMeterChange::Set {
                    staff: 1,
                    meter: staff_meter(6, 8),
                    synchronization: StaffMeterSynchronization::SharedDuration,
                }]),
                ..Default::default()
            },
            PartMeasure {
                staff_meters: Some(vec![StaffMeterChange::Set {
                    staff: 1,
                    meter: staff_meter(0, 8),
                    synchronization: StaffMeterSynchronization::SharedDuration,
                }]),
                ..Default::default()
            },
        ];

        let (table, issues) = resolve_staff_meter_table(&measures, &global_time_at);
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].measure_index, 1);
        assert_eq!(table[1][&1], table[0][&1]);
    }

    #[test]
    fn table_reports_a_shared_duration_mismatch_and_keeps_prior_state_when_a_global_change_breaks_it_mid_run(
    ) {
        // Staff 1 declares sharedDuration 6/8 while global is 3/4 (equal, 3
        // beats). The global meter then changes to 4/4 (4 beats) with no new
        // staffMeters entry — the inherited declaration is no longer valid.
        let global_time_at = vec![ts(3, 4), ts(4, 4)];
        let measures = vec![
            PartMeasure {
                staff_meters: Some(vec![StaffMeterChange::Set {
                    staff: 1,
                    meter: staff_meter(6, 8),
                    synchronization: StaffMeterSynchronization::SharedDuration,
                }]),
                ..Default::default()
            },
            PartMeasure::default(),
        ];
        let (table, issues) = resolve_staff_meter_table(&measures, &global_time_at);
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].measure_index, 1);
        assert_eq!(issues[0].staff, 1);
        assert!(matches!(
            issues[0].error,
            StaffMeterError::SharedDurationMismatch { .. }
        ));
        // The stale (declaration-time) entry is kept rather than dropped.
        assert_eq!(table[1][&1], table[0][&1]);
    }
}
