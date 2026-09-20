use crate::model::{ChordRoot, ChordSymbol};

/// Clone canonical concert harmony for a layout source's written display.
///
/// `source_transpose` is the SOURCE's sounding-to-written
/// `(staff_distance, half_steps)`, not the destination staff's transposition.
/// Pass `None` for concert display, including octave-transposing instruments.
/// Identity/provenance fields and the canonical event are left untouched.
pub(crate) fn chord_symbol_for_display(
    chord: &ChordSymbol,
    source_transpose: Option<(i32, i32)>,
) -> ChordSymbol {
    let mut display = chord.clone();
    let Some(interval) = source_transpose.filter(|interval| *interval != (0, 0)) else {
        return display;
    };
    for root in [&mut display.root, &mut display.bass].into_iter().flatten() {
        if let Some(transposed) = transpose_root(root, interval) {
            *root = transposed;
        }
    }
    for text in [&mut display.raw_text, &mut display.text_override]
        .into_iter()
        .flatten()
    {
        if let Some(transposed) = transpose_text(text, interval) {
            *text = transposed;
        }
    }
    display
}

fn transpose_root(root: &ChordRoot, (staff_distance, half_steps): (i32, i32)) -> Option<ChordRoot> {
    const STEPS: [&str; 7] = ["C", "D", "E", "F", "G", "A", "B"];
    const NATURALS: [i64; 7] = [0, 2, 4, 5, 7, 9, 11];
    let index = STEPS.iter().position(|step| *step == root.step)?;
    let target = index as i64 + i64::from(staff_distance);
    let target_index = target.rem_euclid(7) as usize;
    let target_natural = NATURALS[target_index] + 12 * target.div_euclid(7);
    let alter = i32::try_from(
        NATURALS[index] + i64::from(root.alter.unwrap_or(0)) + i64::from(half_steps)
            - target_natural,
    )
    .ok()?;
    Some(ChordRoot {
        step: STEPS[target_index].into(),
        alter: (alter != 0).then_some(alter),
    })
}

struct TextRoot<'a> {
    root: ChordRoot,
    spelling: &'a str,
    rest: &'a str,
}

fn parse_text_root(text: &str) -> Option<TextRoot<'_>> {
    let step = text.chars().next()?;
    if !matches!(step, 'A'..='G' | 'a'..='g') {
        return None;
    }
    let mut end = 1;
    let mut alter = 0_i32;
    let accidental = text[end..].chars().next();
    if let Some(marker @ ('#' | 'b' | '♯' | '♭')) = accidental {
        for ch in text[end..].chars().take_while(|ch| *ch == marker) {
            alter = alter.checked_add(if matches!(ch, '#' | '♯') { 1 } else { -1 })?;
            end += ch.len_utf8();
        }
    } else if let Some(marker @ ('x' | '𝄪' | '𝄫' | '♮')) = accidental {
        alter = match marker {
            '𝄫' => -2,
            '♮' => 0,
            _ => 2,
        };
        end += marker.len_utf8();
    }
    Some(TextRoot {
        root: ChordRoot {
            step: step.to_ascii_uppercase().to_string(),
            alter: (alter != 0).then_some(alter),
        },
        spelling: &text[..end],
        rest: &text[end..],
    })
}

fn format_text_root(root: &TextRoot<'_>, interval: (i32, i32)) -> Option<String> {
    let transposed = transpose_root(&root.root, interval)?;
    if transposed == root.root {
        return Some(root.spelling.into());
    }
    let alter = transposed.alter.unwrap_or(0);
    // Malformed extreme intervals must not turn a short label into a huge allocation.
    if alter.unsigned_abs() > 128 {
        return None;
    }
    let mut text = if root.spelling.starts_with(char::is_lowercase) {
        transposed.step.to_ascii_lowercase()
    } else {
        transposed.step
    };
    let unicode = root.spelling.contains(['♯', '♭', '♮', '𝄪', '𝄫']);
    match alter {
        0 if root.spelling.contains('♮') => text.push('♮'),
        2 if root.spelling.contains('x') => text.push('x'),
        2 if root.spelling.contains('𝄪') => text.push('𝄪'),
        -2 if root.spelling.contains('𝄫') => text.push('𝄫'),
        _ => {
            let marker = match (alter > 0, unicode) {
                (true, true) => '♯',
                (false, true) => '♭',
                (true, false) => '#',
                (false, false) => 'b',
            };
            text.extend(std::iter::repeat_n(marker, alter.unsigned_abs() as usize));
        }
    }
    Some(text)
}

fn recognizable_suffix(suffix: &str) -> bool {
    if suffix.is_empty() {
        return true;
    }
    // Recognize notation, not arbitrary prose starting with A–G. This is only a
    // spelling boundary: unsupported alterations retain their authored suffix.
    let lower = suffix.to_ascii_lowercase();
    let mut rest = lower.as_str();
    while !rest.is_empty() {
        if let Some(token) = [
            "maj", "ma", "min", "dim", "aug", "sus", "add", "omit", "alt", "no",
        ]
        .into_iter()
        .find(|token| rest.starts_with(token))
        {
            rest = &rest[token.len()..];
            continue;
        }
        let ch = rest.chars().next().unwrap();
        if !(ch.is_ascii_digit()
            || ch.is_whitespace()
            || matches!(
                ch,
                'm' | 'o'
                    | 'b'
                    | '#'
                    | '♭'
                    | '♯'
                    | '♮'
                    | 'Δ'
                    | 'δ'
                    | '△'
                    | 'ø'
                    | '°'
                    | '+'
                    | '-'
                    | '−'
                    | '('
                    | ')'
                    | '['
                    | ']'
                    | ','
                    | '/'
            ))
        {
            return false;
        }
        rest = &rest[ch.len_utf8()..];
    }
    true
}

fn has_six_nine_extension(suffix: &str) -> bool {
    suffix
        .trim()
        .split_once('/')
        .is_some_and(|(left, right)| left.ends_with('6') && right == "9")
}

fn transpose_text(text: &str, interval: (i32, i32)) -> Option<String> {
    let body = text.trim();
    let root = parse_text_root(body)?;
    let (suffix, bass) = match root.rest.rsplit_once('/') {
        Some((suffix, tail)) => {
            let tail_body = tail.trim();
            if let Some(bass) = parse_text_root(tail_body).filter(|bass| bass.rest.is_empty()) {
                (suffix, Some((tail, bass)))
            } else if has_six_nine_extension(root.rest) {
                (root.rest, None)
            } else {
                return None;
            }
        }
        None => (root.rest, None),
    };
    if !recognizable_suffix(suffix) || (suffix.contains('/') && !has_six_nine_extension(suffix)) {
        return None;
    }
    let leading = text.len() - text.trim_start().len();
    let trailing = text.trim_end().len();
    let mut result = String::with_capacity(text.len());
    result.push_str(&text[..leading]);
    result.push_str(&format_text_root(&root, interval)?);
    result.push_str(suffix);
    if let Some((tail, bass)) = bass {
        result.push('/');
        result.push_str(&tail[..tail.len() - tail.trim_start().len()]);
        result.push_str(&format_text_root(&bass, interval)?);
        result.push_str(&tail[tail.trim_end().len()..]);
    }
    result.push_str(&text[trailing..]);
    Some(result)
}
