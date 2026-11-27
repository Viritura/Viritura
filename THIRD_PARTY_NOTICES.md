# Third-Party Notices

Viritura's MIT license applies to the original source code in this repository.
The assets and generated components below remain under their respective terms.

## Music and text fonts

The following unmodified font binaries are distributed under the
[SIL Open Font License 1.1](LICENSES/OFL-1.1.txt):

| Font files                       | Copyright and source                                                                                                                                   | Reserved font name                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| `Bravura.otf`, `BravuraText.otf` | Copyright 2021 Steinberg Media Technologies GmbH. Designed by Daniel Spreadbury and contributors. [Bravura](https://github.com/steinbergmedia/bravura) | Bravura                            |
| `LibertinusSerif-*.otf`          | Copyright 2012-2021 The Libertinus Project Authors. [Libertinus](https://github.com/alerque/libertinus)                                                | None recorded in the bundled files |
| `Anybody-700.ttf`                | Copyright 2020 The Anybody Project Authors. [Anybody](https://github.com/Etcetera-Type-Co/Anybody)                                                     | None recorded in the bundled file  |
| `BodoniModa-600.ttf`             | Copyright 2020 The Bodoni Moda Project Authors. [Bodoni Moda](https://github.com/indestructible-type/Bodoni)                                           | None recorded in the bundled file  |

The font binaries have not been modified. Their embedded license metadata and
copyright notices are retained. The OFL does not apply to documents or images
created with these fonts.

## SpessaSynth

The browser audio worklet and offline MP3 synthesis use package-manager
dependencies rather than a vendored bundle:

- `spessasynth_lib` 4.4.8, copyright its contributors,
  [Apache License 2.0](LICENSES/Apache-2.0.txt),
  <https://github.com/spessasus/spessasynth_lib>
- `spessasynth_core` 4.4.10, copyright its contributors,
  [Apache License 2.0](LICENSES/Apache-2.0.txt),
  <https://github.com/spessasus/spessasynth_core>

`packages/audio/src/assetStaging.ts` copies the unmodified processor and source map
from the installed `spessasynth_lib` package into Git-ignored application
public-assets directories. The package distributions include the Apache 2.0
license and no separate `NOTICE` file.

## MP3 encoding

MP3 export includes these components:

- [`@audio/encode-mp3` 2.0.1](https://github.com/audiojs/encode/tree/8d914d0a76e5266b6a2591c11ea43aa0aeec1189/packages/encode-mp3),
  copyright 2026 Dmitry Iv., under the [MIT License](LICENSES/audio-encode-mp3-MIT.txt).
- [`wasm-media-encoders` 0.7.0](https://github.com/arseneyr/wasm-media-encoders/tree/4a45333baadbab312d1cc0911151dfad23157c51),
  copyright 2020-2024 arseneyr, under the [MIT License](LICENSES/wasm-media-encoders-MIT.txt).
- A WebAssembly build of [`libmp3lame`](https://github.com/arseneyr/lame/tree/98db548e8e851defbba3184125ce10725355c332),
  by the LAME Project and contributors, under the
  [GNU Library General Public License, version 2](LICENSES/LGPL-2.0.txt).

The linked sources and the `wasm-media-encoders` Makefile provide the encoder
source and build recipe. To replace or modify the LAME build, rebuild
`wasm-media-encoders`, rebuild `@audio/encode-mp3` against that version, and
rebuild Viritura with the replacement package.

## Denigma

The Finale MUSX importer bundles a WebAssembly build of
[Denigma](https://github.com/openmusx/denigma), distributed under the MIT
License. Exact source revisions and artifact hashes are recorded in
`packages/musx-import/assets/manifest.json`; the Denigma license is retained
beside the generated assets. The package also retains the license files for the
linked musxdom, mnxdom, smufl-mapping, pugixml, nlohmann/json,
json-schema-validator, zlib, Emscripten, musl, and libc++ runtime dependencies,
plus the smufl-mapping notice and Bravura-derived mapping data's SIL Open Font
License.

## SoundFont

`packages/audio/assets/sounds/Shan-SGM-Pro-15.sf2` is the **Shan SGM Pro 15**
SoundFont by Shan.

- Creator reference: <https://www.youtube.com/@ShanAudioChannel>
- SHA-256: `01ab03ff5156724c7c922fcabdb653d053ba50bd38a814756365b49e6a8c8d57`

The bundled file does not contain a standard license identifier. Before a
public release, retain the creator's explicit redistribution permission with
the project's release records. A channel or download-page reference alone is
not a redistribution license.

## Impulse responses

The five WAV files in `packages/audio/assets/sounds/ir/` come from
[Voxengo Free Reverb Impulse Responses](https://www.voxengo.com/impulses/)
and are distributed under the bundled
[Voxengo impulse-response conditions](LICENSES/Voxengo-Impulse-Responses.txt):

- `french-salon.wav`
- `masonic-lodge.wav`
- `musikvereinsaal.wav`
- `scala-milan-opera.wav`
- `st-nicolaes-church.wav`

These files are complete and byte-identical to their entries in Voxengo's
official `IMreverbs.zip`. Aleksey Vaneev retains exclusive ownership of the
impulse files and all intellectual property rights in them.

The Voxengo files must be removed before any paid version or paid distribution
of Viritura. Non-paid distributions that include them must remain free of
charge and include the copyright notice and complete conditions linked above.

## Demo video

Viritura can stream **Caminandes 3: Llamigos**, copyright Blender Foundation,
from Wikimedia Commons. The video is not stored in this repository. It is used
under [Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/).

- Work page: <https://studio.blender.org/films/caminandes-3/>
- Credit: Caminandes 3: Llamigos, Blender Foundation

The source URL, license, and required attribution are also carried in
`packages/video-sync/src/demoSources.ts` and shown with the clip.
