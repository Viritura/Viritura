# Notice on data provenance

The [MIT license](LICENSE) covers this project's own contributions: the library
code, the Python tooling, the mapping file format and its schema, the font-level
metadata (successor fonts, styles, `staffSpacesPerEm`) and the research behind
it, and the mapping tables to the extent they are this project's work.

Some of the data this project builds on originates elsewhere: with MakeMusic,
Inc., which developed Finale, and with Steinberg Media Technologies GmbH, which
publishes Bravura, the SMuFL reference font. That data is described below so a
reader can see exactly what it is and where it came from, rather than having to
infer it.

## Legacy mapping tables

`source_json/legacy/*.json` maps legacy music-font codepoints to SMuFL glyph
names and Unicode codepoints. Finale 27 distributed conversion data of its own
for a subset of these fonts, and files in this project that were seeded from it
say so: every file records a `provenance` value in its `fontMetadata`, either
`finale-sourced` or `independent`, with a `provenanceNotes` string describing
what the mapping was derived from and what has changed since.

At the time of writing, 31 of the 38 files are `finale-sourced` and 7 were
compiled independently because Finale distributed no conversion data for those
fonts. Among the 31, the degree of subsequent revision varies widely — a few
have been substantially rebuilt, most have been revised by adding legacy
codepoints for glyphs the original mapped only once, and several remain
materially unchanged from the data they were seeded from. The per-file
`provenanceNotes` are the authoritative record; this paragraph is a summary and
may lag them.

What these files record is a correspondence between a codepoint in a legacy font
and the SMuFL glyph that carries the same symbol. That correspondence is a fact
about the font, and the tables here are exhaustive enumerations of it, arranged
under this project's own schema. The purpose of publishing them is
interoperability: allowing software that is not Finale to read documents that
reference these fonts.

The `xOffset` and `yOffset` values are Finale-specific positional data carried
over unchanged from the MakeMusic source. Nothing in this project consumes them
and no API exposes them. They are retained deliberately, because a future
standardised schema for legacy font mapping may want them, and that information
cannot be reconstructed once dropped.

## `source_json/glyphnamesFinale.json`

This file lists the optional-range glyph names, codepoints and descriptions used
by the MakeMusic SMuFL fonts. It is reproduced from the file of the same name
distributed inside the Finale application, with three malformed keys repaired;
the codepoints and descriptions are otherwise MakeMusic's. It is included so
that legacy mappings referencing MakeMusic's optional glyph names can be
resolved to Unicode codepoints, which is not possible from the SMuFL standard
metadata alone.

Note that this file is an application resource rather than font software, so
MakeMusic's release of the Finale SMuFL fonts under the SIL Open Font License
does not extend to it.

## `source_json/glyphnamesBravura.json`

This file lists the optional-range glyph names, codepoints and descriptions
defined by Bravura, the SMuFL reference font. It is a copy of the
`optionalGlyphs` section of `bravura_metadata.json` as distributed with Bravura:
all 518 entries are reproduced with their codepoints, classes and descriptions
unchanged. One entry, `gClef8vbFrench` at `U+F606`, was added by this project
and is not part of Bravura's metadata. It is included so that mappings
referencing Bravura's optional glyph names can be resolved to Unicode
codepoints, which the SMuFL standard metadata alone does not cover.

Bravura carries this notice:

> Copyright © 2019, Steinberg Media Technologies GmbH
> (http://www.steinberg.net/), with Reserved Font Name "Bravura".
>
> This Font Software is licensed under the SIL Open Font License, Version 1.1,
> available with a FAQ at http://scripts.sil.org/OFL

Bravura's own license file is reproduced verbatim at [OFL.txt](OFL.txt), so the
notice and the full license travel with any copy of this project. Unlike
`glyphnamesFinale.json`, which is an application resource, this file is part of
the release that license covers, which is why both are included here. The
reserved font name is not used to name any font: "Bravura" appears here only to
identify the source of the data.

## Fonts

No font software is distributed with this project. The legacy fonts themselves
remain the property of their respective owners and are not redistributable; the
MakeMusic SMuFL fonts (Finale Maestro, Finale Broadway, Finale Jazz, Finale Ash,
Finale Legacy and their text faces) were released by MakeMusic under the SIL
Open Font License and should be obtained from their distributor. Bravura is
likewise available under that license from Steinberg; only its glyph metadata is
reproduced here, and no part of the font itself is.

## Trademarks

Finale is a trademark of MakeMusic, Inc. Font names are trademarks of their
respective owners and are used here nominatively, to identify the fonts being
mapped. This project is not affiliated with, endorsed by, or sponsored by
MakeMusic, Inc., Steinberg Media Technologies GmbH, or any other font vendor.

## Contact

If you hold rights in any of the material described above and would like
something changed or removed, please open an issue on the project's repository.
