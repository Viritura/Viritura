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

The browser audio worklet is generated during application development/build from the
package-manager dependency rather than stored as a vendored bundle:

- `spessasynth_lib` 4.3.1, copyright its contributors,
  [Apache License 2.0](LICENSES/Apache-2.0.txt),
  <https://github.com/spessasus/spessasynth_lib>
- `spessasynth_core` 4.3.22, copyright its contributors,
  [Apache License 2.0](LICENSES/Apache-2.0.txt),
  <https://github.com/spessasus/spessasynth_core>

`packages/audio/src/assetStaging.ts` copies the unmodified processor and source map
from the installed `spessasynth_lib` package into Git-ignored application
public-assets directories. The package distributions include the Apache 2.0
license and no separate `NOTICE` file.

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
