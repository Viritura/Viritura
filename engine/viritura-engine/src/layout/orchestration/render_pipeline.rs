use super::super::*;

pub(in crate::layout) fn render_systems_pass2(
    dl: &mut DisplayList,
    precomp_sys_layouts: &[Vec<MeasureLayout>],
    system_y_positions: &[f64],
    systems: &[Vec<usize>],
    visible_resolved: &[&ResolvedMeasure],
    margin_left: f64,
    sp: f64,
    config: &LayoutConfig,
    score: &Score,
    lyric_line_order: Option<&[String]>,
    part_index: usize,
) {
    let system_count = precomp_sys_layouts.len();
    let mut global_slur_events: Vec<slurs::GlobalSlurEvent> = Vec::new();
    let mut global_tie_notes: Vec<GlobalTieNote> = Vec::new();
    let mut slur_bounds: HashMap<(usize, usize, usize), slurs::SystemSlurBounds> = HashMap::new();

    // Clef-change set scoped to THIS part's staves only — an individual-part
    // view must not reserve a leading-clef gap for a clef change that belongs to
    // a different part (it never carries that change).
    let clef_change_measures =
        render_measure::clef_change_measure_set_from_layouts(precomp_sys_layouts);

    for (sys_idx, sys_measure_layouts) in precomp_sys_layouts.iter().enumerate() {
        let staff_y = system_y_positions[sys_idx];
        let sys_x_end = sys_measure_layouts
            .last()
            .map_or(margin_left, |ml| ml.x + ml.width);

        for line in 0..5 {
            let y = staff_y + line as f64 * sp;
            dl.staff_line(margin_left, sys_x_end, y, config.staff_line_width * sp);
        }

        let next_sys_clef: Option<&Clef> = systems
            .get(sys_idx + 1)
            .and_then(|next_sys| next_sys.first())
            .and_then(|&next_mi| {
                let next_rm = visible_resolved[next_mi];
                next_rm
                    .part
                    .clefs
                    .as_ref()
                    .and_then(|clefs| clefs.iter().find(|c| c.position.is_none()))
                    .map(|pc| &pc.clef)
            });

        render_system_contents(
            dl,
            sys_measure_layouts,
            staff_y,
            sp,
            config,
            score,
            lyric_line_order,
            sys_idx == system_count - 1,
            part_index,
            None,
            next_sys_clef,
            None,
            sys_idx,
            false,
            false,
            &clef_change_measures,
            &mut Vec::new(),
            None,
        );

        render_glissandos(
            dl,
            &[(sys_measure_layouts.as_slice(), staff_y)],
            sp,
            config,
            None,
        );

        // This path has no staff groups (one part, one staff), so a spanning
        // meter covers the staff it belongs to.
        crate::layout::time_signatures::spanning::render_span_meters(
            dl,
            sys_measure_layouts,
            staff_y,
            staff_y + 4.0 * sp,
            config,
        );

        slur_bounds.insert(
            (sys_idx, part_index, 0),
            slurs::SystemSlurBounds {
                left_x: margin_left,
                right_x: sys_x_end,
            },
        );
        slurs::collect_global_slur_events(
            sys_measure_layouts,
            staff_y,
            None,
            sp,
            config,
            sys_idx,
            part_index,
            0,
            &mut global_slur_events,
        );
        collect_global_tie_notes(
            sys_measure_layouts,
            staff_y,
            None,
            sp,
            config,
            sys_idx,
            part_index,
            0,
            &mut global_tie_notes,
        );
    }

    render_cross_system_ties(dl, &global_tie_notes, &slur_bounds, sp, config, false);
    slurs::render_cross_system_slurs(dl, &global_slur_events, &slur_bounds, sp, config, false);
    render_annotations::push_fermatas_clear_of_curves(dl, 0, 0, sp);
}

/// Pass 0 of `layout_score_cached`: compute the "natural" (un-justified)
/// width of every visible measure, populating the layout cache when one is
/// supplied. Returns `(natural_widths, content_hashes, x_cursor_end)`.
#[allow(clippy::too_many_arguments)]
pub(in crate::layout) fn emit_layout_debug(
    dl: &mut DisplayList,
    visible_resolved: &[&ResolvedMeasure],
    natural_widths: &[f64],
    precomp_sys_layouts: &[Vec<MeasureLayout>],
    system_y_positions: &[f64],
    above_staff_extras: &[f64],
    below_staff_extras: &[f64],
    sp: f64,
    staff_height: f64,
    config: &LayoutConfig,
) {
    let system_count = precomp_sys_layouts.len();
    let mut natural_by_idx: HashMap<usize, f64> = HashMap::with_capacity(visible_resolved.len());
    for (i, rm) in visible_resolved.iter().enumerate() {
        natural_by_idx.insert(rm.index, natural_widths[i]);
    }
    let mut systems_dbg: Vec<crate::render::SystemDebug> = (0..system_count)
        .map(|i| {
            let staff_top = system_y_positions[i];
            debug::system_debug_single_staff(
                i,
                debug::page_for_system(&dl.pages, i),
                &precomp_sys_layouts[i],
                staff_top,
                above_staff_extras[i],
                below_staff_extras[i],
                sp,
                config.stem_length,
                &natural_by_idx,
            )
        })
        .collect();
    debug::link_inter_system_gaps(&mut systems_dbg, sp);
    dl.layout_debug = Some(crate::render::LayoutDebugInfo {
        systems: systems_dbg,
        sp,
        staff_height,
        min_note_spacing: config.min_note_spacing * sp,
        shortest_duration_space: config.shortest_duration_space * sp,
        spacing_increment: config.spacing_increment * sp,
        placement: debug::build_placement_debug(config, sp),
    });
}
