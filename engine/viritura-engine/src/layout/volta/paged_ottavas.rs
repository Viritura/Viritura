use super::{element_id, render_ottava_segment, render_ottavas, MeasureLayout, OttavaSegment};
use crate::layout::config::LayoutConfig;
use crate::layout::full_score::FlatSource;
use crate::model::{Placement, Score};
use crate::render::DisplayList;
use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};

pub(crate) fn render_source_ottavas(
    dl: &mut DisplayList,
    layouts: &[MeasureLayout],
    staff_y: f64,
    config: &LayoutConfig,
    score: &Score,
    source: (usize, u32),
) {
    render_ottavas_for_view(
        dl,
        layouts,
        staff_y,
        config,
        score,
        &[FlatSource {
            staff_number: Some(source.1),
            ..FlatSource::whole_part(source.0)
        }],
    );
}

pub(crate) fn render_ottavas_for_view(
    dl: &mut DisplayList,
    layouts: &[MeasureLayout],
    staff_y: f64,
    config: &LayoutConfig,
    score: &Score,
    sources: &[FlatSource],
) {
    if layouts.is_empty() {
        return;
    }
    if config.page_width.is_some() {
        render_paged_ottavas(dl, layouts, staff_y, config.sp, score, sources);
    } else {
        let source = sources.first().expect("rendered staff has a source");
        render_ottavas(dl, layouts, staff_y, config.sp, source.part_index);
    }
}

pub(crate) fn render_paged_ottavas(
    dl: &mut DisplayList,
    layouts: &[MeasureLayout],
    staff_y: f64,
    sp: f64,
    score: &Score,
    sources: &[FlatSource],
) {
    let (Some(first), Some(last)) = (layouts.first(), layouts.last()) else {
        return;
    };
    let measure_indices: HashMap<_, _> = score
        .global
        .measures
        .iter()
        .enumerate()
        .filter_map(|(index, measure)| measure.id.as_deref().map(|id| (id, index)))
        .collect();
    let mut rendered_ranges = HashSet::new();
    for source in sources {
        let part = &score.parts[source.part_index];
        for (start_measure, measure) in part.measures.iter().enumerate() {
            if start_measure > last.resolved.index {
                break;
            }
            for (index, ottava) in measure.ottavas.iter().flatten().enumerate() {
                if source
                    .staff_number
                    .is_some_and(|staff| ottava.staff.unwrap_or(1) != staff)
                {
                    continue;
                }
                let Some(&end_measure) = measure_indices.get(ottava.end.measure.as_str()) else {
                    continue;
                };
                if end_measure < first.resolved.index || end_measure < start_measure {
                    continue;
                }
                let Some(start_mi) = layouts
                    .iter()
                    .position(|layout| layout.resolved.index >= start_measure)
                else {
                    continue;
                };
                let Some(end_mi) = layouts
                    .iter()
                    .rposition(|layout| layout.resolved.index <= end_measure)
                else {
                    continue;
                };
                let show_label = layouts[start_mi].resolved.index == start_measure;
                let show_hook = layouts[end_mi].resolved.index == end_measure;
                if !rendered_ranges.insert((source.part_index, start_measure, index)) {
                    continue;
                }
                let id = element_id::ottava(source.part_index, start_measure, index);
                render_ottava_segment(
                    dl,
                    layouts,
                    staff_y,
                    sp,
                    &OttavaSegment {
                        ottava,
                        start_mi,
                        end_mi,
                        start_beat: if show_label {
                            ottava.position.beats()
                        } else {
                            0.0
                        },
                        end_beat: ottava.end.position.beats(),
                        element_id: id.clone(),
                        bbox_element_id: id,
                        show_label,
                        show_hook,
                    },
                );
            }
        }
    }
}

pub(crate) fn paged_ottava_render_salt(score: &Score, salt: u64) -> u64 {
    let mut hasher = DefaultHasher::new();
    salt.hash(&mut hasher);
    // Continuations depend on ranges authored outside their own system.
    for (part_index, part) in score.parts.iter().enumerate() {
        for (measure_index, measure) in part.measures.iter().enumerate() {
            for (index, ottava) in measure.ottavas.iter().flatten().enumerate() {
                part_index.hash(&mut hasher);
                measure_index.hash(&mut hasher);
                index.hash(&mut hasher);
                ottava.value.hash(&mut hasher);
                ottava.staff.hash(&mut hasher);
                ottava.position.fraction.hash(&mut hasher);
                ottava.end.measure.hash(&mut hasher);
                ottava.end.position.fraction.hash(&mut hasher);
                match ottava.placement {
                    None | Some(Placement::Auto) => 0,
                    Some(Placement::Above) => 1,
                    Some(Placement::Below) => 2,
                }
                .hash(&mut hasher);
            }
        }
    }
    hasher.finish()
}
