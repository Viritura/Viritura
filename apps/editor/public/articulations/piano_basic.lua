-- Piano "basic" mapper.
--
-- A single-patch instrument: every note plays on one MIDI channel and the note's dynamic maps
-- straight to note-on velocity (a struck piano key has no post-attack loudness control, so there
-- is no CC11 dynamics ride here). Every callback receives the timeline `time` (seconds) of its
-- event; MIDI is scheduled relative to that time and any event before the origin is clamped to 0.
--
--   Channel 1  Piano
--
--   Velocity   <- Dynamics (the note's dynamic level is the only loudness control)

local PIANO = 1

local function to_data(value)
    local scaled = math.floor(value * 127 + 0.5)
    if scaled < 0 then
        return 0
    elseif scaled > 127 then
        return 127
    end
    return scaled
end

-- Velocity must be an audible note-on (0 would read as a note-off), so clamp the low end to 1.
local function to_velocity(value)
    local data = to_data(value)
    if data < 1 then
        return 1
    end
    return data
end

function reset(time)
    state.dynamic = 0.5 -- last known dynamic, 0..1
end

-- A piano's loudness is fixed at the moment the key is struck, so a mid-note dynamic change only
-- affects subsequent notes. Remember it for the next note_on.
function dynamics(time, value)
    state.dynamic = value
end

function note_on(time, note)
    midi.note({
        startTime = time,
        endTime = time + note.duration,
        pitch = note.pitch,
        velocity = to_velocity(note.dynamics),
        channel = PIANO,
        id = note.id,
    })
end

function note_off(time, note)
end
