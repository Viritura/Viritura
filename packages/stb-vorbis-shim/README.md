# stb-vorbis SF2-only shim

Viritura supports uncompressed SF2 SoundFonts. This private workspace package
matches the `stb-vorbis` API used by SpessaSynth without installing its decoder.
`StbVorbis.ready` resolves immediately, while `StbVorbis.decode()` reports that
SF3 decoding is unavailable.

The published `spessasynth_lib` audio-worklet bundle is prebuilt and remains
unchanged by this override. The override only replaces the standalone
`stb-vorbis` dependency in Viritura's installed application dependency graph.
