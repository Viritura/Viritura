# MIDI controller profiles

Controller profiles map device-specific MIDI messages to Viritura actions. Keep
one profile per controller under a manufacturer folder and validate it against
[`schema.json`](./schema.json).

## Contributing a profile

1. Capture the controller in Viritura's **Settings > MIDI Monitor**.
2. Record the operating system, firmware (when known), input-port names, MIDI
   channel, message type, number, and trigger value.
3. Add a JSON file under a lowercase manufacturer folder.
4. Use semantic port roles such as `performance` and `controls`. Port names are
   exact aliases because operating systems frequently expose different names
   for the same USB endpoint.
5. Add the profile to the built-in registry in
   `src/controllerProfiles/registry.ts`.
6. Run `pnpm --filter @viritura/midi test` and
   `pnpm --filter @viritura/midi build`.

MIDI channels in profile JSON are human-readable numbers 1-16. Note and
controller numbers and values use the MIDI range 0-127. Bind press messages,
not their corresponding release messages, unless an action explicitly requires
both.

Relative encoders commonly use `1` for a clockwise increment and `127` for a
counterclockwise decrement. Profiles should bind the values the hardware
actually emits rather than assuming every encoder uses the same relative mode.

Profiles are reviewed defaults. User-created MIDI Learn overrides should remain
separate from these files so an upstream profile update never replaces a
personal mapping.
