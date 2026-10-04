//! The instruments and tunings a player actually needs, in first-use order.

use crate::model::{ordered_instrument_changes, ActiveInstrument, Part};

struct RequiredState<'a> {
    active: ActiveInstrument<'a>,
    identity: String,
    interval: (i32, i32),
}

pub(super) struct RequiredName {
    pub full: String,
    pub short: String,
}

fn state<'a>(part: &'a Part, active: ActiveInstrument<'a>) -> RequiredState<'a> {
    RequiredState {
        identity: active.definition.map_or_else(
            || part.name.clone(),
            |definition| definition.instrument_id.clone(),
        ),
        interval: active.transposition.map_or((0, 0), |t| {
            (t.interval.half_steps, t.interval.staff_distance)
        }),
        active,
    }
}

pub(super) fn names(part: &Part) -> Vec<RequiredName> {
    let mut active = ActiveInstrument::at(part, 0, (0, 1));
    let mut states = vec![state(part, active)];
    for measure in part.measures.iter().skip(1) {
        for change in ordered_instrument_changes(measure) {
            active.apply(part, change);
        }
        let next = state(part, active);
        if !states.iter().any(|previous| {
            previous.identity == next.identity && previous.interval == next.interval
        }) {
            states.push(next);
        }
    }
    states
        .iter()
        .map(|state| {
            let full = state
                .active
                .definition
                .and_then(|d| d.name.as_deref())
                .unwrap_or(&part.name);
            let short = short_name(part, state.active);
            let same_pitch_other_octave = states.iter().any(|other| {
                other.identity == state.identity
                    && other.interval != state.interval
                    && other.interval.0.rem_euclid(12) == state.interval.0.rem_euclid(12)
            });
            RequiredName {
                full: active_name(part, state.active, full, same_pitch_other_octave),
                short: active_name(part, state.active, &short, same_pitch_other_octave),
            }
        })
        .collect()
}

fn active_name(
    part: &Part,
    active: ActiveInstrument<'_>,
    authored: &str,
    distinguish_octave: bool,
) -> String {
    let full = active
        .definition
        .and_then(|d| d.name.as_deref())
        .unwrap_or(&part.name);
    let interval = active.transposition.map_or((0, 0), |t| {
        (t.interval.half_steps, t.interval.staff_distance)
    });
    let default_interval = active
        .definition
        .and_then(|d| d.transposition.as_ref())
        .or(part.transposition.as_ref())
        .map_or((0, 0), |t| {
            (t.interval.half_steps, t.interval.staff_distance)
        });
    format_name(
        authored,
        full,
        interval,
        default_interval,
        distinguish_octave,
    )
}

fn short_name(part: &Part, active: ActiveInstrument<'_>) -> String {
    let full = active
        .definition
        .and_then(|d| d.name.as_deref())
        .unwrap_or(&part.name);
    active
        .definition
        .map(|d| {
            d.short_name
                .clone()
                .unwrap_or_else(|| super::super::abbreviate_part_name(full))
        })
        .or_else(|| part.short_name.clone())
        .unwrap_or_else(|| super::super::abbreviate_part_name(full))
}

pub(crate) fn instrument_tuning_name(part: &Part, active: ActiveInstrument<'_>) -> String {
    active_name(part, active, &short_name(part, active), false)
}

fn tuning(interval: (i32, i32)) -> (String, i64) {
    let diatonic = -i64::from(interval.1);
    let chromatic = -i64::from(interval.0);
    let letter = diatonic.rem_euclid(7) as usize;
    let natural = [0, 2, 4, 5, 7, 9, 11][letter] + 12 * diatonic.div_euclid(7);
    let accidental = match chromatic - natural {
        -2 => "\u{1d12b}",
        -1 => "\u{266d}",
        0 => "",
        1 => "\u{266f}",
        2 => "\u{1d12a}",
        _ => {
            let pitch = super::super::transposition_key_name(interval.0).unwrap_or("C");
            return (pitch.to_string(), 4 + chromatic.div_euclid(12));
        }
    };
    (
        format!(
            "{}{accidental}",
            ["C", "D", "E", "F", "G", "A", "B"][letter]
        ),
        4 + diatonic.div_euclid(7),
    )
}

fn format_name(
    authored: &str,
    full: &str,
    interval: (i32, i32),
    default_interval: (i32, i32),
    distinguish_octave: bool,
) -> String {
    let (pitch, octave) = tuning(interval);
    let (default_pitch, _) = tuning(default_interval);
    let mut base = authored.to_string();
    for suffix in [format!(" in {default_pitch}"), format!(" in {pitch}")] {
        if let Some(index) = base.find(&suffix) {
            let end = index + suffix.len();
            if end == base.len() || base[end..].starts_with(' ') {
                base.replace_range(index..end, "");
            }
        }
    }
    let lower = full.to_lowercase();
    let qualifier = if lower.contains("horn") && interval.0.rem_euclid(12) == 2 {
        match interval {
            (2, 1) => Some("alto"),
            (14, 8) => Some("basso"),
            _ => None,
        }
    } else if lower.contains("clarinet") && interval.0.rem_euclid(12) == 9 {
        match interval {
            (-3, -2) => Some("piccolo"),
            (9, 5) => Some("alto"),
            _ => None,
        }
    } else {
        None
    };
    if qualifier.is_some() {
        base = base
            .split_whitespace()
            .filter(|word| !matches!(word.to_lowercase().as_str(), "alto" | "basso" | "piccolo"))
            .collect::<Vec<_>>()
            .join(" ");
    }
    let mut label = format!("{base} in {pitch}");
    if let Some(qualifier) = qualifier {
        label.push_str(&format!(" {qualifier}"));
    } else if distinguish_octave || (interval.0 != 0 && interval.0.rem_euclid(12) == 0) {
        label.push_str(&format!(" (sounds {pitch}{octave} for written C4)"));
    }
    label
}

pub(crate) fn initial_instruction(part: &Part) -> Option<String> {
    let names = names(part);
    if names.len() < 2
        || part.measures.first().is_some_and(|measure| {
            ordered_instrument_changes(measure)
                .iter()
                .any(|change| change.instrument.is_some() || change.transposition.is_some())
        })
    {
        return None;
    }
    names.into_iter().next().map(|name| name.short)
}
