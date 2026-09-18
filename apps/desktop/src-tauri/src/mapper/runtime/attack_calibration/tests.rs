use crate::mapper::{LuaMapper, LuaMapperConfig};

#[test]
fn helper_prioritizes_explicit_values_and_validates_all_resolved_velocities() {
    let source = r#"
        local function unused() error("default mapping must not run") end
        for _, velocity in ipairs({1, 96, 127}) do
            local result = midi.attack_velocity({playbackVelocity = velocity}, unused)
            assert(result == velocity and math.type(result) == "integer")
            assert(midi.attack_velocity({
                dynamics = 0.5,
                playbackVelocityInterpolation = {
                    from = {dynamics = 0, playbackVelocity = velocity},
                    to = {dynamics = 1, playbackVelocity = velocity},
                    progress = 0.5,
                },
            }, unused) == velocity)
            assert(midi.attack_velocity({dynamics = 0.5}, velocity) == velocity)
            assert(midi.attack_velocity({dynamics = 0.5}, function(d)
                assert(d == 0.5)
                return velocity
            end) == velocity)
        end
        assert(midi.attack_velocity({
            playbackVelocity = 17,
            playbackVelocityInterpolation = {},
        }, unused) == 17)
        local invalid = {0, -1, 128, 256, 96.5, 0/0, math.huge, -math.huge,
                         1e300, "96", true, {}, function() end}
        for _, value in ipairs(invalid) do
            local function rejects(note, mapping)
                local ok, err = pcall(midi.attack_velocity, note, mapping)
                assert(not ok and string.find(tostring(err), "finite integer"))
            end
            rejects({playbackVelocity = value}, unused)
            rejects({dynamics = 0.5}, value)
            rejects({dynamics = 0.5}, function() return value end)
            for _, field in ipairs({"from", "to"}) do
                local ramp = {
                    from = {dynamics = 0, playbackVelocity = 100},
                    to = {dynamics = 1, playbackVelocity = 112},
                    progress = 0.5,
                }
                ramp[field].playbackVelocity = value
                rejects({playbackVelocityInterpolation = ramp}, unused)
                ramp[field].playbackVelocity = nil
                rejects({playbackVelocityInterpolation = ramp}, function() return value end)
            end
        end
        assert(not pcall(midi.attack_velocity, {dynamics = 0.5}, nil))
        assert(not pcall(midi.attack_velocity, {dynamics = 0.5}, function() end))
    "#;
    LuaMapper::new(source, LuaMapperConfig::default()).unwrap();
}

#[test]
fn helper_rejects_mutated_non_finite_out_of_range_and_malformed_interpolation() {
    let source = r#"
        local invalid = {-0.001, 1.001, 0/0, math.huge, -math.huge, "0.5", true, {}}
        for _, value in ipairs(invalid) do
            assert(not pcall(midi.attack_velocity, {dynamics = value}, 96))
            for _, field in ipairs({"from", "to", "progress"}) do
                local ramp = {
                    from = {dynamics = 0, playbackVelocity = 1},
                    to = {dynamics = 1, playbackVelocity = 127},
                    progress = 0.5,
                }
                if field == "progress" then
                    ramp.progress = value
                else
                    ramp[field].dynamics = value
                end
                local ok, err = pcall(midi.attack_velocity,
                                     {playbackVelocityInterpolation = ramp}, 96)
                assert(not ok and string.find(tostring(err), "finite number"))
            end
        end
        for _, value in ipairs({true, 1, "ramp", {}}) do
            assert(not pcall(midi.attack_velocity,
                            {playbackVelocityInterpolation = value}, 96))
        end
        for _, field in ipairs({"from", "to", "progress"}) do
            local ramp = {
                from = {dynamics = 0}, to = {dynamics = 1}, progress = 0.5,
            }
            ramp[field] = nil
            assert(not pcall(midi.attack_velocity,
                            {playbackVelocityInterpolation = ramp}, 96))
        end
    "#;
    LuaMapper::new(source, LuaMapperConfig::default()).unwrap();
}

#[test]
fn helper_rounds_half_up_and_retains_valid_extreme_endpoints() {
    let source = r#"
        for _, endpoints in ipairs({{1, 127}, {127, 1}, {1, 2}, {126, 127}}) do
            for _, progress in ipairs({0, 0.25, 0.5, 0.75, 1}) do
                local result = midi.attack_velocity({
                    playbackVelocityInterpolation = {
                        from = {dynamics = 0, playbackVelocity = endpoints[1]},
                        to = {dynamics = 1, playbackVelocity = endpoints[2]},
                        progress = progress,
                    },
                }, function() error("explicit endpoints need no default") end)
                assert(result == math.floor(endpoints[1] +
                    (endpoints[2] - endpoints[1]) * progress + 0.5))
                assert(math.type(result) == "integer" and result >= 1 and result <= 127)
            end
        end
    "#;
    LuaMapper::new(source, LuaMapperConfig::default()).unwrap();
}
