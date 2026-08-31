//! Text style system for score text (title, tempo, staff labels, etc.).
//!
//! A score carries a [`TextStylesheet`] — a flat map from a semantic
//! [`TextRole`] (title, tempo, staff label, …) to a [`TextStyle`] (size,
//! family, weight, slant, color, alignment). Layout sites resolve the role to
//! a concrete style instead of hardcoding `font`/`size`/`color` inline.
//!
//! The defaults reproduce the previously-hardcoded values exactly, so routing a
//! site through the stylesheet is a behavior-preserving refactor. A document
//! can override any subset of any role via the `_x.viritura.textStyles` vendor
//! extension (see `merge_json`); unspecified fields fall back to the default.
//!
//! ## Fonts
//!
//! Only the three CSS generic families are supported (`serif`, `sans-serif`,
//! `monospace`). They need no font files — the browser already has them — and
//! the engine ships approximate per-family advance-width metrics (see
//! [`text_width`]) so layout can position proportional text without a real
//! rasterizer. Arbitrary user font names are intentionally out of scope for v1
//! (they would require a measure-and-reflow pass through the browser).

use crate::render::TextAlign;
use serde::{Deserialize, Serialize};

/// A generic font family. Maps to a CSS generic family on the canvas side and
/// to an advance-width metrics table on the layout side.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum FontFamily {
    /// Times-like serif (the default for all score text).
    #[default]
    Serif,
    /// Helvetica/Arial-like sans-serif.
    SansSerif,
    /// Courier-like fixed-width.
    Monospace,
}

impl FontFamily {
    /// The CSS generic family token used both in the canonical font string and
    /// directly as a canvas `font-family`.
    pub fn css_name(self) -> &'static str {
        match self {
            FontFamily::Serif => "serif",
            FontFamily::SansSerif => "sans-serif",
            FontFamily::Monospace => "monospace",
        }
    }
}

/// Horizontal alignment of a text run relative to its anchor x.
///
/// Mirrors [`TextAlign`] but is `Serialize`/`Deserialize` for the stylesheet
/// JSON; `From`/`Into` bridge the two.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum TextAlignment {
    #[default]
    Left,
    Center,
    Right,
}

impl From<TextAlignment> for TextAlign {
    fn from(a: TextAlignment) -> Self {
        match a {
            TextAlignment::Left => TextAlign::Left,
            TextAlignment::Center => TextAlign::Center,
            TextAlignment::Right => TextAlign::Right,
        }
    }
}

/// A concrete, fully-resolved text style.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TextStyle {
    /// Font size in staff spaces (resolution-independent; multiplied by `sp`).
    #[serde(rename = "size")]
    pub size_sp: f64,
    /// Generic font family.
    #[serde(default)]
    pub family: FontFamily,
    /// Bold weight.
    #[serde(default)]
    pub bold: bool,
    /// Italic slant.
    #[serde(default)]
    pub italic: bool,
    /// Fill color as `#RRGGBB`.
    #[serde(default = "default_color")]
    pub color: String,
    /// Horizontal alignment relative to the anchor x.
    #[serde(default)]
    pub align: TextAlignment,
}

fn default_color() -> String {
    "#000000".to_string()
}

impl TextStyle {
    /// Build the canonical font string consumed by `RenderCommand::DrawText`
    /// and encoded by the binary protocol: the family token plus optional
    /// ` bold` / ` italic` markers (e.g. `"sans-serif bold italic"`).
    pub fn font_string(&self) -> String {
        let mut s = self.family.css_name().to_string();
        if self.bold {
            s.push_str(" bold");
        }
        if self.italic {
            s.push_str(" italic");
        }
        s
    }

    /// Pixel font size for the given staff-space size.
    pub fn size_px(&self, sp: f64) -> f64 {
        self.size_sp * sp
    }
}

/// A semantic text role. Each role resolves to one [`TextStyle`] in the
/// [`TextStylesheet`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TextRole {
    /// Work title (page 1, centered, large).
    Title,
    /// Work subtitle (below the title).
    Subtitle,
    /// Composer credit (top-right of the title block).
    Composer,
    /// Lyricist credit (top-left of the title block).
    Lyricist,
    /// Arranger credit (top-left of the title block).
    Arranger,
    /// Instrument / part name shown beside or above a staff.
    StaffLabel,
    /// Page number in the running header.
    PageNumber,
    /// Tempo marking (e.g. "Allegro ♩ = 120").
    Tempo,
    /// Pedal text markings ("Ped.", etc.).
    PedalText,
    /// Copyright notice (small, centered at the foot of the title page).
    Copyright,
}

/// A document's text stylesheet: one [`TextStyle`] per [`TextRole`].
///
/// Constructed from [`TextStylesheet::default`] (the built-in engraving
/// defaults) and optionally overlaid with per-document overrides via
/// [`TextStylesheet::merge_json`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextStylesheet {
    pub title: TextStyle,
    pub subtitle: TextStyle,
    pub composer: TextStyle,
    pub lyricist: TextStyle,
    pub arranger: TextStyle,
    pub staff_label: TextStyle,
    pub page_number: TextStyle,
    pub tempo: TextStyle,
    pub pedal_text: TextStyle,
    pub copyright: TextStyle,
}

/// The built-in default stylesheet, shared with the TypeScript editor as the
/// single source of truth (`packages/core/src/textStyleDefaults.json`). The
/// editor seeds its JSON editor from the same file, so engine and UI defaults
/// never drift.
const DEFAULT_TEXT_STYLES_JSON: &str =
    include_str!("../../../../packages/core/src/textStyleDefaults.json");

impl Default for TextStylesheet {
    fn default() -> Self {
        // Parsed from the shared defaults file embedded at build time. The file
        // is a fixed asset validated by tests, so a parse failure here is a
        // build/repo error, not a runtime condition.
        serde_json::from_str(DEFAULT_TEXT_STYLES_JSON)
            .expect("textStyleDefaults.json must match the TextStylesheet shape")
    }
}

impl TextStylesheet {
    /// Resolve a role to its style.
    pub fn resolve(&self, role: TextRole) -> &TextStyle {
        match role {
            TextRole::Title => &self.title,
            TextRole::Subtitle => &self.subtitle,
            TextRole::Composer => &self.composer,
            TextRole::Lyricist => &self.lyricist,
            TextRole::Arranger => &self.arranger,
            TextRole::StaffLabel => &self.staff_label,
            TextRole::PageNumber => &self.page_number,
            TextRole::Tempo => &self.tempo,
            TextRole::PedalText => &self.pedal_text,
            TextRole::Copyright => &self.copyright,
        }
    }

    /// Overlay per-document overrides parsed from a `textStyles` JSON object.
    ///
    /// The JSON is a partial map of role name → partial style, e.g.
    /// `{ "tempo": { "size": 3.0, "italic": true }, "title": { "family": "sans-serif" } }`.
    /// Unspecified roles and unspecified fields keep their default value.
    /// Malformed entries are ignored (best-effort, never panics).
    pub fn merge_json(&mut self, json: &serde_json::Value) {
        let Some(obj) = json.as_object() else {
            return;
        };
        for (role_key, role_val) in obj {
            let Some(style) = self.style_mut_for_key(role_key) else {
                continue;
            };
            merge_style_fields(style, role_val);
        }
    }

    fn style_mut_for_key(&mut self, key: &str) -> Option<&mut TextStyle> {
        match key {
            "title" => Some(&mut self.title),
            "subtitle" => Some(&mut self.subtitle),
            "composer" => Some(&mut self.composer),
            "lyricist" => Some(&mut self.lyricist),
            "arranger" => Some(&mut self.arranger),
            "staffLabel" => Some(&mut self.staff_label),
            "pageNumber" => Some(&mut self.page_number),
            "tempo" => Some(&mut self.tempo),
            "pedalText" => Some(&mut self.pedal_text),
            "copyright" => Some(&mut self.copyright),
            _ => None,
        }
    }
}

/// Apply the present fields of a partial style JSON object onto `style`.
fn merge_style_fields(style: &mut TextStyle, val: &serde_json::Value) {
    let Some(obj) = val.as_object() else {
        return;
    };
    if let Some(size) = obj.get("size").and_then(|v| v.as_f64()) {
        style.size_sp = size;
    }
    if let Some(family) = obj.get("family").and_then(|v| v.as_str()) {
        match family {
            "serif" => style.family = FontFamily::Serif,
            "sans-serif" | "sans" => style.family = FontFamily::SansSerif,
            "monospace" | "mono" => style.family = FontFamily::Monospace,
            _ => {}
        }
    }
    if let Some(bold) = obj.get("bold").and_then(|v| v.as_bool()) {
        style.bold = bold;
    }
    if let Some(italic) = obj.get("italic").and_then(|v| v.as_bool()) {
        style.italic = italic;
    }
    if let Some(color) = obj.get("color").and_then(|v| v.as_str()) {
        if is_hex_color(color) {
            style.color = color.to_string();
        }
    }
    if let Some(align) = obj.get("align").and_then(|v| v.as_str()) {
        match align {
            "left" => style.align = TextAlignment::Left,
            "center" => style.align = TextAlignment::Center,
            "right" => style.align = TextAlignment::Right,
            _ => {}
        }
    }
}

/// Validate a `#RRGGBB` color string before accepting it from untrusted JSON.
fn is_hex_color(s: &str) -> bool {
    let bytes = s.as_bytes();
    bytes.len() == 7 && bytes[0] == b'#' && bytes[1..].iter().all(|b| b.is_ascii_hexdigit())
}

/// Total advance width of a string in the given family/weight, in the same
/// units as `size`.
///
/// The layout engine has no rasterizer on the WASM/canvas path, so these are
/// approximate AFM advance-width tables for the standard-14 fonts (Times for
/// serif, Helvetica for sans-serif, Courier for monospace). Italic shares the
/// upright table (slant barely changes horizontal advance). Accurate enough to
/// flow inline glyphs after text and to center/right-align headings.
pub fn text_width(text: &str, size: f64, family: FontFamily, bold: bool) -> f64 {
    text.chars()
        .map(|ch| char_advance(ch, family, bold))
        .sum::<f64>()
        * size
}

/// Vertical distance from a `Middle`-baseline text anchor (the `y` passed to a
/// `DrawText` with [`TextBaseline::Middle`]) **down to the alphabetic
/// baseline**, in the same units as `size`.
///
/// This is the single font-derived offset that lets above-staff text be
/// anchored by its **baseline** rather than a hard-coded half-em guess. Placing
/// a marking's baseline `attach_gap` above the staff means
/// `line_y = staff_y - attach_gap*sp - baseline_offset_from_middle(..)`, so
/// "2sp from the staff to the text" measures to the baseline, not to a font's
/// nominal half-em descent.
///
/// The constant matches the layout text bbox's Middle→baseline descent (the
/// `block_h - 0.46em` the selection box already uses), so placement, hit-box,
/// and the debug overlay all agree on where the baseline sits — eliminating the
/// "over-reserved half-em vs. tight-ink" sliver. It approximates the standard-14
/// metrics' `ascent/upem / 2` (the renderer's own `Middle` convention). When
/// real font loading replaces the AFM tables, this reads the face's
/// `ascender()/units_per_em()` so customizable fonts stay baseline-correct
/// without touching any call site.
pub fn baseline_offset_from_middle(family: FontFamily, size: f64) -> f64 {
    let em = match family {
        // Times / Helvetica / Courier all sit ~0.36 em below the Middle anchor
        // at their baseline (matches the text bbox's Middle→baseline descent).
        FontFamily::Serif | FontFamily::SansSerif | FontFamily::Monospace => 0.36,
    };
    size * em
}

/// Distance from the alphabetic baseline **up to the optical centre of the
/// cap-height ink band** (i.e. `capHeight / 2`), in the same units as `size`.
///
/// This is the font-derived offset for OPTICALLY centring caps-dominant text
/// (instrument names, staff labels, condensed numbers) on a target line. The
/// `Middle` baseline / CSS `align-items: center` centre the *em box*, which
/// reserves empty ascender + descender space — so caps-only / Title-Case text
/// rendered that way sits slightly low. Centring the cap-height band instead
/// puts the visual mass of the capitals on the target line, matching standard
/// engraving practice for part labels.
///
/// Usage: `baseline_y = center_y + cap_center_offset_from_baseline(..)`, then
/// render with [`TextBaseline::Alphabetic`] at `baseline_y`. When real font
/// loading replaces the AFM tables, this reads the face's
/// `capital_height()/units_per_em()` (OS/2 `sCapHeight`) so customizable fonts
/// stay optically centred without touching any call site.
pub fn cap_center_offset_from_baseline(family: FontFamily, size: f64) -> f64 {
    cap_height_from_baseline(family, size) * 0.5
}

/// Distance from the alphabetic baseline **up to the cap-height line** (the top
/// of the capitals), in the same units as `size`.
///
/// This is the **inverse of the baseline** for below-staff text: just as an
/// above-staff marking anchors its gap to the baseline and lets descenders dip
/// through toward the staff, a below-staff marking anchors its gap to the
/// cap-height line and lets the occasional ascender/accent poke up through. The
/// cap-height line is a stable face metric (unlike "top ink", which jumps per
/// glyph between x-height, cap-height, and ascender), so the box's staff-facing
/// edge stays put no matter what letters the text contains — symmetric with the
/// baseline rule above the staff.
///
/// Usage (below-staff text): the box's staff-facing (top) edge sits at
/// `baseline_y - cap_height_from_baseline(..)`. When real font loading replaces
/// the AFM tables, this reads the face's `capital_height()/units_per_em()`
/// (OS/2 `sCapHeight`) so customizable fonts stay correct without touching any
/// call site.
pub fn cap_height_from_baseline(family: FontFamily, size: f64) -> f64 {
    let cap_height_em = match family {
        // Times cap height ≈ 0.662 em; Helvetica ≈ 0.717; Courier ≈ 0.571.
        FontFamily::Serif => 0.662,
        FontFamily::SansSerif => 0.717,
        FontFamily::Monospace => 0.571,
    };
    size * cap_height_em
}

/// Per-character advance as a fraction of the em, dispatched by family/weight.
fn char_advance(ch: char, family: FontFamily, bold: bool) -> f64 {
    match family {
        FontFamily::Monospace => 0.6, // Courier: every glyph is 600/1000 em.
        FontFamily::Serif => {
            if bold {
                crate::render::smufl::smufl::serif_bold_char_advance(ch)
            } else {
                serif_regular_char_advance(ch)
            }
        }
        FontFamily::SansSerif => {
            if bold {
                sans_bold_char_advance(ch)
            } else {
                sans_regular_char_advance(ch)
            }
        }
    }
}

/// Times-Roman AFM advance widths (per-1000 em → 0–1 fraction). Unknown chars
/// fall back to 0.5 em.
fn serif_regular_char_advance(ch: char) -> f64 {
    let units: u32 = match ch {
        ' ' => 250,
        '!' => 333,
        '"' => 408,
        '#' => 500,
        '$' => 500,
        '%' => 833,
        '&' => 778,
        '\'' => 180,
        '(' | ')' => 333,
        '*' => 500,
        '+' | '<' | '=' | '>' => 564,
        ',' | '.' => 250,
        '-' => 333,
        '/' => 278,
        '0'..='9' => 500,
        ':' | ';' => 278,
        '?' => 444,
        '@' => 921,
        'A' => 722,
        'B' => 667,
        'C' => 667,
        'D' => 722,
        'E' => 611,
        'F' => 556,
        'G' => 722,
        'H' => 722,
        'I' => 333,
        'J' => 389,
        'K' => 722,
        'L' => 611,
        'M' => 889,
        'N' => 722,
        'O' => 722,
        'P' => 556,
        'Q' => 722,
        'R' => 667,
        'S' => 556,
        'T' => 611,
        'U' => 722,
        'V' => 722,
        'W' => 944,
        'X' => 722,
        'Y' => 722,
        'Z' => 611,
        '[' | ']' => 333,
        '\\' => 278,
        '^' => 469,
        '_' => 500,
        '`' => 333,
        'a' => 444,
        'b' => 500,
        'c' => 444,
        'd' => 500,
        'e' => 444,
        'f' => 333,
        'g' => 500,
        'h' => 500,
        'i' => 278,
        'j' => 278,
        'k' => 500,
        'l' => 278,
        'm' => 778,
        'n' => 500,
        'o' => 500,
        'p' => 500,
        'q' => 500,
        'r' => 333,
        's' => 389,
        't' => 278,
        'u' => 500,
        'v' => 500,
        'w' => 722,
        'x' => 500,
        'y' => 500,
        'z' => 444,
        '{' | '}' => 480,
        '|' => 200,
        '~' => 541,
        _ => 500,
    };
    units as f64 / 1000.0
}

/// Helvetica AFM advance widths (per-1000 em → 0–1 fraction).
fn sans_regular_char_advance(ch: char) -> f64 {
    let units: u32 = match ch {
        ' ' | '!' | ',' | '.' | '/' | ':' | ';' | 'i' | 'j' | 'l' | '|' => 278,
        '"' => 355,
        '#'
        | '$'
        | '0'..='9'
        | 'L'
        | 'Z'
        | 'a'
        | 'b'
        | 'c'
        | 'd'
        | 'e'
        | 'g'
        | 'h'
        | 'k'
        | 'n'
        | 'o'
        | 'p'
        | 'q'
        | 'u' => 556,
        '%' => 889,
        '&' => 667,
        '\'' => 191,
        '(' | ')' | 'f' | 't' | '[' | ']' => 333,
        '*' => 389,
        '+' | '<' | '=' | '>' | '~' => 584,
        '-' => 333,
        '?' | 'r' | 's' | 'z' => 500,
        '@' => 1015,
        'A' | 'B' | 'C' | 'D' | 'E' | 'H' | 'K' | 'N' | 'R' | 'U' | 'V' | 'X' | 'Y' => 667,
        'F' | 'P' | 'S' => 667,
        'G' | 'O' | 'Q' => 778,
        'I' => 278,
        'J' => 500,
        'M' | 'm' | 'w' => 833,
        'T' => 611,
        'W' => 944,
        '\\' => 278,
        '^' => 469,
        '_' => 556,
        '`' => 333,
        'v' | 'x' | 'y' => 500,
        '{' | '}' => 334,
        _ => 556,
    };
    units as f64 / 1000.0
}

/// Helvetica-Bold AFM advance widths (per-1000 em → 0–1 fraction).
fn sans_bold_char_advance(ch: char) -> f64 {
    let units: u32 = match ch {
        ' ' | '!' | '/' | 'i' | 'j' | 'l' => 278,
        ',' | '.' | ':' | ';' | '|' => 333,
        '"' => 474,
        '#'
        | '$'
        | '0'..='9'
        | 'a'
        | 'b'
        | 'c'
        | 'd'
        | 'e'
        | 'g'
        | 'h'
        | 'k'
        | 'n'
        | 'o'
        | 'p'
        | 'q'
        | 'u' => 556,
        '%' => 889,
        '&' => 722,
        '\'' => 238,
        '(' | ')' | '[' | ']' => 333,
        '*' => 389,
        '+' | '<' | '=' | '>' | '~' => 584,
        '-' => 333,
        '?' | 'f' | 't' | 'z' => 333,
        '@' => 975,
        'A' | 'B' | 'C' | 'D' | 'E' | 'H' | 'K' | 'N' | 'R' | 'U' | 'V' | 'X' | 'Y' => 722,
        'F' => 611,
        'G' | 'O' | 'Q' => 778,
        'I' => 278,
        'J' => 556,
        'L' | 'P' | 'S' | 'Z' | 'r' | 's' => 611,
        'M' | 'm' | 'w' => 833,
        'T' => 667,
        'W' => 944,
        '\\' => 278,
        '^' => 584,
        '_' => 556,
        '`' => 333,
        'v' | 'x' | 'y' => 556,
        '{' | '}' => 389,
        _ => 556,
    };
    units as f64 / 1000.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_tempo_is_serif_bold() {
        let sheet = TextStylesheet::default();
        let tempo = sheet.resolve(TextRole::Tempo);
        assert_eq!(tempo.font_string(), "serif bold");
        assert_eq!(tempo.size_sp, 2.4);
    }

    #[test]
    fn shared_defaults_json_covers_every_role() {
        // The embedded `textStyleDefaults.json` (shared with the TS editor) must
        // deserialize into a complete stylesheet — every role present. This
        // guards against a role being added in Rust but missing from the file.
        let sheet = TextStylesheet::default();
        for role in [
            TextRole::Title,
            TextRole::Subtitle,
            TextRole::Composer,
            TextRole::Arranger,
            TextRole::StaffLabel,
            TextRole::PageNumber,
            TextRole::Tempo,
            TextRole::PedalText,
            TextRole::Copyright,
        ] {
            let style = sheet.resolve(role);
            assert!(
                style.size_sp > 0.0,
                "{role:?} default size must be positive"
            );
            assert!(
                is_hex_color(&style.color),
                "{role:?} default color must be #RRGGBB"
            );
        }
    }

    #[test]
    fn font_string_combines_family_weight_slant() {
        let style = TextStyle {
            size_sp: 2.0,
            family: FontFamily::SansSerif,
            bold: true,
            italic: true,
            color: "#000000".into(),
            align: TextAlignment::Left,
        };
        assert_eq!(style.font_string(), "sans-serif bold italic");
    }

    #[test]
    fn merge_json_overrides_present_fields_only() {
        let mut sheet = TextStylesheet::default();
        let json = serde_json::json!({
            "tempo": { "size": 3.0, "italic": true, "family": "sans-serif" },
            "title": { "color": "#FF0000" }
        });
        sheet.merge_json(&json);

        let tempo = sheet.resolve(TextRole::Tempo);
        assert_eq!(tempo.size_sp, 3.0);
        assert!(tempo.italic);
        assert!(tempo.bold, "bold should remain at its default (true)");
        assert_eq!(tempo.family, FontFamily::SansSerif);

        let title = sheet.resolve(TextRole::Title);
        assert_eq!(title.color, "#FF0000");
        assert_eq!(title.size_sp, 5.0, "unspecified title size keeps default");
    }

    #[test]
    fn merge_json_rejects_bad_color() {
        let mut sheet = TextStylesheet::default();
        sheet.merge_json(&serde_json::json!({ "title": { "color": "red" } }));
        assert_eq!(sheet.resolve(TextRole::Title).color, "#000000");
    }

    #[test]
    fn text_width_scales_with_size() {
        let w1 = text_width("Allegro", 10.0, FontFamily::Serif, true);
        let w2 = text_width("Allegro", 20.0, FontFamily::Serif, true);
        assert!((w2 - 2.0 * w1).abs() < 1e-9);
    }

    #[test]
    fn monospace_width_is_uniform() {
        let w = text_width("iiii", 10.0, FontFamily::Monospace, false);
        let w2 = text_width("WWWW", 10.0, FontFamily::Monospace, false);
        assert!((w - w2).abs() < 1e-9, "monospace advances are constant");
    }
}
