//! Degree operations for the engraving equality key, never playback voicing.

#[derive(Default)]
pub(super) struct Modifiers {
    pub(super) added: Vec<usize>,
    pub(super) omitted: Vec<usize>,
}

impl Modifiers {
    pub(super) fn parse(text: &str) -> Option<Self> {
        let text = text.trim();
        if text.is_empty() {
            return Some(Self::default());
        }
        let lower = text.to_ascii_lowercase();
        let mut rest = lower.as_str();
        let mut modifiers = Self::default();
        let mut operation = None;
        let mut needs_degree = false;
        let mut after_degree = false;
        let mut in_group = false;
        let mut after_comma = false;
        while !rest.is_empty() {
            if let Some((token, add)) = [("add", true), ("omit", false), ("no", false)]
                .into_iter()
                .find(|(token, _)| rest.starts_with(token))
            {
                if needs_degree {
                    return None;
                }
                operation = Some(add);
                needs_degree = true;
                after_degree = false;
                after_comma = false;
                rest = rest[token.len()..].trim_start();
                continue;
            }
            match rest.as_bytes()[0] {
                b'(' if !in_group && !after_comma => {
                    in_group = true;
                    after_degree = false;
                }
                b')' if in_group && after_degree && !after_comma => {
                    in_group = false;
                }
                b',' if after_degree && !after_comma => {
                    after_comma = true;
                    after_degree = false;
                }
                b'1'..=b'9' => {
                    let add = operation?;
                    let (degree, length) = if rest.starts_with("13") {
                        (13, 2)
                    } else if rest.starts_with("11") {
                        (11, 2)
                    } else {
                        (usize::from(rest.as_bytes()[0] - b'0'), 1)
                    };
                    if !matches!(degree, 1 | 2 | 3 | 4 | 5 | 6 | 7 | 9 | 11 | 13)
                        || (add && matches!(degree, 1 | 3 | 5))
                    {
                        return None;
                    }
                    if add {
                        modifiers.added.push(degree);
                    } else {
                        modifiers.omitted.push(degree);
                    }
                    needs_degree = false;
                    after_degree = true;
                    after_comma = false;
                    rest = rest[length..].trim_start();
                    continue;
                }
                _ => return None,
            }
            rest = rest[1..].trim_start();
        }
        if in_group || needs_degree || !after_degree || after_comma {
            return None;
        }
        modifiers.added.sort_unstable();
        modifiers.added.dedup();
        modifiers.omitted.sort_unstable();
        modifiers.omitted.dedup();
        Some(modifiers)
    }

    pub(super) fn intervals(&self, mut degrees: [u16; 14]) -> u16 {
        for degree in &self.added {
            let interval = match degree {
                2 | 9 => 2,
                4 | 11 => 5,
                6 | 13 => 9,
                7 => 10,
                _ => unreachable!("validated added degree"),
            };
            degrees[*degree] |= 1 << interval;
        }
        for degree in &self.omitted {
            degrees[*degree] = 0;
        }
        degrees.into_iter().fold(0, |key, interval| key | interval)
    }

    pub(super) fn label(&self) -> String {
        self.added
            .iter()
            .map(|degree| format!("add{degree}"))
            .chain(self.omitted.iter().map(|degree| format!("omit{degree}")))
            .collect()
    }
}
