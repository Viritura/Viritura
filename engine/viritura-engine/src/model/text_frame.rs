use serde::{Deserialize, Serialize};

use super::text::TextContent;

/// Shared optional block presentation on music-attached staff text.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StaffTextFramePresentation {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<StaffTextFrameWidth>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub padding: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub horizontal_alignment: Option<TextFrameAlign>,
    #[serde(default)]
    pub paragraph_justification: TextFrameJustify,
    #[serde(default)]
    pub border: TextFrameBorder,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(
    tag = "unit",
    content = "value",
    rename_all = "camelCase",
    deny_unknown_fields
)]
pub enum StaffTextFrameWidth {
    StaffSpaces(f64),
}

/// A free rectangular text frame owned by one score view
/// (`scores[i]._x.viritura.textFrames`).
///
/// Frames carry genuinely free page prose. Semantic labels (tempo, rehearsal
/// marks, marker text, staff labels) remain fields on their owning objects.
///
/// The locator only chooses the page; geometry is always page-relative, so a
/// frame never needs coordinates that depend on where music reflows.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TextFrame {
    pub id: String,
    /// Frame text. A `\n` inside a text run is an authored line break;
    /// every other break is produced by automatic wrapping.
    pub content: TextContent,
    pub locator: TextFrameLocator,
    pub placement: TextFramePlacement,
    pub width: TextFrameWidth,
    /// Inner padding on all four sides, in staff spaces.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub padding: Option<f64>,
    /// Horizontal alignment of the frame about its anchor point. Absent means
    /// the anchor's own horizontal side (left anchors align the frame's left
    /// edge, top/bottom edge anchors its centre, right anchors its right edge).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub horizontal_alignment: Option<TextFrameAlign>,
    /// Paragraph justification of lines inside the frame, independent of
    /// [`Self::horizontal_alignment`].
    #[serde(default)]
    pub paragraph_justification: TextFrameJustify,
    #[serde(default)]
    pub border: TextFrameBorder,
}

/// Selects the final paginated page that displays a frame.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TextFrameLocator {
    /// A 0-based index into the final pages, including title and blank leaves.
    #[serde(rename_all = "camelCase")]
    Page { page_index: usize },
    /// The page containing this global measure ID.
    #[serde(rename_all = "camelCase")]
    GlobalMeasure { measure_id: String },
    /// The page containing the measure that holds this part-scoped event ID.
    #[serde(rename_all = "camelCase")]
    Event { part_id: String, event_id: String },
}

/// Page-relative placement: an anchor on the page's printable area (inside
/// the page margins) plus an offset in staff spaces.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TextFramePlacement {
    pub anchor: TextFrameAnchor,
    pub offset: TextFrameOffset,
}

/// Offset in staff spaces, +x right and +y down.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Default)]
pub struct TextFrameOffset {
    pub x: f64,
    pub y: f64,
}

/// Corner or edge midpoint of the page's printable area. The frame's matching
/// corner/edge sits on that point before the offset applies.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum TextFrameAnchor {
    TopLeft,
    Top,
    TopRight,
    Right,
    BottomRight,
    Bottom,
    BottomLeft,
    Left,
}

/// Frame width. Height is always automatic (content plus padding).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(tag = "unit", content = "value", rename_all = "camelCase")]
pub enum TextFrameWidth {
    /// Absolute width in staff spaces.
    StaffSpaces(f64),
    /// Fraction of the printable text-column width, in `(0, 1]`.
    TextColumnFraction(f64),
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TextFrameAlign {
    Left,
    Center,
    Right,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum TextFrameJustify {
    #[default]
    Left,
    Center,
    Right,
    /// Full justification: inter-word space stretches to both frame edges,
    /// except on the last line of each paragraph.
    Justify,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum TextFrameBorder {
    #[default]
    None,
    Solid,
}
