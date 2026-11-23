use super::{apply_automatic_courtesy_accidentals, AccidentalState};
use crate::layout::page_turn::expand_playback_order;
use crate::model::{GlobalMeasure, ResolvedMeasure};

pub(crate) fn has_repeat_navigation(measures: &[GlobalMeasure]) -> bool {
    measures.iter().any(|measure| measure.repeat_end.is_some())
}

/// Apply the existing boundary policy to every actually performed predecessor.
pub(crate) fn apply_repeat_courtesy_accidentals(
    resolved: &mut [ResolvedMeasure],
    globals: &[GlobalMeasure],
) {
    let mut depth = 0usize;
    let mut nested = false;
    for measure in globals {
        if measure.repeat_start.is_some() {
            depth += 1;
            nested |= depth > 1;
        }
        if measure.repeat_end.is_some() {
            depth = depth.saturating_sub(1);
        }
    }
    let playback_order = if nested {
        Err("nested repeats are not supported by repeat expansion".to_string())
    } else {
        expand_playback_order(globals)
    };
    let order = match playback_order {
        Ok(order) => order,
        Err(error) => {
            eprintln!("repeat accidental navigation could not be resolved: {error}");
            (0..resolved.len()).collect()
        }
    };
    let states: Vec<AccidentalState> = resolved
        .iter()
        .map(|measure| {
            let mut part = measure.part.clone();
            apply_automatic_courtesy_accidentals(
                &mut part,
                measure.display_transposition(),
                &measure.tie_continuation_ids,
                &AccidentalState::new(),
            )
        })
        .collect();
    let mut predecessors = vec![Vec::new(); resolved.len()];
    for pair in order.windows(2) {
        let (source, target) = (pair[0], pair[1]);
        if source < resolved.len()
            && target < resolved.len()
            && resolved[source].active_key == resolved[target].active_key
            && !predecessors[target].contains(&source)
        {
            predecessors[target].push(source);
        }
    }
    for (index, measure) in resolved.iter_mut().enumerate() {
        let transposition = measure.display_transposition();
        for &source in &predecessors[index] {
            apply_automatic_courtesy_accidentals(
                &mut measure.part,
                transposition,
                &measure.tie_continuation_ids,
                &states[source],
            );
        }
    }
}
