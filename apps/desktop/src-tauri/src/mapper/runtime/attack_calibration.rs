use mlua::{Lua, Table, Value};

use super::super::protocol::{PlaybackVelocityEndpoint, PlaybackVelocityInterpolation};

#[cfg(test)]
mod tests;

pub(super) fn install(lua: &Lua, midi: &Table) -> mlua::Result<()> {
    midi.set(
        "attack_velocity",
        lua.create_function(|_, (note, default_mapping): (Table, Value)| {
            if let Some(velocity) = optional_velocity(&note)? {
                return Ok(velocity);
            }
            if let Some(interpolation) =
                note.get::<Option<Table>>("playbackVelocityInterpolation")?
            {
                let progress = unit(&interpolation, "progress")?;
                let from = endpoint_velocity(&interpolation.get("from")?, &default_mapping)?;
                let to = endpoint_velocity(&interpolation.get("to")?, &default_mapping)?;
                let value = f64::from(from) + (f64::from(to) - f64::from(from)) * progress;
                return velocity(Value::Number(value.round().clamp(1.0, 127.0)));
            }
            mapped_velocity(&default_mapping, unit(&note, "dynamics")?)
        })?,
    )
}

fn endpoint_velocity(endpoint: &Table, default_mapping: &Value) -> mlua::Result<u8> {
    let dynamics = unit(endpoint, "dynamics")?;
    match optional_velocity(endpoint)? {
        Some(velocity) => Ok(velocity),
        None => mapped_velocity(default_mapping, dynamics),
    }
}

fn mapped_velocity(default_mapping: &Value, dynamics: f64) -> mlua::Result<u8> {
    let value = match default_mapping {
        Value::Function(mapping) => mapping.call::<Value>(dynamics)?,
        constant => constant.clone(),
    };
    velocity(value)
}

fn optional_velocity(table: &Table) -> mlua::Result<Option<u8>> {
    match table.get::<Value>("playbackVelocity")? {
        Value::Nil => Ok(None),
        value => velocity(value).map(Some),
    }
}

fn velocity(value: Value) -> mlua::Result<u8> {
    match value {
        Value::Integer(value) if (1..=127).contains(&value) => Ok(value as u8),
        Value::Number(value)
            if value.is_finite() && (1.0..=127.0).contains(&value) && value.fract() == 0.0 =>
        {
            Ok(value as u8)
        }
        _ => Err(mlua::Error::RuntimeError(
            "midi.attack_velocity velocity must be a finite integer in 1..=127".to_owned(),
        )),
    }
}

fn unit(table: &Table, field: &str) -> mlua::Result<f64> {
    let value = match table.get::<Value>(field)? {
        Value::Integer(value) => value as f64,
        Value::Number(value) => value,
        _ => f64::NAN,
    };
    if value.is_finite() && (0.0..=1.0).contains(&value) {
        Ok(value)
    } else {
        Err(mlua::Error::RuntimeError(format!(
            "midi.attack_velocity {field} must be a finite number in 0..=1"
        )))
    }
}

pub(super) fn interpolation_table(
    lua: &Lua,
    interpolation: &PlaybackVelocityInterpolation,
) -> mlua::Result<Table> {
    let table = lua.create_table()?;
    table.set("from", endpoint_table(lua, &interpolation.from)?)?;
    table.set("to", endpoint_table(lua, &interpolation.to)?)?;
    table.set("progress", interpolation.progress)?;
    Ok(table)
}

fn endpoint_table(lua: &Lua, endpoint: &PlaybackVelocityEndpoint) -> mlua::Result<Table> {
    let table = lua.create_table()?;
    table.set("dynamics", endpoint.dynamics)?;
    table.set("playbackVelocity", endpoint.playback_velocity)?;
    Ok(table)
}
