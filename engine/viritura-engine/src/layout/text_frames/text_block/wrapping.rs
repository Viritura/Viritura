//! Deterministic line breaking for text-frame content.
//!
//! Authored `\n` characters always end a paragraph; within a paragraph words
//! are filled greedily against the frame's inner width using the engine's
//! font-metric tables, so wrapping is identical in the editor and in headless
//! export. Runs of spaces collapse to one inter-word space. A single word wider
//! than the frame keeps its own line and overflows rather than being split
//! mid-word (standard typesetting practice without hyphenation).

use crate::layout::render_annotations::content_width;
use crate::layout::text_styles::FontFamily;
use crate::model::{TextContent, TextContentChunk, TextRun, TextRunStyle};

/// Baseline-to-baseline distance as a multiple of the tallest run on a line.
const LINE_SPACING: f64 = 1.2;
/// Distance from a line's top to its baseline, as a multiple of run size.
const ASCENT: f64 = 0.8;
const WIDTH_TOLERANCE: f64 = 1e-6;

#[derive(Clone, Copy)]
pub(crate) struct FrameFont {
    pub base_size: f64,
    pub family: FontFamily,
    pub bold: bool,
}

pub(super) struct Word {
    pub chunks: Vec<TextContentChunk>,
    pub width: f64,
    pub space_width: f64,
    size_multiplier: f64,
}

pub(super) struct Line {
    pub words: Vec<Word>,
    /// Width of the words plus one natural space between each pair.
    pub natural_width: f64,
    pub height: f64,
    pub ascent: f64,
    /// Last line of an authored paragraph (never stretched by full justification).
    pub ends_paragraph: bool,
}

pub(super) fn wrap(content: &TextContent, inner_width: f64, font: &FrameFont) -> Vec<Line> {
    let mut lines = Vec::new();
    for paragraph in paragraphs(content) {
        let words: Vec<Word> = paragraph
            .into_iter()
            .map(|chunks| measure_word(chunks, font))
            .collect();
        let mut current: Vec<Word> = Vec::new();
        let mut current_width = 0.0;
        for word in words {
            let needed = if current.is_empty() {
                word.width
            } else {
                current_width + current.last().unwrap().space_width + word.width
            };
            if !current.is_empty() && needed > inner_width + WIDTH_TOLERANCE {
                lines.push(finish_line(std::mem::take(&mut current), font));
                current_width = word.width;
            } else {
                current_width = needed;
            }
            current.push(word);
        }
        lines.push(finish_line(current, font));
        if let Some(last) = lines.last_mut() {
            last.ends_paragraph = true;
        }
    }
    lines
}

/// Split content into authored paragraphs of words; each word is the list of
/// styled fragments that touch without intervening whitespace.
fn paragraphs(content: &TextContent) -> Vec<Vec<Vec<TextContentChunk>>> {
    let mut paragraphs = Vec::new();
    let mut paragraph: Vec<Vec<TextContentChunk>> = Vec::new();
    let mut word: Vec<TextContentChunk> = Vec::new();
    for chunk in content.chunks() {
        let run = match chunk {
            TextContentChunk::Glyph(_) => {
                word.push(chunk.clone());
                continue;
            }
            TextContentChunk::Text(run) => run,
        };
        let mut fragment = String::new();
        for ch in run.text.chars() {
            match ch {
                '\n' => {
                    push_fragment(&mut word, &mut fragment, run.style.as_ref());
                    push_word(&mut paragraph, &mut word);
                    paragraphs.push(std::mem::take(&mut paragraph));
                }
                '\r' => {}
                ch if ch.is_whitespace() && ch != '\u{a0}' => {
                    push_fragment(&mut word, &mut fragment, run.style.as_ref());
                    push_word(&mut paragraph, &mut word);
                }
                ch => fragment.push(ch),
            }
        }
        push_fragment(&mut word, &mut fragment, run.style.as_ref());
    }
    push_word(&mut paragraph, &mut word);
    paragraphs.push(paragraph);
    paragraphs
}

fn push_fragment(
    word: &mut Vec<TextContentChunk>,
    fragment: &mut String,
    style: Option<&TextRunStyle>,
) {
    if fragment.is_empty() {
        return;
    }
    word.push(TextContentChunk::Text(TextRun {
        text: std::mem::take(fragment),
        style: style.cloned(),
    }));
}

fn push_word(paragraph: &mut Vec<Vec<TextContentChunk>>, word: &mut Vec<TextContentChunk>) {
    if !word.is_empty() {
        paragraph.push(std::mem::take(word));
    }
}

fn measure_word(chunks: Vec<TextContentChunk>, font: &FrameFont) -> Word {
    let size_multiplier = chunks.iter().map(size_multiplier).fold(1.0, f64::max);
    let width = content_width(
        &TextContent(chunks.clone()),
        font.base_size,
        font.family,
        font.bold,
    );
    let space_width = content_width(
        &TextContent(vec![space_after(&chunks)]),
        font.base_size,
        font.family,
        font.bold,
    );
    Word {
        chunks,
        width,
        space_width,
        size_multiplier,
    }
}

fn size_multiplier(chunk: &TextContentChunk) -> f64 {
    let size = match chunk {
        TextContentChunk::Text(run) => run.style.as_ref().and_then(|style| style.size),
        TextContentChunk::Glyph(run) => run
            .smufl_style
            .as_ref()
            .and_then(|style| style.size)
            .or_else(|| run.style.as_ref().and_then(|style| style.size)),
    };
    size.filter(|size| size.is_finite() && *size > 0.0)
        .unwrap_or(1.0)
}

fn finish_line(words: Vec<Word>, font: &FrameFont) -> Line {
    let tallest = words
        .iter()
        .map(|word| word.size_multiplier)
        .fold(1.0, f64::max);
    let size = font.base_size * tallest;
    let natural_width = words.iter().map(|word| word.width).sum::<f64>()
        + words
            .iter()
            .take(words.len().saturating_sub(1))
            .map(|word| word.space_width)
            .sum::<f64>();
    Line {
        words,
        natural_width,
        height: LINE_SPACING * size,
        ascent: ASCENT * size,
        ends_paragraph: false,
    }
}

fn space_after(chunks: &[TextContentChunk]) -> TextContentChunk {
    let style = match chunks.last() {
        Some(TextContentChunk::Text(run)) => run.style.clone(),
        _ => None,
    };
    TextContentChunk::Text(TextRun {
        text: " ".into(),
        style,
    })
}

impl Line {
    /// The line as one content value: words joined by single spaces carrying
    /// the preceding fragment's style, with same-styled neighbours merged so a
    /// plain line stays one text run.
    pub(super) fn joined_content(&self) -> TextContent {
        let mut chunks: Vec<TextContentChunk> = Vec::new();
        for (index, word) in self.words.iter().enumerate() {
            if index > 0 {
                let space = space_after(&chunks);
                append_chunk(&mut chunks, space);
            }
            for chunk in &word.chunks {
                append_chunk(&mut chunks, chunk.clone());
            }
        }
        TextContent(chunks)
    }
}

fn append_chunk(chunks: &mut Vec<TextContentChunk>, chunk: TextContentChunk) {
    if let (Some(TextContentChunk::Text(previous)), TextContentChunk::Text(next)) =
        (chunks.last_mut(), &chunk)
    {
        if previous.style == next.style {
            previous.text.push_str(&next.text);
            return;
        }
    }
    chunks.push(chunk);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::text_styles;
    use crate::model::{GlyphRun, TextWeight, TextWeightName};

    const FONT: FrameFont = FrameFont {
        base_size: 20.0,
        family: FontFamily::Serif,
        bold: false,
    };

    fn text(value: &str) -> TextContentChunk {
        TextContentChunk::Text(TextRun {
            text: value.into(),
            style: None,
        })
    }

    fn bold(value: &str) -> TextContentChunk {
        TextContentChunk::Text(TextRun {
            text: value.into(),
            style: Some(TextRunStyle {
                weight: Some(TextWeight::Named(TextWeightName::Bold)),
                ..TextRunStyle::default()
            }),
        })
    }

    fn line_texts(lines: &[Line]) -> Vec<String> {
        lines
            .iter()
            .map(|line| {
                line.joined_content()
                    .chunks()
                    .iter()
                    .map(|chunk| match chunk {
                        TextContentChunk::Text(run) => run.text.clone(),
                        TextContentChunk::Glyph(run) => format!("<{}>", run.glyphs.join(",")),
                    })
                    .collect()
            })
            .collect()
    }

    #[test]
    fn authored_breaks_blank_lines_and_collapsed_spaces() {
        let content = TextContent(vec![text("one   two\n\nthree  ")]);
        let lines = wrap(&content, 10_000.0, &FONT);
        assert_eq!(line_texts(&lines), ["one two", "", "three"]);
        assert!(lines.iter().all(|line| line.ends_paragraph));
        assert!((lines[1].height - LINE_SPACING * FONT.base_size).abs() < 1e-9);
    }

    #[test]
    fn styled_fragments_without_whitespace_stay_one_word() {
        let content = TextContent(vec![
            text("un"),
            bold("break"),
            text("able next"),
            TextContentChunk::Glyph(GlyphRun {
                glyphs: vec!["segno".into()],
                style: None,
                smufl_style: None,
            }),
        ]);
        let lines = wrap(&content, 10_000.0, &FONT);
        assert_eq!(lines[0].words.len(), 2);
        assert_eq!(lines[0].words[0].chunks.len(), 3);
        assert_eq!(line_texts(&lines), ["unbreakable next<segno>"]);
    }

    #[test]
    fn greedy_fill_breaks_before_overflow_and_keeps_long_words_whole() {
        let word = text_styles::text_width("word", FONT.base_size, FONT.family, false);
        let space = text_styles::text_width(" ", FONT.base_size, FONT.family, false);
        let content = TextContent(vec![text("word word word extraordinarily")]);
        let lines = wrap(&content, 2.0 * word + space, &FONT);
        assert_eq!(line_texts(&lines), ["word word", "word", "extraordinarily"]);
        assert!(!lines[0].ends_paragraph);
        assert!(lines[2].ends_paragraph);
        assert!(
            lines[2].natural_width > 2.0 * word + space,
            "overlong word overflows"
        );
    }

    #[test]
    fn larger_runs_grow_their_line() {
        let big = TextContentChunk::Text(TextRun {
            text: "Big".into(),
            style: Some(TextRunStyle {
                size: Some(2.0),
                ..TextRunStyle::default()
            }),
        });
        let lines = wrap(&TextContent(vec![text("small\n"), big]), 10_000.0, &FONT);
        assert!((lines[1].height - 2.0 * lines[0].height).abs() < 1e-9);
        assert!((lines[1].ascent - 2.0 * ASCENT * FONT.base_size).abs() < 1e-9);
    }

    #[test]
    fn styled_spaces_match_rendered_width_and_control_line_breaks() {
        let content = TextContent(vec![TextContentChunk::Text(TextRun {
            text: "word word".into(),
            style: Some(TextRunStyle {
                size: Some(2.0),
                ..TextRunStyle::default()
            }),
        })]);
        let rendered_width = content_width(&content, FONT.base_size, FONT.family, FONT.bold);
        let lines = wrap(&content, rendered_width, &FONT);
        assert_eq!(line_texts(&lines), ["word word"]);
        assert!((lines[0].natural_width - rendered_width).abs() < WIDTH_TOLERANCE);
        let base_space = text_styles::text_width(" ", FONT.base_size, FONT.family, FONT.bold);
        assert_eq!(
            line_texts(&wrap(&content, rendered_width - base_space / 2.0, &FONT)),
            ["word", "word"]
        );
    }

    #[test]
    fn mixed_style_spaces_match_joined_content_width() {
        let content = TextContent(vec![
            TextContentChunk::Text(TextRun {
                text: "big ".into(),
                style: Some(TextRunStyle {
                    size: Some(2.0),
                    ..TextRunStyle::default()
                }),
            }),
            text("small end"),
        ]);
        let lines = wrap(&content, 10_000.0, &FONT);
        let line = &lines[0];
        assert!(line.words[0].space_width > line.words[1].space_width);
        let width = content_width(
            &line.joined_content(),
            FONT.base_size,
            FONT.family,
            FONT.bold,
        );
        assert!((line.natural_width - width).abs() < WIDTH_TOLERANCE);
    }
}
