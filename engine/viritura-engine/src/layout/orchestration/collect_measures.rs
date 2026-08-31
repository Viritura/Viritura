use super::super::*;

/// Clone `config` with the document's `_x.viritura` layout overrides merged
/// over the defaults, or `None` when nothing differs from the defaults (so
/// the common case avoids a `LayoutConfig` clone).
///
/// Merges `textStyles`, `placement`, and the time signature style the
/// document asks for in this layout context.
pub(in crate::layout) fn config_with_document_overrides(
    score: &Score,
    config: &LayoutConfig,
    context: LayoutContext,
) -> Option<LayoutConfig> {
    let ts = score.text_styles_json();
    let pj = score.placement_json();
    let time_signature_settings = score.time_signature_styles().resolve(context);
    if ts.is_none() && pj.is_none() && time_signature_settings == config.time_signature_settings {
        return None;
    }
    let mut c = config.clone();
    if let Some(ts) = ts {
        c.text_styles.merge_json(ts);
    }
    if let Some(pj) = pj {
        c.placement.merge_json(pj);
    }
    c.time_signature_settings = time_signature_settings;
    Some(c)
}

/// Which time signature style a rendered MNX score definition asks for.
///
/// The primary score definition is the score itself. Any later definition
/// that draws exactly one part is a player's layout — that is what the
/// editor's "add part" flow produces — and reads the document's `parts`
/// style. Anything else (a condensed score, a custom subset) is engraved as
/// a score.
pub(in crate::layout) fn mnx_layout_context(score: &Score, score_index: usize) -> LayoutContext {
    if score_index == 0 {
        return LayoutContext::Score;
    }
    let Some(layout_id) = score
        .scores
        .get(score_index)
        .and_then(|sd| sd.layout.as_deref())
    else {
        return LayoutContext::Score;
    };
    let Some(layout) = score.layouts.iter().find(|l| l.id == layout_id) else {
        return LayoutContext::Score;
    };
    let mut parts: Vec<&str> = Vec::new();
    collect_layout_parts(&layout.content, &mut parts);
    parts.sort_unstable();
    parts.dedup();
    if parts.len() == 1 {
        LayoutContext::Part
    } else {
        LayoutContext::Score
    }
}

fn collect_layout_parts<'a>(content: &'a [LayoutContent], out: &mut Vec<&'a str>) {
    for node in content {
        match node {
            LayoutContent::Group(group) => collect_layout_parts(&group.content, out),
            LayoutContent::Staff(staff) => {
                out.extend(staff.sources.iter().map(|s| s.part.as_str()));
            }
        }
    }
}

/// Pass 2 of `layout_score_cached`: walk each pre-computed system, draw the
/// 5-line staff, dispatch to `render_system_contents`, and finally render
/// cross-system slurs in a single sweep over all systems.
#[allow(clippy::too_many_arguments)]
pub(in crate::layout) fn compute_natural_widths(
    visible_resolved: &[&ResolvedMeasure],
    mmr_start_map: &HashMap<usize, u32>,
    margin_left: f64,
    sp: f64,
    config: &LayoutConfig,
    resolved_ottavas: &[ResolvedOttavaRange],
    common_shortest_beats: f64,
    part_index: usize,
    mut cache: Option<&mut cache::LayoutCache>,
) -> (Vec<f64>, Vec<u64>, f64) {
    let mut natural_widths: Vec<f64> = Vec::new();
    let mut content_hashes: Vec<u64> = Vec::new();
    let mut x_cursor = margin_left;
    for &rm in visible_resolved {
        let content_hash = measure_content_hash(rm);
        content_hashes.push(content_hash);
        let is_mmr = mmr_start_map.contains_key(&rm.index);

        // Multimeasure rests reserve their clef/key/time prefix plus an H-bar
        // body wide enough for the (possibly multi-digit) count number. Always
        // lay the measure out fresh to read its prefix width — MMR groups are
        // rare, so skipping the natural-width cache here is cheap.
        let width = if is_mmr {
            let ml = layout_measure(
                rm,
                sp,
                0.0,
                config,
                None,
                resolved_ottavas,
                common_shortest_beats,
            );
            let count = mmr_start_map.get(&rm.index).copied().unwrap_or(0);
            render_measure::multimeasure_rest_natural_width(ml.prefix_width, count, sp)
        } else if let Some(ref mut c) = cache {
            if let Some(cached_w) = c.get_natural_width(rm.index, content_hash) {
                cached_w
            } else {
                // Compute at x=0 for position-independent caching
                let ml = layout_measure(
                    rm,
                    sp,
                    0.0,
                    config,
                    None,
                    resolved_ottavas,
                    common_shortest_beats,
                );
                let w = ml.width;
                c.set_natural_width(rm.index, content_hash, w);
                c.set_full_layout(
                    rm.index,
                    content_hash,
                    ml.width,
                    &ml.voice_layouts,
                    ml.prefix_width,
                    ml.first_onset_padding,
                    ml.time_signature_x_offset,
                    &ml.mid_clef_changes,
                );
                w
            }
        } else {
            let mut ml = layout_measure(
                rm,
                sp,
                x_cursor,
                config,
                None,
                resolved_ottavas,
                common_shortest_beats,
            );
            ml.part_index = part_index;
            ml.width
        };

        // Reserve room for above-staff annotations through the §4 space-request
        // channel. A rehearsal mark reserves its box width so it can't overhang
        // the next bar; a tempo over a multi-measure rest widens the bar (up to
        // a cap) instead of overflowing. These are declarative `MinMeasureWidth`
        // requests folded into the natural width before justification, so the
        // line-breaker and justification still run exactly once. A co-located
        // tempo over a *normal* bar is NOT reserved — it may overhang following
        // bars and is kept inside the right page margin by a render-time
        // left-nudge (see `render_tempo_markings`).
        let space_reqs =
            space_requests::measure_min_width_requests(rm, rm.index, is_mmr, config, sp);
        let width = space_requests::reconcile_natural_width(width, &space_reqs, sp);

        natural_widths.push(width);
        x_cursor += width;
    }

    (natural_widths, content_hashes, x_cursor)
}
