use crate::layout::text_styles::{text_width, FontFamily};
use crate::model::chord_symbol::{BarreEndpoint, Fretboard, FretboardLabelLocation};
use crate::render::{DisplayList, RenderCommand, TextAlign, TextBaseline};

const STRING_GAP: f64 = 0.85;
const FRET_GAP: f64 = 0.95;
const TOP: f64 = 1.5;
const BOTTOM: f64 = 1.8;
pub(super) const LABEL_GAP: f64 = 0.6;

fn label(frame: &Fretboard) -> String {
    frame
        .first_fret
        .as_ref()
        .and_then(|first| first.text.clone())
        .unwrap_or_else(|| {
            if frame.first() > 1 {
                frame.first().to_string()
            } else {
                String::new()
            }
        })
}

fn side_padding(frame: &Fretboard, sp: f64) -> (f64, f64) {
    let marker_width = text_width(
        frame.unplayed.as_deref().unwrap_or("x"),
        sp,
        FontFamily::Serif,
        false,
    );
    let fingering_width = frame
        .frame_notes
        .iter()
        .filter_map(|note| note.fingering.as_deref())
        .map(|text| text_width(text, sp, FontFamily::Serif, false))
        .fold(marker_width, f64::max);
    let pad = (0.5 * fingering_width + 0.25 * sp).max(0.5 * sp);
    let label_pad = text_width(&label(frame), sp, FontFamily::Serif, false) + 0.4 * sp;
    if frame.first_fret.as_ref().and_then(|first| first.location)
        == Some(FretboardLabelLocation::Right)
    {
        (pad, pad.max(label_pad))
    } else {
        (pad.max(label_pad), pad)
    }
}

pub(super) fn dimensions(frame: &Fretboard, sp: f64) -> (f64, f64) {
    let (left, right) = side_padding(frame, sp);
    let extra_fingering_row = (1..=frame.frame_strings).any(|string| {
        frame
            .frame_notes
            .iter()
            .filter(|note| note.string == string && note.fingering.is_some())
            .count()
            > 1
    });
    (
        left + (frame.frame_strings - 1) as f64 * STRING_GAP * sp + right,
        (TOP + frame.frame_frets as f64 * FRET_GAP
            + BOTTOM
            + if extra_fingering_row { 1.1 } else { 0.0 })
            * sp,
    )
}

pub(super) fn render(dl: &mut DisplayList, frame: &Fretboard, x: f64, top: f64, sp: f64, id: &str) {
    let (left, _) = side_padding(frame, sp);
    let grid_x = x + left;
    let grid_y = top + TOP * sp;
    let grid_width = (frame.frame_strings - 1) as f64 * STRING_GAP * sp;
    let grid_bottom = grid_y + frame.frame_frets as f64 * FRET_GAP * sp;
    let string_x = |string: i64| grid_x + (frame.frame_strings - string) as f64 * STRING_GAP * sp;
    let fret_y =
        |fret: i64| grid_y + (fret - frame.first()) as f64 * FRET_GAP * sp + 0.5 * FRET_GAP * sp;
    let mut push = |command| dl.push_tagged(command, id.to_owned());
    let line = |x1, y1, x2, y2, width| RenderCommand::DrawLine {
        x1,
        y1,
        x2,
        y2,
        width,
        color: "#000000".into(),
    };
    let text = |x, y, text, align| RenderCommand::DrawText {
        x,
        y,
        text,
        font: "serif".into(),
        size: sp,
        color: "#000000".into(),
        align,
        baseline: TextBaseline::Middle,
    };
    for string in 1..=frame.frame_strings {
        push(line(
            string_x(string),
            grid_y,
            string_x(string),
            grid_bottom,
            0.08 * sp,
        ));
    }
    for fret in 0..=frame.frame_frets {
        let y = grid_y + fret as f64 * FRET_GAP * sp;
        // Standard chord grids use a heavy nut only when the first fret is shown.
        let width = if fret == 0 && frame.first() == 1 {
            0.25
        } else {
            0.08
        };
        push(line(grid_x, y, grid_x + grid_width, y, width * sp));
    }
    for note in &frame.frame_notes {
        if note.barre == Some(BarreEndpoint::Start) {
            if let Some(stop) = frame
                .frame_notes
                .iter()
                .find(|other| other.fret == note.fret && other.barre == Some(BarreEndpoint::Stop))
            {
                push(line(
                    string_x(note.string),
                    fret_y(note.fret),
                    string_x(stop.string),
                    fret_y(note.fret),
                    0.55 * sp,
                ));
            }
        }
    }
    for string in 1..=frame.frame_strings {
        let x = string_x(string);
        let mut notes: Vec<_> = frame
            .frame_notes
            .iter()
            .filter(|note| note.string == string)
            .collect();
        notes.sort_unstable_by_key(|note| note.fret);
        let mut fingering_row = 0;
        for note in &notes {
            if note.fret == 0 {
                push(RenderCommand::DrawEllipse {
                    cx: x,
                    cy: grid_y - 0.75 * sp,
                    rx: 0.25 * sp,
                    ry: 0.25 * sp,
                    angle: 0.0,
                    filled: false,
                    color: "#000000".into(),
                });
            } else {
                push(RenderCommand::DrawCircle {
                    cx: x,
                    cy: fret_y(note.fret),
                    r: 0.28 * sp,
                    color: "#000000".into(),
                });
            }
            if let Some(finger) = &note.fingering {
                push(text(
                    x,
                    grid_bottom + (0.8 + f64::from(fingering_row) * 1.1) * sp,
                    finger.clone(),
                    TextAlign::Center,
                ));
                fingering_row += 1;
            }
        }
        if notes.is_empty() {
            push(text(
                x,
                grid_y - 0.75 * sp,
                frame.unplayed.clone().unwrap_or_else(|| "x".into()),
                TextAlign::Center,
            ));
        }
    }
    let label = label(frame);
    if !label.is_empty() {
        let right = frame.first_fret.as_ref().and_then(|first| first.location)
            == Some(FretboardLabelLocation::Right);
        let (x, align) = if right {
            (grid_x + grid_width + 0.4 * sp, TextAlign::Left)
        } else {
            (grid_x - 0.4 * sp, TextAlign::Right)
        };
        push(text(x, grid_y + 0.5 * FRET_GAP * sp, label, align));
    }
}
