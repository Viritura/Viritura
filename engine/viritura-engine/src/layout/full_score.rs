// Full-score orchestral layout (extracted from layout.rs)

pub use super::config::LayoutConfig;
use super::page::render_title_block;

use super::beams::*;
use super::element_id;
use super::glissando::*;
use super::hairpins::*;
use super::measure::*;
use super::page::*;
use super::pedals::*;
use super::render_barlines::*;
use super::render_events::compute_tie_accidental_map;
use super::render_measure::*;
use super::resolve::*;
use super::slurs::*;
use super::spacing::*;
use super::staff_brace::brace_geometry;
use super::ties::*;
use super::types::*;
use super::volta::*;
use super::{build_beat_anchors, layout_score_cached};
use crate::model::*;
use crate::render::*;
use std::collections::HashSet;

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

#[path = "full_score/natural_widths.rs"]
mod natural_widths;
#[path = "full_score/page_geometry.rs"]
mod page_geometry;
#[path = "full_score/system_chrome.rs"]
mod system_chrome;

use natural_widths::compute_natural_widths_grid;
use page_geometry::{compute_full_score_page_layout, compute_inter_staff_gap, FullScorePageLayout};
use system_chrome::render_system_chrome;

/// Compute a compound hash for full-layout caching in multi-part mode.
/// Includes measure content, forced width, shared spacing, and prefix width
/// so the cache correctly invalidates when any of these change.
fn compound_layout_hash(
    content_hash: u64,
    forced_width: f64,
    spacing: &LogSpacing,
    prefix: AlignedPrefix,
) -> u64 {
    let mut hasher = DefaultHasher::new();
    content_hash.hash(&mut hasher);
    forced_width.to_bits().hash(&mut hasher);
    prefix.width.to_bits().hash(&mut hasher);
    prefix.first_onset_padding.to_bits().hash(&mut hasher);
    for &(beat, x) in &spacing.mapping {
        beat.to_bits().hash(&mut hasher);
        x.to_bits().hash(&mut hasher);
    }
    spacing.total_width.to_bits().hash(&mut hasher);
    hasher.finish()
}

/// Layout all parts of a score stacked vertically and produce a single DisplayList.
///
/// Aligns measures across parts, draws system barlines connecting staves,
/// and renders part name labels to the left. Handles grand staff parts
/// (staves >= 2) by splitting them into separate visual staves with braces.
pub fn layout_full_score(score: &Score, config: &LayoutConfig) -> DisplayList {
    layout_full_score_cached(score, config, None)
}

/// Layout all parts with an optional layout cache.
#[allow(clippy::too_many_lines)] // single multi-part assembly pass; cohesive pipeline stage
pub fn layout_full_score_cached(
    score: &Score,
    config: &LayoutConfig,
    mut cache: Option<&mut super::cache::LayoutCache>,
) -> DisplayList {
    // P1: consume any patch-side dirty range so the cache invariant
    // "after any cached layout pass `pending_dirty_range` is `None`" holds for
    // non-MNX layouts too. The full-score path does not yet honor the range
    // (Phases A–D scope only the MNX auto-flow path), so we discard.
    let _ = cache
        .as_deref_mut()
        .and_then(|c| c.take_pending_dirty_range());

    let part_count = score.parts.len();
    if part_count == 0 {
        return DisplayList::new(0.0, 0.0);
    }
    if part_count == 1 {
        return layout_score_cached(score, 0, config, cache);
    }

    // Apply the document's `_x.viritura` overrides. This path (no MNX layouts
    // or score definitions) renders every part stacked, which is a score.
    let merged_config = crate::layout::orchestration::config_with_document_overrides(
        score,
        config,
        LayoutContext::Score,
    );
    let config = merged_config.as_ref().unwrap_or(config);

    let sp = config.sp;
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
    // Dynamic inter-staff gap based on content complexity
    let inter_staff_gap = compute_inter_staff_gap(score, sp).max(
        crate::layout::time_signatures::above_position_clearance(
            config.time_signature_settings,
            sp,
        ),
    );

    // Build visual staff mapping: (part_index, staff_number)
    let mut visual_staves: Vec<(usize, u32)> = Vec::new();
    for (pi, part) in score.parts.iter().enumerate() {
        let ns = part.staves.max(1);
        for s in 1..=ns {
            visual_staves.push((pi, s));
        }
    }
    let visual_staff_count = visual_staves.len();

    // Resolve measures for each visual staff
    let all_resolved: Vec<Vec<ResolvedMeasure>> = visual_staves
        .iter()
        .map(|&(pi, sn)| {
            if score.parts[pi].staves >= 2 {
                resolve_measures_for_staff(score, pi, sn)
            } else {
                resolve_measures(score, pi)
            }
        })
        .collect();
    let all_resolved_ottavas: Vec<Vec<ResolvedOttavaRange>> = all_resolved
        .iter()
        .map(|resolved| resolve_all_ottavas(resolved))
        .collect();

    // Detect common shortest duration across all parts
    let mut all_durations: Vec<f64> = Vec::new();
    for resolved in &all_resolved {
        all_durations.extend(collect_all_event_durations(resolved));
    }
    let common_shortest_beats = detect_common_shortest_duration(&all_durations);

    let measure_count = all_resolved.iter().map(|r| r.len()).max().unwrap_or(0);

    // First pass: compute natural measure widths + content hashes for every
    // (visual-staff, measure) cell, using the layout cache when available.
    if let Some(ref mut c) = cache {
        c.check_config(config);
        c.reset_stats();
    }
    let (natural_widths, content_hash_grid) = compute_natural_widths_grid(
        &all_resolved,
        &all_resolved_ottavas,
        sp,
        config,
        common_shortest_beats,
        cache.as_deref_mut(),
    );

    // Compute max width per measure across all visual staves
    let max_widths: Vec<f64> = (0..measure_count)
        .map(|mi| {
            let natural_width = natural_widths
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

    // Compute extra left margin for part name labels + potential brace, then
    // resolve all derived page/system dimensions in a single helper to keep
    // the per-system loop below short.
    let layout_dims = compute_full_score_page_layout(
        score,
        config,
        &max_widths,
        measure_count,
        visual_staff_count,
        staff_height,
        inter_staff_gap,
        sp,
    );
    let FullScorePageLayout {
        margin_left,
        brace_margin,
        label_margin,
        content_width,
        systems,
        system_count,
        system_y_positions,
        justified_gaps,
        page_w,
        total_height,
        pages,
    } = layout_dims;

    let total_width = page_w;
    let mut dl = DisplayList::new(total_width, total_height);

    // Render title block on page 1
    if config.page_width.is_some() {
        let title_y = config.page_margin_top * sp;
        let title_cmds = render_title_block(score.metadata(), config, title_y, page_w);
        for cmd in title_cmds {
            dl.commands.push(cmd);
        }
    }

    let lyric_line_order = score
        .global
        .lyrics
        .as_ref()
        .and_then(|gl| gl.line_order.as_deref());

    // Accumulators for the cross-system slur post-pass. The per-staff
    // `render_slurs` call below only handles slurs whose source and target
    // share a single (system, part, staff) triple; anything crossing a system
    // (or page) boundary is captured here and rendered as two half-beziers
    // after all systems are laid out.
    let mut global_slur_events: Vec<GlobalSlurEvent> = Vec::new();
    let mut global_tie_notes: Vec<GlobalTieNote> = Vec::new();
    let mut slur_bounds: std::collections::HashMap<(usize, usize, usize), SystemSlurBounds> =
        std::collections::HashMap::new();

    // Measures with a start-of-measure clef change in ANY part. Standard
    // engraving practice engraves such a change before the preceding barline;
    // the leading gap is opened on every staff (shared barline alignment), so
    // the set is cross-part and constant across systems.
    let clef_change_measures =
        super::render_measure::clef_change_measure_set_resolved(&all_resolved);

    for (sys_idx, sys_measures) in systems.iter().enumerate() {
        let system_y_base = system_y_positions[sys_idx];

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

        let staff_y_offsets: Vec<f64> = (0..visual_staff_count)
            .map(|i| system_y_base + i as f64 * (staff_height + justified_gaps[sys_idx]))
            .collect();

        let (merged_spacings, max_prefix_widths) = compute_system_spacing(
            &all_resolved,
            sys_measures,
            sp,
            common_shortest_beats,
            config,
            None,
        );

        let mut all_sys_layouts = build_system_measure_layouts(
            &all_resolved,
            &all_resolved_ottavas,
            sys_measures,
            &visual_staves,
            &max_widths,
            &content_hash_grid,
            &merged_spacings,
            &max_prefix_widths,
            margin_left,
            scale,
            sp,
            common_shortest_beats,
            config,
            cache.as_deref_mut(),
        );

        // Fix note positions for cross-staff events: recompute using the target staff's clef
        fix_cross_staff_note_positions(&mut all_sys_layouts, &visual_staves, sp, config);

        for (vi, measure_layouts) in all_sys_layouts.iter().enumerate() {
            render_one_staff_for_system(
                &mut dl,
                config,
                sys_idx,
                vi,
                measure_layouts,
                &staff_y_offsets,
                &visual_staves,
                margin_left,
                sp,
                use_beams,
                use_accidental_display,
                lyric_line_order,
                &clef_change_measures,
                &mut global_slur_events,
                &mut slur_bounds,
                &mut global_tie_notes,
            );
        }

        // System-wide pass: a harp/keyboard gliss can join two staves of one
        // part, so both endpoints must be visible to one call.
        let gliss_staves: Vec<super::glissando::GlissandoStaff<'_>> = all_sys_layouts
            .iter()
            .enumerate()
            .map(|(vi, layouts)| (layouts.as_slice(), staff_y_offsets[vi]))
            .collect();
        render_glissandos(&mut dl, &gliss_staves, sp, config, Some(&staff_y_offsets));

        if let Some(first_layouts) = all_sys_layouts.first() {
            let volta_part_index = visual_staves.first().map_or(0, |vs| vs.0);
            render_volta_brackets(
                &mut dl,
                first_layouts,
                staff_y_offsets[0],
                sp,
                volta_part_index,
            );
        }

        render_system_chrome(
            &mut dl,
            score,
            config,
            sys_idx,
            system_count,
            &all_sys_layouts,
            &visual_staves,
            visual_staff_count,
            &staff_y_offsets,
            margin_left,
            brace_margin,
            label_margin,
            staff_height,
            sp,
        );

        // Group-spanning meters. This path has no MNX layout definitions and
        // therefore no bracket groups, so each staff carries its own meter.
        for (vi, measure_layouts) in all_sys_layouts.iter().enumerate() {
            let staff_y = staff_y_offsets[vi];
            crate::layout::time_signatures::spanning::render_span_meters(
                &mut dl,
                measure_layouts,
                staff_y,
                staff_y + staff_height,
                config,
            );
        }
    }

    render_cross_system_ties(&mut dl, &global_tie_notes, &slur_bounds, sp, config, false);
    // Broken slurs render after ties so their local pieces can clear tie bands.
    render_cross_system_slurs(
        &mut dl,
        &global_slur_events,
        &slur_bounds,
        sp,
        config,
        false,
    );
    super::render_annotations::push_fermatas_clear_of_curves(&mut dl, 0, 0, sp);

    dl.pages = pages;

    dl
}

/// Build the per-visual-staff `MeasureLayout` vectors for one system,
/// consulting the layout cache when present and applying horizontal scale.
///
/// Extracted from `layout_full_score_cached` to keep that function under the
/// `too_many_lines` threshold.
#[allow(clippy::too_many_arguments)] // builder for one system's measure layouts
fn build_system_measure_layouts(
    all_resolved: &[Vec<ResolvedMeasure>],
    all_resolved_ottavas: &[Vec<ResolvedOttavaRange>],
    sys_measures: &[usize],
    visual_staves: &[(usize, u32)],
    max_widths: &[f64],
    content_hash_grid: &[Vec<u64>],
    merged_spacings: &[LogSpacing],
    max_prefix_widths: &[AlignedPrefix],
    margin_left: f64,
    scale: f64,
    sp: f64,
    common_shortest_beats: f64,
    config: &LayoutConfig,
    mut cache: Option<&mut super::cache::LayoutCache>,
) -> Vec<Vec<MeasureLayout>> {
    let mut all_sys_layouts: Vec<Vec<MeasureLayout>> = Vec::new();
    for (vi, resolved) in all_resolved.iter().enumerate() {
        let mut sys_x = margin_left;
        let mut measure_layouts = Vec::new();
        for (si, &mi) in sys_measures.iter().enumerate() {
            if mi >= resolved.len() {
                continue;
            }
            let rm = &resolved[mi];
            let fw = max_widths[mi] * scale;
            let content_hash = content_hash_grid[vi][mi];
            // Use offset key space to avoid collision with single-part cache
            let cache_key = 1_000_000 + mi * 1000 + vi;
            let compound_hash = compound_layout_hash(
                content_hash,
                fw,
                &merged_spacings[si],
                max_prefix_widths[si],
            );

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
                // Compute at x=0 for position-independent caching
                let ml = layout_measure_with_shared_spacing(
                    rm,
                    sp,
                    0.0,
                    config,
                    Some(fw),
                    &all_resolved_ottavas[vi],
                    common_shortest_beats,
                    &merged_spacings[si],
                    Some(max_prefix_widths[si]),
                    &[],
                    si == 0,
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
            ml.part_index = visual_staves[vi].0;
            ml.is_first_on_system = si == 0;
            sys_x += ml.width;
            measure_layouts.push(ml);
        }
        all_sys_layouts.push(measure_layouts);
    }
    all_sys_layouts
}

/// Render one visual staff's contents (staff lines, per-measure music,
/// cross-barline beams, ties, slurs, glissandos, ottavas, hairpins, pedals)
/// inside a single system and append its slur bounds + global slur events to
/// the cross-system accumulators.
///
/// Extracted from `layout_full_score_cached` to keep that function under the
/// `too_many_lines` threshold.
#[allow(clippy::too_many_arguments)] // staff-content dispatch
fn render_one_staff_for_system(
    dl: &mut DisplayList,
    config: &LayoutConfig,
    sys_idx: usize,
    vi: usize,
    measure_layouts: &[MeasureLayout],
    staff_y_offsets: &[f64],
    visual_staves: &[(usize, u32)],
    margin_left: f64,
    sp: f64,
    use_beams: bool,
    use_accidental_display: bool,
    lyric_line_order: Option<&[String]>,
    clef_change_measures: &std::collections::HashSet<usize>,
    global_slur_events: &mut Vec<GlobalSlurEvent>,
    slur_bounds: &mut std::collections::HashMap<(usize, usize, usize), SystemSlurBounds>,
    global_tie_notes: &mut Vec<GlobalTieNote>,
) {
    let staff_y = staff_y_offsets[vi];
    let x_end = measure_layouts
        .last()
        .map_or(margin_left, |ml| ml.x + ml.width);
    let staff_shape_start = dl.element_shapes.len();
    let staff_cmd_start = dl.commands.len();

    for line in 0..5 {
        let y = staff_y + line as f64 * sp;
        dl.staff_line(margin_left, x_end, y, config.staff_line_width * sp);
    }

    let global_beamed_ids = collect_all_beamed_event_ids(measure_layouts, use_beams);
    let explicit_beamed_ids = collect_explicit_beamed_event_ids(measure_layouts);
    let slur_map = collect_slur_participation(measure_layouts);
    let tie_accidentals = compute_tie_accidental_map(measure_layouts);

    // Multimeasure-rest count numbers protrude above the staff; collect their
    // horizontal bands so a tempo marking in any measure of this system can
    // hop above a neighbouring count number it would otherwise collide with.
    // An above-staff meter occupies the same band of air, so it joins the list.
    let mmr_number_extents: Vec<super::render_annotations::AboveGlyphBox> = measure_layouts
        .iter()
        .filter_map(|ml| multimeasure_rest_number_extent(ml, staff_y, sp))
        .chain(measure_layouts.iter().filter_map(|ml| {
            crate::layout::time_signatures::above_staff_extent(
                ml,
                staff_y,
                sp,
                config.time_signature_settings,
            )
        }))
        .collect();

    // Shared across this system's measure/voice layouts (see render_measure).
    let mut acc_obstacles: Vec<(u32, f64, f64, f64, f64)> = Vec::new();

    for (i, ml) in measure_layouts.iter().enumerate() {
        let prev_has_repeat_end = if i > 0 {
            measure_layouts[i - 1].resolved.global.repeat_end.is_some()
        } else {
            false
        };
        let prev_barline_type = if i > 0 {
            measure_layouts[i - 1]
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
            measure_repeat_span_right(measure_layouts, i),
            staff_y,
            sp,
            config,
            prev_has_repeat_end,
            prev_barline_type,
            &global_beamed_ids,
            &explicit_beamed_ids,
            lyric_line_order,
            Some(staff_y_offsets),
            use_beams,
            use_accidental_display,
            Some(&slur_map),
            Some(&tie_accidentals),
            &mmr_number_extents,
            clef_change_measures,
            &mut acc_obstacles,
        );

        dl.measure_bounds.push({
            let (total_beats, beat_anchors) = build_beat_anchors(ml);
            let leading_clef_gap =
                super::render_measure::measure_leading_clef_gap(ml, sp, clef_change_measures);
            let (bounds_x, bounds_width, bounds_prefix) =
                super::render_measure::measure_bounds_geometry(ml, leading_clef_gap);
            crate::render::MeasureBounds {
                index: ml.resolved.index,
                measure_id: ml.resolved.global.id.clone(),
                part_index: vi,
                staff_index: vi,
                system_index: sys_idx,
                x: bounds_x,
                width: bounds_width,
                y: staff_y,
                height: 4.0 * sp,
                prefix_width: bounds_prefix,
                total_beats,
                beat_anchors,
                ghost_staff: false,
                is_hidden: false,
                has_music_hidden: false,
                is_expansion: false,
            }
        });
    }

    render_cross_barline_beams(dl, measure_layouts, staff_y, sp, config);
    render_ties(
        dl,
        measure_layouts,
        staff_y,
        sp,
        config,
        Some(staff_y_offsets),
    );
    let slur_geom_start = dl.slur_geometries.len();
    render_slurs(
        dl,
        measure_layouts,
        staff_y,
        sp,
        config,
        Some(staff_y_offsets),
        staff_shape_start,
    );
    super::render_annotations::push_fermatas_clear_of_curves(
        dl,
        staff_cmd_start,
        slur_geom_start,
        sp,
    );
    super::render_annotations::flow_above_staff_dependents(
        dl,
        staff_cmd_start,
        slur_geom_start,
        measure_layouts,
        &config.placement,
        staff_y,
        sp,
    );
    super::render_annotations::push_below_dynamics_under_slurs(
        dl,
        measure_layouts,
        staff_y,
        sp,
        slur_geom_start,
    );
    let actual_part_index = visual_staves[vi].0;
    let actual_staff_idx = visual_staves[vi].1 as usize;
    render_ottavas(dl, measure_layouts, staff_y, sp, actual_part_index);
    render_hairpins(
        dl,
        measure_layouts,
        staff_y,
        sp,
        config,
        actual_part_index,
        staff_cmd_start,
        slur_geom_start,
        None,
    );
    render_pedals(dl, measure_layouts, staff_y, sp, config, actual_part_index);

    // Capture this staff's event positions + system bounds so the
    // cross-system slur pass below can connect endpoints that live
    // in different systems (or pages).
    slur_bounds.insert(
        (sys_idx, actual_part_index, actual_staff_idx),
        SystemSlurBounds {
            left_x: margin_left,
            right_x: x_end,
        },
    );
    collect_global_slur_events(
        measure_layouts,
        staff_y,
        Some(staff_y_offsets),
        sp,
        config,
        sys_idx,
        actual_part_index,
        actual_staff_idx,
        global_slur_events,
    );
    collect_global_tie_notes(
        measure_layouts,
        staff_y,
        Some(staff_y_offsets),
        sp,
        config,
        sys_idx,
        actual_part_index,
        actual_staff_idx,
        global_tie_notes,
    );
}

// ═══════════════════════════════════════════
// MNX Layout-driven rendering (Tier 5)
// ═══════════════════════════════════════════

/// A flattened staff derived from the layout content tree.
#[derive(Clone)]
pub(super) struct FlatStaff {
    /// Part indices and optional staff/voice/stem constraints for this staff.
    pub(crate) sources: Vec<FlatSource>,
    /// Full label to display for this staff (used on the first system).
    pub(crate) label: Option<String>,
    /// Abbreviated label for subsequent systems.
    pub(crate) short_label: Option<String>,
    /// Whether this is an expansion staff (rendered dimmed).
    pub(crate) expansion: bool,
    /// For condensed staves: per-source numbers to display stacked vertically.
    /// When non-empty, `label`/`short_label` hold the base instrument name only.
    pub(crate) condensed_numbers: Vec<u32>,
}

#[derive(Clone)]
pub(super) struct FlatSource {
    pub(crate) part_index: usize,
    pub(crate) staff_number: Option<u32>,
    pub(crate) voice_filter: Option<String>,
    pub(crate) stem_direction: Option<String>,
}

impl FlatStaff {
    /// A staff is in condensing mode when it has multiple source parts
    /// and none of them specify explicit stem directions. Explicit stems
    /// indicate a manual divisi layout (not auto-condensing).
    pub(crate) fn is_condensing(&self) -> bool {
        self.sources.len() > 1 && self.sources.iter().all(|s| s.stem_direction.is_none())
    }
}

/// A group range for rendering brackets/braces.
#[derive(Clone)]
pub(super) struct GroupRange {
    /// First staff index in this group (0-indexed into flat staves).
    pub(crate) first_staff: usize,
    /// Last staff index in this group (inclusive).
    pub(crate) last_staff: usize,
    /// Symbol type: "bracket", "brace", or "noSymbol".
    /// Nested brackets automatically render as thin lines.
    pub(crate) symbol: String,
    /// Group label.
    pub(crate) label: Option<String>,
    /// Nesting depth for line brackets (0 = first level, 1 = second level, etc.).
    pub(crate) depth: usize,
}

/// Compute which staff indices should display system objects (tempo, rehearsal marks).
/// Returns the first staff index of each top-level (depth 0) group.
/// If no depth-0 groups exist, returns just index 0 (the very first staff).
pub(super) fn compute_system_object_staves(
    group_ranges: &[GroupRange],
    staff_count: usize,
) -> HashSet<usize> {
    let mut result = HashSet::new();
    let top_groups: Vec<&GroupRange> = group_ranges.iter().filter(|g| g.depth == 0).collect();
    if top_groups.is_empty() {
        if staff_count > 0 {
            result.insert(0);
        }
    } else {
        for g in &top_groups {
            result.insert(g.first_staff);
        }
    }
    result
}
