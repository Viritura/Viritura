use crate::model::{GlyphRun, SystemText, TextContent, TextContentChunk, TextRun, TextRunStyle};
use crate::render::smufl::smufl;

pub(super) fn display_content(instruction: &SystemText) -> TextContent {
    let mut content = if instruction.show_text == Some(false) {
        TextContent::default()
    } else {
        instruction.text.clone()
    };
    let Some(tempo) = &instruction.tempo else {
        return content;
    };
    let (Some(bpm), Some(value)) = (tempo.bpm, tempo.value.as_ref()) else {
        return content;
    };
    if tempo.show_metronome_mark == Some(false) {
        return content;
    }
    let has_text = content.chunks().iter().any(|chunk| match chunk {
        TextContentChunk::Text(run) => !run.text.is_empty(),
        TextContentChunk::Glyph(run) => !run.glyphs.is_empty(),
    });
    if has_text {
        content.0.push(TextContentChunk::Text(TextRun {
            text: " (".into(),
            style: None,
        }));
    }
    let name = match smufl::metronome_note_glyph(&value.base) {
        smufl::MET_NOTE_DOUBLE_WHOLE => "metNoteDoubleWhole",
        smufl::MET_NOTE_WHOLE => "metNoteWhole",
        smufl::MET_NOTE_HALF_UP => "metNoteHalfUp",
        smufl::MET_NOTE_QUARTER_UP => "metNoteQuarterUp",
        smufl::MET_NOTE_8TH_UP => "metNote8thUp",
        smufl::MET_NOTE_16TH_UP => "metNote16thUp",
        smufl::MET_NOTE_32ND_UP => "metNote32ndUp",
        _ => "metNote64thUp",
    };
    let mut glyphs = vec![name.to_owned()];
    glyphs.extend((0..value.dots.unwrap_or(0)).map(|_| "metAugmentationDot".to_owned()));
    content.0.push(TextContentChunk::Glyph(GlyphRun {
        glyphs,
        style: Some(TextRunStyle {
            size: Some(1.5),
            ..Default::default()
        }),
        smufl_style: None,
    }));
    content.0.push(TextContentChunk::Text(TextRun {
        text: format!(" = {bpm}{}", if has_text { ")" } else { "" }),
        style: None,
    }));
    content
}
