use super::super::config::LayoutConfig;
use super::super::types::MeasureLayout;
use super::{endpoint_articulation_relation, EndpointArticulationRelation};
use std::collections::HashMap;
use std::ops::{Deref, DerefMut};

pub(super) type SlurSpan = (String, String, f64, f64);

pub(super) type SlurObstacleMaps = (
    HashMap<String, EventRenderInfo>,
    HashMap<String, (f64, f64)>,
    Vec<SlurObstacle>,
);

pub(super) type SlurNestDepths = (
    Vec<SlurSpan>,
    HashMap<(String, String), usize>,
    Vec<(u32, u32)>,
);

/// Cached position info for an event used during slur lookup.
///
/// The fields after `eff_staff_y` are S1 data-plumbing additions that
/// downstream phases (S2-S8) consume. Each carries a sensible default when
/// upstream data isn't yet plumbed — see field comments for the consuming
/// phase and current best-effort status.
#[derive(Clone)]
pub(crate) struct EndpointSnapshot {
    pub(crate) x: f64,
    /// Representative Y staff position (topmost note in half-spaces from top line)
    pub(crate) y_pos: f64,
    /// Bottom-most note Y staff position (for choosing curve endpoints)
    pub(crate) y_pos_bottom: f64,
    pub(crate) stem_up: bool,
    /// Whether the event draws a real stem. Whole notes retain a notional stem
    /// direction for voice/curve decisions but must not anchor at a phantom tip.
    pub(crate) has_stem: bool,
    pub(crate) notehead_w: f64,
    /// Number of notes in the endpoint chord. Two-note outer-note pairs use
    /// a shared spring line; denser chords retain independent note targeting.
    pub(crate) note_count: usize,
    /// Effective staff_y (cross-staff aware)
    pub(crate) eff_staff_y: f64,
    // ── S1 data plumbing ──────────────────────────────────────────────
    /// 1-based voice index (MNX convention: voice="1" → 1). Used by S3 for
    /// the multi-voice direction rule (voice 1/3/5 → up, voice 2/4/6 → down).
    #[allow(dead_code)]
    pub(crate) voice_idx: usize,
    /// Number of voices present in this event's parent measure. The S3
    /// multi-voice parity rule only fires when `num_voices > 1`; single-voice
    /// passages keep the stem-opposite default. Mirrors `EventLayout.num_voices`.
    #[allow(dead_code)]
    pub(crate) num_voices: usize,
    /// Cross-staff direction: +1 = moved down to lower staff, -1 = moved up,
    /// 0 = no cross-staff move. Used by S6 (cross-staff height reduction)
    /// and S11 (cross-system + cross-staff). Derived from the event's first
    /// note `staff` override compared to the owning sequence's staff.
    #[allow(dead_code)]
    pub(crate) staff_move: i32,
    /// Magnification factor (1.0 main note, ~0.6 grace). Used by S2 (A6
    /// grace-note scaling) and S9 (scorer geometry). Main events are always
    /// 1.0 for principal events and the rendered grace magnification for
    /// grace endpoints.
    #[allow(dead_code)]
    pub(crate) mag: f64,
    /// Beam Y extents in absolute pixels (top/bottom), when this event is
    /// part of a beam group. Used by S2 (A1 beam clearance) and S4 (D2 beam
    /// obstacle). Exact local extents are merged from published beam polygons;
    /// `None` remains a valid retained/global fallback.
    #[allow(dead_code)]
    pub(crate) beam_top_y: Option<f64>,
    #[allow(dead_code)]
    pub(crate) beam_bottom_y: Option<f64>,
    /// Right edge X of the leftmost accidental on this event (so a slur
    /// starting here can clear it). Used by S2 (A2) and S4 (D3). `None`
    /// when no accidental. Exact local extents include enclosure glyphs.
    #[allow(dead_code)]
    pub(crate) accidental_right_x: Option<f64>,
    /// Right edge X of the rightmost augmentation dot (so a slur ending
    /// here can clear it). Used by S2 (A3) and S4 (D5). `None` when no
    /// dot. Exact local extents merge every published augmentation-dot glyph.
    #[allow(dead_code)]
    pub(crate) dot_right_x: Option<f64>,
    /// Bounding box [top, bottom] of articulation glyphs on this event, in
    /// absolute pixels, on the side this event currently has articulations.
    /// Used by S2 (A4 endpoint pull-back) and S4 (D4 articulation obstacle).
    /// `None` when no articulation; local snapshots merge the shared shape.
    #[allow(dead_code)]
    pub(crate) articulation_extent: Option<(f64, f64)>,
    /// Horizontal union of the exact articulation glyph boxes on this event.
    pub(crate) articulation_x_extent: Option<(f64, f64)>,
    /// Display-list IDs for the articulation stack, used by the final
    /// outside-endpoint resolver to keep commands and spatial metadata aligned.
    pub(crate) articulation_element_ids: Vec<String>,
    /// Display-list IDs for a fermata attached to this event. Fermatas always
    /// sit outside a slur at an endpoint and move with the outside stack.
    pub(crate) fermata_element_ids: Vec<String>,
    /// True if this event has any note with an incoming tie (chained from a
    /// previous note). Used by S8 (A5 tie-chain walking for slur endpoints).
    #[allow(dead_code)]
    pub(crate) incoming_tie: bool,
    /// True if this event has any note with an outgoing tie. Used by S8.
    #[allow(dead_code)]
    pub(crate) outgoing_tie: bool,
    /// Outer Y of the outermost tie tip landing on this event, tracked per
    /// curve side. Recorded from the published tie band so a slur sharing the
    /// notehead can take the next lane outward instead of converging onto the
    /// tie. `None` when no tie band was published on that side.
    pub(crate) tie_tip_above_y: Option<f64>,
    pub(crate) tie_tip_below_y: Option<f64>,
    /// True if this event is part of a beam group (explicit or auto-beamed).
    /// Used by the stem-side endpoint Y logic: a beamed stem terminates at
    /// the beam (not the default stem length), and the beam itself has
    /// thickness on the stem side. Suppressing the contour-driven tip drop
    /// keeps the slur tip well clear of the beam glyph.
    pub(crate) is_beamed: bool,
    pub(crate) endpoint_articulation_relation: Option<EndpointArticulationRelation>,
}

/// Build the normalized endpoint snapshot consumed by both the local and
/// global slur passes. Keeping all defaults here prevents the two collectors
/// from silently diverging as new endpoint geometry is published.
pub(crate) fn endpoint_snapshot(
    x: f64,
    y_top: f64,
    y_bottom: f64,
    stem_up: bool,
    has_stem: bool,
    notehead_w: f64,
    note_count: usize,
    eff_staff_y: f64,
    voice_idx: usize,
    num_voices: usize,
    staff_move: i32,
    mag: f64,
    outgoing_tie: bool,
    is_beamed: bool,
    endpoint_articulation_relation: Option<EndpointArticulationRelation>,
) -> EndpointSnapshot {
    EndpointSnapshot {
        x,
        y_pos: y_top,
        y_pos_bottom: y_bottom,
        stem_up,
        has_stem,
        notehead_w,
        note_count,
        eff_staff_y,
        voice_idx,
        num_voices,
        staff_move,
        mag,
        beam_top_y: None,
        beam_bottom_y: None,
        accidental_right_x: None,
        dot_right_x: None,
        articulation_extent: None,
        articulation_x_extent: None,
        articulation_element_ids: Vec::new(),
        fermata_element_ids: Vec::new(),
        incoming_tie: false,
        outgoing_tie,
        tie_tip_above_y: None,
        tie_tip_below_y: None,
        is_beamed,
        endpoint_articulation_relation,
    }
}

pub(crate) struct EventRenderInfo {
    pub(super) endpoint: EndpointSnapshot,
}

impl Deref for EventRenderInfo {
    type Target = EndpointSnapshot;

    fn deref(&self) -> &Self::Target {
        &self.endpoint
    }
}

impl DerefMut for EventRenderInfo {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.endpoint
    }
}

/// An obstacle between slur endpoints that the curve must avoid.
/// Ref: standard engraving practice `getSegmentShapes()` — collects note/stem
/// bounding boxes between slur start and end.
pub(super) struct SlurObstacle {
    /// Owning event ID (used to skip the slur's own start/end chord).
    /// standard engraving practice excludes slur endpoint chords by
    /// element identity, not by X position.
    pub(super) event_id: Option<String>,
    /// 1-based voice index of the owning event. Used by contour-aware
    /// auto-side detection so a slur in voice 1 doesn't mis-classify
    /// voice 2's notes as part of its own contour.
    pub(super) voice_idx: usize,
    /// Center X position of the obstacle
    pub(super) x: f64,
    /// Topmost Y extent (smallest Y = highest on screen)
    pub(super) y_top: f64,
    /// Bottommost Y extent (largest Y = lowest on screen)
    pub(super) y_bottom: f64,
    /// Notehead-only Y extents (None for non-note obstacles like
    /// accidentals, dots, articulations). Used by contour-aware auto-side
    /// detection so stem tips do NOT distort the perceived peak/valley
    /// shape — a stems-up middle note must not register as a mountain.
    pub(super) notehead_y_top: Option<f64>,
    pub(super) notehead_y_bottom: Option<f64>,
    /// True for sampled tie bands. Tie bodies remain obstacles even when a
    /// sample is nearest to the slur's source/target event; endpoint X slack
    /// handles the shared tip instead of dropping half the connector.
    pub(super) is_tie: bool,
    /// True if this obstacle is an articulation (staccato, accent, marcato,
    /// tenuto, fermata) attached to an INTERIOR note. Used by the slur-tip
    /// lift pass: when an inner-note articulation protrudes higher than the
    /// boundary-articulation pull would set the tip to, the tip is raised
    /// so the entire slur (including endpoints) sits clearly above all
    /// inner articulations. Prevents the apex from looking like it floats
    /// well above the tips while the tips dangle next to inner staccatos.
    pub(super) is_articulation: bool,
}

/// Find the half-open range `[lo, hi)` of indices in an x-sorted obstacle
/// slice whose `x` is in `(x_lo, x_hi)` (strict on both ends — matches the
/// `obs.x <= x_lo || obs.x >= x_hi` filter used by every consumer).
///
/// Lets all the per-slur obstacle scans walk only the slice that can possibly
/// matter instead of the full per-staff vector. With `O(S)` slurs and `O(E)`
/// obstacles this trims the inner loop from `O(S × E)` to `O(S × log E + hits)`.
pub(super) fn obstacles_in_x_range(
    obstacles: &[SlurObstacle],
    x_lo: f64,
    x_hi: f64,
) -> &[SlurObstacle] {
    if x_lo >= x_hi || obstacles.is_empty() {
        return &[];
    }
    // First index whose x > x_lo.
    let lo = obstacles.partition_point(|o| o.x <= x_lo);
    // First index whose x >= x_hi.
    let hi = obstacles.partition_point(|o| o.x < x_hi);
    if lo >= hi {
        &[]
    } else {
        &obstacles[lo..hi]
    }
}

/// Build the per-event lookup maps and the obstacle list that the slur
/// engine consults when shaping curves.
///
/// Walks every event across every voice in every measure exactly once and:
/// - Records its rendered position + S1 plumbing (accidentals, dots, ties,
///   beam membership, outside-boundary articulation flag) in `event_map`,
///   keyed by MNX event id.
/// - Records each note id → `(staff_y_pos, eff_staff_y)` in `note_map` for
///   `startNote` / `endNote` targeting.
/// - Pushes a notehead/stem obstacle (with cross-staff Y) plus thin
///   accidental + augmentation-dot obstacles where applicable.
///
/// Refs: standard engraving practice / `addMinClearanceToShapes` /
/// `Accidental::layout1`;(dot placement).
#[allow(clippy::too_many_lines)] // single obstacle-building pass; cohesive, splitting would obscure flow
pub(super) fn build_slur_event_obstacle_maps(
    measure_layouts: &[MeasureLayout],
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
    staff_y_offsets: Option<&[f64]>,
) -> SlurObstacleMaps {
    let notehead_w = config.notehead_rx * 2.0 * sp;
    let nh_h = config.notehead_ry * sp;

    let mut event_map: HashMap<String, EventRenderInfo> = HashMap::new();
    let mut note_map: HashMap<String, (f64, f64)> = HashMap::new();
    let mut all_obstacles: Vec<SlurObstacle> = Vec::new();

    // Beam-awareness: any event that will render with a beam (explicit or
    // auto). Stem-side slur endpoints anchored on a beamed event need extra
    // clearance because the actual stem terminates at the beam.
    let beamed_event_ids: std::collections::HashSet<String> =
        super::super::beams::collect_all_beamed_event_ids(measure_layouts, false);

    for ml in measure_layouts {
        for (voice_idx_0based, vl) in ml.voice_layouts.iter().enumerate() {
            let voice_idx_1based = voice_idx_0based + 1;
            for ei in 0..vl.events.len() {
                let ev = vl.events.event(ei);
                let ev_x = vl.events.x(ei);
                let ev_stem_up = vl.events.stem_up(ei);
                let ev_num_voices = vl.events.num_voices(ei);
                let ev_note_positions = vl.events.note_positions(ei);
                let eff_staff_y = super::super::render_measure::cross_staff_y_scalar(
                    ev.staff,
                    vl.events.sequence_staff(ei),
                    staff_y,
                    staff_y_offsets,
                );
                let notes = ev.notes();
                for (i, note) in notes.iter().enumerate() {
                    if let Some(ref note_id) = note.id {
                        if let Some(&y_pos) = ev_note_positions.get(i) {
                            note_map.insert(note_id.clone(), (y_pos, eff_staff_y));
                        }
                    }
                }

                let y_top = ev_note_positions
                    .iter()
                    .cloned()
                    .min_by(|a, b| a.total_cmp(b))
                    .unwrap_or(4.0);
                let y_bottom = ev_note_positions
                    .iter()
                    .cloned()
                    .max_by(|a, b| a.total_cmp(b))
                    .unwrap_or(4.0);

                // ── S1 data plumbing ──────────────────────────────
                let staff_move = notes
                    .first()
                    .and_then(|n| n.staff)
                    .map(|s| (s as i32) - (vl.events.sequence_staff(ei) as i32))
                    .unwrap_or(0);
                let outgoing_tie_flag = notes
                    .iter()
                    .any(|n| n.ties.as_ref().is_some_and(|ts| !ts.is_empty()));

                let has_accidental_top = notes.iter().any(|n| {
                    let show = n
                        .accidental_display
                        .as_ref()
                        .map(|a| a.show)
                        .unwrap_or(false);
                    show || n.pitch.alter.map(|a| a != 0).unwrap_or(false)
                });
                let acc_right_x = if has_accidental_top {
                    Some(ev_x - 0.12 * sp)
                } else {
                    None
                };
                let dots = ev.duration.dots.unwrap_or(0);
                let dot_right_x_val = if dots > 0 {
                    Some(ev_x + notehead_w + (dots as f64) * 0.3 * sp + 0.1 * sp)
                } else {
                    None
                };

                let articulation_relation = endpoint_articulation_relation(ev.markings.as_ref());
                if let Some(id) = vl.events.id(ei) {
                    let mut endpoint = endpoint_snapshot(
                        ev_x,
                        y_top,
                        y_bottom,
                        ev_stem_up,
                        ev.duration.base.has_stem(),
                        notehead_w,
                        ev.notes().len(),
                        eff_staff_y,
                        voice_idx_1based,
                        ev_num_voices,
                        staff_move,
                        1.0,
                        outgoing_tie_flag,
                        beamed_event_ids.contains(id),
                        articulation_relation,
                    );
                    // Analytic fallback until the exact event-owned shapes are
                    // merged below by the slur render pass.
                    endpoint.accidental_right_x = acc_right_x;
                    endpoint.dot_right_x = dot_right_x_val;
                    event_map.insert(id.to_string(), EventRenderInfo { endpoint });
                }

                // Grace notes attached to this event are addressable slur
                // endpoints too. They live in `grace_notes(ei)` (separate from
                // the main events vector), so register each in the same maps
                // with grace magnification (0.65) and the parent event's staff.
                // No obstacles are emitted for grace notes — they sit small and
                // immediately left of their principal, so they don't meaningfully
                // block a neighbouring slur's contour.
                let grace_mag = 0.65;
                let grace_nh_w = notehead_w * grace_mag;
                for gn in vl.events.grace_notes(ei) {
                    for (i, note) in gn.event.notes().iter().enumerate() {
                        if let Some(ref note_id) = note.id {
                            if let Some(&y_pos) = gn.note_positions.get(i) {
                                note_map.insert(note_id.clone(), (y_pos, eff_staff_y));
                            }
                        }
                    }
                    let gn_y_top = gn
                        .note_positions
                        .iter()
                        .cloned()
                        .min_by(|a, b| a.total_cmp(b))
                        .unwrap_or(4.0);
                    let gn_y_bottom = gn
                        .note_positions
                        .iter()
                        .cloned()
                        .max_by(|a, b| a.total_cmp(b))
                        .unwrap_or(4.0);
                    if let Some(ref id) = gn.id {
                        let outgoing_tie =
                            gn.event.notes().iter().any(|note| {
                                note.ties.as_ref().is_some_and(|ties| !ties.is_empty())
                            });
                        event_map.insert(
                            id.clone(),
                            EventRenderInfo {
                                endpoint: endpoint_snapshot(
                                    gn.x,
                                    gn_y_top,
                                    gn_y_bottom,
                                    gn.stem_up,
                                    gn.event.duration.base.has_stem(),
                                    grace_nh_w,
                                    gn.event.notes().len(),
                                    eff_staff_y,
                                    voice_idx_1based,
                                    ev_num_voices,
                                    0,
                                    grace_mag,
                                    outgoing_tie,
                                    beamed_event_ids.contains(id),
                                    endpoint_articulation_relation(gn.event.markings.as_ref()),
                                ),
                            },
                        );
                    }
                }

                let note_y_top_px = eff_staff_y + y_top * sp * 0.5 - nh_h;
                let note_y_bot_px = eff_staff_y + y_bottom * sp * 0.5 + nh_h;

                let (obs_top, obs_bot) = if ev.duration.base.has_stem() {
                    if ev_stem_up {
                        let stem_tip = eff_staff_y + y_top * sp * 0.5 - config.stem_length * sp;
                        let middle_y = eff_staff_y + 4.0 * sp * 0.5;
                        (stem_tip.min(middle_y).min(note_y_top_px), note_y_bot_px)
                    } else {
                        let stem_tip = eff_staff_y + y_bottom * sp * 0.5 + config.stem_length * sp;
                        let middle_y = eff_staff_y + 4.0 * sp * 0.5;
                        (note_y_top_px, stem_tip.max(middle_y).max(note_y_bot_px))
                    }
                } else {
                    (note_y_top_px, note_y_bot_px)
                };

                all_obstacles.push(SlurObstacle {
                    event_id: vl.events.id(ei).map(|s| s.to_string()),
                    voice_idx: voice_idx_1based,
                    x: ev_x + notehead_w * 0.5,
                    y_top: obs_top,
                    y_bottom: obs_bot,
                    notehead_y_top: if notes.is_empty() {
                        None
                    } else {
                        Some(note_y_top_px)
                    },
                    notehead_y_bottom: if notes.is_empty() {
                        None
                    } else {
                        Some(note_y_bot_px)
                    },
                    is_tie: false,
                    is_articulation: false,
                });

                // D3: accidentals — thin obstacle ~0.5sp left of notehead.
                let has_accidental = ev.notes().iter().any(|n| {
                    let show = n
                        .accidental_display
                        .as_ref()
                        .map(|a| a.show)
                        .unwrap_or(false);
                    show || n.pitch.alter.map(|a| a != 0).unwrap_or(false)
                });
                if has_accidental {
                    all_obstacles.push(SlurObstacle {
                        event_id: vl.events.id(ei).map(|s| format!("{}/accidental", s)),
                        voice_idx: voice_idx_1based,
                        x: ev_x - 0.5 * sp,
                        y_top: note_y_top_px,
                        y_bottom: note_y_bot_px,
                        notehead_y_top: None,
                        notehead_y_bottom: None,
                        is_tie: false,
                        is_articulation: false,
                    });
                }

                // D5: augmentation dots — single obstacle at notehead_right + 0.4sp.
                let dots = ev.duration.dots.unwrap_or(0);
                if dots > 0 {
                    all_obstacles.push(SlurObstacle {
                        event_id: vl.events.id(ei).map(|s| format!("{}/dot", s)),
                        voice_idx: voice_idx_1based,
                        x: ev_x + notehead_w + 0.4 * sp,
                        y_top: note_y_top_px,
                        y_bottom: note_y_bot_px,
                        notehead_y_top: None,
                        notehead_y_bottom: None,
                        is_tie: false,
                        is_articulation: false,
                    });
                }
            }
        }
    }

    (event_map, note_map, all_obstacles)
}

/// Compute the nesting depth of every slur across all measures.
///
/// Returns the flat `slur_spans` list plus an `(src_id, tgt_id) → index` map
/// and a parallel `span_depths: Vec<(nest_depth, inner_depth)>`. Each slur's
/// `nest_depth` counts OTHER slurs strictly inside its X range; `inner_depth`
/// counts slurs that strictly contain it. Outer slurs (higher `nest_depth`)
/// arch above any inner slurs"nested slurs").
pub(super) fn compute_slur_nest_depths(
    measure_layouts: &[MeasureLayout],
    event_map: &HashMap<String, EventRenderInfo>,
) -> SlurNestDepths {
    let mut slur_spans: Vec<SlurSpan> = Vec::new();
    for ml in measure_layouts {
        for vl in &ml.voice_layouts {
            for ei in 0..vl.events.len() {
                if let Some(ref slurs) = vl.events.event(ei).slurs {
                    let src_id = match vl.events.id(ei) {
                        Some(s) => s.to_string(),
                        None => continue,
                    };
                    let Some(src_info) = event_map.get(&src_id) else {
                        continue;
                    };
                    for slur in slurs {
                        let Some(tgt_info) = event_map.get(&slur.target) else {
                            continue;
                        };
                        slur_spans.push((
                            src_id.clone(),
                            slur.target.clone(),
                            src_info.x,
                            tgt_info.x,
                        ));
                    }
                }
            }
        }
    }
    let mut span_index: HashMap<(String, String), usize> = HashMap::with_capacity(slur_spans.len());
    for (i, (s, t, _, _)) in slur_spans.iter().enumerate() {
        span_index.insert((s.clone(), t.clone()), i);
    }
    let mut span_depths: Vec<(u32, u32)> = vec![(0, 0); slur_spans.len()];
    for (i, (_, _, sx_i, tx_i)) in slur_spans.iter().enumerate() {
        let (lo, hi) = if sx_i < tx_i {
            (*sx_i, *tx_i)
        } else {
            (*tx_i, *sx_i)
        };
        let mut nest = 0u32;
        let mut inner = 0u32;
        for (j, (_, _, sx_j, tx_j)) in slur_spans.iter().enumerate() {
            if i == j {
                continue;
            }
            let (olo, ohi) = if sx_j < tx_j {
                (*sx_j, *tx_j)
            } else {
                (*tx_j, *sx_j)
            };
            if olo >= lo && ohi <= hi && (olo > lo || ohi < hi) {
                nest += 1;
            }
            if olo <= lo && ohi >= hi && (olo < lo || ohi > hi) {
                inner += 1;
            }
        }
        span_depths[i] = (nest, inner);
    }
    (slur_spans, span_index, span_depths)
}

/// Build a per-endpoint, per-side map of slur tips landing on each event,
/// sorted by nest depth so callers can compute a *local* stacking rank.
///
/// Standard engraving practice: when multiple
/// slurs share an endpoint event, outer slurs sit farther from the notehead
/// and inner slurs hug it. The side tag (`false` = SOURCE, `true` = TARGET)
/// keeps chained-pair pivots (A→B + B→C share event B) at rank 0 on each
/// side, while truly nested co-starts (A→D + B→C both starting at A) still
/// stack.
pub(super) fn build_slur_tip_stack_map(
    slur_spans: &[(String, String, f64, f64)],
    span_depths: &[(u32, u32)],
) -> HashMap<String, Vec<(u32, bool, String, String)>> {
    let mut tips_at_event: HashMap<String, Vec<(u32, bool, String, String)>> = HashMap::new();
    for (i, (s, t, _sx, _tx)) in slur_spans.iter().enumerate() {
        let d = span_depths[i].0;
        tips_at_event
            .entry(s.clone())
            .or_default()
            .push((d, false, s.clone(), t.clone()));
        tips_at_event
            .entry(t.clone())
            .or_default()
            .push((d, true, s.clone(), t.clone()));
    }
    for v in tips_at_event.values_mut() {
        v.sort_by_key(|(d, _, _, _)| *d);
    }
    tips_at_event
}

/// Return the local stacking rank (0 = innermost) of the slur `(sid, tid)`
/// among other tips landing on `evid` on the same side.
///
/// Same-side filtering: chained-pair pivots have one tip on each side and
/// each side gets rank 0; truly nested co-starts get sequential ranks. When
/// only one same-side tip exists, returns 0.
pub(super) fn local_tip_rank(
    tips_at_event: &HashMap<String, Vec<(u32, bool, String, String)>>,
    evid: &str,
    sid: &str,
    tid: &str,
    is_target: bool,
) -> u32 {
    let Some(list) = tips_at_event.get(evid) else {
        return 0;
    };
    let mut same_side_count: u32 = 0;
    let mut rank_among_same_side: Option<u32> = None;
    for (_, side, s, t) in list.iter() {
        if *side != is_target {
            continue;
        }
        if rank_among_same_side.is_none() && s == sid && t == tid {
            rank_among_same_side = Some(same_side_count);
        }
        same_side_count += 1;
    }
    if same_side_count < 2 {
        return 0;
    }
    rank_among_same_side.unwrap_or(0)
}
