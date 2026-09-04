use super::super::*;
use crate::layout::staff_brace::brace_geometry;

pub(in crate::layout) fn compute_grand_staff_natural_widths(
    all_resolved: &[Vec<ResolvedMeasure>],
    all_resolved_ottavas: &[Vec<ResolvedOttavaRange>],
    sp: f64,
    config: &LayoutConfig,
    common_shortest_beats: f64,
    mut cache: Option<&mut cache::LayoutCache>,
) -> (Vec<Vec<f64>>, Vec<Vec<u64>>) {
    let mut natural_widths_per_staff: Vec<Vec<f64>> = Vec::new();
    let mut gs_content_hash_grid: Vec<Vec<u64>> = Vec::new();
    for (si, resolved) in all_resolved.iter().enumerate() {
        let mut widths = Vec::new();
        let mut hashes = Vec::new();
        for rm in resolved {
            let content_hash = measure_content_hash(rm);
            hashes.push(content_hash);
            // Staff-specific cache key: combine measure index with staff index
            let cache_key = rm.index * 100 + si;

            let width = if let Some(ref mut c) = cache {
                if let Some(cached_w) = c.get_natural_width(cache_key, content_hash) {
                    cached_w
                } else {
                    let ml = layout_measure(
                        rm,
                        sp,
                        0.0,
                        config,
                        None,
                        &all_resolved_ottavas[si],
                        common_shortest_beats,
                    );
                    c.set_natural_width(cache_key, content_hash, ml.width);
                    ml.width
                }
            } else {
                let ml = layout_measure(
                    rm,
                    sp,
                    0.0,
                    config,
                    None,
                    &all_resolved_ottavas[si],
                    common_shortest_beats,
                );
                ml.width
            };

            widths.push(width);
        }
        natural_widths_per_staff.push(widths);
        gs_content_hash_grid.push(hashes);
    }
    (natural_widths_per_staff, gs_content_hash_grid)
}

/// Grand-staff helper — layout every measure on every staff for one system
/// (shared spacing already merged), honouring the layout cache.
/// Returns the per-staff `Vec<MeasureLayout>` grid for the system.
#[allow(clippy::too_many_arguments)]
pub(in crate::layout) fn layout_grand_staff_system_measures(
    all_resolved: &[Vec<ResolvedMeasure>],
    all_resolved_ottavas: &[Vec<ResolvedOttavaRange>],
    sys_measures: &[usize],
    max_widths: &[f64],
    gs_content_hash_grid: &[Vec<u64>],
    merged_spacings: &[crate::layout::spacing::LogSpacing],
    max_prefix_widths: &[AlignedPrefix],
    scale: f64,
    margin_left: f64,
    sp: f64,
    config: &LayoutConfig,
    common_shortest_beats: f64,
    part_index: usize,
    mut cache: Option<&mut cache::LayoutCache>,
) -> Vec<Vec<MeasureLayout>> {
    let mut all_sys_layouts: Vec<Vec<MeasureLayout>> = Vec::new();
    for (si, resolved) in all_resolved.iter().enumerate() {
        let mut sys_x = margin_left;
        let mut layouts = Vec::new();
        for (smi, &mi) in sys_measures.iter().enumerate() {
            if mi >= resolved.len() {
                continue;
            }
            let rm = &resolved[mi];
            let fw = max_widths[mi] * scale;
            let content_hash = gs_content_hash_grid[si][mi];
            // Grand-staff cache key: offset to avoid collision with other caches
            let cache_key = 2_000_000 + mi * 100 + si;
            let compound_hash = {
                let mut hasher = DefaultHasher::new();
                content_hash.hash(&mut hasher);
                fw.to_bits().hash(&mut hasher);
                max_prefix_widths[smi].width.to_bits().hash(&mut hasher);
                max_prefix_widths[smi]
                    .first_onset_padding
                    .to_bits()
                    .hash(&mut hasher);
                for &(beat, x) in &merged_spacings[smi].mapping {
                    beat.to_bits().hash(&mut hasher);
                    x.to_bits().hash(&mut hasher);
                }
                merged_spacings[smi].total_width.to_bits().hash(&mut hasher);
                hasher.finish()
            };

            let cached_hit = if let Some(ref c) = cache {
                c.get_full_layout(cache_key, compound_hash)
            } else {
                None
            };

            let mut ml = if let Some(cached_layout) = cached_hit {
                let mut ml = MeasureLayout {
                    x: 0.0,
                    width: cached_layout.width,
                    resolved: rm.clone(),
                    voice_layouts: cached_layout.voice_layouts,
                    prefix_width: cached_layout.prefix_width,
                    first_onset_padding: cached_layout.first_onset_padding,
                    time_signature_x_offset: cached_layout.time_signature_x_offset,
                    trailing_barline_extra:
                        crate::layout::render_barlines::trailing_barline_extra_width(rm, config, sp),
                    mid_clef_changes: cached_layout.mid_clef_changes,
                    multimeasure_rest_count: None,
                    multimeasure_rest_label: None,
                    part_index: 0,
                    is_first_on_system: false,
                    show_system_objects: true,
                    is_first_staff: true,
                };
                ml.translate_x(sys_x);
                ml
            } else {
                let ml = layout_measure_with_shared_spacing(
                    rm,
                    sp,
                    0.0,
                    config,
                    Some(fw),
                    &all_resolved_ottavas[si],
                    common_shortest_beats,
                    &merged_spacings[smi],
                    Some(max_prefix_widths[smi]),
                    &[],
                    smi == 0,
                );
                if let Some(ref mut c) = cache {
                    c.set_full_layout(
                        cache_key,
                        compound_hash,
                        ml.width,
                        &ml.voice_layouts,
                        ml.prefix_width,
                        ml.first_onset_padding,
                        ml.time_signature_x_offset,
                        &ml.mid_clef_changes,
                    );
                }
                let mut ml = ml;
                ml.translate_x(sys_x);
                ml
            };
            ml.part_index = part_index;
            ml.is_first_on_system = smi == 0;
            sys_x += ml.width;
            layouts.push(ml);
        }
        all_sys_layouts.push(layouts);
    }
    all_sys_layouts
}

fn push_grand_staff_measure_bounds(
    dl: &mut DisplayList,
    ml: &MeasureLayout,
    staff_y: f64,
    sp: f64,
    part_index: usize,
    staff_index: usize,
    system_index: usize,
    clef_change_measures: &HashSet<usize>,
) {
    let (total_beats, beat_anchors) = build_beat_anchors(ml);
    let leading_clef_gap = render_measure::measure_leading_clef_gap(ml, sp, clef_change_measures);
    let (x, width, prefix_width) = render_measure::measure_bounds_geometry(ml, leading_clef_gap);
    dl.measure_bounds.push(crate::render::MeasureBounds {
        index: ml.resolved.index,
        measure_id: ml.resolved.global.id.clone(),
        part_index,
        staff_index,
        system_index,
        x,
        width,
        y: staff_y,
        height: 4.0 * sp,
        prefix_width,
        total_beats,
        beat_anchors,
        ghost_staff: false,
        is_hidden: false,
        has_music_hidden: false,
        is_expansion: false,
    });
}

/// Grand-staff helper — render every staff of one system: staff lines, per-measure
/// content, beams, ties, slurs, glissandos, ottavas, hairpins, pedals, and
/// per-staff slur-bound accumulation for the cross-system pass.
#[allow(clippy::too_many_arguments)]
pub(in crate::layout) fn render_grand_staff_system_staves(
    dl: &mut DisplayList,
    all_sys_layouts: &[Vec<MeasureLayout>],
    staff_y_offsets: &[f64],
    margin_left: f64,
    sp: f64,
    config: &LayoutConfig,
    use_beams: bool,
    use_accidental_display: bool,
    lyric_line_order: Option<&[String]>,
    part_index: usize,
    sys_idx: usize,
    slur_bounds: &mut HashMap<(usize, usize, usize), slurs::SystemSlurBounds>,
    global_slur_events: &mut Vec<slurs::GlobalSlurEvent>,
    global_tie_notes: &mut Vec<GlobalTieNote>,
) {
    // Cross-staff set: a clef change on ANY staff opens the leading gap on EVERY
    // staff so the shared barline stays aligned. Built once from all staves.
    let clef_change_measures: HashSet<usize> = all_sys_layouts
        .iter()
        .flat_map(|layouts| layouts.iter())
        .filter(|ml| ml.resolved.index != 0)
        .filter(|ml| {
            ml.resolved
                .part
                .clefs
                .as_ref()
                .is_some_and(|clefs| clefs.iter().any(|c| c.position.is_none()))
        })
        .map(|ml| ml.resolved.index)
        .collect();
    // Shared across ALL staves/voices of this system. The grand-staff layout
    // flattens each voice into its own entry of `all_sys_layouts` (two voices
    // on one physical staff share a `staff_y`), so two simultaneous chords on
    // one staff are rendered by separate `si` iterations. A system-scoped
    // accumulator lets the later voice's accidental column clear the earlier
    // one's; the `(visual_staff, y-band, x-window)` filter keeps unrelated
    // staves/measures from interfering.
    //
    // Pre-seed it with EVERY voice's noteheads up front. Noteheads do not
    // depend on accidental placement, so seeding them before any voice renders
    // makes accidental-vs-notehead clearance bidirectional (the first-rendered
    // voice clears the later voice's noteheads too, not just vice versa).
    let mut acc_obstacles: Vec<AccidentalObstacle> = Vec::new();
    for (si, layouts) in all_sys_layouts.iter().enumerate() {
        let sy = staff_y_offsets[si];
        for ml in layouts {
            render_measure::collect_measure_notehead_obstacles(
                ml,
                sy,
                Some(staff_y_offsets),
                sp,
                config,
                &mut acc_obstacles,
            );
        }
    }
    for (si, layouts) in all_sys_layouts.iter().enumerate() {
        let staff_y = staff_y_offsets[si];
        let shared_lane = render_measure::shared_staff_lane(staff_y, sp, Some(staff_y_offsets));
        let x_end = layouts.last().map_or(margin_left, |ml| ml.x + ml.width);
        let staff_shape_start = dl.element_shapes.len();
        let staff_cmd_start = dl.commands.len();

        for line in 0..5 {
            let y = staff_y + line as f64 * sp;
            dl.staff_line(margin_left, x_end, y, config.staff_line_width * sp);
        }

        let global_beamed_ids = collect_all_beamed_event_ids(layouts, use_beams);
        let explicit_beamed_ids = collect_explicit_beamed_event_ids(layouts);
        let slur_map = collect_slur_participation(layouts);
        let tie_accidentals = compute_tie_accidental_map(layouts);
        let mmr_number_extents: Vec<render_annotations::AboveGlyphBox> = layouts
            .iter()
            .filter_map(|ml| render_measure::multimeasure_rest_number_extent(ml, staff_y, sp))
            .chain(layouts.iter().filter_map(|ml| {
                crate::layout::time_signatures::above_staff_extent(
                    ml,
                    staff_y,
                    sp,
                    config.time_signature_settings,
                )
            }))
            .collect();
        for (i, ml) in layouts.iter().enumerate() {
            let prev_has_repeat_end = if i > 0 {
                layouts[i - 1].resolved.global.repeat_end.is_some()
            } else {
                false
            };
            let prev_barline_type = if i > 0 {
                layouts[i - 1]
                    .resolved
                    .global
                    .barline
                    .as_ref()
                    .map(|b| &b.barline_type)
            } else {
                None
            };
            render_measure(
                dl,
                ml,
                render_measure::measure_repeat_span_right(layouts, i),
                staff_y,
                sp,
                config,
                prev_has_repeat_end,
                prev_barline_type,
                &global_beamed_ids,
                &explicit_beamed_ids,
                lyric_line_order,
                Some(staff_y_offsets),
                Some(staff_y_offsets),
                shared_lane.is_bottom,
                use_beams,
                use_accidental_display,
                Some(&slur_map),
                Some(&tie_accidentals),
                &mmr_number_extents,
                &clef_change_measures,
                &mut acc_obstacles,
            );
            let bboxes = compute_measure_bboxes(
                ml,
                staff_y,
                sp,
                config,
                part_index,
                Some(&slur_map),
                &global_beamed_ids,
                render_measure::measure_leading_clef_gap(ml, sp, &clef_change_measures),
                shared_lane.is_bottom,
                shared_lane.is_top,
                shared_lane.center_y,
            );
            dl.extend_element_bboxes_with_shapes(bboxes);

            push_grand_staff_measure_bounds(
                dl,
                ml,
                staff_y,
                sp,
                part_index,
                si,
                sys_idx,
                &clef_change_measures,
            );
        }

        render_cross_barline_beams(dl, layouts, staff_y, sp, config);
        render_ties(dl, layouts, staff_y, sp, config, Some(staff_y_offsets));
        let slur_geom_start = dl.slur_geometries.len();
        render_slurs(
            dl,
            layouts,
            staff_y,
            sp,
            config,
            Some(staff_y_offsets),
            staff_shape_start,
        );
        render_annotations::push_fermatas_clear_of_curves(dl, staff_cmd_start, slur_geom_start, sp);
        render_annotations::flow_above_staff_dependents(
            dl,
            staff_cmd_start,
            slur_geom_start,
            layouts,
            &config.placement,
            staff_y,
            sp,
        );
        render_annotations::push_below_dynamics_under_slurs(
            dl,
            layouts,
            staff_y,
            sp,
            slur_geom_start,
        );
        render_ottavas(dl, layouts, staff_y, sp, part_index);
        render_hairpins(
            dl,
            layouts,
            staff_y,
            sp,
            config,
            part_index,
            staff_cmd_start,
            slur_geom_start,
            Some(staff_y_offsets),
        );
        render_pedals(dl, layouts, staff_y, sp, config, part_index);

        slur_bounds.insert(
            (sys_idx, part_index, si),
            slurs::SystemSlurBounds {
                left_x: margin_left,
                right_x: x_end,
            },
        );
        slurs::collect_global_slur_events(
            layouts,
            staff_y,
            Some(staff_y_offsets),
            sp,
            config,
            sys_idx,
            part_index,
            si,
            global_slur_events,
        );
        collect_global_tie_notes(
            layouts,
            staff_y,
            Some(staff_y_offsets),
            sp,
            config,
            sys_idx,
            part_index,
            si,
            global_tie_notes,
        );
    }

    // System-wide pass: a harp/keyboard gliss can join two staves of the part,
    // so both endpoints must be visible to one call.
    let gliss_staves: Vec<glissando::GlissandoStaff<'_>> = all_sys_layouts
        .iter()
        .enumerate()
        .map(|(si, layouts)| (layouts.as_slice(), staff_y_offsets[si]))
        .collect();
    render_glissandos(dl, &gliss_staves, sp, config, Some(staff_y_offsets));
}

/// Grand-staff helper — draw the brace, system-start barline, inter-staff
/// barline connectors at every measure boundary, the final barline, and
/// repeat-counts, for one system.
#[allow(clippy::too_many_arguments)]
pub(in crate::layout) fn render_grand_staff_system_connectors(
    dl: &mut DisplayList,
    all_sys_layouts: &[Vec<MeasureLayout>],
    staff_y_offsets: &[f64],
    num_staves: usize,
    margin_left: f64,
    staff_height: f64,
    barline_w: f64,
    sys_idx: usize,
    system_count: usize,
    sp: f64,
    config: &LayoutConfig,
) {
    let Some(top_layouts) = all_sys_layouts.first() else {
        return;
    };
    let system_top = staff_y_offsets[0];
    let system_bottom = staff_y_offsets.last().copied().unwrap_or(system_top) + staff_height;

    // System start barline connecting all staves
    dl.push(RenderCommand::DrawLine {
        x1: margin_left,
        y1: system_top,
        x2: margin_left,
        y2: system_bottom,
        width: barline_w * 1.5,
        color: "#000000".into(),
    });

    // Brace glyph to the left, scaled to span all staves.
    // The SMuFL brace glyph origin (baseline) is at its bottom (bBoxSW.y = 0),
    // so y must be at system_bottom and the font size scaled by the glyph's
    // design height to produce the exact desired span.
    let brace = brace_geometry(system_bottom - system_top, staff_y_offsets.len(), sp);
    dl.push(RenderCommand::DrawStretchedGlyph {
        x: margin_left - brace.width - 0.3 * sp,
        y: system_bottom,
        codepoint: brace.codepoint,
        font: "Bravura".into(),
        size: brace.size,
        scale_x: brace.scale_x,
        color: "#000000".into(),
    });

    // Inter-staff barlines at each measure boundary
    for (mi, ml) in top_layouts.iter().enumerate() {
        if mi > 0 {
            let prev_ml = &top_layouts[mi - 1];
            let prev_has_repeat_end = prev_ml.resolved.global.repeat_end.is_some();
            let has_repeat_start = ml.resolved.global.repeat_start.is_some();
            let connector_bt = BarlineKind::at_boundary(
                prev_has_repeat_end,
                has_repeat_start,
                prev_ml
                    .resolved
                    .global
                    .barline
                    .as_ref()
                    .map(|b| &b.barline_type),
                BarlineType::Regular,
            );
            let barline_tag = element_id::barline(ml.resolved.index);
            for gap_idx in 0..(num_staves - 1) {
                render_tagged_barline_connector(
                    dl,
                    BarlineGap {
                        x: ml.x,
                        y_top: staff_y_offsets[gap_idx] + staff_height,
                        y_bottom: staff_y_offsets[gap_idx + 1],
                    },
                    sp,
                    config,
                    &connector_bt,
                    &barline_tag,
                );
            }
        }
    }

    // Final barline connecting staves
    let is_last_system = sys_idx == system_count - 1;
    if let Some(last_ml) = top_layouts.last() {
        let end_x = last_ml.x + last_ml.width;

        let barline_kind = if last_ml.resolved.global.repeat_end.is_some() {
            BarlineKind::RepeatEnd
        } else if is_last_system {
            BarlineKind::from(
                last_ml
                    .resolved
                    .global
                    .barline
                    .as_ref()
                    .map(|b| b.barline_type)
                    .unwrap_or(BarlineType::Final),
            )
        } else {
            BarlineKind::Regular
        };

        let barline_tag = element_id::barline(last_ml.resolved.index + 1);
        let cmd_idx = dl.commands.len();
        for &staff_y in staff_y_offsets {
            render_barline(dl, end_x, staff_y, staff_height, sp, config, &barline_kind);
        }
        for ci in cmd_idx..dl.commands.len() {
            dl.tag_command(ci, barline_tag.clone());
        }

        for gap_idx in 0..(num_staves - 1) {
            render_tagged_barline_connector(
                dl,
                BarlineGap {
                    x: end_x,
                    y_top: staff_y_offsets[gap_idx] + staff_height,
                    y_bottom: staff_y_offsets[gap_idx + 1],
                },
                sp,
                config,
                &barline_kind,
                &barline_tag,
            );
        }

        dl.push_element_bbox_with_shape(ElementBBox {
            element_id: barline_tag,
            bbox: BoundingBox::new(
                end_x - barline_w * 0.5,
                staff_y_offsets[0],
                barline_w.max(1.0 * sp),
                staff_height,
            ),
        });
    }

    render_repeat_counts(dl, top_layouts, staff_y_offsets[0], sp);
}

/// Layout a grand staff part (staves >= 2) and produce a DisplayList.
/// Renders multiple staves per part with a brace and shared barlines.
#[allow(clippy::too_many_lines)] // single grand-staff layout pipeline; cohesive collect→measure→emit stages
pub(in crate::layout) fn layout_grand_staff_score_cached(
    score: &Score,
    part_index: usize,
    config: &LayoutConfig,
    mut cache: Option<&mut cache::LayoutCache>,
) -> DisplayList {
    let sp = config.sp;
    let part = &score.parts[part_index];
    let num_staves = part.staves as usize;
    let staff_height = 4.0 * sp;
    let use_beams = score
        .mnx
        .support
        .as_ref()
        .and_then(|s| s.use_beams)
        .unwrap_or(false);
    let use_accidental_display = score
        .mnx
        .support
        .as_ref()
        .and_then(|s| s.use_accidental_display)
        .unwrap_or(false);

    // Compute inter-staff gap: extra space when dynamics or multi-voice stems are present
    let has_dynamics = part
        .measures
        .iter()
        .any(|m| m.dynamics.as_ref().is_some_and(|d| !d.is_empty()));
    let has_multi_voice = part.measures.iter().any(|m| m.sequences.len() > 1);
    let mut inter_staff_gap = if has_dynamics && has_multi_voice {
        11.0 * sp
    } else if has_dynamics || has_multi_voice {
        9.0 * sp
    } else {
        7.0 * sp
    };
    let meters_on_each_staff = config.time_signature_settings.distribution
        == crate::model::time::TimeSignatureDistribution::PerStaff
        || config.time_signature_settings.grand_staff
            == crate::model::time::TimeSignatureGrandStaff::Exclude;
    if meters_on_each_staff {
        inter_staff_gap =
            inter_staff_gap.max(crate::layout::time_signatures::above_position_clearance(
                config.time_signature_settings,
                sp,
            ));
    }

    // Resolve measures for each staff
    let all_resolved: Vec<Vec<ResolvedMeasure>> = (1..=num_staves)
        .map(|s| resolve_measures_for_staff(score, part_index, s as u32))
        .collect();
    let all_resolved_ottavas: Vec<Vec<ResolvedOttavaRange>> = all_resolved
        .iter()
        .map(|resolved| resolve_all_ottavas(resolved))
        .collect();

    // Detect common shortest duration across all staves
    let mut all_durations: Vec<f64> = Vec::new();
    for resolved in &all_resolved {
        all_durations.extend(collect_all_event_durations(resolved));
    }
    let common_shortest_beats = detect_common_shortest_duration(&all_durations);

    let measure_count = all_resolved.iter().map(|r| r.len()).max().unwrap_or(0);

    // Compute natural widths per staff per measure, take max
    // Use cache for natural widths when available
    if let Some(ref mut c) = cache {
        c.check_config(config);
        c.reset_stats();
    }

    let (natural_widths_per_staff, gs_content_hash_grid) = compute_grand_staff_natural_widths(
        &all_resolved,
        &all_resolved_ottavas,
        sp,
        config,
        common_shortest_beats,
        cache.as_deref_mut(),
    );

    let max_widths: Vec<f64> = (0..measure_count)
        .map(|mi| {
            let natural_width = natural_widths_per_staff
                .iter()
                .filter_map(|pw| pw.get(mi))
                .copied()
                .fold(0.0f64, f64::max);
            let included_prefix = all_resolved
                .iter()
                .filter_map(|resolved| resolved.get(mi))
                .map(|measure| compute_prefix_width(measure, sp, false, config))
                .fold(0.0f64, f64::max);
            let aligned_prefix = compute_max_prefix_width(
                all_resolved.iter().filter_map(|resolved| resolved.get(mi)),
                sp,
                false,
                config,
            );
            natural_width_with_aligned_prefix(natural_width, included_prefix, aligned_prefix)
        })
        .collect();

    // Extra left margin for brace
    let brace_margin = 2.0 * sp;
    let base_margin_l = if config.page_width.is_some() {
        config.page_margin_left * sp
    } else {
        config.margin_left * sp
    };
    let base_margin_r = if config.page_width.is_some() {
        config.page_margin_right * sp
    } else {
        config.margin_right * sp
    };
    let margin_left = base_margin_l + brace_margin;
    let margin_top = config.margin_top * sp;

    // System breaks
    let content_width = config.page_width.map(|pw| pw - margin_left - base_margin_r);
    let systems = if let Some(avail) = content_width {
        if avail > 0.0 {
            // Keep a wide tempo on one line by breaking the system before its
            // measure rather than letting it overrun the right margin.
            let systems = break_into_systems(&max_widths, avail);
            let tempo_widths = render_annotations::global_tempo_widths(
                &score.global.measures,
                measure_count,
                config,
                sp,
            );
            system::enforce_tempo_system_breaks(systems, &max_widths, &tempo_widths, avail)
        } else {
            vec![(0..measure_count).collect()]
        }
    } else {
        vec![(0..measure_count).collect()]
    };

    let system_count = systems.len();
    let inter_system_gap = 10.0 * sp;
    let single_system_height =
        num_staves as f64 * staff_height + (num_staves - 1) as f64 * inter_staff_gap;

    let page_w = if let Some(pw) = config.page_width {
        pw
    } else {
        let natural_total: f64 = max_widths.iter().sum();
        margin_left + natural_total + config.margin_right * sp
    };
    let total_height = margin_top * 2.0
        + system_count as f64 * single_system_height
        + if system_count > 1 {
            (system_count - 1) as f64 * inter_system_gap
        } else {
            0.0
        };

    let mut dl = DisplayList::new(page_w, total_height);
    let barline_w = config.barline_width * sp;
    let lyric_line_order = score
        .global
        .lyrics
        .as_ref()
        .and_then(|gl| gl.line_order.as_deref());

    // Accumulators for the cross-system slur post-pass. Same rationale as in
    // `layout_score_cached` (single-staff path).
    let mut global_slur_events: Vec<slurs::GlobalSlurEvent> = Vec::new();
    let mut global_tie_notes: Vec<GlobalTieNote> = Vec::new();
    let mut slur_bounds: std::collections::HashMap<(usize, usize, usize), slurs::SystemSlurBounds> =
        std::collections::HashMap::new();

    for (sys_idx, sys_measures) in systems.iter().enumerate() {
        let system_y_base = margin_top + sys_idx as f64 * (single_system_height + inter_system_gap);

        let natural_total: f64 = sys_measures.iter().map(|&mi| max_widths[mi]).sum();
        let avail_w = content_width.unwrap_or(natural_total);
        let scale = if natural_total > 0.0 && config.page_width.is_some() {
            if sys_idx == system_count - 1 && natural_total < avail_w * 0.65 && system_count > 1 {
                1.0
            } else {
                avail_w / natural_total
            }
        } else {
            1.0
        };

        let staff_y_offsets: Vec<f64> = (0..num_staves)
            .map(|i| system_y_base + i as f64 * (staff_height + inter_staff_gap))
            .collect();

        // Layout measures for each staff
        let (merged_spacings, max_prefix_widths) = compute_system_spacing(
            &all_resolved,
            sys_measures,
            sp,
            common_shortest_beats,
            config,
            None,
        );

        let mut all_sys_layouts = layout_grand_staff_system_measures(
            &all_resolved,
            &all_resolved_ottavas,
            sys_measures,
            &max_widths,
            &gs_content_hash_grid,
            &merged_spacings,
            &max_prefix_widths,
            scale,
            margin_left,
            sp,
            config,
            common_shortest_beats,
            part_index,
            cache.as_deref_mut(),
        );

        // Fix note positions for cross-staff events: recompute using the target staff's clef
        {
            let visual_staves: Vec<(usize, u32)> =
                (1..=num_staves).map(|s| (part_index, s as u32)).collect();
            fix_cross_staff_note_positions(&mut all_sys_layouts, &visual_staves, sp, config);
        }

        // Draw staff lines and render each staff's contents
        render_grand_staff_system_staves(
            &mut dl,
            &all_sys_layouts,
            &staff_y_offsets,
            margin_left,
            sp,
            config,
            use_beams,
            use_accidental_display,
            lyric_line_order,
            part_index,
            sys_idx,
            &mut slur_bounds,
            &mut global_slur_events,
            &mut global_tie_notes,
        );

        // Volta brackets on the top staff only
        if let Some(top_layouts) = all_sys_layouts.first() {
            render_volta_brackets(&mut dl, top_layouts, staff_y_offsets[0], sp, part_index);
        }

        render_grand_staff_system_connectors(
            &mut dl,
            &all_sys_layouts,
            &staff_y_offsets,
            num_staves,
            margin_left,
            staff_height,
            barline_w,
            sys_idx,
            system_count,
            sp,
            config,
        );

        crate::layout::time_signatures::spanning::render_grand_staff_meters(
            &mut dl,
            &all_sys_layouts,
            &staff_y_offsets,
            config,
        );
    }

    render_cross_system_ties(&mut dl, &global_tie_notes, &slur_bounds, sp, config, false);
    slurs::render_cross_system_slurs(
        &mut dl,
        &global_slur_events,
        &slur_bounds,
        sp,
        config,
        false,
    );

    let system_heights: Vec<f64> = vec![single_system_height; system_count];
    dl.pages = compute_page_breaks(&system_heights, config, 0.0);

    dl
}
