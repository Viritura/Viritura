# Contributing to Viritura

Thank you for contributing. Bug fixes, features, tests, documentation,
accessibility improvements, and ideas are all welcome. Open an issue or a pull
request—whichever feels more useful for the change. If you are unsure where to
start, an issue is a good place to discuss it.

Setup instructions and repository structure are in the
[`README`](README.md#getting-started). Validation commands and guidance for
choosing focused checks are in
[`docs/setup/development.md`](docs/setup/development.md). Please include tests
for behavior changes where practical and list the checks you ran in the pull
request. Screenshots or recordings help reviewers understand visible changes.

Do not include credentials, private user data, or suspected vulnerabilities in
public issues or pull requests. Follow [`SECURITY.md`](SECURITY.md) to report
security problems privately.

## Generated files and schemas

Commit generated source artifacts when their source changes, but do not edit the
artifacts themselves.

- `packages/format/schemas/mnx-schema.json` is vendored from W3C MNX. Update it
  with `pnpm mnx:schema:sync`, which records provenance and regenerates bindings.
  Do not hand-edit it or `mnx-schema-source.json`.
- `packages/format/schemas/viritura-extensions.json` is Viritura's hand-authored
  schema. After changing it, run
  `pnpm --filter @viritura/format gen:raw-viritura`,
  `pnpm --filter @viritura/format gen:validators`, and
  `pnpm gen:raw:rust`.
- MNX TypeScript bindings are regenerated with
  `pnpm --filter @viritura/format gen:raw`; Rust bindings and embedded schema
  snapshots are regenerated with `pnpm gen:raw:rust`.
- Do not commit or hand-edit package `dist` directories, Storybook static output,
  or `engine/viritura-wasm/pkg-browser`. Build them with the documented commands.

The lint gates check schema provenance and generated-artifact drift. See
[`docs/spec/data-model-pipeline.md`](docs/spec/data-model-pipeline.md) for the
authoritative source/generated boundary.

## Third-party material

Do not add code, fonts, scores, audio, images, videos, fixtures, or other material
unless redistribution and modification rights are clear and compatible with the
repository. In the pull request, identify the source, author or copyright owner,
license, modifications, and any required attribution. Add the license text and
update [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) when applicable. Do not
assume that public availability permits redistribution.

## Review and releases

Reviews consider correctness, tests, compatibility, security, user experience,
provenance, and maintenance cost. Maintainers may suggest a different approach
or follow-up work. Maintainers are responsible for merging, versioning,
deployment, releases, and security disclosures.

Participation is governed by [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
