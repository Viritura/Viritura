# Examples

Runnable examples of how to embed Viritura in your own project.

| Example                                                      | Stack        | Notes                               |
| ------------------------------------------------------------ | ------------ | ----------------------------------- |
| [`score-viewer-react-minimal`](./score-viewer-react-minimal) | React + Vite | 30-line `<ScoreView>` with playhead |

## Why workspace links?

Examples currently use `"workspace:*"` to pull in the latest
in-development packages. When `@viritura/score-engine` and
`@viritura/score-viewer-react` ship to npm, the examples become
standalone reference templates by changing one line in each
`package.json`.

## Adding a new example

1. Make a folder under `examples/`
2. Use `@viritura-examples/<name>` as the package name
3. Keep it minimal — examples are docs, not production apps
4. Add a row to the table above
