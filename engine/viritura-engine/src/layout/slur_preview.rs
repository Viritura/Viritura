use serde::{Deserialize, Serialize};

use super::curves::{engrave_stroke, StrokeSpine};
use crate::render::RenderCommand;

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SlurPreviewMode {
    Write,
    Engrave,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SlurPreviewHandle {
    P0,
    P1,
    P2,
    P3,
    Pm,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlurPreviewInput {
    pub spine: [[f64; 2]; 4],
    pub thickness: f64,
    pub endpoint_thickness: f64,
    pub curve_dir: f64,
    pub line_style: u8,
    pub mode: SlurPreviewMode,
    pub handle: SlurPreviewHandle,
    pub dx: f64,
    pub dy: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SlurPreview {
    pub command: RenderCommand,
    pub spine: [[f64; 2]; 4],
}

/// Apply one live drag to an engine-published slur spine and cut the preview
/// with the same graver used by final tie/slur rendering.
pub fn compute_slur_preview(input: &SlurPreviewInput) -> SlurPreview {
    let mut spine = input.spine;
    match input.mode {
        SlurPreviewMode::Engrave => apply_engrave_drag(&mut spine, input),
        SlurPreviewMode::Write => apply_write_drag(&mut spine, input),
    }
    let command = engrave_stroke(
        &StrokeSpine {
            x1: spine[0][0],
            y1: spine[0][1],
            cp1_x: spine[1][0],
            cp1_y: spine[1][1],
            cp2_x: spine[2][0],
            cp2_y: spine[2][1],
            x2: spine[3][0],
            y2: spine[3][1],
            curve_dir: input.curve_dir,
        },
        input.thickness,
        input.endpoint_thickness,
        input.line_style,
    );
    SlurPreview { command, spine }
}

fn apply_engrave_drag(spine: &mut [[f64; 2]; 4], input: &SlurPreviewInput) {
    let add = |point: &mut [f64; 2], scale: f64| {
        point[0] += input.dx * scale;
        point[1] += input.dy * scale;
    };
    match input.handle {
        SlurPreviewHandle::P0 => add(&mut spine[0], 1.0),
        SlurPreviewHandle::P1 => add(&mut spine[1], 1.0),
        SlurPreviewHandle::P2 => add(&mut spine[2], 1.0),
        SlurPreviewHandle::P3 => add(&mut spine[3], 1.0),
        SlurPreviewHandle::Pm => {
            add(&mut spine[1], 4.0 / 3.0);
            add(&mut spine[2], 4.0 / 3.0);
        }
    }
}

fn apply_write_drag(spine: &mut [[f64; 2]; 4], input: &SlurPreviewInput) {
    let weights = match input.handle {
        SlurPreviewHandle::P0 => [1.0, 2.0 / 3.0, 1.0 / 3.0, 0.0],
        SlurPreviewHandle::P3 => [0.0, 1.0 / 3.0, 2.0 / 3.0, 1.0],
        _ => return,
    };
    for (point, weight) in spine.iter_mut().zip(weights) {
        point[0] += input.dx * weight;
        point[1] += input.dy * weight;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(mode: SlurPreviewMode, handle: SlurPreviewHandle) -> SlurPreviewInput {
        SlurPreviewInput {
            spine: [[0.0, 20.0], [30.0, 0.0], [70.0, 0.0], [100.0, 20.0]],
            thickness: 2.0,
            endpoint_thickness: 0.4,
            curve_dir: -1.0,
            line_style: 0,
            mode,
            handle,
            dx: -60.0,
            dy: 30.0,
        }
    }

    #[test]
    fn write_endpoint_drag_redistributes_the_span() {
        let preview = compute_slur_preview(&input(SlurPreviewMode::Write, SlurPreviewHandle::P3));
        assert_eq!(
            preview.spine,
            [[0.0, 20.0], [10.0, 10.0], [30.0, 20.0], [40.0, 50.0]]
        );
        assert!(matches!(
            preview.command,
            RenderCommand::DrawFilledBezier { .. }
        ));
    }

    #[test]
    fn engrave_endpoint_drag_moves_only_the_visual_handle() {
        let preview = compute_slur_preview(&input(SlurPreviewMode::Engrave, SlurPreviewHandle::P3));
        assert_eq!(
            preview.spine,
            [[0.0, 20.0], [30.0, 0.0], [70.0, 0.0], [40.0, 50.0]]
        );
    }
}
