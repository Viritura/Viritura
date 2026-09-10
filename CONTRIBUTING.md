# Contributing to Viritura

Thank you for contributing. Viritura welcomes focused bug fixes, tests,
documentation improvements, accessibility work, performance improvements,
notation and import/export corrections, and well-scoped features.

## Before starting

Search existing issues before opening a new one. Small, well-understood fixes can
go directly to a pull request. For a new feature, format change, architectural
change, or work spanning several packages, open a feature request first. Explain
the user problem, proposed scope, compatibility impact, and alternatives. Wait
for maintainer agreement before investing in a large implementation; agreement
on an issue is not a promise that a change will be merged.

Use the issue forms for bugs, feature requests, and documentation work. Do not
put suspected vulnerabilities, credentials, or private user data in an issue or
pull request. Follow [`SECURITY.md`](SECURITY.md) to report vulnerabilities
privately.

## Set up the repository

The recommended Docker worktree workflow and native prerequisites are in the
[`README`](README.md#getting-started). The complete toolchain setup, development
commands, and cache behavior are in
[`docs/setup/development.md`](docs/setup/development.md).

Keep a pull request limited to one concern. Use descriptive, imperative commit
messages and keep commits reviewable; do not mix formatting or dependency
updates with an unrelated fix. Do not rewrite reviewed history without telling
reviewers. Link the issue the pull request addresses.

Follow the conventions in `AGENTS.md` and any path-specific repository
instructions. Engraving changes should be grounded in established engraving
practice. New engraving behavior and UI surfaces generally need the
corresponding tests and Storybook story described there.

## Select checks

Run the smallest relevant checks while iterating, then run all checks appropriate
to the changed surfaces before requesting review:

| Change                                    | Required checks                                                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| TypeScript or React                       | Affected package test/build, then `pnpm lint`                                                                            |
| Rust engine or WASM                       | Focused `pnpm test:rust <test-name>`, then `pnpm lint:rust` and `pnpm test:rust`; add `pnpm test:rust:wasm` for bindings |
| .NET server                               | `pnpm lint:dotnet`, `pnpm build:dotnet`, and `pnpm test:dotnet`                                                          |
| Desktop Rust                              | `pnpm test:desktop`                                                                                                      |
| VST probe                                 | `pnpm test:vst-probe`                                                                                                    |
| Cross-cutting or release-sensitive        | `pnpm validate`                                                                                                          |
| Browser behavior                          | Relevant unit tests plus `pnpm e2e` with worktree services running                                                       |
| Documentation or repository metadata only | `pnpm exec prettier --check --ignore-unknown <changed-files>`                                                            |

`pnpm test` covers JavaScript and TypeScript only. If a toolchain is unavailable,
state which check was not run and why in the pull request. CI is a backstop, not
a replacement for focused local testing. Include regression tests for behavior
changes and screenshots or recordings for visible changes.

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

## Review and acceptance

Maintainers review correctness, scope, tests, compatibility, security, user
experience, provenance, and long-term maintenance cost. Address review comments
with new commits or clearly explain a different approach. Approval may require
review from owners of sensitive surfaces such as authentication, deployment,
schemas, and the engraving engine.

Maintainers decide whether and how to merge, may ask that a change be split or
reworked, and retain sole authority for releases, versioning, deployment, and
security disclosures. Contributors must not publish artifacts or represent an
unmerged change as an official Viritura release.

Participation is governed by [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
