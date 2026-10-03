//! Automatic advance reminders follow the final sounding release, across
//! voices and tied continuations, rather than the beginning of a rest.

use crate::model::*;
use std::collections::HashMap;

struct Sound {
    onset: Fraction,
    release: Fraction,
    ids: Vec<String>,
    targets: Vec<String>,
}

fn add(a: Fraction, b: Fraction) -> Option<Fraction> {
    Some(Fraction::new(
        a.num
            .checked_mul(b.den)?
            .checked_add(b.num.checked_mul(a.den)?)?,
        a.den.checked_mul(b.den)?,
    ))
}

fn multiply(a: Fraction, b: Fraction) -> Option<Fraction> {
    // Reduce cross factors before multiplying, including nested tuplet ratios.
    let x = Fraction::new(a.num, b.den);
    let y = Fraction::new(b.num, a.den);
    Some(Fraction::new(
        x.num.checked_mul(y.num)?,
        x.den.checked_mul(y.den)?,
    ))
}

fn before(a: Fraction, b: Fraction) -> bool {
    u128::from(a.num) * u128::from(b.den) < u128::from(b.num) * u128::from(a.den)
}

fn duration(value: &Duration) -> Option<Fraction> {
    let base = match value.base {
        NoteValueBase::DuplexMaxima => Fraction::new(16, 1),
        NoteValueBase::Maxima => Fraction::new(8, 1),
        NoteValueBase::Longa => Fraction::new(4, 1),
        NoteValueBase::Breve => Fraction::new(2, 1),
        _ => Fraction::new(1, (4.0 / value.base.beats()) as u64),
    };
    let power = 1_u64.checked_shl(value.dots.unwrap_or(0))?;
    multiply(
        base,
        Fraction::new(power.checked_mul(2)?.checked_sub(1)?, power),
    )
}

fn sound(event: &Event, onset: Fraction, release: Fraction, sounds: &mut Vec<Sound>) {
    if event.notes().is_empty() {
        return;
    }
    sounds.push(Sound {
        onset,
        release,
        ids: event
            .notes()
            .iter()
            .filter_map(|note| note.id.clone())
            .collect(),
        targets: event
            .notes()
            .iter()
            .flat_map(|note| note.ties.iter().flatten())
            .filter(|tie| !tie.lv.unwrap_or(false))
            .filter_map(|tie| tie.target.clone())
            .collect(),
    });
}

fn walk(
    content: &[SequenceContent],
    cursor: &mut Fraction,
    scale: Fraction,
    sounds: &mut Vec<Sound>,
) -> Option<()> {
    for item in content {
        match item {
            SequenceContent::Event(event) => {
                let release = add(*cursor, multiply(duration(&event.duration)?, scale)?)?;
                sound(event, *cursor, release, sounds);
                *cursor = release;
            }
            SequenceContent::Space(space) => {
                *cursor = add(
                    *cursor,
                    multiply(
                        Fraction::new(u64::from(space.duration.0), u64::from(space.duration.1)),
                        scale,
                    )?,
                )?;
            }
            SequenceContent::Tuplet(tuplet) => {
                let inner = multiply(
                    duration(&tuplet.inner.duration)?,
                    Fraction::new(u64::from(tuplet.inner.multiple), 1),
                )?;
                let outer = multiply(
                    duration(&tuplet.outer.duration)?,
                    Fraction::new(u64::from(tuplet.outer.multiple), 1),
                )?;
                if inner.num == 0 {
                    return None;
                }
                let ratio = multiply(outer, Fraction::new(inner.den, inner.num))?;
                walk(&tuplet.content, cursor, multiply(scale, ratio)?, sounds)?;
            }
            SequenceContent::MultiNoteTremolo(tremolo) => {
                let span = multiply(
                    duration(&tremolo.outer.duration)?,
                    Fraction::new(u64::from(tremolo.outer.multiple), 1),
                )?;
                let release = add(*cursor, multiply(span, scale)?)?;
                for event in &tremolo.content {
                    sound(event, *cursor, release, sounds);
                }
                *cursor = release;
            }
            // Grace groups have no notated duration: they cannot establish a
            // release anchor independently of the principal sounding event.
            SequenceContent::Grace(_) | SequenceContent::Other(_) => {}
        }
    }
    Some(())
}

pub(super) fn anchor(
    score: &Score,
    part: &Part,
    index: usize,
    change: &InstrumentChange,
) -> Option<(usize, RhythmicPosition)> {
    let times = effective_time_signature_table(&score.global.measures);
    let (meters, _) = resolve_staff_meter_table(&part.measures, &times);
    let mut starts = vec![Fraction::new(0, 1)];
    for time in &times {
        starts.push(add(
            *starts.last()?,
            Fraction::new(u64::from(time.count), u64::from(time.unit)),
        )?);
    }
    let boundary = add(
        *starts.get(index)?,
        Fraction::new(
            u64::from(change.fraction().0),
            u64::from(change.fraction().1),
        ),
    )?;
    let mut sounds = Vec::new();
    for (mi, measure) in part.measures.iter().enumerate() {
        for sequence in &measure.sequences {
            let mut cursor = *starts.get(mi)?;
            let scale = meters
                .get(mi)
                .and_then(|m| m.get(&sequence.staff.unwrap_or(1)))
                .map_or(Fraction::new(1, 1), |meter| meter.ratio_to_global);
            walk(&sequence.content, &mut cursor, scale, &mut sounds)?;
        }
    }
    extend_ties(&mut sounds);
    let release = sounds
        .iter()
        .filter(|sound| before(sound.onset, boundary))
        .map(|sound| sound.release)
        .max_by(|a, b| {
            (u128::from(a.num) * u128::from(b.den)).cmp(&(u128::from(b.num) * u128::from(a.den)))
        })?;
    // No resting interval before the change means no advance reminder.
    if !before(release, boundary) {
        return None;
    }

    fn extend_ties(sounds: &mut [Sound]) {
        let ids: HashMap<_, _> = sounds
            .iter()
            .enumerate()
            .flat_map(|(index, sound)| sound.ids.iter().map(move |id| (id.clone(), index)))
            .collect();
        let mut order: Vec<_> = (0..sounds.len()).collect();
        // A tie target must be later in musical time; reverse order resolves
        // entire chains once, without duplicating rhythmic durations.
        order.sort_by(|&a, &b| {
            let a = sounds[a].onset;
            let b = sounds[b].onset;
            (u128::from(b.num) * u128::from(a.den)).cmp(&(u128::from(a.num) * u128::from(b.den)))
        });
        for index in order {
            let mut release = sounds[index].release;
            for target in &sounds[index].targets {
                if let Some(&target) = ids.get(target) {
                    if before(sounds[index].onset, sounds[target].onset)
                        && before(release, sounds[target].release)
                    {
                        release = sounds[target].release;
                    }
                }
            }
            sounds[index].release = release;
        }
    }
    let anchor_index = starts
        .iter()
        .take(times.len())
        .rposition(|start| !before(release, *start))?;
    let start = starts[anchor_index];
    let local = Fraction::new(
        release
            .num
            .checked_mul(start.den)?
            .checked_sub(start.num.checked_mul(release.den)?)?,
        release.den.checked_mul(start.den)?,
    );
    Some((
        anchor_index,
        RhythmicPosition {
            fraction: (
                u32::try_from(local.num).ok()?,
                u32::try_from(local.den).ok()?,
            ),
        },
    ))
}
