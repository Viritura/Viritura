use crate::layout::page_turn::expand_playback_order;
use crate::model::{GlobalMeasure, ResolvedMeasure};

pub(crate) fn apply_repeat_signature_restatements(
    resolved: &mut [ResolvedMeasure],
    globals: &[GlobalMeasure],
) {
    for measure in resolved.iter_mut() {
        measure.repeat_key_restatement_from = None;
        measure.repeat_time_restatement = None;
        measure.repeat_clef_restatement = false;
        measure.repeat_ending_brackets = false;
    }

    let order = match expand_playback_order(globals) {
        Ok(order) => order,
        Err(error) => {
            eprintln!("repeat signature navigation could not be resolved: {error}");
            return;
        }
    };

    for pair in order.windows(2) {
        let (source, target) = (pair[0], pair[1]);
        let Some(previous) = resolved.get(source) else {
            continue;
        };
        if target >= source || resolved.get(target).is_none() {
            continue;
        }

        let previous_key = previous.active_key.clone();
        let previous_time = previous.effective_beat_meter().clone();
        let previous_clef = active_clef(previous).cloned();
        let Some(repeated) = resolved.get_mut(target) else {
            continue;
        };
        if previous_key != repeated.active_key
            && super::super::render_signatures::staff_has_key_signature(repeated)
        {
            repeated.repeat_key_restatement_from = Some(previous_key);
        }
        if previous_time != *repeated.effective_beat_meter() {
            repeated.repeat_time_restatement = Some(repeated.effective_beat_meter().clone());
        }
        if previous_clef.as_ref() != active_clef(repeated) {
            restate_clef(repeated);
        }
    }

    apply_first_ending_reminders(resolved, globals);
}

fn apply_first_ending_reminders(resolved: &mut [ResolvedMeasure], globals: &[GlobalMeasure]) {
    for (second_start, second_global) in globals.iter().enumerate() {
        if !second_global
            .ending
            .as_ref()
            .is_some_and(|ending| ending.numbers.contains(&2))
        {
            continue;
        }
        let Some((first_start, first_end)) = globals
            .iter()
            .enumerate()
            .take(second_start)
            .rev()
            .find_map(|(start, measure)| {
                let ending = measure.ending.as_ref()?;
                if !ending.numbers.contains(&1) {
                    return None;
                }
                let end = (start + ending.duration.max(1) as usize).min(globals.len());
                let has_repeat_end = globals[start..end]
                    .iter()
                    .any(|measure| measure.repeat_end.is_some());
                (end <= second_start && has_repeat_end).then_some((start, end))
            })
        else {
            continue;
        };
        let (Some(before), Some(first_ending_last)) = (
            first_start
                .checked_sub(1)
                .and_then(|index| resolved.get(index)),
            first_end
                .checked_sub(1)
                .and_then(|index| resolved.get(index)),
        ) else {
            continue;
        };
        let previous_key = before.active_key.clone();
        let ending_key = first_ending_last.active_key.clone();
        let key_changed = previous_key != ending_key;
        let previous_time = before.effective_beat_meter().clone();
        let ending_time = first_ending_last.effective_beat_meter().clone();
        let time_changed = previous_time != ending_time;
        let previous_clef = active_clef(before).cloned();
        let ending_clef = active_clef(first_ending_last).cloned();
        let clef_changed = previous_clef != ending_clef;
        if !key_changed && !time_changed && !clef_changed {
            continue;
        }

        let Some(second) = resolved.get_mut(second_start) else {
            continue;
        };
        let mut has_reminder = false;
        if key_changed
            && second.global.key.is_none()
            && second.active_key == ending_key
            && super::super::render_signatures::staff_has_key_signature(second)
        {
            second.repeat_key_restatement_from = Some(previous_key);
            has_reminder = true;
        }
        if time_changed
            && second.global.time.is_none()
            && second.part.staff_meters.as_ref().is_none_or(Vec::is_empty)
            && second.effective_beat_meter() == &ending_time
        {
            second.repeat_time_restatement = Some(second.effective_beat_meter().clone());
            has_reminder = true;
        }
        if clef_changed
            && second
                .part
                .clefs
                .as_ref()
                .is_none_or(|clefs| clefs.iter().all(|clef| clef.position.is_some()))
            && active_clef(second) == ending_clef.as_ref()
        {
            has_reminder |= restate_clef(second);
        }
        second.repeat_ending_brackets = has_reminder;
    }
}

fn restate_clef(measure: &mut ResolvedMeasure) -> bool {
    if measure
        .part
        .clefs
        .as_ref()
        .is_some_and(|clefs| clefs.iter().any(|clef| clef.position.is_none()))
    {
        return false;
    }
    let Some(mut clef) = start_clef(measure).cloned() else {
        return false;
    };
    clef.position = None;
    measure
        .part
        .clefs
        .get_or_insert_with(Vec::new)
        .insert(0, clef);
    measure.repeat_clef_restatement = true;
    true
}

fn start_clef(measure: &ResolvedMeasure) -> Option<&crate::model::PositionedClef> {
    measure.part.clefs.as_ref()?.iter().find(|clef| {
        clef.position
            .as_ref()
            .is_none_or(|position| position.fraction.0 == 0)
    })
}

fn active_clef(measure: &ResolvedMeasure) -> Option<&crate::model::Clef> {
    measure.part.clefs.as_ref()?.last().map(|clef| &clef.clef)
}
