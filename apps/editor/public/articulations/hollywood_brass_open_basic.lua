-- Hollywood Brass "basic (open only)" mapper.
--
-- A cut-down variant of hollywood_brass_basic that omits the muted (con sordino)
-- patches, for libraries loaded with only the three open articulations.
--
-- The patch is selected by MIDI channel (one channel per articulation) and dynamics ride on CC11.
-- Every callback receives the timeline `time` (seconds) of its event; MIDI is scheduled relative to
-- that time and any event before the origin is clamped to 0.
--
--   Channel 1  Marcato    (short notes, held <= 0.75 s)
--   Channel 2  Sustain    (long notes,  held  > 0.75 s)
--   Channel 3  Staccato
--
--   CC11  Dynamics   -- Marcato/Sustain: the ONLY loudness control (velocity is nominal)
--                    -- Staccato:        combined with note velocity

local MARCATO = 1
local SUSTAIN = 2
local STACCATO = 3

local SUSTAIN_THRESHOLD = 0.75 -- seconds; marcato notes longer than this become sustains
local LATENCY = 0.03 -- seconds to nudge channel-priming CCs ahead of the note
local NOMINAL_VELOCITY = 96 -- fixed note velocity for CC11-only articulations

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

-- Pick the channel/patch for a note from its articulation and held duration.
local function channel_for(note)
    if note.articulations.staccato or note.articulations.staccatissimo then
        return STACCATO
    elseif note.duration > SUSTAIN_THRESHOLD then
        return SUSTAIN
    end
    return MARCATO
end

local function is_dynamic_only(channel)
    return channel == MARCATO or channel == SUSTAIN
end

function reset(time)
    state.dynamic = 0.5 -- last known dynamic, 0..1
    state.active_channel = nil -- channel of the note currently sounding, if any
end

-- CC11 is the master dynamic. Marcato/Sustain are driven purely by it, so keep it moving live on
-- the sounding channel; staccato reads it too but blends it with velocity at note-on.
function dynamics(time, value)
    state.dynamic = value
    if state.active_channel then
        midi.cc(time, 11, to_data(value), state.active_channel)
    end
end

function note_on(time, note)
    local channel = channel_for(note)
    state.active_channel = channel
    state.dynamic = note.dynamics

    -- Prime the channel just before the note sounds with its starting dynamic.
    midi.cc(time - LATENCY, 11, to_data(note.dynamics), channel)

    -- Marcato/Sustain ignore velocity (CC11 is everything); staccato combines the two.
    local velocity = NOMINAL_VELOCITY
    if not is_dynamic_only(channel) then
        velocity = to_velocity(note.dynamics)
    end

    midi.note({
        startTime = time,
        endTime = time + note.duration,
        pitch = note.pitch,
        velocity = velocity,
        channel = channel,
        id = note.id,
    })
end

function note_off(time, note)
    state.active_channel = nil
end
